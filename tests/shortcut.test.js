const test = require("node:test");
const assert = require("node:assert/strict");

const {
  triggerShortcutCopy,
  isShortcutCopySuccess,
} = require("../src/background/shortcut.js");

function createShortcutUtils(overrides) {
  const config = Object.assign({
    keyboardShortcutEnabled: true,
    activeTab: { id: 7, url: "https://example.com/article" },
    excluded: false,
  }, overrides || {});

  return {
    DEFAULT_SETTINGS: {},
    mergeSettings: function () {
      return {
        keyboardShortcutEnabled: config.keyboardShortcutEnabled,
        excludedDomains: [],
      };
    },
    safeStorageGet: async function () {
      return {};
    },
    safeTabsQuery: async function () {
      return config.activeTab ? [config.activeTab] : [];
    },
    safeExecuteScript: async function (details) {
      config.events.push({ type: "executeScript", details: details });
      return [];
    },
    getHostnameFromUrl: function (url) {
      return new URL(url).hostname;
    },
    isExcludedHost: function () {
      return config.excluded;
    },
    isExtensionContextInvalidatedError: function () {
      return false;
    },
    events: config.events,
  };
}

test("isShortcutCopySuccess requires an explicit copied ack", function () {
  assert.equal(isShortcutCopySuccess({ ok: true, copied: true }), true);
  assert.equal(isShortcutCopySuccess({ ok: true, copied: false }), false);
  assert.equal(isShortcutCopySuccess(undefined), false);
});

test("shortcut copy completes after content confirms copy", async function () {
  const originalChrome = global.chrome;
  const events = [];
  global.chrome = {
    tabs: {
      sendMessage: async function (tabId, message) {
        events.push({ type: "sendMessage", tabId: tabId, message: message });
        return { ok: true, copied: true };
      },
    },
  };

  try {
    const result = await triggerShortcutCopy(createShortcutUtils({ events: events }), async function () {});

    assert.deepEqual(events.map(function (event) { return event.type; }), ["sendMessage"]);
    assert.equal(result.copied, true);
    assert.equal(result.reason, "copied");
  } finally {
    global.chrome = originalChrome;
  }
});

test("shortcut copy reports when content does not copy", async function () {
  const originalChrome = global.chrome;
  const events = [];
  global.chrome = {
    tabs: {
      sendMessage: async function () {
        events.push({ type: "sendMessage" });
        return { ok: false, copied: false, reason: "no-target" };
      },
    },
  };

  try {
    const result = await triggerShortcutCopy(createShortcutUtils({ events: events }), async function () {});

    assert.deepEqual(events.map(function (event) { return event.type; }), ["sendMessage"]);
    assert.equal(result.copied, false);
    assert.equal(result.reason, "no-target");
  } finally {
    global.chrome = originalChrome;
  }
});

test("shortcut copy injects the content script before retrying", async function () {
  const originalChrome = global.chrome;
  const events = [];
  let attempts = 0;
  global.chrome = {
    tabs: {
      sendMessage: async function () {
        attempts += 1;
        events.push({ type: "sendMessage", attempts: attempts });
        if (attempts === 1) {
          throw new Error("Could not establish connection.");
        }
        return { ok: true, copied: true };
      },
    },
  };

  try {
    const result = await triggerShortcutCopy(createShortcutUtils({ events: events }), async function () {});

    assert.deepEqual(events.map(function (event) { return event.type; }), [
      "sendMessage",
      "executeScript",
      "sendMessage",
    ]);
    assert.equal(result.copied, true);
    assert.equal(result.reason, "copied");
  } finally {
    global.chrome = originalChrome;
  }
});
