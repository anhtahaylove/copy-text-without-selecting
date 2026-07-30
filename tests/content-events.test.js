const test = require("node:test");
const assert = require("node:assert/strict");
const { createContentEvents } = require("../src/content/events.js");

test("click copies the current event target instead of a stale preview target", async function () {
  const staleTarget = { id: "stale" };
  const currentTarget = { id: "current" };
  let copiedTarget;
  const hoverState = { lastRenderedTarget: staleTarget };
  const events = createContentEvents({
    utils: {
      getCopyMode: function () { return "copy"; },
    },
    state: {
      settings: { metaKey: "Alt" },
      hoverState,
    },
    helpers: {
      shouldIgnoreElement: function () { return false; },
      syncPointerState: function () {},
      getElementNode: function (element) { return element; },
      pierceShadowDOM: function (element) { return element; },
      copyCommand: async function (target) { copiedTarget = target; },
    },
    isExtensionUsable: function () { return true; },
    isCurrentHostExcluded: function () { return false; },
    handleExtensionContextError: function () { return false; },
  });

  events.handleClick({
    target: currentTarget,
    clientX: 1,
    clientY: 2,
    cancelable: true,
    composedPath: function () { return [currentTarget]; },
    preventDefault: function () {},
    stopImmediatePropagation: function () {},
  });
  await new Promise(function (resolve) { setImmediate(resolve); });

  assert.equal(copiedTarget, currentTarget);
  assert.equal(hoverState.hoveredElement, currentTarget);
});
