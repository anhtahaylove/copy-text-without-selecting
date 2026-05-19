const test = require("node:test");
const assert = require("node:assert/strict");
const utils = require("../shared.js");

test("normalizeDomain strips protocol, paths, and leading dots", function () {
  assert.equal(utils.normalizeDomain("https://docs.google.com/document/d/123"), "docs.google.com");
  assert.equal(utils.normalizeDomain(".figma.com"), "figma.com");
  assert.equal(utils.normalizeDomain("sub.example.com/path?q=1"), "sub.example.com");
});

test("normalizeExcludedDomains deduplicates and normalizes values", function () {
  assert.deepEqual(
    utils.normalizeExcludedDomains([
      "https://docs.google.com",
      "docs.google.com",
      " .figma.com ",
      ""
    ]),
    ["docs.google.com", "figma.com"]
  );
});

test("mergeSettings applies defaults and clamps duration", function () {
  assert.deepEqual(
    utils.mergeSettings({
      metaKey: "Ctrl",
      excludedDomains: "docs.google.com",
      previewEnabled: false,
      avoidEditable: false,
      toastDurationMs: 5000
    }),
    {
      metaKey: "Ctrl",
      excludedDomains: ["docs.google.com"],
      previewEnabled: false,
      avoidEditable: false,
      toastDurationMs: 5000,
      uiLanguage: "auto",
      copyHistoryLimit: 20,
      keyboardShortcutEnabled: true
    }
  );
});

test("isExcludedHost matches exact domains and subdomains", function () {
  const excluded = ["figma.com", "docs.google.com"];
  assert.equal(utils.isExcludedHost("figma.com", excluded), true);
  assert.equal(utils.isExcludedHost("www.figma.com", excluded), true);
  assert.equal(utils.isExcludedHost("x.docs.google.com", excluded), true);
  assert.equal(utils.isExcludedHost("google.com", excluded), false);
});

test("buildExcludeMatches generates host and wildcard patterns", function () {
  assert.deepEqual(
    utils.buildExcludeMatches(["figma.com"]),
    ["*://figma.com/*", "*://*.figma.com/*"]
  );
});

test("getCopyMode returns copy when the configured modifier is held", function () {
  assert.equal(utils.getCopyMode("Alt", { altKey: true, shiftKey: false }), "copy");
  assert.equal(utils.getCopyMode("Shift", { altKey: false, shiftKey: true }), "copy");
  assert.equal(utils.getCopyMode("Ctrl", { ctrlKey: false, shiftKey: false }), null);
});

test("toggleDomain adds and removes normalized hostnames", function () {
  assert.deepEqual(utils.toggleDomain([], "https://docs.google.com"), ["docs.google.com"]);
  assert.deepEqual(utils.toggleDomain(["docs.google.com"], "docs.google.com"), []);
});

test("translate resolves manual Vietnamese override and auto language", function () {
  assert.equal(utils.translate({ uiLanguage: "vi" }, "popup_site_active", "fallback", "en-US"), "Đang bật");
  assert.equal(utils.translate({ uiLanguage: "auto" }, "popup_site_active", "fallback", "vi-VN"), "Đang bật");
  assert.equal(utils.translate({ uiLanguage: "auto" }, "popup_site_active", "fallback", "ja"), "fallback");
});

test("pushHistoryEntry deduplicates by text and enforces the limit", function () {
  const history = utils.pushHistoryEntry([
    { id: "1", text: "Old", snippet: "Old", createdAt: 1, source: "click", mode: "copy", url: "https://example.com" },
    { id: "2", text: "Keep", snippet: "Keep", createdAt: 2, source: "shortcut", mode: "copy", url: "https://example.com" }
  ], {
    text: "Old",
    snippet: "Old",
    createdAt: 3,
    source: "shortcut",
    mode: "copy",
    url: "https://example.com/page"
  }, 2);

  assert.equal(history.length, 2);
  assert.equal(history[0].text, "Old");
  assert.equal(history[0].source, "shortcut");
  assert.equal(history[1].text, "Keep");
});

test("getTextSnippet collapses whitespace and truncates long text", function () {
  assert.equal(utils.getTextSnippet("  A   long   text  "), "A long text");
  assert.equal(utils.getTextSnippet("1234567890", 8), "12345...");
});

