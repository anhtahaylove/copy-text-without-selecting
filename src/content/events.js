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

    if (helpers.shouldIgnoreElement(event.target)) {
      helpers.saveAnalyticsEvent({
        type: "editableSkipped",
        hostname: window.location.hostname,
      });
      return;
    }

    claimCopyGesture(event);

    const targetToCopy = hoverState.lastRenderedTarget;
    helpers.syncPointerState(event);

    if (targetToCopy) {
      helpers.executePrecisionCopy(targetToCopy, "click").catch(function (error) {
        if (context.handleExtensionContextError(error)) {
          return;
        }
        console.error("Copy failed.", error);
      });
    } else {
      const composedTarget = event.composedPath ? event.composedPath()[0] : event.target;
      const deepTarget = helpers.getElementNode(helpers.pierceShadowDOM(composedTarget, event.clientX, event.clientY));
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
      hoverState.pointerClientX = event.clientX;
      hoverState.pointerClientY = event.clientY;
      hoverState.pointerPageX = event.pageX;
      hoverState.pointerPageY = event.pageY;
      hoverState.previewModifierActive = false;
      return;
    }

    helpers.syncPointerState(event);
    const composedTarget = event.composedPath ? event.composedPath()[0] : event.target;
    hoverState.hoveredElement = helpers.getElementNode(helpers.pierceShadowDOM(composedTarget, event.clientX, event.clientY));
    hoverState.previewModifierActive = true;
    hoverState.scopeLevel = 0;

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
      hoverState.scopeLevel = 0;
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

    event.preventDefault();

    const delta = event.deltaY < 0 ? 1 : -1;
    const nextLevel = Math.max(0, Math.min(3, hoverState.scopeLevel + delta));
    if (nextLevel === hoverState.scopeLevel) {
      return;
    }

    hoverState.scopeLevel = nextLevel;
    hoverState.scopeAnchorClientX = hoverState.pointerClientX;
    hoverState.scopeAnchorClientY = hoverState.pointerClientY;
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
