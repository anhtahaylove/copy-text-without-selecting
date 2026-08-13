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

test("modifier release and leaving the document reset expanded scope", function () {
  let resets = 0;
  let hides = 0;
  const hoverState = {
    hoveredElement: { id: "target" },
    previewModifierActive: true,
  };
  const events = createContentEvents({
    utils: {
      isModifierKeyEvent: function () { return true; },
      isPrimaryModifierPressed: function () { return false; },
    },
    state: {
      settings: { metaKey: "Alt" },
      hoverState,
    },
    helpers: {
      resetScopeState: function () { resets += 1; },
      shouldShowPreview: function () { return false; },
      hidePreview: function () { hides += 1; },
    },
    isExtensionUsable: function () { return true; },
  });

  events.handleModifierChange({ key: "Alt" });
  events.handleMouseOut({ relatedTarget: null });

  assert.equal(resets, 2);
  assert.equal(hides, 2);
  assert.equal(hoverState.previewModifierActive, false);
  assert.equal(hoverState.hoveredElement, null);
});

test("mouseover without modifier flags does not clear an active scoped gesture", function () {
  const hoverState = {
    previewModifierActive: true,
    hoveredElement: null,
  };
  const events = createContentEvents({
    utils: {
      isPrimaryModifierPressed: function () { return false; },
    },
    state: {
      settings: { metaKey: "Alt" },
      hoverState,
    },
    helpers: {
      syncPointerState: function () {},
      getElementNode: function (node) { return node; },
      shouldShowPreview: function () { return true; },
      schedulePreviewUpdate: function () {},
    },
    isExtensionUsable: function () { return true; },
  });

  const nextTarget = { id: "scroll-retarget" };
  events.handleMouseOver({ target: nextTarget, altKey: false });

  assert.equal(hoverState.previewModifierActive, true);
  assert.equal(hoverState.hoveredElement, nextTarget);
});

test("wheel at the maximum scope does not consume page scrolling", function () {
  let prevented = 0;
  const events = createContentEvents({
    utils: {},
    state: {
      settings: { metaKey: "Alt" },
      hoverState: {
        previewModifierActive: true,
        scopeLevel: 3,
      },
    },
    helpers: {
      SCOPE_EXACT: 0,
      SCOPE_CONTAINER: 3,
      shouldShowPreview: function () { return true; },
    },
    isExtensionUsable: function () { return true; },
  });

  events.handleWheel({
    deltaY: -100,
    preventDefault: function () { prevented += 1; },
  });

  assert.equal(prevented, 0);
});

test("wheel skips scope levels that would shrink the exact target", function () {
  let prevented = 0;
  const receivedBaseTargets = [];
  const baseTarget = { id: "base" };
  const sentenceTarget = { id: "sentence" };
  const paragraphTarget = { id: "paragraph" };
  const hoverState = {
    hoveredElement: {},
    pointerClientX: 10,
    pointerClientY: 20,
    previewModifierActive: true,
    scopeAnchorClientX: null,
    scopeAnchorClientY: null,
    scopeBaseTarget: null,
    scopeLevel: 0,
  };
  const events = createContentEvents({
    utils: {},
    state: { settings: {}, hoverState },
    helpers: {
      SCOPE_EXACT: 0,
      SCOPE_CONTAINER: 3,
      shouldShowPreview: function () { return true; },
      resolvePrecisionTarget: function () { return baseTarget; },
      resolveScopedTarget: function (_element, _x, _y, level, anchoredBaseTarget) {
        receivedBaseTargets.push(anchoredBaseTarget);
        return level === 1 ? sentenceTarget : paragraphTarget;
      },
      doesTargetContain: function (container, inner) {
        return container === paragraphTarget || container === inner;
      },
      schedulePreviewUpdate: function () {},
    },
    isExtensionUsable: function () { return true; },
  });

  events.handleWheel({
    deltaY: -100,
    preventDefault: function () { prevented += 1; },
  });

  assert.equal(prevented, 1);
  assert.equal(hoverState.scopeLevel, 2);
  assert.equal(hoverState.scopeBaseTarget, baseTarget);
  assert.deepEqual(receivedBaseTargets, [baseTarget, baseTarget]);
});
