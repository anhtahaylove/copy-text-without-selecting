const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const { test, expect, chromium } = require("@playwright/test");

const FIXTURE_ROOT = path.join(__dirname, "..", "..", "fixtures");
const EXTENSION_ROOT = path.join(__dirname, "..", "..", "dist", "chrome");
const HOST = "127.0.0.1";

let server;
let baseUrl;
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
    const requestPath = new URL(request.url, baseUrl).pathname;
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

  await new Promise(function (resolve, reject) {
    function handleError(error) {
      reject(error);
    }
    server.once("error", handleError);
    server.listen(0, HOST, function () {
      server.off("error", handleError);
      resolve();
    });
  });
  const address = server.address();
  baseUrl = `http://${HOST}:${address.port}`;
}

async function stopFixtureServer() {
  if (!server) {
    return;
  }

  if (server.listening) {
    await new Promise(function (resolve) {
      server.close(resolve);
    });
  }
  server = null;
  baseUrl = null;
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

  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }

  extensionId = new URL(serviceWorker.url()).host;
  await serviceWorker.evaluate(function () {
    return chrome.storage.sync.set({ copyTextE2EInitialize: Date.now() });
  });
  await expect.poll(function () {
    return serviceWorker.evaluate(async function () {
      const scripts = await chrome.scripting.getRegisteredContentScripts({
        ids: ["copy-text-with-alt-click-content"],
      });
      return scripts.length;
    });
  }, { timeout: 15000 }).toBe(1);
}

