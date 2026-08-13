const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/shared/core.js");
const { createContentClipboard } = require("../src/content/clipboard.js");
const { createContentPersistence } = require("../src/content/persistence.js");

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  return function restore() {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete globalThis[name];
    }
  };
}

test("clipboard fallback rejects instead of recording a false success", async function () {
  const restoreNavigator = replaceGlobal("navigator", {});
  const restoreDocument = replaceGlobal("document", {
    body: { appendChild: function () {} },
    createElement: function () {
      return {
        style: {},
        select: function () {},
        remove: function () {},
      };
    },
    execCommand: function () { return false; },
  });
  const context = {
    state: {
      hoverState: {},
      suppressNativeCopyTracking: false,
    },
  };
  const clipboard = createContentClipboard(context, {}, {}, {}, {});

  try {
    await assert.rejects(clipboard.copy("text", ""), /Copy failed/);
  } finally {
    restoreDocument();
    restoreNavigator();
  }
});

test("content history keeps the background service worker as the only writer", async function () {
  const restoreChrome = replaceGlobal("chrome", {
    runtime: {
      id: "test-extension",
      sendMessage: async function () { throw new Error("background unavailable"); },
    },
  });
  const restoreWindow = replaceGlobal("window", {
    location: {
      href: "https://example.com/page",
      hostname: "example.com",
    },
  });
  let localAccesses = 0;
  const utils = Object.assign({}, core, {
    safeStorageGet: async function () { localAccesses += 1; return { copyHistory: [] }; },
    safeStorageSet: async function () { localAccesses += 1; return true; },
  });
  const persistence = createContentPersistence({
    utils,
    state: { settings: core.mergeSettings() },
    handleExtensionContextError: function () { return false; },
  });
  const originalWarn = console.warn;
  console.warn = function () {};

  try {
    await persistence.saveHistory("text", "copied", "click", false);
    assert.equal(localAccesses, 0);
  } finally {
    console.warn = originalWarn;
    restoreWindow();
    restoreChrome();
  }
});

test("successful precision copy resets expanded scope", async function () {
  const restoreNavigator = replaceGlobal("navigator", {
    clipboard: {
      writeText: async function () {},
    },
  });
  const restoreWindow = replaceGlobal("window", {
    location: { hostname: "example.com" },
  });
  let resets = 0;
  const clipboard = createContentClipboard({
    state: { hoverState: {} },
  }, {
    resetScopeState: function () { resets += 1; },
  }, {
    getText: function () { return "Copied text"; },
    getHtmlContent: function () { return ""; },
    getCopyMetadata: function () { return { targetKind: "text" }; },
  }, {
    showCopyFeedback: function () {},
  }, {
    getAnalyticsTypeForResult: function () { return "copy"; },
    getToastAnalyticsKind: function () { return "copied"; },
    saveAnalyticsEvents: function () {},
    saveHistory: async function () {},
  });

  try {
    assert.equal(await clipboard.executePrecisionCopy({ kind: "text", rect: {} }, "click"), true);
    assert.equal(resets, 1);
  } finally {
    restoreWindow();
    restoreNavigator();
  }
});

test("precision copy snapshots history metadata before the async clipboard write", async function () {
  let releaseClipboard;
  const clipboardPending = new Promise(function (resolve) { releaseClipboard = resolve; });
  const restoreNavigator = replaceGlobal("navigator", {
    clipboard: {
      writeText: function () { return clipboardPending; },
    },
  });
  const restoreWindow = replaceGlobal("window", {
    location: { hostname: "example.com" },
  });
  let currentFormat = "markdown";
  let savedMetadata;
  const clipboard = createContentClipboard({
    state: { hoverState: {} },
  }, {
    resetScopeState: function () {},
  }, {
    getText: function () { return "[Docs](https://example.com/docs)"; },
    getHtmlContent: function () { return ""; },
    getCopyMetadata: function () { return { targetKind: "link", copyFormat: currentFormat }; },
  }, {
    showCopyFeedback: function () {},
  }, {
    getAnalyticsTypeForResult: function () { return "copy"; },
    getToastAnalyticsKind: function () { return "copied"; },
    saveAnalyticsEvents: function () {},
    saveHistory: async function (_text, _result, _source, _selection, metadata) {
      savedMetadata = metadata;
    },
  });

  try {
    const copyPromise = clipboard.executePrecisionCopy({ kind: "link", rect: {} }, "click");
    currentFormat = "url";
    releaseClipboard();
    await copyPromise;
    assert.deepEqual(savedMetadata, { targetKind: "link", copyFormat: "markdown" });
  } finally {
    restoreWindow();
    restoreNavigator();
  }
});

test("rich clipboard write publishes matching plain and HTML MIME blobs", async function () {
  let writtenItems;
  const restoreNavigator = replaceGlobal("navigator", {
    clipboard: {
      write: async function (items) { writtenItems = items; },
    },
  });
  const restoreClipboardItem = replaceGlobal("ClipboardItem", class ClipboardItem {
    constructor(data) {
      this.data = data;
    }
  });
  const clipboard = createContentClipboard({ state: { hoverState: {} } }, {}, {}, {}, {});

  try {
    await clipboard.copy("Plain label", "<b>Plain label</b>");
    assert.equal(writtenItems.length, 1);
    const data = writtenItems[0].data;
    assert.deepEqual(Object.keys(data).sort(), ["text/html", "text/plain"]);
    assert.equal(data["text/plain"].type, "text/plain");
    assert.equal(await data["text/plain"].text(), "Plain label");
    assert.equal(data["text/html"].type, "text/html");
    assert.equal(await data["text/html"].text(), "<b>Plain label</b>");
  } finally {
    restoreClipboardItem();
    restoreNavigator();
  }
});

test("rich clipboard failure falls back to writeText exactly once", async function () {
  let fallbackText = "";
  let fallbackWrites = 0;
  const restoreNavigator = replaceGlobal("navigator", {
    clipboard: {
      write: async function () { throw new Error("rich write blocked"); },
      writeText: async function (text) {
        fallbackWrites += 1;
        fallbackText = text;
      },
    },
  });
  const restoreClipboardItem = replaceGlobal("ClipboardItem", class ClipboardItem {});
  const clipboard = createContentClipboard({ state: { hoverState: {} } }, {}, {}, {}, {});
  const originalWarn = console.warn;
  console.warn = function () {};

  try {
    await clipboard.copy("Fallback label", "<b>Fallback label</b>");
    assert.equal(fallbackWrites, 1);
    assert.equal(fallbackText, "Fallback label");
  } finally {
    console.warn = originalWarn;
    restoreClipboardItem();
    restoreNavigator();
  }
});

test("content history forwards optional target and link format metadata", async function () {
  let sentMessage;
  const restoreChrome = replaceGlobal("chrome", {
    runtime: {
      id: "test-extension",
      sendMessage: async function (message) {
        sentMessage = message;
        return { ok: true };
      },
    },
  });
  const restoreWindow = replaceGlobal("window", {
    location: {
      href: "https://example.com/page",
      hostname: "example.com",
    },
  });
  const persistence = createContentPersistence({
    utils: core,
    state: { settings: core.mergeSettings({ linkCopyFormat: "url" }) },
    handleExtensionContextError: function () { return false; },
  });

  try {
    await persistence.saveHistory("https://example.com/docs", "copied", "click", false, {
      targetKind: "link",
      copyFormat: "url",
    });
    assert.equal(sentMessage.payload.entry.targetKind, "link");
    assert.equal(sentMessage.payload.entry.copyFormat, "url");
  } finally {
    restoreWindow();
    restoreChrome();
  }
});
