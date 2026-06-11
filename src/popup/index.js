const utils = require("../shared/core.js");
const { createPopupUi } = require("./ui.js");
const { createPopupState } = require("./state.js");
const { createPopupHistoryView } = require("./history-view.js");

(function () {
  let currentHostname = "";
  let settings = utils ? utils.mergeSettings() : null;

  if (!utils) {
    console.error("CopyTextUtils is not available.");
    return;
  }

  const elements = {
    site: document.getElementById("current_site"),
    siteStatus: document.getElementById("current_site_status"),
    toggleSite: document.getElementById("toggle_site"),
    metaKey: document.getElementById("popup_meta_key"),
    previewEnabled: document.getElementById("popup_preview_enabled"),
    avoidEditable: document.getElementById("popup_avoid_editable"),
    toastDuration: document.getElementById("popup_toast_duration"),
    copyHistoryLimit: document.getElementById("popup_copy_history_limit"),
    nativeStatus: document.getElementById("native_status"),
    openCompanion: document.getElementById("open_companion"),
    openOptions: document.getElementById("open_options"),
    clearHistory: document.getElementById("clear_history"),
    historyList: document.getElementById("history_list"),
    status: document.getElementById("popup_status"),
  };

  function isExtensionUsable() {
    return utils.isExtensionContextValid();
  }

  function reportPopupError(message, error) {
    if (utils.isExtensionContextInvalidatedError(error)) {
      return true;
    }

    console.warn(message, error);
    return false;
  }

  const context = {
    utils,
    elements,
    getSettings: function () { return settings; },
    setSettings: function (nextSettings) { settings = nextSettings; },
    get currentHostname() { return currentHostname; },
    set currentHostname(value) { currentHostname = value; },
    isExtensionUsable,
    reportPopupError,
  };

  context.ui = createPopupUi(context);
  context.state = createPopupState(context);
  context.historyView = createPopupHistoryView(context);

  document.addEventListener("DOMContentLoaded", initializePopup);

  async function initializePopup() {
    if (!isExtensionUsable()) {
      return;
    }

    try {
      await context.state.restoreSettings();
      context.ui.applyMessages();
      await Promise.all([context.state.detectCurrentSite(), context.historyView.renderHistory()]);
      refreshNativeStatus();
    } catch (error) {
      if (reportPopupError("Initializing popup failed.", error)) {
        return;
      }
    }

    elements.metaKey.addEventListener("change", context.state.saveSettings);
    elements.previewEnabled.addEventListener("change", context.state.saveSettings);
    elements.avoidEditable.addEventListener("change", context.state.saveSettings);
    elements.toastDuration.addEventListener("input", context.state.saveSettings);
    elements.toastDuration.addEventListener("change", context.state.saveSettings);
    elements.copyHistoryLimit.addEventListener("input", context.state.saveSettings);
    elements.copyHistoryLimit.addEventListener("change", context.state.saveSettings);
    elements.toggleSite.addEventListener("click", function () {
      context.state.toggleCurrentSite().catch(function (error) {
        reportPopupError("Toggling popup site state failed.", error);
      });
    });
    elements.clearHistory.addEventListener("click", function () {
      context.historyView.clearHistory().catch(function (error) {
        reportPopupError("Clearing popup history failed.", error);
      });
    });
    elements.openOptions.addEventListener("click", function () {
      utils.safeOpenOptionsPage().catch(function (error) {
        reportPopupError("Opening the options page failed.", error);
      });
    });
    if (elements.openCompanion) {
      elements.openCompanion.addEventListener("click", function () {
        openNativeCompanion().catch(function (error) {
          reportPopupError("Opening the native companion failed.", error);
        });
      });
    }

    utils.addListenerSafely(chrome.storage.onChanged, function (changes, areaName) {
      if (!isExtensionUsable()) {
        return;
      }

      if (areaName == "sync") {
        context.state.restoreSettings().then(function () {
          context.ui.applyMessages();
          context.state.refreshSiteState();
          context.historyView.renderHistory();
        }).catch(function (error) {
          reportPopupError("Refreshing popup after settings change failed.", error);
        });
      }

      if (areaName == "local" && changes.copyHistory) {
        context.historyView.renderHistory().catch(function (error) {
          reportPopupError("Refreshing popup history failed.", error);
        });
      }
    });
  }

  async function refreshNativeStatus() {
    if (!elements.nativeStatus || !isExtensionUsable()) {
      return;
    }

    const response = await utils.safeChromeAsync(function () {
      return chrome.runtime.sendMessage({ type: "COPY_TEXT_NATIVE_PING" });
    }, null);

    const connected = !!(response && response.ok);
    elements.nativeStatus.classList.toggle("connected", connected);
    elements.nativeStatus.textContent = connected
      ? "Companion: connected"
      : "Companion: local mode";
    if (response && response.error && response.error.message) {
      elements.nativeStatus.title = response.error.message;
    }
  }

  async function openNativeCompanion() {
    if (!isExtensionUsable()) {
      return;
    }

    const response = await utils.safeChromeAsync(function () {
      return chrome.runtime.sendMessage({ type: "COPY_TEXT_NATIVE_OPEN_APP" });
    }, null);

    const opened = !!(response && response.ok && response.payload && response.payload.opened);
    if (opened) {
      elements.nativeStatus.classList.add("connected");
      elements.nativeStatus.textContent = "Companion: opened";
      elements.nativeStatus.title = "";
      return;
    }

    elements.nativeStatus.classList.remove("connected");
    elements.nativeStatus.textContent = "Companion: local mode";
    if (response && response.error && response.error.message) {
      elements.nativeStatus.title = response.error.message;
    }
  }
})();
