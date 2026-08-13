const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { buildChrome } = require("./build-chrome.cjs");
const { PROJECT_ROOT } = require("./lib/release-utils.cjs");
const { chromium, resolveBrowserExecutable } = require("./lib/playwright-browser.cjs");

const EXTENSION_ROOT = path.join(PROJECT_ROOT, "dist", "chrome");
const SCREENSHOT_ROOT = path.join(PROJECT_ROOT, "docs", "screenshots");
const HOST = "127.0.0.1";

function startFixtureServer() {
  const server = http.createServer(function (request, response) {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relativePath = pathname.replace(/^\/+/, "");
    const absolutePath = path.resolve(PROJECT_ROOT, relativePath);
    const relativeToRoot = path.relative(PROJECT_ROOT, absolutePath);

    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot) || !fs.existsSync(absolutePath)) {
      response.writeHead(404).end("Not found");
      return;
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const extension = path.extname(absolutePath).toLowerCase();
    const contentTypes = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".png": "image/png",
    };
    response.writeHead(200, { "Content-Type": contentTypes[extension] || "application/octet-stream" });
    response.end(fs.readFileSync(absolutePath));
  });

  return new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, HOST, function () {
      server.off("error", reject);
      resolve({
        server,
        baseUrl: `http://${HOST}:${server.address().port}`,
      });
    });
  });
}

function stopFixtureServer(server) {
  if (!server || !server.listening) {
    return Promise.resolve();
  }
  return new Promise(function (resolve) {
    server.close(resolve);
  });
}

async function getExtensionId(context) {
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  return new URL(serviceWorker.url()).host;
}

async function seedReleaseData(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const now = Date.now();
  await page.evaluate(async function (seed) {
    await chrome.storage.sync.set({
      metaKey: "Alt",
      excludedDomains: ["private.example"],
      previewEnabled: true,
      avoidEditable: true,
      toastDurationMs: 1400,
      uiLanguage: "en",
      copyHistoryLimit: 50,
      keyboardShortcutEnabled: true,
    });
    await chrome.storage.local.set(seed);
  }, {
    copyHistory: [
      {
        id: "release-json",
        text: "{\"name\":\"Copy Text Without Selecting\",\"privacy\":\"local-first\"}",
        createdAt: now - 2 * 60 * 1000,
        source: "click",
        url: "https://docs.example/features",
        hostname: "docs.example",
        mode: "copy",
        format: "json",
        pinned: true,
      },
      {
        id: "release-sql",
        text: "SELECT title, source FROM copy_history ORDER BY created_at DESC;",
        createdAt: now - 18 * 60 * 1000,
        source: "shortcut",
        url: "https://developer.example/query",
        hostname: "developer.example",
        mode: "copy",
        format: "sql",
      },
      {
        id: "release-link",
        text: "[Installation guide](https://github.com/anhtahaylove/copy-text-without-selecting)",
        createdAt: now - 70 * 60 * 1000,
        source: "native",
        url: "https://github.com/anhtahaylove/copy-text-without-selecting",
        hostname: "github.com",
        mode: "copy",
        format: "plain",
      },
    ],
    copyAnalytics: {
      totals: {
        totalActions: 128,
        copied: 112,
        nativeCopies: 9,
        selectionCopies: 24,
        shortcuts: 16,
        historyReplayCopy: 8,
        historyPinnedCount: 1,
        historyReplayCount: 8,
        excludedBlocked: 5,
        editableSkipped: 3,
      },
      toastCounts: { copied: 112, status: 16 },
      domainStats: {
        "docs.example": {
          totalActions: 54,
          copied: 50,
          shortcuts: 8,
          selectionCopies: 12,
          historyReplays: 4,
          blockedExcluded: 0,
          editableSkipped: 1,
          lastUsedAt: now,
        },
        "github.com": {
          totalActions: 31,
          copied: 28,
          shortcuts: 3,
          selectionCopies: 7,
          historyReplays: 2,
          blockedExcluded: 0,
          editableSkipped: 0,
          lastUsedAt: now - 70 * 60 * 1000,
        },
      },
      lastUpdatedAt: now,
    },
  });

  await page.close();
}

async function captureScreenshots(context, extensionId, baseUrl) {
  fs.mkdirSync(SCREENSHOT_ROOT, { recursive: true });

  const fixturePage = await context.newPage();
  await fixturePage.goto(`${baseUrl}/fixtures/basic-copy.html`);
  await fixturePage.bringToFront();

  const popupPage = await context.newPage();
  await popupPage.setViewportSize({ width: 380, height: 760 });
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await fixturePage.bringToFront();
  await popupPage.reload();
  await popupPage.locator("#history_list").waitFor();
  await popupPage.screenshot({
    path: path.join(SCREENSHOT_ROOT, "popup.png"),
    fullPage: true,
  });
  await popupPage.close();

  const optionsPage = await context.newPage();
  await optionsPage.setViewportSize({ width: 1440, height: 900 });
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
  await optionsPage.locator("#panel_general").waitFor();
  await optionsPage.screenshot({
    path: path.join(SCREENSHOT_ROOT, "options-general.png"),
    fullPage: true,
  });

  await optionsPage.locator("#tab_history").click();
  await optionsPage.locator("#options_history_list").waitFor();
  await optionsPage.screenshot({
    path: path.join(SCREENSHOT_ROOT, "options-history.png"),
    fullPage: true,
  });

  await optionsPage.close();
  await fixturePage.close();
}

async function main() {
  let context;
  let fixtureServer;
  let userDataDir;

  try {
    await buildChrome();
    fixtureServer = await startFixtureServer();
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "copy-text-release-screenshots-"));
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: resolveBrowserExecutable(),
      headless: true,
      colorScheme: "light",
      args: [
        `--disable-extensions-except=${EXTENSION_ROOT}`,
        `--load-extension=${EXTENSION_ROOT}`,
      ],
    });

    const extensionId = await getExtensionId(context);
    await seedReleaseData(context, extensionId);
    await captureScreenshots(context, extensionId, fixtureServer.baseUrl);
    console.log(`Release screenshots created in ${SCREENSHOT_ROOT}`);
  } finally {
    try {
      if (context) {
        await context.close();
      }
    } finally {
      try {
        if (fixtureServer) {
          await stopFixtureServer(fixtureServer.server);
        }
      } finally {
        if (userDataDir) {
          fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
      }
    }
  }
}

if (require.main === module) {
  main().catch(function (error) {
    console.error("Release screenshot capture failed.");
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
