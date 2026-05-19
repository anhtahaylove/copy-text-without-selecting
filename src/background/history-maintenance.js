const HISTORY_CLEANUP_ALARM = "copy-text-history-cleanup";

async function trimHistory(utils, limit) {
  const current = await utils.safeStorageGet("local", { copyHistory: [] });
  let history = Array.isArray(current.copyHistory) ? current.copyHistory : [];

  if (history.length > limit) {
    history = history.slice(0, limit);
  }

  const maxBytes = 4 * 1024 * 1024;
  let serialized = JSON.stringify(history);
  while (serialized.length > maxBytes && history.length > 1) {
    let indexToRemove = -1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (!history[index].pinned) {
        indexToRemove = index;
        break;
      }
    }
    if (indexToRemove === -1) {
      indexToRemove = history.length - 1;
    }
    history.splice(indexToRemove, 1);
    serialized = JSON.stringify(history);
  }

  await utils.safeStorageSet("local", { copyHistory: history });
}

async function initializeHistoryCleanup(utils, trimHistoryImpl) {
  const settings = utils.mergeSettings(await utils.safeStorageGet("sync", utils.DEFAULT_SETTINGS));
  await trimHistoryImpl(settings.copyHistoryLimit);
}

async function saveAnalyticsEvent(utils, event) {
  const current = await utils.safeStorageGet("local", { copyAnalytics: utils.DEFAULT_ANALYTICS });
  const nextAnalytics = utils.recordAnalyticsEvent(current.copyAnalytics, event || {});
  await utils.safeStorageSet("local", { copyAnalytics: nextAnalytics });
}

module.exports = {
  HISTORY_CLEANUP_ALARM,
  trimHistory,
  initializeHistoryCleanup,
  saveAnalyticsEvent,
};
