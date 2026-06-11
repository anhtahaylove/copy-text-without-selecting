const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("@playwright/test");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const EXTENSION_ROOT = path.join(PROJECT_ROOT, "dist", "chrome");
const BROWSER_EXE = chromium.executablePath();
const INSTALL_SCRIPT = path.join(PROJECT_ROOT, "scripts", "install-native-host-windows.cjs");
const UNINSTALL_SCRIPT = path.join(PROJECT_ROOT, "scripts", "uninstall-native-host-windows.cjs");
const nativeInstall = require("./install-native-host-windows.cjs");
const NATIVE_EXE = path.join(PROJECT_ROOT, "dist", "native", "copy-text-companion.exe");
const HOST = "127.0.0.1";
const JSON_TEXT = "{\"integration\":\"copy-text-native\",\"value\":42}";
const OFFLINE_KEEP_TEXT = "offline history item to pin";
const OFFLINE_DELETE_TEXT = "offline history item to delete";
const AFTER_CLEAR_TEXT = "history item created after offline clear";
let fixtureUrl = "";

async function main() {
  assertFile(BROWSER_EXE, "Playwright Chromium");
  assertFile(NATIVE_EXE, "Native companion");
  assertFile(path.join(EXTENSION_ROOT, "manifest.json"), "Built extension");

  const nativeState = captureNativeHostState();
  const server = await startFixtureServer();
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "copy-text-native-e2e-appdata-"));
  const nativeInstallRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copy-text-native-e2e-install-"));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "copy-text-native-e2e-profile-"));
  let extensionId = "";
  let session = null;
  const cleanupErrors = [];

  try {
    console.log("Launching Playwright Chromium with the unpacked extension...");
    session = await launchExtension(appData, userDataDir);
    extensionId = session.extensionId;
    console.log(`Detected unpacked extension ID: ${extensionId}`);
    installHost(extensionId, nativeInstallRoot);

    console.log("Verifying connected native companion flow...");
    await verifyConnectedFlow(session.context);
    await closeSession(session);
    session = null;

    console.log("Removing the native host to queue offline history operations...");
    uninstallHost(nativeInstallRoot);
    await delay(400);

    session = await launchExtension(appData, userDataDir);
    await verifyOfflinePinDeleteQueue(session.context);
    await closeSession(session);
    session = null;

    console.log("Reinstalling the native host to flush offline pin/delete operations...");
    installHost(extensionId, nativeInstallRoot);
    session = await launchExtension(appData, userDataDir);
    await verifyPinDeleteReconnect(session.context);
    await closeSession(session);
    session = null;

    console.log("Removing the native host to queue clear followed by a new copy...");
    uninstallHost(nativeInstallRoot);
    await delay(400);
    session = await launchExtension(appData, userDataDir);
    await verifyOfflineClearQueue(session.context);
    await closeSession(session);
    session = null;

    console.log("Reinstalling the native host to verify clear ordering...");
    installHost(extensionId, nativeInstallRoot);
    session = await launchExtension(appData, userDataDir);
    await verifyClearReconnect(session.context);
    await closeSession(session);
    session = null;

    console.log("Removing the native host for the final local fallback check...");
    uninstallHost(nativeInstallRoot);
    await delay(400);
    session = await launchExtension(appData, userDataDir);
    await verifyLocalFallback(session.context, AFTER_CLEAR_TEXT);
  } finally {
    await cleanupStep("browser session", async function () {
      if (session) await closeSession(session);
    }, cleanupErrors);
    await cleanupStep("fixture server", function () {
      return stopServer(server);
    }, cleanupErrors);
    await cleanupStep("native host registration", function () {
      restoreNativeHostState(nativeState);
    }, cleanupErrors);
    await cleanupStep("temporary native install", function () {
      fs.rmSync(nativeInstallRoot, { recursive: true, force: true });
    }, cleanupErrors);
    await cleanupStep("temporary app data", function () {
      fs.rmSync(appData, { recursive: true, force: true });
    }, cleanupErrors);
    await cleanupStep("Playwright profile", function () {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }, cleanupErrors);
  }

  if (cleanupErrors.length) {
    throw new Error(formatCleanupErrors(cleanupErrors));
  }

  console.log(`Native Chrome integration passed for extension ${extensionId}.`);
}

async function launchExtension(appData, userDataDir) {
  let context = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: BROWSER_EXE,
      headless: true,
      env: Object.assign({}, process.env, { APPDATA: appData }),
      args: [
        `--disable-extensions-except=${EXTENSION_ROOT}`,
        `--load-extension=${EXTENSION_ROOT}`,
      ],
    });

    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(fixtureUrl).origin,
    });

    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    }

    return {
      context,
      extensionId: new URL(serviceWorker.url()).host,
    };
  } catch (error) {
    if (context) {
      await context.close().catch(function () {});
    }
    throw error;
  }
}

