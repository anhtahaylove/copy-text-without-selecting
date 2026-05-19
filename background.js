if (typeof importScripts === "function") {
    importScripts("shared.js");
}

var utils = globalThis.CopyTextUtils;
var CONTENT_SCRIPT_ID = "copy-text-with-alt-click-content";
var HISTORY_CLEANUP_ALARM = "copy-text-history-cleanup";

if (!utils) {
    console.error("CopyTextUtils is not available.");
} else {
    utils.addListenerSafely(chrome.runtime.onInstalled, function () {
        initializeExtension().catch(function (error) {
            reportBackgroundError("Initializing extension on install failed.", error);
        });
    });

    utils.addListenerSafely(chrome.runtime.onStartup, function () {
        initializeExtension().catch(function (error) {
            reportBackgroundError("Initializing extension on startup failed.", error);
        });
    });

    utils.addListenerSafely(chrome.storage.onChanged, function (changes, areaName) {
        if (!utils.isExtensionContextValid() || areaName != "sync") {
            return;
        }

        initializeExtension().catch(function (error) {
            reportBackgroundError("Re-initializing extension after settings change failed.", error);
        });
    });

    utils.addListenerSafely(chrome.commands.onCommand, function (command) {
        triggerShortcutCopy(command).catch(function (error) {
            reportBackgroundError("Handling shortcut command failed.", error);
        });
    });

    try {
        chrome.alarms.create(HISTORY_CLEANUP_ALARM, { periodInMinutes: 360 });
        utils.addListenerSafely(chrome.alarms.onAlarm, function (alarm) {
            if (!alarm || alarm.name != HISTORY_CLEANUP_ALARM) {
                return;
            }

            initializeHistoryCleanup().catch(function (error) {
                reportBackgroundError("Running history cleanup failed.", error);
            });
        });
    } catch (error) {
        reportBackgroundError("Scheduling history cleanup failed.", error);
    }
}

async function initializeExtension() {
    if (!utils.isExtensionContextValid()) {
        return;
    }

    var settings = await ensureSettings();
    await syncContentScriptRegistration(settings);
    await injectContentScriptsIntoOpenTabs(settings);
    await trimHistory(settings.copyHistoryLimit);
}

async function ensureSettings() {
    var current = await utils.safeStorageGet("sync", utils.DEFAULT_SETTINGS);
    var merged = utils.mergeSettings(current);
    await utils.safeStorageSet("sync", merged);
    return merged;
}

async function syncContentScriptRegistration(settings) {
    if (!utils.isExtensionContextValid()) {
        return;
    }

    try {
        await utils.safeChromeAsync(function () {
            return chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
        }, true);
    } catch (error) {
        reportBackgroundError("Unregistering prior content scripts failed.", error);
    }

    await utils.safeChromeAsync(function () {
        return chrome.scripting.registerContentScripts([{
            id: CONTENT_SCRIPT_ID,
            matches: ["http://*/*", "https://*/*"],
            excludeMatches: utils.buildExcludeMatches(settings.excludedDomains),
            js: ["shared.js", "menu.js"],
            runAt: "document_start",
            persistAcrossSessions: true,
        }]);
    }, false);
}

async function injectContentScriptsIntoOpenTabs(settings) {
    var tabs = await utils.safeTabsQuery({});

    await Promise.all(tabs.map(async function (tab) {
        if (!tab.id || !tab.url) {
            return;
        }

        var hostname = utils.getHostnameFromUrl(tab.url);
        if (!hostname || utils.isExcludedHost(hostname, settings.excludedDomains)) {
            return;
        }

        try {
            await utils.safeExecuteScript({
                target: { tabId: tab.id },
                files: ["shared.js", "menu.js"],
            });
        } catch (error) {
            reportBackgroundError("Injecting content scripts into an open tab failed.", error);
        }
    }));
}

async function triggerShortcutCopy(command) {
    if (command != "copy-focused-target") {
        return;
    }

    var settings = utils.mergeSettings(await utils.safeStorageGet("sync", utils.DEFAULT_SETTINGS));
    if (!settings.keyboardShortcutEnabled) {
        return;
    }

    var tabs = await utils.safeTabsQuery({ active: true, lastFocusedWindow: true });
    var activeTab = tabs[0];
    if (!activeTab || !activeTab.id || !activeTab.url) {
        return;
    }

    var hostname = utils.getHostnameFromUrl(activeTab.url);
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

async function trimHistory(limit) {
    var current = await utils.safeStorageGet("local", { copyHistory: [] });
    var history = Array.isArray(current.copyHistory) ? current.copyHistory : [];

    if (history.length > limit) {
        history = history.slice(0, limit);
    }

    var maxBytes = 4 * 1024 * 1024;
    var serialized = JSON.stringify(history);
    while (serialized.length > maxBytes && history.length > 1) {
        var indexToRemove = -1;
        for (var i = history.length - 1; i >= 0; i--) {
            if (!history[i].pinned) {
                indexToRemove = i;
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

async function initializeHistoryCleanup() {
    var settings = utils.mergeSettings(await utils.safeStorageGet("sync", utils.DEFAULT_SETTINGS));
    await trimHistory(settings.copyHistoryLimit);
}

async function saveAnalyticsEvent(event) {
    var current = await utils.safeStorageGet("local", { copyAnalytics: utils.DEFAULT_ANALYTICS });
    var nextAnalytics = utils.recordAnalyticsEvent(current.copyAnalytics, event || {});
    await utils.safeStorageSet("local", { copyAnalytics: nextAnalytics });
}

function reportBackgroundError(message, error) {
    if (utils.isExtensionContextInvalidatedError(error)) {
        return;
    }

    console.warn(message, error);
}
