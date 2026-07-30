let initializationQueue = Promise.resolve();

async function ensureSettings(utils) {
  const current = await utils.safeStorageGet("sync", utils.DEFAULT_SETTINGS);
  const merged = utils.mergeSettings(current);
  const changed = Object.keys(merged).some(function (key) {
    return JSON.stringify(current[key]) !== JSON.stringify(merged[key]);
  });
  if (changed) {
    await utils.safeStorageSet("sync", merged);
  }
  return merged;
}

async function syncContentScriptRegistration(utils, settings, contentScriptId) {
  if (!utils.isExtensionContextValid()) {
    return;
  }

  const definition = {
    id: contentScriptId,
    matches: ["http://*/*", "https://*/*"],
    excludeMatches: utils.buildExcludeMatches(settings.excludedDomains),
    js: ["shared.js", "menu.js"],
    runAt: "document_start",
    persistAcrossSessions: true,
  };
  const registered = await utils.safeChromeAsync(function () {
    return chrome.scripting.getRegisteredContentScripts({ ids: [contentScriptId] });
  }, []);

  await utils.safeChromeAsync(function () {
    return registered && registered.length
      ? chrome.scripting.updateContentScripts([definition])
      : chrome.scripting.registerContentScripts([definition]);
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

function initializeExtension(utils, contentScriptId, trimHistory) {
  const next = initializationQueue.then(async function () {
    if (!utils.isExtensionContextValid()) {
      return;
    }

    const settings = await ensureSettings(utils);
    await syncContentScriptRegistration(utils, settings, contentScriptId);
    await injectContentScriptsIntoOpenTabs(utils, settings);
    await trimHistory(settings.copyHistoryLimit);
  });
  initializationQueue = next.catch(function () {});
  return next;
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
