async function ensureSettings(utils) {
  const current = await utils.safeStorageGet("sync", utils.DEFAULT_SETTINGS);
  const merged = utils.mergeSettings(current);
  await utils.safeStorageSet("sync", merged);
  return merged;
}

async function syncContentScriptRegistration(utils, settings, contentScriptId) {
  if (!utils.isExtensionContextValid()) {
    return;
  }

  try {
    await utils.safeChromeAsync(function () {
      return chrome.scripting.unregisterContentScripts({ ids: [contentScriptId] });
    }, true);
  } catch (error) {
    reportBackgroundError(utils, "Unregistering prior content scripts failed.", error);
  }

  await utils.safeChromeAsync(function () {
    return chrome.scripting.registerContentScripts([{
      id: contentScriptId,
      matches: ["http://*/*", "https://*/*"],
      excludeMatches: utils.buildExcludeMatches(settings.excludedDomains),
      js: ["shared.js", "menu.js"],
      runAt: "document_start",
      persistAcrossSessions: true,
    }]);
  }, false);
}

async function injectContentScriptsIntoOpenTabs(utils, settings) {
  const tabs = await utils.safeTabsQuery({});

  await Promise.all(tabs.map(async function (tab) {
    if (!tab.id || !tab.url) {
      return;
    }

    const hostname = utils.getHostnameFromUrl(tab.url);
    if (!hostname || utils.isExcludedHost(hostname, settings.excludedDomains)) {
      return;
    }

    try {
      await utils.safeExecuteScript({
        target: { tabId: tab.id },
        files: ["shared.js", "menu.js"],
      });
    } catch (error) {
      reportBackgroundError(utils, "Injecting content scripts into an open tab failed.", error);
    }
  }));
}

async function initializeExtension(utils, contentScriptId, trimHistory) {
  if (!utils.isExtensionContextValid()) {
    return;
  }

  const settings = await ensureSettings(utils);
  await syncContentScriptRegistration(utils, settings, contentScriptId);
  await injectContentScriptsIntoOpenTabs(utils, settings);
  await trimHistory(settings.copyHistoryLimit);
}

function reportBackgroundError(utils, message, error) {
  if (utils.isExtensionContextInvalidatedError(error)) {
    return;
  }

  console.warn(message, error);
}

module.exports = {
  ensureSettings,
  syncContentScriptRegistration,
  injectContentScriptsIntoOpenTabs,
  initializeExtension,
  reportBackgroundError,
};
