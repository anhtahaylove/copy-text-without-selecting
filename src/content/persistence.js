function createContentPersistence(context) {
  const utils = context.utils;

  function settings() {
    return context.state.settings;
  }

  async function saveHistory(text, result, source, isSelectionBased) {
    const entry = {
      text: text,
      snippet: utils.getTextSnippet(text),
      source: source,
      mode: "copy",
      url: window.location.href,
      hostname: window.location.hostname,
      pinned: false,
      replayCount: 0,
      lastReplayedAt: isSelectionBased ? Date.now() : 0,
    };
    const backgroundSaved = await saveHistoryThroughBackground(entry);
    if (!backgroundSaved && utils.isExtensionContextValid()) {
      console.warn("Saving copy history through the background service worker failed.");
    }
  }

  async function saveHistoryThroughBackground(entry) {
    if (!utils.isExtensionContextValid() || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      return false;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "COPY_TEXT_LOCAL_HISTORY_ADD",
        payload: {
          entry: entry,
          limit: settings().copyHistoryLimit,
        },
      });
      return !!(response && response.ok);
    } catch (error) {
      return false;
    }
  }

  async function saveAnalyticsEvent(event) {
    return saveAnalyticsEvents([event]);
  }

  async function saveAnalyticsEvents(events) {
    try {
      const current = await utils.safeStorageGet("local", { copyAnalytics: utils.DEFAULT_ANALYTICS });
      let nextAnalytics = current.copyAnalytics;
      (Array.isArray(events) ? events : [events]).forEach(function (event) {
        nextAnalytics = utils.recordAnalyticsEvent(nextAnalytics, event || {});
      });
      await utils.safeStorageSet("local", { copyAnalytics: nextAnalytics });
    } catch (error) {
      if (context.handleExtensionContextError(error)) {
        return;
      }

      console.warn("Saving copy analytics failed.", error);
    }
  }

  function getAnalyticsTypeForResult(result, source, isSelectionBased) {
    if (source == "history") {
      return "historyReplayCopy";
    }

    if (isSelectionBased) {
      return "selectionCopy";
    }

    return "copy";
  }

  function getToastAnalyticsKind(result) {
    return "copied";
  }

  return {
    saveHistory,
    saveAnalyticsEvent,
    saveAnalyticsEvents,
    getAnalyticsTypeForResult,
    getToastAnalyticsKind,
  };
}

module.exports = {
  createContentPersistence,
};