test("recordAnalyticsEvent increments totals and domain stats", function () {
  let analytics = utils.recordAnalyticsEvent(utils.DEFAULT_ANALYTICS, {
    type: "copy",
    hostname: "docs.google.com",
    toastKind: "copied",
  });
  analytics = utils.recordAnalyticsEvent(analytics, {
    type: "shortcut",
    hostname: "docs.google.com",
  });
  analytics = utils.recordAnalyticsEvent(analytics, {
    type: "blockedExcluded",
    hostname: "figma.com",
    toastKind: "status",
  });

  assert.equal(analytics.totals.totalActions, 1);
  assert.equal(analytics.totals.copied, 1);
  assert.equal(analytics.totals.shortcuts, 1);
  assert.equal(analytics.totals.excludedBlocked, 1);
  assert.equal(analytics.toastCounts.copied, 1);
  assert.equal(analytics.toastCounts.status, 1);
  assert.equal(analytics.domainStats["docs.google.com"].copied, 1);
  assert.equal(analytics.domainStats["docs.google.com"].shortcuts, 1);
  assert.equal(analytics.domainStats["figma.com"].blockedExcluded, 1);
});

test("recordAnalyticsEvent tracks native copy activity", function () {
  const analytics = utils.recordAnalyticsEvent(utils.DEFAULT_ANALYTICS, {
    type: "nativeCopy",
    hostname: "example.com",
  });

  assert.equal(analytics.totals.totalActions, 1);
  assert.equal(analytics.totals.nativeCopies, 1);
  assert.equal(analytics.domainStats["example.com"].copied, 1);
});

test("filterHistoryEntries applies search, source, mode, and domain filters", function () {
  const entries = [
    { text: "Google Docs Guide", snippet: "Google Docs Guide", source: "click", mode: "copy", hostname: "docs.google.com" },
    { text: "Figma Board", snippet: "Figma Board", source: "shortcut", mode: "copy", hostname: "figma.com" },
    { text: "Replay", snippet: "Replay", source: "history", mode: "copy", hostname: "example.com" },
    { text: "Selected native text", snippet: "Selected native text", source: "native", mode: "copy", hostname: "news.ycombinator.com" }
  ];

  assert.equal(utils.filterHistoryEntries(entries, { search: "docs", source: "all", mode: "all", hostname: "all" }).length, 1);
  assert.equal(utils.filterHistoryEntries(entries, { search: "", source: "shortcut", mode: "copy", hostname: "figma.com" }).length, 1);
  assert.equal(utils.filterHistoryEntries(entries, { search: "", source: "history", mode: "copy", hostname: "all" }).length, 1);
  assert.equal(utils.filterHistoryEntries(entries, { search: "native", source: "native", mode: "copy", hostname: "news.ycombinator.com" }).length, 1);
});

test("updateHistoryEntry updates replay metadata", function () {
  const entries = [
    { id: "a", text: "Alpha", snippet: "Alpha", createdAt: 1, source: "click", mode: "copy", hostname: "example.com", pinned: false, replayCount: 0, lastReplayedAt: 0 }
  ];

  const updated = utils.updateHistoryEntry(entries, "a", function (entry) {
    entry.replayCount = 3;
    entry.lastReplayedAt = 99;
    return entry;
  }, 10);

  assert.equal(updated[0].replayCount, 3);
  assert.equal(updated[0].lastReplayedAt, 99);
});

test("deleteHistoryEntries removes targeted items", function () {
  const entries = [
    { id: "a", text: "Alpha", snippet: "Alpha", createdAt: 1, source: "click", mode: "copy", hostname: "example.com" },
    { id: "b", text: "Beta", snippet: "Beta", createdAt: 2, source: "native", mode: "copy", hostname: "example.com" }
  ];

  const remaining = utils.deleteHistoryEntries(entries, ["a"]);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, "b");
});

test("sortHistoryEntries supports replay sorting", function () {
  const entries = [
    { id: "a", text: "Alpha", snippet: "Alpha", createdAt: 1, source: "click", mode: "copy", hostname: "example.com", pinned: false, replayCount: 1 },
    { id: "b", text: "Beta", snippet: "Beta", createdAt: 3, source: "click", mode: "copy", hostname: "example.com", pinned: false, replayCount: 0 },
    { id: "c", text: "Gamma", snippet: "Gamma", createdAt: 2, source: "click", mode: "copy", hostname: "example.com", pinned: false, replayCount: 5 }
  ];

  assert.equal(utils.sortHistoryEntries(entries, "replayed")[0].id, "c");
});

test("groupHistoryEntries groups by source", function () {
  const entries = [
    { id: "a", text: "Alpha", snippet: "Alpha", createdAt: 1, source: "click", mode: "copy", hostname: "example.com" },
    { id: "b", text: "Beta", snippet: "Beta", createdAt: 2, source: "native", mode: "copy", hostname: "example.com" }
  ];

  const groups = utils.groupHistoryEntries(entries, "source");
  assert.equal(groups.length, 2);
  assert.equal(groups[0].entries.length, 1);
});

