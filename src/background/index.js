const utils = require("../shared/core.js");
const {
  HISTORY_CLEANUP_ALARM,
  initializeHistoryCleanup,
  saveAnalyticsEvent,
} = require("./history-maintenance.js");
const {
  initializeExtension,
  reportBackgroundError,
} = require("./registration.js");
const { createNativeMessagingBridge } = require("./native-messaging.js");
const { createLocalHistoryController } = require("./local-history.js");
const { triggerShortcutCopy } = require("./shortcut.js");

const CONTENT_SCRIPT_ID = "copy-text-with-alt-click-content";

if (!utils) {
  console.error("CopyTextUtils is not available.");
} else {
  const nativeBridge = createNativeMessagingBridge(utils);
  const localHistory = createLocalHistoryController(utils, nativeBridge);
  localHistory.flushOutbox().catch(function (error) {
    reportBackgroundError(utils, "Flushing pending companion history failed.", error);
  });

  utils.addListenerSafely(chrome.runtime.onInstalled, function () {
    initializeExtension(utils, CONTENT_SCRIPT_ID, function (limit) {
      return localHistory.trimHistory(limit);
    }).catch(function (error) {
      reportBackgroundError(utils, "Initializing extension on install failed.", error);
    });
  });

  utils.addListenerSafely(chrome.runtime.onStartup, function () {
    initializeExtension(utils, CONTENT_SCRIPT_ID, function (limit) {
      return localHistory.trimHistory(limit);
    }).catch(function (error) {
      reportBackgroundError(utils, "Initializing extension on startup failed.", error);
    });
  });

  utils.addListenerSafely(chrome.storage.onChanged, function (changes, areaName) {
    if (!utils.isExtensionContextValid() || areaName != "sync") {
      return;
    }

    initializeExtension(utils, CONTENT_SCRIPT_ID, function (limit) {
      return localHistory.trimHistory(limit);
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
    }, function () {
      return nativeBridge.openApp();
    }).catch(function (error) {
      reportBackgroundError(utils, "Handling shortcut command failed.", error);
    });
  });

  utils.addListenerSafely(chrome.runtime.onMessage, function (message, sender, sendResponse) {
    return nativeBridge.handleRuntimeMessage(message, sender, sendResponse)
      || localHistory.handleRuntimeMessage(message, sender, sendResponse);
  });

  try {
    chrome.alarms.create(HISTORY_CLEANUP_ALARM, { periodInMinutes: 360 });
    utils.addListenerSafely(chrome.alarms.onAlarm, function (alarm) {
      if (!alarm || alarm.name != HISTORY_CLEANUP_ALARM) {
        return;
      }

      initializeHistoryCleanup(utils, function (limit) {
        return localHistory.trimHistory(limit);
      }).catch(function (error) {
        reportBackgroundError(utils, "Running history cleanup failed.", error);
      });
    });
  } catch (error) {
    reportBackgroundError(utils, "Scheduling history cleanup failed.", error);
  }
}
