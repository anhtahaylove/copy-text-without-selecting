(function () {
  const { createOptionsUi } = require("./ui.js");
  const { createTabController } = require("./tabs.js");
  const { createSettingsForm } = require("./settings-form.js");
  const { createDomainsController } = require("./domains.js");
  const { createAnalyticsView } = require("./analytics-view.js");
  const { createOptionsHistoryView } = require("./history-view.js");

  const utils = globalThis.CopyTextUtils;
  if (!utils) {
    console.error("CopyTextUtils is not available.");
    return;
  }

  const state = {
    settings: utils.mergeSettings(),
    historyFilters: {
      search: "",
      source: "all",
      mode: "all",
      hostname: "all",
      sort: "newest",
      group: "none",
    },
    bulkSelectionMode: false,
    selectedHistoryIds: new Set(),
  };

  function isExtensionUsable() {
    return utils.isExtensionContextValid();
  }

  function reportOptionsError(message, error) {
    if (utils.isExtensionContextInvalidatedError(error)) {
      return true;
    }

    console.warn(message, error);
    return false;
  }

  const context = {
    utils,
    state,
    isExtensionUsable,
    reportOptionsError,
    getSettings: function () {
      return state.settings;
    },
  };

  context.ui = createOptionsUi(context);
  context.tabs = createTabController();
  context.analytics = createAnalyticsView(context);
  context.domains = createDomainsController(context);
  context.settingsForm = createSettingsForm(context);
  context.history = createOptionsHistoryView(context);

  document.addEventListener("DOMContentLoaded", initializeOptions);

  async function initializeOptions() {
    if (!isExtensionUsable()) {
      return;
    }

    try {
      await context.settingsForm.restoreOptions();
      context.ui.applyMessages();
      bindEvents();
      await context.domains.renderExcludedDomains();
      await context.history.renderHistoryAndAnalytics();
    } catch (error) {
      if (reportOptionsError("Initializing the options page failed.", error)) {
        return;
      }
    }
  }

  function bindEvents() {
    context.tabs.bindTabEvents();

    document.getElementById("meta_key").addEventListener("change", function () {
      context.settingsForm.saveOptions().catch(function (error) {
        reportOptionsError("Saving options failed.", error);
      });
    });
    document.getElementById("preview_enabled").addEventListener("change", function () {
      context.settingsForm.saveOptions().catch(function (error) {
        reportOptionsError("Saving options failed.", error);
      });
    });
    document.getElementById("avoid_editable").addEventListener("change", function () {
      context.settingsForm.saveOptions().catch(function (error) {
        reportOptionsError("Saving options failed.", error);
      });
    });
    document.getElementById("keyboard_shortcut_enabled").addEventListener("change", function () {
      context.settingsForm.saveOptions().catch(function (error) {
        reportOptionsError("Saving options failed.", error);
      });
    });
    document.getElementById("ui_language").addEventListener("change", function () {
      context.settingsForm.handleLanguageChange().catch(function (error) {
        reportOptionsError("Changing options language failed.", error);
      });
    });
    document.getElementById("copy_history_limit").addEventListener("change", function () {
      context.settingsForm.saveOptions().catch(function (error) {
        reportOptionsError("Saving options failed.", error);
      });
    });

    document.getElementById("toast_duration").addEventListener("input", context.settingsForm.syncDurationControls);
    document.getElementById("toast_duration_range").addEventListener("input", context.settingsForm.syncDurationControls);
    document.getElementById("toast_duration").addEventListener("change", function () {
      context.settingsForm.saveOptions().catch(function (error) {
        reportOptionsError("Saving options failed.", error);
      });
    });
    document.getElementById("toast_duration_range").addEventListener("change", function () {
      context.settingsForm.saveOptions().catch(function (error) {
        reportOptionsError("Saving options failed.", error);
      });
    });

    document.getElementById("add_domain_button").addEventListener("click", function () {
      context.domains.addDomainFromInput().catch(function (error) {
        reportOptionsError("Adding an excluded domain failed.", error);
      });
    });
    document.getElementById("domain_input").addEventListener("keydown", function (event) {
      if (event.key == "Enter") {
        event.preventDefault();
        context.domains.addDomainFromInput().catch(function (error) {
          reportOptionsError("Adding an excluded domain failed.", error);
        });
      }
    });
    document.getElementById("apply_bulk_button").addEventListener("click", function () {
      context.domains.applyBulkDomains().catch(function (error) {
        reportOptionsError("Applying excluded domains failed.", error);
      });
    });

    document.getElementById("history_search").addEventListener("input", function (event) {
      state.historyFilters.search = event.target.value;
      context.history.renderHistoryAndAnalytics().catch(function (error) {
        reportOptionsError("Refreshing filtered history failed.", error);
      });
    });
    document.getElementById("history_source_filter").addEventListener("change", function (event) {
      state.historyFilters.source = event.target.value;
      context.history.renderHistoryAndAnalytics().catch(function (error) {
        reportOptionsError("Refreshing filtered history failed.", error);
      });
    });
    document.getElementById("history_mode_filter").addEventListener("change", function (event) {
      state.historyFilters.mode = event.target.value;
      context.history.renderHistoryAndAnalytics().catch(function (error) {
        reportOptionsError("Refreshing filtered history failed.", error);
      });
    });
    document.getElementById("history_domain_filter").addEventListener("change", function (event) {
      state.historyFilters.hostname = event.target.value;
      context.history.renderHistoryAndAnalytics().catch(function (error) {
        reportOptionsError("Refreshing filtered history failed.", error);
      });
    });
    document.getElementById("history_sort").addEventListener("change", function (event) {
      state.historyFilters.sort = event.target.value;
      context.history.renderHistoryAndAnalytics().catch(function (error) {
        reportOptionsError("Refreshing filtered history failed.", error);
      });
    });
    document.getElementById("history_group").addEventListener("change", function (event) {
      state.historyFilters.group = event.target.value;
      context.history.renderHistoryAndAnalytics().catch(function (error) {
        reportOptionsError("Refreshing filtered history failed.", error);
      });
    });

    document.getElementById("history_bulk_toggle_button").addEventListener("click", function () {
      context.history.enableBulkSelection();
    });
    document.getElementById("history_bulk_cancel_button").addEventListener("click", function () {
      context.history.disableBulkSelection();
    });
    document.getElementById("history_bulk_delete_button").addEventListener("click", function () {
      context.history.bulkDeleteHistory().catch(function (error) {
        reportOptionsError("Bulk deleting history failed.", error);
      });
    });
    document.getElementById("history_bulk_copy_button").addEventListener("click", function () {
      context.history.bulkReplayHistory().catch(function (error) {
        reportOptionsError("Bulk replaying history failed.", error);
      });
    });
    document.getElementById("clear_history_button").addEventListener("click", function () {
      context.history.clearHistory().catch(function (error) {
        reportOptionsError("Clearing history failed.", error);
      });
    });
    document.getElementById("reset_analytics_button").addEventListener("click", function () {
      context.history.resetAnalytics().catch(function (error) {
        reportOptionsError("Resetting analytics failed.", error);
      });
    });

    utils.addListenerSafely(chrome.storage.onChanged, function (changes, areaName) {
      if (!isExtensionUsable()) {
        return;
      }

      if (areaName == "sync") {
        context.settingsForm.restoreOptions().then(function () {
          context.ui.applyMessages();
          context.domains.renderExcludedDomains();
          context.history.renderHistoryAndAnalytics();
        }).catch(function (error) {
          reportOptionsError("Refreshing the options page after settings change failed.", error);
        });
      }

      if (areaName == "local" && (changes.copyHistory || changes.copyAnalytics)) {
        context.history.renderHistoryAndAnalytics().catch(function (error) {
          reportOptionsError("Refreshing options history or analytics failed.", error);
        });
      }
    });
  }
})();
