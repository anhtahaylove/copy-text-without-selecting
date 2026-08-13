(function () {
  const { createContentHelpers } = require("./helpers.js");
  const { createContentEvents } = require("./events.js");

  const previousState = globalThis.__copyTextWithAltClickContentScriptState;
  if (previousState && typeof previousState.dispose === "function") {
    previousState.dispose();
  }

  const utils = globalThis.CopyTextUtils;
  if (!utils) {
    console.error("CopyTextUtils is not available.");
    return;
  }

  const state = {
    settings: utils.mergeSettings(),
    overlayState: null,
    hoverState: {
      hoveredElement: null,
      previewModifierActive: false,
      previewAnimationFrame: 0,
      pointerPageX: null,
      pointerPageY: null,
      pointerClientX: null,
      pointerClientY: null,
      scopeLevel: 0,
      scopeAnchorClientX: null,
      scopeAnchorClientY: null,
      lastRenderedTarget: null,
    },
    suppressNativeCopyTracking: false,
    extensionContextInvalidated: !utils.isExtensionContextValid(),
    disposed: false,
    scriptState: null,
  };

  function isExtensionUsable() {
    return !state.disposed && !state.extensionContextInvalidated && utils.isExtensionContextValid();
  }

  function isCurrentHostExcluded() {
    return utils.isExcludedHost(window.location.hostname, state.settings.excludedDomains);
  }

  function t(key, fallback) {
    return utils.translate(state.settings, key, fallback, chrome.i18n && chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : "");
  }

  const context = {
    utils,
    state,
    isExtensionUsable,
    isCurrentHostExcluded,
    t,
    handleExtensionContextError,
  };

  const helpers = createContentHelpers(context);
  context.helpers = helpers;
  const events = createContentEvents(context);
  state.scriptState = { dispose: dispose };
  globalThis.__copyTextWithAltClickContentScriptState = state.scriptState;

  updateSettings();
  attachExtensionListeners();
  attachDomListeners();

  function onStorageChanged(changes, areaName) {
    if (!isExtensionUsable()) {
      return;
    }

    if (areaName == "sync") {
      updateSettings();
    }
  }

  function onRuntimeMessage(message, sender, sendResponse) {
    if (!isExtensionUsable()) {
      return false;
    }

    if (!message || message.type != "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT") {
      return false;
    }

    if (isCurrentHostExcluded() || !state.settings.keyboardShortcutEnabled) {
      if (isCurrentHostExcluded()) {
        helpers.saveAnalyticsEvent({
          type: "blockedExcluded",
          hostname: window.location.hostname,
          toastKind: "status",
        });
      }
      sendResponse({ ok: false, copied: false, reason: "disabled-or-excluded" });
      return false;
    }

    const shortcutTarget = helpers.resolveShortcutTarget();
    if (!shortcutTarget) {
      helpers.saveAnalyticsEvent({
        toastKind: "status",
        hostname: window.location.hostname,
      });
      helpers.showStatusToast(t("shortcut_unavailable", "No hovered or focused target to copy."));
      sendResponse({ ok: false, copied: false, reason: "no-target" });
      return false;
    }

    if (helpers.shouldIgnoreElement(shortcutTarget)) {
      helpers.saveAnalyticsEvent({
        type: "editableSkipped",
        hostname: window.location.hostname,
        toastKind: "status",
      });
      helpers.showStatusToast(t("unsupported_surface_status", "Editing surface skipped"));
      sendResponse({ ok: false, copied: false, reason: "ignored-target" });
      return false;
    }

    helpers.copyCommand(shortcutTarget, "shortcut", {
      preferSelection: true,
      ignoreSelectionPointer: true,
    }).then(function (copied) {
      sendResponse({ ok: !!copied, copied: !!copied });
    }).catch(function (error) {
      if (handleExtensionContextError(error)) {
        sendResponse({ ok: false, copied: false, reason: "context-invalidated" });
        return;
      }
      console.error("Shortcut copy failed.", error);
      sendResponse({ ok: false, copied: false, reason: "copy-failed" });
    });
    return true;
  }

  function attachExtensionListeners() {
    if (state.extensionContextInvalidated) {
      return;
    }

    try {
      utils.addListenerSafely(chrome.storage.onChanged, onStorageChanged);
    } catch (error) {
      handleExtensionContextError(error);
    }

    try {
      utils.addListenerSafely(chrome.runtime.onMessage, onRuntimeMessage);
    } catch (error) {
      handleExtensionContextError(error);
    }
  }

  function removeExtensionListeners() {
    try {
      utils.removeListenerSafely(chrome.storage.onChanged, onStorageChanged);
    } catch (error) {
      // Ignore invalidated contexts during teardown.
    }

    try {
      utils.removeListenerSafely(chrome.runtime.onMessage, onRuntimeMessage);
    } catch (error) {
      // Ignore invalidated contexts during teardown.
    }
  }

  function attachDomListeners() {
    document.addEventListener("click", events.handleClick, true);
    document.addEventListener("mousemove", events.handleMouseMove, true);
    document.addEventListener("mouseover", events.handleMouseOver, true);
    document.addEventListener("mouseout", events.handleMouseOut, true);
    document.addEventListener("copy", events.handleNativeCopy, true);
    document.addEventListener("keydown", events.handleModifierChange, true);
    document.addEventListener("keyup", events.handleModifierChange, true);
    document.addEventListener("wheel", events.handleWheel, { capture: true, passive: false });
    document.addEventListener("scroll", events.handleViewportChange, true);
    document.addEventListener("visibilitychange", events.handleVisibilityChange, true);
    window.addEventListener("resize", events.handleViewportChange);
  }

  function removeDomListeners() {
    document.removeEventListener("click", events.handleClick, true);
    document.removeEventListener("mousemove", events.handleMouseMove, true);
    document.removeEventListener("mouseover", events.handleMouseOver, true);
    document.removeEventListener("mouseout", events.handleMouseOut, true);
    document.removeEventListener("copy", events.handleNativeCopy, true);
    document.removeEventListener("keydown", events.handleModifierChange, true);
    document.removeEventListener("keyup", events.handleModifierChange, true);
    document.removeEventListener("wheel", events.handleWheel, true);
    document.removeEventListener("scroll", events.handleViewportChange, true);
    document.removeEventListener("visibilitychange", events.handleVisibilityChange, true);
    window.removeEventListener("resize", events.handleViewportChange);
  }

  function handleExtensionContextError(error) {
    if (!utils.isExtensionContextInvalidatedError(error)) {
      return false;
    }

    dispose();
    return true;
  }

  function dispose() {
    if (state.disposed) {
      return;
    }

    state.disposed = true;
    state.extensionContextInvalidated = true;

    if (state.hoverState.previewAnimationFrame) {
      cancelAnimationFrame(state.hoverState.previewAnimationFrame);
      state.hoverState.previewAnimationFrame = 0;
    }

    removeExtensionListeners();
    removeDomListeners();
    helpers.hidePreview();

    if (globalThis.__copyTextWithAltClickContentScriptState === state.scriptState) {
      delete globalThis.__copyTextWithAltClickContentScriptState;
    }
  }

  function updateSettings() {
    if (!isExtensionUsable()) {
      return;
    }

    utils.safeStorageGet("sync", utils.DEFAULT_SETTINGS).then(function (items) {
      if (!isExtensionUsable()) {
        return;
      }

      state.settings = utils.mergeSettings(items);

      if (isCurrentHostExcluded() || !state.hoverState.previewModifierActive) {
        helpers.hidePreview();
      } else if (helpers.shouldShowPreview()) {
        helpers.schedulePreviewUpdate();
      }
    }).catch(function (error) {
      if (handleExtensionContextError(error)) {
        return;
      }

      console.warn("Updating settings failed.", error);
    });
  }
})();
