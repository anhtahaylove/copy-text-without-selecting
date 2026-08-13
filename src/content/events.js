function createContentEvents(context) {
  const utils = context.utils;
  const hoverState = context.state.hoverState;
  const helpers = context.helpers;

  function handleClick(event) {
    if (!context.isExtensionUsable()) {
      return;
    }

    const copyMode = utils.getCopyMode(context.state.settings.metaKey, event);
    if (!copyMode || context.isCurrentHostExcluded()) {
      if (copyMode && context.isCurrentHostExcluded()) {
        helpers.saveAnalyticsEvent({
          type: "blockedExcluded",
          hostname: window.location.hostname,
        });
      }
      return;
    }

    const composedTarget = event.composedPath ? event.composedPath()[0] : event.target;
    const deepTarget = helpers.getElementNode(helpers.pierceShadowDOM(composedTarget, event.clientX, event.clientY));
    if (helpers.shouldIgnoreElement(deepTarget)) {
      helpers.saveAnalyticsEvent({
        type: "editableSkipped",
        hostname: window.location.hostname,
      });
      return;
    }

    claimCopyGesture(event);
    helpers.syncPointerState(event);
    hoverState.hoveredElement = deepTarget;
    helpers.copyCommand(deepTarget, "click", {
      clientX: event.clientX,
      clientY: event.clientY,
      preferSelection: true,
    }).catch(function (error) {
      if (context.handleExtensionContextError(error)) {
        return;
      }
      console.error("Copy failed.", error);
    });
  }

  function claimCopyGesture(event) {
    if (typeof event.preventDefault === "function" && event.cancelable !== false) {
      event.preventDefault();
    }

    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
      return;
    }

    if (typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
  }

  function handleMouseMove(event) {
    if (!context.isExtensionUsable()) {
      return;
    }

    if (!utils.isPrimaryModifierPressed(context.state.settings.metaKey, event)) {
      helpers.syncPointerState(event);
      hoverState.previewModifierActive = false;
      helpers.resetScopeState();
      return;
    }

    helpers.syncPointerState(event);
    const composedTarget = event.composedPath ? event.composedPath()[0] : event.target;
    const nextHoveredElement = helpers.getElementNode(helpers.pierceShadowDOM(composedTarget, event.clientX, event.clientY));
    if (hoverState.scopeLevel > helpers.SCOPE_EXACT && hoverState.scopeBaseTarget) {
      const nextBaseTarget = helpers.resolvePrecisionTarget(nextHoveredElement, {
        clientX: event.clientX,
        clientY: event.clientY,
        preferSelection: true,
        scopeLevel: helpers.SCOPE_EXACT,
      });
      if (!helpers.isSamePrecisionTarget(hoverState.scopeBaseTarget, nextBaseTarget)) {
        helpers.resetScopeState();
      }
    }
    hoverState.hoveredElement = nextHoveredElement;
    hoverState.previewModifierActive = true;

    if (helpers.shouldShowPreview()) {
      helpers.schedulePreviewUpdate();
    } else {
      helpers.hidePreview();
    }
  }

  function handleMouseOver(event) {
    if (!context.isExtensionUsable()) {
      return;
    }

    helpers.syncPointerState(event);
    hoverState.hoveredElement = helpers.getElementNode(event.target);
    hoverState.previewModifierActive = utils.isPrimaryModifierPressed(context.state.settings.metaKey, event);

    if (helpers.shouldShowPreview()) {
      helpers.schedulePreviewUpdate();
    }
  }

  function handleMouseOut(event) {
    if (!context.isExtensionUsable()) {
      return;
    }

    if (!event.relatedTarget) {
      hoverState.hoveredElement = null;
      helpers.resetScopeState();
      helpers.hidePreview();
      return;
    }

    hoverState.hoveredElement = helpers.getElementNode(event.relatedTarget);

    if (helpers.shouldShowPreview()) {
      helpers.schedulePreviewUpdate();
    } else if (!hoverState.previewModifierActive) {
      helpers.hidePreview();
    }
  }

  function handleNativeCopy() {
    if (!context.isExtensionUsable()) {
      return;
    }

    if (context.state.suppressNativeCopyTracking || context.isCurrentHostExcluded()) {
      return;
    }

    const copiedText = helpers.getNativeCopiedText();
    if (!copiedText) {
      return;
    }

    helpers.saveAnalyticsEvent({
      type: "nativeCopy",
      hostname: window.location.hostname,
    });
    helpers.saveHistory(copiedText, "copied", "native");
  }

  function handleModifierChange(event) {
    if (!context.isExtensionUsable()) {
      return;
    }

    if (!utils.isModifierKeyEvent(event)) {
      return;
    }

    hoverState.previewModifierActive = utils.isPrimaryModifierPressed(context.state.settings.metaKey, event);

    if (!hoverState.previewModifierActive) {
      helpers.resetScopeState();
    }

    if (!hoverState.hoveredElement && hoverState.pointerClientX !== null && hoverState.pointerClientY !== null) {
      const pointElement = document.elementFromPoint(hoverState.pointerClientX, hoverState.pointerClientY);
      hoverState.hoveredElement = helpers.getElementNode(helpers.pierceShadowDOM(pointElement, hoverState.pointerClientX, hoverState.pointerClientY));
    }

    if (helpers.shouldShowPreview()) {
      helpers.schedulePreviewUpdate();
    } else {
      helpers.hidePreview();
    }
  }

  function handleViewportChange() {
    if (!context.isExtensionUsable()) {
      return;
    }

    if (helpers.shouldShowPreview()) {
      helpers.schedulePreviewUpdate();
    }
  }

  function handleVisibilityChange() {
    if (!context.isExtensionUsable()) {
      return;
    }

    if (document.hidden) {
      helpers.hidePreview();
    }
  }

  function handleWheel(event) {
    if (!context.isExtensionUsable()) {
      return;
    }

    if (!hoverState.previewModifierActive || !helpers.shouldShowPreview()) {
      return;
    }

    const delta = event.deltaY < 0 ? 1 : -1;
    const nextLevel = Math.max(helpers.SCOPE_EXACT, Math.min(helpers.SCOPE_CONTAINER, hoverState.scopeLevel + delta));
    if (nextLevel === hoverState.scopeLevel) {
      return;
    }

    if (nextLevel > helpers.SCOPE_EXACT) {
      const anchorClientX = hoverState.scopeAnchorClientX !== null ? hoverState.scopeAnchorClientX : hoverState.pointerClientX;
      const anchorClientY = hoverState.scopeAnchorClientY !== null ? hoverState.scopeAnchorClientY : hoverState.pointerClientY;
      const scopedTarget = helpers.resolveScopedTarget(hoverState.hoveredElement, anchorClientX, anchorClientY, nextLevel);
      if (!scopedTarget) {
        return;
      }

      if (hoverState.scopeLevel === helpers.SCOPE_EXACT) {
        const baseTarget = helpers.resolvePrecisionTarget(hoverState.hoveredElement, {
          clientX: hoverState.pointerClientX,
          clientY: hoverState.pointerClientY,
          preferSelection: true,
          scopeLevel: helpers.SCOPE_EXACT,
        });
        if (!baseTarget) {
          return;
        }
        hoverState.scopeBaseTarget = baseTarget;
        hoverState.scopeAnchorClientX = hoverState.pointerClientX;
        hoverState.scopeAnchorClientY = hoverState.pointerClientY;
      }
    }

    event.preventDefault();

    if (nextLevel === helpers.SCOPE_EXACT) {
      helpers.resetScopeState();
      helpers.schedulePreviewUpdate();
      return;
    }

    hoverState.scopeLevel = nextLevel;
    helpers.schedulePreviewUpdate();
  }

  return {
    handleClick,
    handleMouseMove,
    handleMouseOver,
    handleMouseOut,
    handleNativeCopy,
    handleModifierChange,
    handleViewportChange,
    handleVisibilityChange,
    handleWheel,
  };
}

module.exports = {
  createContentEvents,
};
