const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const { test, expect, chromium } = require("@playwright/test");

const FIXTURE_ROOT = path.join(__dirname, "..", "..", "fixtures");
const EXTENSION_ROOT = path.join(__dirname, "..", "..", "dist", "chrome");
const HOST = "127.0.0.1";
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;

let server;
let context;
let extensionId;
let userDataDir;

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    default: return "text/plain; charset=utf-8";
  }
}

async function startFixtureServer() {
  server = http.createServer(function (request, response) {
    const requestPath = new URL(request.url, BASE_URL).pathname;
    const relativePath = decodeURIComponent(requestPath.replace(/^\/+/, ""));
    const absolutePath = path.join(path.dirname(FIXTURE_ROOT), relativePath);

    if (!absolutePath.startsWith(path.dirname(FIXTURE_ROOT)) || !fs.existsSync(absolutePath)) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }

    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      response.statusCode = 403;
      response.end("Forbidden");
      return;
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", contentTypeFor(absolutePath));
    response.end(fs.readFileSync(absolutePath));
  });

  await new Promise(function (resolve) {
    server.listen(PORT, HOST, resolve);
  });
}

async function stopFixtureServer() {
  if (!server) {
    return;
  }

  await new Promise(function (resolve) {
    server.close(resolve);
  });
  server = null;
}

async function launchExtensionContext() {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "copy-text-extension-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromium.executablePath(),
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_ROOT}`,
      `--load-extension=${EXTENSION_ROOT}`,
    ],
  });

  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }

  extensionId = new URL(serviceWorker.url()).host;
}

async function closeExtensionContext() {
  if (context) {
    await context.close();
    context = null;
  }

  if (userDataDir) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
    userDataDir = null;
  }
}

async function openPage(relativePath) {
  const page = await context.newPage();
  const consoleMessages = [];
  page.on("console", function (message) {
    consoleMessages.push(message.text());
  });
  await page.goto(`${BASE_URL}/${relativePath}`);
  return { page, consoleMessages };
}

async function openExtensionPage(relativePath) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${relativePath}`);
  return page;
}

async function withFreshExtensionContext(callback) {
  await closeExtensionContext();
  await launchExtensionContext();
  return callback();
}

async function readClipboard(page) {
  return page.evaluate(async function () {
    return navigator.clipboard.readText();
  });
}

async function altClick(target) {
  await target.click({ modifiers: ["Alt"] });
}

test.beforeAll(async function () {
  await startFixtureServer();
  await launchExtensionContext();
});

test.afterAll(async function () {
  await closeExtensionContext();
  await stopFixtureServer();
});

test("copies basic paragraph text", async function () {
  const { page } = await openPage("fixtures/basic-copy.html");
  await altClick(page.locator("#plain-text"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toContain("Copying this paragraph should capture");
  await page.close();
});

test("prefers the selected text over the whole element", async function () {
  const { page } = await openPage("fixtures/selection-copy.html");
  await page.evaluate(function () {
    const paragraph = document.querySelectorAll(".card p")[0];
    const textNode = paragraph.firstChild;
    const range = document.createRange();
    const text = textNode.textContent;
    const start = text.indexOf("few words");
    range.setStart(textNode, start);
    range.setEnd(textNode, start + "few words".length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const popupPage = await openExtensionPage("popup.html");
  await popupPage.evaluate(async function () {
    const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
    const targetTab = tabs.find(function (tab) {
      return typeof tab.url === "string" && tab.url.includes("/fixtures/selection-copy.html");
    });
    if (!targetTab || !targetTab.id) {
      throw new Error("Fixture tab not found for selection test.");
    }
    await chrome.tabs.sendMessage(targetTab.id, {
      type: "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT",
    });
  });
  await popupPage.close();
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("few words");
  await page.close();
});

test("copies hovered paragraph through the shortcut message path", async function () {
  const { page } = await openPage("fixtures/keyboard-shortcut.html");
  await page.locator("section.card >> text=Hover this paragraph").hover();
  const popupPage = await openExtensionPage("popup.html");
  await popupPage.evaluate(async function () {
    const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
    const targetTab = tabs.find(function (tab) {
      return typeof tab.url === "string" && tab.url.includes("/fixtures/keyboard-shortcut.html");
    });
    if (!targetTab || !targetTab.id) {
      throw new Error("Fixture tab not found for shortcut test.");
    }
    await chrome.tabs.sendMessage(targetTab.id, {
      type: "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT",
    });
  });
  await popupPage.close();
  await expect.poll(async function () {
    return readClipboard(page);
  }).toContain("Hover this paragraph");
  await page.close();
});

test("saves popup settings and excluded domains roundtrip", async function () {
  const popupPage = await openExtensionPage("popup.html");
  await popupPage.selectOption("#popup_meta_key", "Ctrl");
  await popupPage.locator("#popup_copy_history_limit").fill("7");
  await popupPage.locator("#popup_preview_enabled").uncheck();
  await popupPage.waitForTimeout(250);
  await popupPage.close();

  const optionsPage = await openExtensionPage("options.html");
  await expect(optionsPage.locator("#meta_key")).toHaveValue("Ctrl");
  await expect(optionsPage.locator("#copy_history_limit")).toHaveValue("7");
  await expect(optionsPage.locator("#preview_enabled")).not.toBeChecked();

  await optionsPage.locator("#tab_sites").click();
  await optionsPage.locator("#domain_input").fill(HOST);
  await optionsPage.locator("#add_domain_button").click();
  await expect(optionsPage.locator("#excluded_domains_list")).toContainText(HOST);
  await optionsPage.close();
});

test("blocks copy on excluded domain", async function () {
  const { page } = await openPage("fixtures/basic-copy.html");
  await page.evaluate(async function () {
    await navigator.clipboard.writeText("unchanged");
  });
  await altClick(page.locator("#plain-text"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("unchanged");
  await page.close();
});

test("extension reload plus page refresh does not break copy or spam invalidation errors", async function () {
  await withFreshExtensionContext(async function () {
    const { page, consoleMessages } = await openPage("fixtures/basic-copy.html");
    await page.reload();
    await altClick(page.locator("#plain-text"));
    await expect.poll(async function () {
      return readClipboard(page);
    }).toContain("Copying this paragraph should capture");

    expect(consoleMessages.filter(function (message) {
      return /Extension context invalidated/i.test(message);
    })).toEqual([]);

    await page.close();
  });
});
