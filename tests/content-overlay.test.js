const test = require("node:test");
const assert = require("node:assert/strict");

const { createContentOverlay } = require("../src/content/overlay.js");

function createOverlay(scopeLevel, linkCopyFormat) {
  const context = {
    state: {
      hoverState: { scopeLevel: scopeLevel || 0 },
      settings: { toastDurationMs: 1400, linkCopyFormat: linkCopyFormat || "markdown" },
    },
    utils: {
      normalizeLinkCopyFormat: function (value) {
        return ["markdown", "text", "url"].includes(value) ? value : "markdown";
      },
    },
    t: function (key, fallback) {
      return fallback;
    },
  };
  const targeting = {
    SCOPE_SENTENCE: 1,
    SCOPE_PARAGRAPH: 2,
    SCOPE_CONTAINER: 3,
  };
  return createContentOverlay(context, targeting, {});
}

test("target badge identifies hidden accessible action labels", function () {
  const overlay = createOverlay(0);
  assert.equal(overlay.getTargetBadgeText({
    kind: "action",
    label: "About this result",
    labelSource: "aria-label",
  }), "Action · About this result");
  assert.equal(overlay.getTargetBadgeText({
    kind: "action",
    label: "Visible action",
    labelSource: "text",
  }), "");
});

test("target badge describes expanded scope and bounds long labels", function () {
  const overlay = createOverlay(1);
  assert.equal(overlay.getTargetBadgeText({ kind: "text" }), "Text · Sentence");

  const exactOverlay = createOverlay(0);
  const badge = exactOverlay.getTargetBadgeText({
    kind: "action",
    label: "A".repeat(100),
    labelSource: "title",
  });
  assert.equal(badge.length, "Action · ".length + 64);
  assert.ok(badge.endsWith("…"));
});

test("target badge shows the effective link copy format", function () {
  assert.equal(createOverlay(0, "markdown").getTargetBadgeText({ kind: "link" }), "Link · Markdown");
  assert.equal(createOverlay(0, "text").getTargetBadgeText({ kind: "link" }), "Link · Text");
  assert.equal(createOverlay(0, "url").getTargetBadgeText({ kind: "link" }), "Link · URL");
});
