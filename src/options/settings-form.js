function createSettingsForm(context) {
  async function restoreOptions() {
    const settings = context.utils.mergeSettings(await context.utils.safeStorageGet("sync", context.utils.DEFAULT_SETTINGS));
    context.state.settings = settings;

    document.getElementById("meta_key").value = settings.metaKey;
    document.getElementById("link_copy_format").value = settings.linkCopyFormat;
    document.getElementById("preview_enabled").checked = settings.previewEnabled;
    document.getElementById("avoid_editable").checked = settings.avoidEditable;
    document.getElementById("keyboard_shortcut_enabled").checked = settings.keyboardShortcutEnabled;
    document.getElementById("ui_language").value = settings.uiLanguage;
    document.getElementById("copy_history_limit").value = String(settings.copyHistoryLimit);
    document.getElementById("toast_duration").value = String(settings.toastDurationMs);
    document.getElementById("toast_duration_range").value = String(settings.toastDurationMs);
    document.getElementById("excluded_domains_bulk").value = settings.excludedDomains.join("\n");
    document.getElementById("history_sort").value = context.state.historyFilters.sort;
    document.getElementById("history_group").value = context.state.historyFilters.group;
  }

  async function saveOptions() {
    if (!context.isExtensionUsable()) {
      return;
    }

    const settings = context.utils.mergeSettings({
      metaKey: document.getElementById("meta_key").value,
      linkCopyFormat: document.getElementById("link_copy_format").value,
      previewEnabled: document.getElementById("preview_enabled").checked,
      avoidEditable: document.getElementById("avoid_editable").checked,
      keyboardShortcutEnabled: document.getElementById("keyboard_shortcut_enabled").checked,
      toastDurationMs: document.getElementById("toast_duration").value,
      uiLanguage: document.getElementById("ui_language").value,
      copyHistoryLimit: document.getElementById("copy_history_limit").value,
      excludedDomains: document.getElementById("excluded_domains_bulk").value,
    });

    context.state.settings = settings;
    await context.utils.safeStorageSet("sync", settings);
    context.ui.showStatus(context.ui.t("save_status_saved", "Saved"));
    await context.domains.renderExcludedDomains();
  }

  function syncDurationControls(event) {
    const value = context.utils.normalizeToastDuration(event.target.value);
    document.getElementById("toast_duration").value = String(value);
    document.getElementById("toast_duration_range").value = String(value);
  }

  async function handleLanguageChange() {
    await saveOptions();
    context.ui.applyMessages();
    await context.domains.renderExcludedDomains();
    await context.history.renderHistoryAndAnalytics();
  }

  return {
    restoreOptions,
    saveOptions,
    syncDurationControls,
    handleLanguageChange,
  };
}

module.exports = {
  createSettingsForm,
};