test("sanitizeText removes zero-width spaces and BOM", function () {
  assert.equal(utils.sanitizeText("Hello\u200BWorld"), "HelloWorld");
  assert.equal(utils.sanitizeText("\uFEFFStart"), "Start");
  assert.equal(utils.sanitizeText("A\u200CB\u200DC"), "ABC");
});

test("sanitizeText collapses horizontal whitespace and trims", function () {
  assert.equal(utils.sanitizeText("  Hello   World  "), "Hello World");
  assert.equal(utils.sanitizeText("Tab\t\tSpace"), "Tab Space");
  assert.equal(utils.sanitizeText("  \t  "), "");
});

test("sanitizeText preserves up to 2 consecutive newlines", function () {
  assert.equal(utils.sanitizeText("A\n\nB"), "A\n\nB");
  assert.equal(utils.sanitizeText("A\n\n\n\nB"), "A\n\nB");
  assert.equal(utils.sanitizeText("A\n\n\n\n\n\nB"), "A\n\nB");
});

test("sanitizeText converts non-breaking spaces to regular spaces", function () {
  assert.equal(utils.sanitizeText("Hello\u00A0World"), "Hello World");
  assert.equal(utils.sanitizeText("Multiple\u00A0\u00A0Nbsp"), "Multiple Nbsp");
});

test("sanitizeText handles empty and null input", function () {
  assert.equal(utils.sanitizeText(""), "");
  assert.equal(utils.sanitizeText(null), "");
  assert.equal(utils.sanitizeText(undefined), "");
});

test("pushHistoryEntry deduplicates consecutive identical text", function () {
  const first = utils.pushHistoryEntry([], {
    text: "Same text",
    snippet: "Same text",
    createdAt: 1,
    source: "click",
    mode: "copy",
    url: "https://example.com"
  }, 20);

  const second = utils.pushHistoryEntry(first, {
    text: "Same text",
    snippet: "Same text",
    createdAt: 2,
    source: "click",
    mode: "copy",
    url: "https://example.com"
  }, 20);

  assert.equal(second.length, 1, "Should have only 1 entry after copying same text twice");
  assert.equal(second[0].createdAt, 2, "Should update timestamp to latest");
});

test("pushHistoryEntry preserves pinned status on dedup", function () {
  const entries = [{
    id: "pinned-1",
    text: "Pinned entry",
    snippet: "Pinned entry",
    createdAt: 1,
    source: "click",
    mode: "copy",
    hostname: "example.com",
    pinned: true
  }];

  const result = utils.pushHistoryEntry(entries, {
    text: "Pinned entry",
    snippet: "Pinned entry",
    createdAt: 2,
    source: "shortcut",
    mode: "copy",
    hostname: "example.com",
    pinned: false
  }, 20);

  assert.equal(result.length, 1);
  assert.equal(result[0].pinned, true, "Pinned status should be preserved from original");
  assert.equal(result[0].source, "shortcut", "Source should update to latest");
});

test("isExtensionContextValid reflects chrome.runtime.id presence", function () {
  const originalChrome = global.chrome;

  delete global.chrome;
  assert.equal(utils.isExtensionContextValid(), false);

  global.chrome = { runtime: { id: "abc123" } };
  assert.equal(utils.isExtensionContextValid(), true);

  global.chrome = originalChrome;
});

test("isExtensionContextInvalidatedError detects the expected runtime error", function () {
  assert.equal(utils.isExtensionContextInvalidatedError(new Error("Extension context invalidated.")), true);
  assert.equal(utils.isExtensionContextInvalidatedError(new Error("Could not establish connection. Receiving end does not exist.")), false);
});

test("safeStorage wrappers return fallbacks when context is unavailable", async function () {
  const originalChrome = global.chrome;
  delete global.chrome;

  const storageDefaults = { ok: true };
  assert.deepEqual(await utils.safeStorageGet("sync", storageDefaults), storageDefaults);
  assert.equal(await utils.safeStorageSet("sync", { ok: false }), false);
  assert.deepEqual(await utils.safeTabsQuery({}), []);
  assert.deepEqual(await utils.safeExecuteScript({}), []);
  assert.equal(await utils.safeSendMessage(1, { ping: true }), null);
  assert.equal(await utils.safeOpenOptionsPage(), false);

  global.chrome = originalChrome;
});