async function closeExtensionContext() {
  try {
    if (context) {
      await context.close();
    }
  } finally {
    context = null;
    if (userDataDir) {
      fs.rmSync(userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
      userDataDir = null;
    }
  }
}

async function openPage(relativePath) {
  const page = await context.newPage();
  const consoleMessages = [];
  page.on("console", function (message) {
    consoleMessages.push(message.text());
  });
  await page.goto(`${baseUrl}/${relativePath}`);
  return { page, consoleMessages };
}

async function openExtensionPage(relativePath) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${relativePath}`);
  return page;
}

async function updateSyncSettings(settings) {
  const extensionPage = await openExtensionPage("popup.html");
  await extensionPage.evaluate(async function (nextSettings) {
    await chrome.storage.sync.set(nextSettings);
  }, settings);
  await extensionPage.close();
}

async function readLatestHistoryText() {
  const extensionPage = await openExtensionPage("popup.html");
  const text = await extensionPage.evaluate(async function () {
    const items = await chrome.storage.local.get({ copyHistory: [] });
    return items.copyHistory && items.copyHistory[0] ? items.copyHistory[0].text : "";
  });
  await extensionPage.close();
  return text;
}

async function readHistoryEntries() {
  const extensionPage = await openExtensionPage("popup.html");
  const entries = await extensionPage.evaluate(async function () {
    const items = await chrome.storage.local.get({ copyHistory: [] });
    return Array.isArray(items.copyHistory) ? items.copyHistory : [];
  });
  await extensionPage.close();
  return entries;
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

async function readClipboardHtml(page) {
  return page.evaluate(async function () {
    const items = await navigator.clipboard.read();
    const item = items.find(function (candidate) {
      return candidate.types.includes("text/html");
    });
    if (!item) return "";
    return (await item.getType("text/html")).text();
  });
}

async function altClick(target) {
  await target.click({ modifiers: ["Alt"] });
}

async function getTextRangePoint(page, selector, phrase) {
  return page.evaluate(function (input) {
    const element = document.querySelector(input.selector);
    const textNode = element && Array.from(element.childNodes).find(function (node) {
      return node.nodeType === Node.TEXT_NODE && String(node.textContent || "").includes(input.phrase);
    });
    if (!textNode) {
      throw new Error("Text node not found for scope fixture.");
    }
    const start = textNode.textContent.indexOf(input.phrase);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + input.phrase.length);
    const rect = range.getBoundingClientRect();
    return {
      x: rect.left + (rect.width / 2),
      y: rect.top + (rect.height / 2),
    };
  }, { selector, phrase });
}

async function getTextStartPoint(page, selector, phrase) {
  return page.evaluate(function (input) {
    const element = document.querySelector(input.selector);
    const textNode = element && Array.from(element.childNodes).find(function (node) {
      return node.nodeType === Node.TEXT_NODE && String(node.textContent || "").includes(input.phrase);
    });
    if (!textNode) {
      throw new Error("Text node not found for scope fixture.");
    }
    const start = textNode.textContent.indexOf(input.phrase);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + 1);
    const rect = range.getBoundingClientRect();
    return {
      x: rect.left + Math.min(1, rect.width / 4),
      y: rect.top + (rect.height / 2),
    };
  }, { selector, phrase });
}

test.beforeAll(async function () {
  try {
    await startFixtureServer();
    await launchExtensionContext();
  } catch (error) {
    await closeExtensionContext();
    await stopFixtureServer();
    throw error;
  }
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

test("copies rich targets from the basic fixture", async function () {
  await updateSyncSettings({ avoidEditable: false });
  const { page } = await openPage("fixtures/basic-copy.html");
  try {
    await altClick(page.locator("a[href='https://example.com/docs/guide']"));
    await expect.poll(async function () {
      return readClipboard(page);
    }).toBe("[documentation link](https://example.com/docs/guide)");

    await altClick(page.locator("input[type='text']"));
    await expect.poll(async function () {
      return readClipboard(page);
    }).toBe("Input field text");

    await altClick(page.locator("textarea"));
    await expect.poll(async function () {
      return readClipboard(page);
    }).toContain("Textarea content line 1");

    await altClick(page.locator("select"));
    await expect.poll(async function () {
      return readClipboard(page);
    }).toBe("Beta");
  } finally {
    await page.close();
    await updateSyncSettings({ avoidEditable: true });
  }
});

test("captures form button copy before page click handlers", async function () {
  const { page } = await openPage("fixtures/google-like-buttons.html");

  await altClick(page.locator("#google_search_button"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Google Search");
  await expect(page.locator("body")).toBeVisible();
  expect(await page.evaluate(function () {
    return {
      submitCount: window.fixtureSubmitCount,
      searchButtonClickCount: window.fixtureSearchButtonClickCount,
    };
  })).toEqual({
    submitCount: 0,
    searchButtonClickCount: 0,
  });

  await altClick(page.locator("#lucky_button"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("I'm Feeling Lucky");

  await page.close();
});

test("copies icon-only semantic actions without leaking ancestor text", async function () {
  const { page } = await openPage("fixtures/semantic-actions.html");

  await altClick(page.locator("#result-menu svg"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("About this result");
  expect(await readClipboardHtml(page)).toBe("About this result");
  expect(await page.evaluate(function () {
    return window.fixtureActionClickCount;
  })).toBe(0);

  await altClick(page.locator("#shadow-text-action-host span"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Slotted Action");

  await altClick(page.locator("#shadow-image-action-host img"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Slotted image action");

  await altClick(page.locator("#shadow-scoped-label-host").locator("#shadow-scoped-label-button"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Shadow scoped label");

  await altClick(page.locator("#shadow-scoped-label-host").locator("#shadow-out-of-scope-button"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Shadow title fallback");

  await altClick(page.locator("#labelled-action svg"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Referenced action label");

  await altClick(page.locator("#role-button-action svg"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Role button action");

  await altClick(page.locator("#role-menuitem-action svg"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Role menu item action");

  await altClick(page.locator("#image-alt-action img"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Download report");

  await altClick(page.locator("#image-alt-link img"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("[Documentation image](https://example.com/image-docs)");

  await altClick(page.locator("#image-input-action"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Submit image action");

  await altClick(page.locator("#shadow-slotted-icon svg"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Shadow slot action");
  expect(await page.evaluate(function () {
    return window.fixtureActionClickCount;
  })).toBe(0);

  await altClick(page.locator("#nested-action-link"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("[Nested documentation](https://example.com/nested-docs)");

  await altClick(page.locator("#result-link"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("[Example search result](https://example.com/search-result)");

  await expect.poll(async function () {
    const entries = await readHistoryEntries();
    return entries.some(function (entry) {
      return entry.text === "[Example search result](https://example.com/search-result)";
    });
  }).toBe(true);

  const historyBeforeUnlabelledAction = await readHistoryEntries();
  await page.evaluate(async function () {
    await navigator.clipboard.writeText("unchanged");
  });
  await altClick(page.locator("#unlabelled-action svg"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("unchanged");
  expect((await readHistoryEntries()).length).toBe(historyBeforeUnlabelledAction.length);

  await page.evaluate(async function () {
    await navigator.clipboard.writeText("safe-mode-seed");
  });
  await altClick(page.locator("#shadow-editor-host").locator("#shadow-editor"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("safe-mode-seed");

  await altClick(page.locator("#hidden-descendant-action svg"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("safe-mode-seed");

  await altClick(page.locator("#shadow-unassigned-image-action-host").locator("svg"));
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("safe-mode-seed");
  expect((await readHistoryEntries()).length).toBe(historyBeforeUnlabelledAction.length);

  await page.close();
});

test("copies a focused icon-only action through the shortcut path", async function () {
  const { page } = await openPage("fixtures/semantic-actions.html");
  await page.locator("#result-menu").focus();

  const popupPage = await openExtensionPage("popup.html");
  await popupPage.evaluate(async function () {
    const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
    const targetTab = tabs.find(function (tab) {
      return typeof tab.url === "string" && tab.url.includes("/fixtures/semantic-actions.html");
    });
    if (!targetTab || !targetTab.id) {
      throw new Error("Fixture tab not found for semantic shortcut test.");
    }
    await chrome.tabs.sendMessage(targetTab.id, {
      type: "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT",
    });
  });
  await popupPage.close();

  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("About this result");

  await page.locator("#shadow-action-host").evaluate(function (host) {
    host.shadowRoot.getElementById("shadow-action-button").focus();
  });
  const shadowPopupPage = await openExtensionPage("popup.html");
  await shadowPopupPage.evaluate(async function () {
    const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
    const targetTab = tabs.find(function (tab) {
      return typeof tab.url === "string" && tab.url.includes("/fixtures/semantic-actions.html");
    });
    if (!targetTab || !targetTab.id) {
      throw new Error("Fixture tab not found for shadow shortcut test.");
    }
    await chrome.tabs.sendMessage(targetTab.id, {
      type: "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT",
    });
  });
  await shadowPopupPage.close();
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Shadow slot action");

  await page.locator("#shadow-text-action-host").evaluate(function (host) {
    host.shadowRoot.getElementById("shadow-text-action-button").focus();
  });
  const textActionPopupPage = await openExtensionPage("popup.html");
  await textActionPopupPage.evaluate(async function () {
    const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
    const targetTab = tabs.find(function (tab) {
      return typeof tab.url === "string" && tab.url.includes("/fixtures/semantic-actions.html");
    });
    await chrome.tabs.sendMessage(targetTab.id, { type: "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT" });
  });
  await textActionPopupPage.close();
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Slotted Action");

  await page.locator("#shadow-input-host").evaluate(function (host) {
    const input = host.shadowRoot.getElementById("shadow-selection-input");
    input.focus();
    input.setSelectionRange(1, 4);
  });
  const inputPopupPage = await openExtensionPage("popup.html");
  await inputPopupPage.evaluate(async function () {
    const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
    const targetTab = tabs.find(function (tab) {
      return typeof tab.url === "string" && tab.url.includes("/fixtures/semantic-actions.html");
    });
    await chrome.tabs.sendMessage(targetTab.id, { type: "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT" });
  });
  await inputPopupPage.close();
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("bcd");

  await page.locator("#result-menu").hover();
  await page.locator("#shadow-range-host").evaluate(function (host) {
    const textNode = host.shadowRoot.getElementById("shadow-range-text").firstChild;
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 4);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const rangePopupPage = await openExtensionPage("popup.html");
  await rangePopupPage.evaluate(async function () {
    const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
    const targetTab = tabs.find(function (tab) {
      return typeof tab.url === "string" && tab.url.includes("/fixtures/semantic-actions.html");
    });
    await chrome.tabs.sendMessage(targetTab.id, { type: "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT" });
  });
  await rangePopupPage.close();
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("bcd");
  await page.close();
});

test("keeps expanded scope through tiny pointer movement and supports contraction", async function () {
  const { page } = await openPage("fixtures/scope-preview.html");
  const point = await getTextRangePoint(page, "#inline-scope-text strong", "bold target words");

  await page.keyboard.down("Alt");
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -100);
  await page.mouse.move(point.x + 1, point.y);
  await page.mouse.click(point.x + 1, point.y);
  await page.keyboard.up("Alt");
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("First bold target words ending here.");

  await page.keyboard.down("Alt");
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, 100);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Alt");
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("bold target words");

  await page.close();
});

test("selects the following sentence at its first-character boundary", async function () {
  const { page } = await openPage("fixtures/scope-preview.html");
  const point = await getTextStartPoint(page, "#sentence-edge-target", "Second target sentence");

  await page.keyboard.down("Alt");
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -100);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Alt");

  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Second target sentence.");
  await page.close();
});

test("keeps abbreviations, decimals, and URLs inside their sentences", async function () {
  const { page } = await openPage("fixtures/scope-preview.html");
  const point = await getTextRangePoint(page, "#abbreviation-target", "Smith wrote this sentence");

  await page.keyboard.down("Alt");
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -100);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Alt");

  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Dr. Smith wrote this sentence.");
  await page.close();
});

test("sentence scope excludes hidden descendants from plain and rich clipboard", async function () {
  const { page } = await openPage("fixtures/scope-preview.html");
  const point = await getTextRangePoint(page, "#hidden-sentence-text strong", "sentence target");

  await page.keyboard.down("Alt");
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -100);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Alt");

  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Visible sentence target.");
  expect(await readClipboardHtml(page)).toBe("Visible sentence target.");
  await page.close();
});

test("sentence scope follows the composed tree and excludes unassigned light DOM", async function () {
  const { page } = await openPage("fixtures/scope-preview.html");
  const point = await getTextRangePoint(page, "#shadow-scope-target", "Visible target");

  await page.keyboard.down("Alt");
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -100);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Alt");

  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Visible target sentence.");
  expect(await readClipboardHtml(page)).toBe("Visible target sentence.");
  await page.close();
});

test("never shrinks a whole-text exact target when expanding scope", async function () {
  const { page } = await openPage("fixtures/scope-preview.html");
  const point = await getTextRangePoint(page, "#scope-text", "Second target sentence");

  await page.keyboard.down("Alt");
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -100);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Alt");

  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("First sentence. Second target sentence. Third sentence.");
  await page.close();
});

test("resets expanded scope when the pointer moves to a different base target", async function () {
  const { page } = await openPage("fixtures/scope-preview.html");
  const firstPoint = await getTextRangePoint(page, "#scope-text", "Second target sentence");
  const secondPoint = await getTextRangePoint(page, "#other-scope-text", "Different target second sentence");

  await page.keyboard.down("Alt");
  await page.mouse.move(firstPoint.x, firstPoint.y);
  await page.mouse.wheel(0, -100);
  await page.mouse.move(secondPoint.x, secondPoint.y);
  await page.mouse.click(secondPoint.x, secondPoint.y);
  await page.keyboard.up("Alt");

  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("Different target first sentence. Different target second sentence.");
  await page.close();
});

test("expands scope across inline markup without shrinking paragraph or container", async function () {
  const { page } = await openPage("fixtures/scope-preview.html");
  const inlinePoint = await getTextRangePoint(page, "#inline-scope-text strong", "bold target words");
  const trailingPoint = await getTextRangePoint(page, "#inline-scope-text", "ending here");

  await page.keyboard.down("Alt");
  await page.mouse.move(inlinePoint.x, inlinePoint.y);
  await page.mouse.wheel(0, -100);
  await page.mouse.move(trailingPoint.x, trailingPoint.y);
  await page.mouse.click(trailingPoint.x, trailingPoint.y);
  await page.keyboard.up("Alt");
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("First bold target words ending here.");

  await page.keyboard.down("Alt");
  await page.mouse.move(inlinePoint.x, inlinePoint.y);
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.mouse.click(inlinePoint.x, inlinePoint.y);
  await page.keyboard.up("Alt");
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("First bold target words ending here. Next sentence.");

  await page.keyboard.down("Alt");
  await page.mouse.move(inlinePoint.x, inlinePoint.y);
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.mouse.click(inlinePoint.x, inlinePoint.y);
  await page.keyboard.up("Alt");
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("First bold target words ending here. Next sentence. Container sibling.");

  await page.keyboard.down("Alt");
  await page.mouse.move(inlinePoint.x, inlinePoint.y);
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Alt");
  await page.keyboard.down("Alt");
  await page.mouse.click(inlinePoint.x, inlinePoint.y);
  await page.keyboard.up("Alt");
  await expect.poll(async function () {
    return readClipboard(page);
  }).toBe("bold target words");

  await page.close();
});

test("copies tables as TSV without hidden cells", async function () {
  const { page } = await openPage("fixtures/table-copy.html");
  await altClick(page.locator("td", { hasText: "Analytics Hub" }));

  await expect.poll(async function () {
    return readLatestHistoryText();
  }).toBe([
    "Product\tOwner\tStatus",
    "Editor Suite\tAna\tBeta",
    "Analytics Hub\tMarco\tLive",
    "Docs Cloud\tTrang SEA Region\tPlanning",
  ].join("\n"));

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
  await expect(popupPage.locator("#open_companion")).toHaveCount(0);
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
