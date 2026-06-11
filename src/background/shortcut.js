async function triggerShortcutCopy(utils, saveAnalyticsEvent, openCompanion) {
  const settings = utils.mergeSettings(await utils.safeStorageGet("sync", utils.DEFAULT_SETTINGS));
  if (!settings.keyboardShortcutEnabled) {
    return { copied: false, opened: false, reason: "disabled" };
  }

  const tabs = await utils.safeTabsQuery({ active: true, lastFocusedWindow: true });
  const activeTab = tabs[0];
  if (!activeTab || !activeTab.id || !activeTab.url) {
    return { copied: false, opened: false, reason: "no-active-tab" };
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
    return { copied: false, opened: false, reason: "excluded-host" };
  }

  let response = null;
  try {
    response = await chrome.tabs.sendMessage(activeTab.id, {
      type: "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT",
    });
  } catch (error) {
    if (utils.isExtensionContextInvalidatedError(error)) {
      return { copied: false, opened: false, reason: "context-invalidated" };
    }

    try {
      await utils.safeExecuteScript({
        target: { tabId: activeTab.id },
        files: ["shared.js", "menu.js"],
      });

      response = await chrome.tabs.sendMessage(activeTab.id, {
        type: "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT",
      });
    } catch (secondError) {
      if (utils.isExtensionContextInvalidatedError(secondError)) {
        return { copied: false, opened: false, reason: "context-invalidated" };
      }
      return { copied: false, opened: false, reason: "send-failed" };
    }
  }

  if (!isShortcutCopySuccess(response)) {
    return {
      copied: false,
      opened: false,
      reason: response && response.reason ? response.reason : "copy-not-confirmed",
    };
  }

  if (typeof openCompanion !== "function") {
    return { copied: true, opened: false, reason: "open-handler-missing" };
  }

  const openResponse = await openCompanion();
  return {
    copied: true,
    opened: !!(openResponse && openResponse.ok),
    openResponse: openResponse,
  };
}

function isShortcutCopySuccess(response) {
  return !!(response && response.ok && response.copied);
}

module.exports = {
  triggerShortcutCopy,
  isShortcutCopySuccess,
};
