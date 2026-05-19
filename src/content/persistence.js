function createContentPersistence(context) {
  const utils = context.utils;

  function settings() {
    return context.state.settings;
  }

  async function saveHistory(text, result, source, isSelectionBased) {
    if (!settings().copyHistoryLimit) {
      return;
    }

    try {
      const current = await utils.safeStorageGet("local", { copyHistory: [] });
      const nextHistory = utils.pushHistoryEntry(current.copyHistory, {
        text: text,
        snippet: utils.getTextSnippet(text),
        source: source,
        mode: "copy",
        url: window.location.href,
        hostname: window.location.hostname,
        pinned: false,
        replayCount: 0,
        lastReplayedAt: isSelectionBased ? Date.now() : 0,
      }, settings().copyHistoryLimit);

      await utils.safeStorageSet("local", { copyHistory: nextHistory });
    } catch (error) {
      if (context.handleExtensionContextError(error)) {
        return;
      }

      console.warn("Saving copy history failed.", error);
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
