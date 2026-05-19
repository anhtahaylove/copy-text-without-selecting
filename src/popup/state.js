function createPopupState(context) {
  async function restoreSettings() {
    const settings = context.utils.mergeSettings(await context.utils.safeStorageGet("sync", context.utils.DEFAULT_SETTINGS));
    context.setSettings(settings);
    context.elements.metaKey.value = settings.metaKey;
    context.elements.previewEnabled.checked = settings.previewEnabled;
    context.elements.avoidEditable.checked = settings.avoidEditable;
    context.elements.toastDuration.value = String(settings.toastDurationMs);
    if (context.elements.copyHistoryLimit) {
      context.elements.copyHistoryLimit.value = String(settings.copyHistoryLimit);
    }
  }

  async function detectCurrentSite() {
    const tabs = await context.utils.safeTabsQuery({ active: true, lastFocusedWindow: true });
    const activeTab = tabs[0];
    context.currentHostname = activeTab ? context.utils.getHostnameFromUrl(activeTab.url) : "";

    if (!context.currentHostname) {
      context.elements.site.textContent = context.ui.t("popup_site_unknown", "This page is not scriptable");
      context.ui.setSiteStatus("unsupported");
      context.elements.toggleSite.disabled = true;
      return;
    }

    context.elements.site.textContent = context.currentHostname;
    context.elements.toggleSite.disabled = false;
    await refreshSiteState();
  }

  async function refreshSiteState() {
    const currentSettings = context.utils.mergeSettings(await context.utils.safeStorageGet("sync", context.utils.DEFAULT_SETTINGS));
    const isExcluded = context.utils.isExcludedHost(context.currentHostname, currentSettings.excludedDomains);

    context.ui.setSiteStatus(isExcluded ? "excluded" : "active");
    context.elements.toggleSite.textContent = isExcluded
      ? context.ui.t("popup_toggle_include", "Allow this site")
      : context.ui.t("popup_toggle_exclude", "Exclude this site");
  }

  async function saveSettings() {
    if (!context.isExtensionUsable()) {
      return;
    }

    const settings = context.utils.mergeSettings(Object.assign({}, context.getSettings(), {
      metaKey: context.elements.metaKey.value,
      previewEnabled: context.elements.previewEnabled.checked,
      avoidEditable: context.elements.avoidEditable.checked,
      toastDurationMs: context.elements.toastDuration.value,
      copyHistoryLimit: context.elements.copyHistoryLimit ? context.elements.copyHistoryLimit.value : context.getSettings().copyHistoryLimit,
    }));

    context.setSettings(settings);
    await context.utils.safeStorageSet("sync", settings);
    context.ui.showStatus(context.ui.t("save_status_saved", "Saved"));
  }

  async function toggleCurrentSite() {
    if (!context.currentHostname) {
      return;
    }

    const currentSettings = context.utils.mergeSettings(await context.utils.safeStorageGet("sync", context.utils.DEFAULT_SETTINGS));
    currentSettings.excludedDomains = context.utils.toggleDomain(currentSettings.excludedDomains, context.currentHostname);

    await context.utils.safeStorageSet("sync", currentSettings);
    await refreshSiteState();
    context.ui.showStatus(context.ui.t("save_status_saved", "Saved"));
  }

  return {
    restoreSettings,
    detectCurrentSite,
    refreshSiteState,
    saveSettings,
    toggleCurrentSite,
  };
}

module.exports = {
  createPopupState,
};