async function closeSession(session) {
  await session.context.close();
  await delay(250);
}

async function verifyConnectedFlow(context) {
  const extensionId = new URL(context.serviceWorkers()[0].url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await waitFor(async function () {
    return (await popup.locator("#native_status").textContent()) === "Companion: connected";
  }, "popup to report Companion: connected");
  console.log("Popup reports Companion: connected.");

  await nativeMessage(popup, "COPY_TEXT_NATIVE_HISTORY_CLEAR");

  const fixture = await context.newPage();
  await fixture.goto(fixtureUrl);
  await fixture.locator("#json_payload").click({ modifiers: ["Alt"] });

  const listResponse = await waitFor(async function () {
    const response = await nativeMessage(popup, "COPY_TEXT_NATIVE_HISTORY_LIST", { limit: 10 });
    const history = response && response.ok && response.payload && response.payload.history;
    if (Array.isArray(history) && history.some(function (entry) { return entry.text === JSON_TEXT; })) {
      return response;
    }
    return null;
  }, "native history to receive the copied JSON");

  const entry = listResponse.payload.history.find(function (item) {
    return item.text === JSON_TEXT;
  });
  if (!entry || entry.format !== "json") {
    throw new Error(`Expected a JSON history entry, got ${JSON.stringify(entry)}`);
  }
  console.log("JSON copy reached native history.");

  const search = await nativeMessage(popup, "COPY_TEXT_NATIVE_HISTORY_LIST", {
    query: "copy-text-native",
    limit: 10,
  });
  assertHistoryCount(search, 1, "history search");
  console.log("Native history search passed.");

  const preview = await nativeMessage(popup, "COPY_TEXT_NATIVE_FORMAT_PREVIEW", {
    text: JSON_TEXT,
    action: "prettyJson",
  });
  if (!preview || !preview.ok || !preview.payload || !preview.payload.text.includes("\n  \"integration\"")) {
    throw new Error(`Expected pretty JSON preview, got ${JSON.stringify(preview)}`);
  }
  console.log("Smart JSON preview passed.");

  const pinned = await nativeMessage(popup, "COPY_TEXT_NATIVE_HISTORY_PIN", {
    id: entry.id,
    pinned: true,
  });
  if (!pinned || !pinned.ok || !pinned.payload.changed) {
    throw new Error(`Expected history pin to change the entry, got ${JSON.stringify(pinned)}`);
  }

  const pinnedList = await nativeMessage(popup, "COPY_TEXT_NATIVE_HISTORY_LIST", { limit: 10 });
  if (!pinnedList.payload.history[0].pinned) {
    throw new Error("Expected pinned entry to sort first.");
  }

  const unpinned = await nativeMessage(popup, "COPY_TEXT_NATIVE_HISTORY_PIN", {
    id: entry.id,
    pinned: false,
  });
  if (!unpinned || !unpinned.ok || !unpinned.payload.changed) {
    throw new Error(`Expected history unpin to change the entry, got ${JSON.stringify(unpinned)}`);
  }
  const unpinnedList = await nativeMessage(popup, "COPY_TEXT_NATIVE_HISTORY_LIST", { limit: 10 });
  if (unpinnedList.payload.history[0].pinned) {
    throw new Error("Expected history entry to be unpinned.");
  }
  console.log("Pin, unpin, and ordering passed.");

  const replayButton = popup.locator(".history-item", { hasText: "copy-text-native" }).locator("button").first();
  await replayButton.click();
  await waitFor(async function () {
    return fixture.evaluate(function () {
      return navigator.clipboard.readText();
    }).then(function (text) {
      return text === JSON_TEXT;
    });
  }, "history replay to copy JSON back to the clipboard");
  console.log("History replay copied JSON back to the clipboard.");

  await waitFor(async function () {
    const replayed = await nativeMessage(popup, "COPY_TEXT_NATIVE_HISTORY_LIST", { limit: 10 });
    const replayedEntry = replayed && replayed.ok && replayed.payload.history.find(function (item) {
      return item.text === JSON_TEXT;
    });
    return replayedEntry && replayedEntry.source === "history";
  }, "history replay metadata to synchronize");

  const deleted = await nativeMessage(popup, "COPY_TEXT_LOCAL_HISTORY_DELETE", {
    id: entry.id,
    text: entry.text,
  });
  if (!deleted || !deleted.ok) {
    throw new Error(`Expected history delete to remove the entry, got ${JSON.stringify(deleted)}`);
  }
  assertHistoryCount(await nativeMessage(popup, "COPY_TEXT_NATIVE_HISTORY_LIST", { limit: 10 }), 0, "history delete");
  console.log("Native history delete passed.");

  await fixture.locator("#json_payload").click({ modifiers: ["Alt"] });
  await waitFor(async function () {
    const response = await nativeMessage(popup, "COPY_TEXT_NATIVE_HISTORY_LIST", { limit: 10 });
    return response && response.ok && response.payload.history.length === 1;
  }, "history to refill before clear");

  const cleared = await nativeMessage(popup, "COPY_TEXT_LOCAL_HISTORY_CLEAR");
  if (!cleared || !cleared.ok) {
    throw new Error(`Expected history clear to remove items, got ${JSON.stringify(cleared)}`);
  }
  assertHistoryCount(await nativeMessage(popup, "COPY_TEXT_NATIVE_HISTORY_LIST", { limit: 10 }), 0, "history clear");
  console.log("Native history clear passed.");

  await fixture.close();
  await popup.close();
}

async function verifyOfflinePinDeleteQueue(context) {
  const extensionId = new URL(context.serviceWorkers()[0].url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await waitFor(async function () {
    return (await popup.locator("#native_status").textContent()) === "Companion: local mode";
  }, "popup to report Companion: local mode");
  console.log("Popup reports Companion: local mode.");

  const fixture = await context.newPage();
  await fixture.goto(fixtureUrl);
  await fixture.locator("#offline_keep").click({ modifiers: ["Alt"] });
  await fixture.locator("#offline_delete").click({ modifiers: ["Alt"] });

  const localList = await waitFor(async function () {
    const response = await nativeMessage(popup, "COPY_TEXT_LOCAL_HISTORY_LIST", { limit: 20 });
    const history = response && response.ok && response.payload && response.payload.history;
    if (response && response.payload && response.payload.mode === "local"
      && Array.isArray(history)
      && history.some(function (entry) { return entry.text === OFFLINE_KEEP_TEXT; })
      && history.some(function (entry) { return entry.text === OFFLINE_DELETE_TEXT; })) {
      return response;
    }
    return null;
  }, "offline copies to reach local history", 12000);

  const keepEntry = localList.payload.history.find(function (entry) {
    return entry.text === OFFLINE_KEEP_TEXT;
  });
  const deleteEntry = localList.payload.history.find(function (entry) {
    return entry.text === OFFLINE_DELETE_TEXT;
  });
  await nativeMessage(popup, "COPY_TEXT_LOCAL_HISTORY_PIN", {
    id: keepEntry.id,
    text: keepEntry.text,
    pinned: true,
  });
  await nativeMessage(popup, "COPY_TEXT_LOCAL_HISTORY_DELETE", {
    id: deleteEntry.id,
    text: deleteEntry.text,
  });

  const queued = await popup.evaluate(async function () {
    return chrome.storage.local.get({ copyHistory: [] });
  });
  const outbox = await nativeMessage(popup, "COPY_TEXT_LOCAL_HISTORY_OUTBOX_STATUS");
  if (!queued.copyHistory.some(function (entry) {
    return entry.text === OFFLINE_KEEP_TEXT && entry.pinned;
  })) {
    throw new Error(`Expected offline pin in local history, got ${JSON.stringify(queued.copyHistory)}`);
  }
  if (queued.copyHistory.some(function (entry) { return entry.text === OFFLINE_DELETE_TEXT; })) {
    throw new Error("Expected offline delete to remove the local item.");
  }
  if (!outbox || !outbox.ok || outbox.payload.pending < 4) {
    throw new Error(`Expected pending add/pin/delete operations, got ${JSON.stringify(outbox)}`);
  }
  console.log("Offline copy, pin, and delete operations were queued.");

  await fixture.close();
  await popup.close();
}

async function verifyPinDeleteReconnect(context) {
  const popup = await openConnectedPopup(context);
  const response = await waitFor(async function () {
    const listed = await nativeMessage(popup, "COPY_TEXT_NATIVE_HISTORY_LIST", { limit: 20 });
    const history = listed && listed.ok && listed.payload && listed.payload.history;
    if (!Array.isArray(history)) {
      return null;
    }
    const keep = history.find(function (entry) { return entry.text === OFFLINE_KEEP_TEXT; });
    const removed = history.find(function (entry) { return entry.text === OFFLINE_DELETE_TEXT; });
    return keep && keep.pinned && !removed ? listed : null;
  }, "offline pin/delete operations to flush after reconnect", 12000);
  if (!response.payload.history.some(function (entry) {
    return entry.text === OFFLINE_KEEP_TEXT && entry.pinned;
  })) {
    throw new Error(`Expected pinned offline item after reconnect, got ${JSON.stringify(response)}`);
  }
  await assertOutboxEmpty(popup, "pin/delete reconnect");
  console.log("Offline add, pin, and delete synchronized after reconnect.");
  await popup.close();
}

async function verifyOfflineClearQueue(context) {
  const extensionId = new URL(context.serviceWorkers()[0].url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await waitFor(async function () {
    return (await popup.locator("#native_status").textContent()) === "Companion: local mode";
  }, "popup to report Companion: local mode before clear");

  await nativeMessage(popup, "COPY_TEXT_LOCAL_HISTORY_CLEAR");
  const fixture = await context.newPage();
  await fixture.goto(fixtureUrl);
  await fixture.locator("#after_clear").click({ modifiers: ["Alt"] });

  await waitFor(async function () {
    const stored = await popup.evaluate(async function () {
      return chrome.storage.local.get({ copyHistory: [] });
    });
    const outbox = await nativeMessage(popup, "COPY_TEXT_LOCAL_HISTORY_OUTBOX_STATUS");
    const operations = outbox && outbox.ok && outbox.payload && outbox.payload.operations;
    return stored.copyHistory.length === 1
      && stored.copyHistory[0].text === AFTER_CLEAR_TEXT
      && Array.isArray(operations)
      && operations.length === 2
      && operations[0].type === "clear"
      && operations[1].type === "upsert";
  }, "clear and later copy to remain ordered in the outbox", 12000);
  console.log("Offline clear retained only the clear and subsequent copy operations.");

  await fixture.close();
  await popup.close();
}

async function verifyClearReconnect(context) {
  const popup = await openConnectedPopup(context);
  const response = await waitFor(async function () {
    const listed = await nativeMessage(popup, "COPY_TEXT_NATIVE_HISTORY_LIST", { limit: 20 });
    const history = listed && listed.ok && listed.payload && listed.payload.history;
    return Array.isArray(history)
      && history.length === 1
      && history[0].text === AFTER_CLEAR_TEXT
      ? listed
      : null;
  }, "offline clear to flush before its subsequent copy", 12000);
  assertHistoryCount(response, 1, "clear ordering");
  await assertOutboxEmpty(popup, "clear reconnect");
  console.log("Offline clear did not resurrect older history after reconnect.");
  await popup.close();
}

async function verifyLocalFallback(context, expectedText) {
  const extensionId = new URL(context.serviceWorkers()[0].url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await waitFor(async function () {
    return (await popup.locator("#native_status").textContent()) === "Companion: local mode";
  }, "popup to report Companion: local mode");

  const localList = await nativeMessage(popup, "COPY_TEXT_LOCAL_HISTORY_LIST", { limit: 20 });
  if (!localList || !localList.ok || localList.payload.mode !== "local"
    || !localList.payload.history.some(function (entry) { return entry.text === expectedText; })) {
    throw new Error(`Expected local fallback history to contain ${expectedText}, got ${JSON.stringify(localList)}`);
  }
  console.log("Extension local history remains functional.");
  await popup.close();
}

async function openConnectedPopup(context) {
  const extensionId = new URL(context.serviceWorkers()[0].url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await waitFor(async function () {
    return (await popup.locator("#native_status").textContent()) === "Companion: connected";
  }, "popup to report Companion: connected", 12000);
  return popup;
}

async function assertOutboxEmpty(page, label) {
  await waitFor(async function () {
    const response = await nativeMessage(page, "COPY_TEXT_LOCAL_HISTORY_OUTBOX_STATUS");
    return response && response.ok && response.payload && response.payload.pending === 0;
  }, `${label} outbox to empty`, 12000);
}

function nativeMessage(page, type, payload) {
  return page.evaluate(async function (message) {
    return chrome.runtime.sendMessage(message);
  }, { type, payload: payload || {} });
}

function assertHistoryCount(response, count, label) {
  const history = response && response.ok && response.payload && response.payload.history;
  if (!Array.isArray(history) || history.length !== count) {
    throw new Error(`${label} expected ${count} item(s), got ${JSON.stringify(response)}`);
  }
}

function installHost(extensionId, nativeInstallRoot) {
  const env = Object.assign({}, process.env);
  if (extensionId) {
    env.COPY_TEXT_DEV_EXTENSION_ID = extensionId;
  }
  if (nativeInstallRoot) {
    env.COPY_TEXT_NATIVE_INSTALL_ROOT = nativeInstallRoot;
  }
  const result = spawnSync(process.execPath, [INSTALL_SCRIPT], {
    cwd: PROJECT_ROOT,
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Native host installation failed.").trim());
  }
}

function uninstallHost(nativeInstallRoot) {
  const env = Object.assign({}, process.env);
  if (nativeInstallRoot) {
    env.COPY_TEXT_NATIVE_INSTALL_ROOT = nativeInstallRoot;
  }
  const result = spawnSync(process.execPath, [UNINSTALL_SCRIPT], {
    cwd: PROJECT_ROOT,
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Native host removal failed.").trim());
  }
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

function waitFor(check, label, timeoutMs = 8000) {
  const startedAt = Date.now();
  return new Promise(function (resolve, reject) {
    async function poll() {
      try {
        const value = await check();
        if (value) {
          resolve(value);
          return;
        }
      } catch (error) {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(error);
          return;
        }
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${label}.`));
        return;
      }
      setTimeout(poll, 150);
    }
    poll();
  });
}

function startFixtureServer() {
  const fixtureRoot = path.join(PROJECT_ROOT, "fixtures");
  const server = http.createServer(function (request, response) {
    const requestPath = new URL(request.url, fixtureUrl || `http://${HOST}/`).pathname;
    const relativePath = requestPath.replace(/^\/fixtures\//, "");
    const absolutePath = path.join(fixtureRoot, relativePath);
    const relativeToRoot = path.relative(fixtureRoot, absolutePath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot) || !fs.existsSync(absolutePath)) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(fs.readFileSync(absolutePath));
  });

  return new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, HOST, function () {
      const address = server.address();
      fixtureUrl = `http://${HOST}:${address.port}/fixtures/native-companion.html`;
      resolve(server);
    });
  });
}

function stopServer(server) {
  return new Promise(function (resolve) {
    server.close(resolve);
  });
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function captureNativeHostState() {
  const manifestPath = path.join(nativeInstall.INSTALL_ROOT, "NativeMessagingHosts", `${nativeInstall.HOST_NAME}.json`);
  return {
    exe: readOptionalFile(nativeInstall.INSTALLED_HOST_EXE),
    manifest: readOptionalFile(manifestPath),
    manifestPath,
    registry: nativeInstall.REGISTRY_PATHS.map(function (registryPath) {
      return { path: registryPath, value: nativeInstall.readRegistryDefault(registryPath) };
    }),
  };
}

function restoreNativeHostState(state) {
  const restoreErrors = [];
  try {
    restoreOptionalFile(nativeInstall.INSTALLED_HOST_EXE, state.exe);
  } catch (error) {
    restoreErrors.push(`restore ${nativeInstall.INSTALLED_HOST_EXE}: ${error.message || error}`);
  }
  try {
    restoreOptionalFile(state.manifestPath, state.manifest);
  } catch (error) {
    restoreErrors.push(`restore ${state.manifestPath}: ${error.message || error}`);
  }
  state.registry.forEach(function (entry) {
    if (entry.value === null) {
      const result = spawnSync("reg", ["delete", entry.path, "/f"], { encoding: "utf8" });
      if (result.status !== 0 && !/unable to find|cannot find/i.test(result.stderr + result.stdout)) {
        restoreErrors.push((result.stderr || result.stdout || `Failed to delete ${entry.path}`).trim());
      }
      return;
    }
    const result = spawnSync("reg", ["add", entry.path, "/ve", "/t", "REG_SZ", "/d", entry.value, "/f"], { encoding: "utf8" });
    if (result.status !== 0) {
      restoreErrors.push((result.stderr || result.stdout || `Failed to restore ${entry.path}`).trim());
    }
  });
  if (restoreErrors.length) {
    throw new Error(restoreErrors.join("; "));
  }
}

function readOptionalFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

function restoreOptionalFile(filePath, contents) {
  if (contents === null) {
    fs.rmSync(filePath, { force: true });
    return;
  }
  if (fs.existsSync(filePath) && Buffer.compare(fs.readFileSync(filePath), contents) === 0) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

async function cleanupStep(label, action, cleanupErrors) {
  try {
    await action();
  } catch (error) {
    if (Array.isArray(cleanupErrors)) {
      cleanupErrors.push({ label, error });
    }
    console.warn(`Cleanup failed for ${label}: ${error && error.message ? error.message : error}`);
  }
}

function formatCleanupErrors(cleanupErrors) {
  return "Native E2E cleanup failed: " + cleanupErrors.map(function (item) {
    const message = item.error && item.error.message ? item.error.message : String(item.error);
    return `${item.label}: ${message}`;
  }).join("; ");
}

if (require.main === module) {
  main().catch(function (error) {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
