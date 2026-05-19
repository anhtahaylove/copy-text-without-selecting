async function triggerShortcutCopy(utils, saveAnalyticsEvent) {
  const settings = utils.mergeSettings(await utils.safeStorageGet("sync", utils.DEFAULT_SETTINGS));
  if (!settings.keyboardShortcutEnabled) {
    return;
  }

  const tabs = await utils.safeTabsQuery({ active: true, lastFocusedWindow: true });
  const activeTab = tabs[0];
  if (!activeTab || !activeTab.id || !activeTab.url) {
    return;
  }

  const hostname = utils.getHostnameFromUrl(activeTab.url);
  if (!hostname || utils.isExcludedHost(hostname, settings.excludedDomains)) {
    if (hostname && utils.isExcludedHost(hostname, settings.excludedDomains)) {
      await saveAnalyticsEvent({
        type: "blockedExcluded",
        hostname: hostname,
        toastKind: "status",
      });
    }
    return;
  }

  try {
    await chrome.tabs.sendMessage(activeTab.id, {
      type: "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT",
    });
  } catch (error) {
    if (utils.isExtensionContextInvalidatedError(error)) {
      return;
    }

    try {
      await utils.safeExecuteScript({
        target: { tabId: activeTab.id },
        files: ["shared.js", "menu.js"],
      });

      await chrome.tabs.sendMessage(activeTab.id, {
        type: "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT",
      });
    } catch (secondError) {
      if (utils.isExtensionContextInvalidatedError(secondError)) {
        return;
      }
    }
  }
}

module.exports = {
  triggerShortcutCopy,
};
