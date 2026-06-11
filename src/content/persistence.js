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
    const nativeEvent = {
      source: source || "click",
      text: text,
      url: window.location.href,
      hostname: window.location.hostname,
      title: document.title || "",
      createdAt: Date.now(),
      selectionBased: !!isSelectionBased,
    };

    const backgroundSaved = await saveHistoryThroughBackground(entry, nativeEvent);
    if (backgroundSaved) {
      return;
    }

    try {
      notifyNativeClipboardEvent(nativeEvent);
      if (!settings().copyHistoryLimit) {
        return;
      }
      const current = await utils.safeStorageGet("local", { copyHistory: [] });
      const nextHistory = utils.pushHistoryEntry(current.copyHistory, entry, settings().copyHistoryLimit);

      await utils.safeStorageSet("local", { copyHistory: nextHistory });
    } catch (error) {
      if (context.handleExtensionContextError(error)) {
        return;
      }

      console.warn("Saving copy history failed.", error);
    }
  }

  async function saveHistoryThroughBackground(entry, nativeEvent) {
    if (!utils.isExtensionContextValid() || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      return false;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "COPY_TEXT_LOCAL_HISTORY_ADD",
        payload: {
          entry: entry,
          nativeEvent: nativeEvent,
          limit: settings().copyHistoryLimit,
        },
      });
      return !!(response && response.ok);
    } catch (error) {
      return false;
    }
  }

  function notifyNativeClipboardEvent(nativeEvent) {
    if (!utils.isExtensionContextValid() || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      return;
    }

    try {
      chrome.runtime.sendMessage({
        type: "COPY_TEXT_NATIVE_CLIPBOARD_EVENT",
        payload: nativeEvent,
      }).catch(function () {
        // The companion is optional; local history remains the fallback.
      });
    } catch (error) {
      // Ignore optional companion bridge failures.
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
