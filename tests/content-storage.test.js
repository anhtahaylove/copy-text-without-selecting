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
