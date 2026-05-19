const utils = require("../shared/core.js");
const {
  HISTORY_CLEANUP_ALARM,
  trimHistory,
  initializeHistoryCleanup,
  saveAnalyticsEvent,
} = require("./history-maintenance.js");
const {
  initializeExtension,
  reportBackgroundError,
} = require("./registration.js");
const { triggerShortcutCopy } = require("./shortcut.js");

const CONTENT_SCRIPT_ID = "copy-text-with-alt-click-content";

if (!utils) {
  console.error("CopyTextUtils is not available.");
} else {
  utils.addListenerSafely(chrome.runtime.onInstalled, function () {
    initializeExtension(utils, CONTENT_SCRIPT_ID, function (limit) {
      return trimHistory(utils, limit);
    }).catch(function (error) {
      reportBackgroundError(utils, "Initializing extension on install failed.", error);
    });
  });

  utils.addListenerSafely(chrome.runtime.onStartup, function () {
    initializeExtension(utils, CONTENT_SCRIPT_ID, function (limit) {
      return trimHistory(utils, limit);
    }).catch(function (error) {
      reportBackgroundError(utils, "Initializing extension on startup failed.", error);
    });
  });

  utils.addListenerSafely(chrome.storage.onChanged, function (changes, areaName) {
    if (!utils.isExtensionContextValid() || areaName != "sync") {
      return;
    }

    initializeExtension(utils, CONTENT_SCRIPT_ID, function (limit) {
      return trimHistory(utils, limit);
    }).catch(function (error) {
      reportBackgroundError(utils, "Re-initializing extension after settings change failed.", error);
    });
  });

  utils.addListenerSafely(chrome.commands.onCommand, function (command) {
    if (command != "copy-focused-target") {
      return;
    }

    triggerShortcutCopy(utils, function (event) {
      return saveAnalyticsEvent(utils, event);
    }).catch(function (error) {
      reportBackgroundError(utils, "Handling shortcut command failed.", error);
    });
  });

  try {
    chrome.alarms.create(HISTORY_CLEANUP_ALARM, { periodInMinutes: 360 });
    utils.addListenerSafely(chrome.alarms.onAlarm, function (alarm) {
      if (!alarm || alarm.name != HISTORY_CLEANUP_ALARM) {
        return;
      }

      initializeHistoryCleanup(utils, function (limit) {
        return trimHistory(utils, limit);
      }).catch(function (error) {
        reportBackgroundError(utils, "Running history cleanup failed.", error);
      });
    });
  } catch (error) {
    reportBackgroundError(utils, "Scheduling history cleanup failed.", error);
  }
}
