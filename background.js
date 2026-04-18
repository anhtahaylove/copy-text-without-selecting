if (typeof importScripts === "function") {
    importScripts("shared.js");
}

var utils = globalThis.CopyTextUtils;
var CONTENT_SCRIPT_ID = "copy-text-with-alt-click-content";

chrome.runtime.onInstalled.addListener(function () {
    initializeExtension();
});

chrome.runtime.onStartup.addListener(function () {
    initializeExtension();
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName == "sync") {
        initializeExtension();
    }
});

chrome.commands.onCommand.addListener(function (command) {
    triggerShortcutCopy(command);
});

async function initializeExtension() {
    var settings = await ensureSettings();
    await syncContentScriptRegistration(settings);
    await injectContentScriptsIntoOpenTabs(settings);
    await trimHistory(settings.copyHistoryLimit);
}

async function ensureSettings() {
    var current = await chrome.storage.sync.get(utils.DEFAULT_SETTINGS);
    var merged = utils.mergeSettings(current);
    await chrome.storage.sync.set(merged);
    return merged;
}

async function syncContentScriptRegistration(settings) {
    try {
        await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    } catch (error) {
        // Ignore when the content script was not registered yet.
    }

    await chrome.scripting.registerContentScripts([{
        id: CONTENT_SCRIPT_ID,
        matches: ["http://*/*", "https://*/*"],
        excludeMatches: utils.buildExcludeMatches(settings.excludedDomains),
        js: ["shared.js", "menu.js"],
        runAt: "document_start",
        persistAcrossSessions: true,
    }]);
}

async function injectContentScriptsIntoOpenTabs(settings) {
    var tabs = await chrome.tabs.query({});

    await Promise.all(tabs.map(async function (tab) {
        if (!tab.id || !tab.url) {
            return;
        }

        var hostname = utils.getHostnameFromUrl(tab.url);
        if (!hostname || utils.isExcludedHost(hostname, settings.excludedDomains)) {
            return;
        }

        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["shared.js", "menu.js"],
            });
        } catch (error) {
            // Ignore tabs where scripting is not allowed.
        }
    }));
}

async function triggerShortcutCopy(command) {
    var settings = utils.mergeSettings(await chrome.storage.sync.get(utils.DEFAULT_SETTINGS));
    if (!settings.keyboardShortcutEnabled) {
        return;
    }

    if (command != "copy-focused-target") {
        return;
    }

    var tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
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
        try {
            await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                files: ["shared.js", "menu.js"],
            });

            await chrome.tabs.sendMessage(activeTab.id, {
                type: "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT",
            });
        } catch (secondError) {
            // Ignore when the page does not allow messaging or injection.
        }
    }
}

async function trimHistory(limit) {
    var current = await chrome.storage.local.get({ copyHistory: [] });
    var history = Array.isArray(current.copyHistory) ? current.copyHistory : [];

    // Enforce entry count limit
    if (history.length > limit) {
        history = history.slice(0, limit);
    }

    // Enforce storage size guard (keep under 4MB to leave room for analytics/other data)
    var maxBytes = 4 * 1024 * 1024;
    var serialized = JSON.stringify(history);
    while (serialized.length > maxBytes && history.length > 1) {
        // Remove the oldest non-pinned entry first
        var indexToRemove = -1;
        for (var i = history.length - 1; i >= 0; i--) {
            if (!history[i].pinned) {
                indexToRemove = i;
                break;
            }
        }
        if (indexToRemove === -1) {
            // All pinned, remove last one anyway
            indexToRemove = history.length - 1;
        }
        history.splice(indexToRemove, 1);
        serialized = JSON.stringify(history);
    }

    await chrome.storage.local.set({ copyHistory: history });
}

// Schedule periodic history cleanup every 6 hours
try {
    chrome.alarms.create("copy-text-history-cleanup", { periodInMinutes: 360 });
    chrome.alarms.onAlarm.addListener(function (alarm) {
        if (alarm.name === "copy-text-history-cleanup") {
            chrome.storage.sync.get(utils.DEFAULT_SETTINGS, function (items) {
                var settings = utils.mergeSettings(items);
                trimHistory(settings.copyHistoryLimit);
            });
        }
    });
} catch (error) {
    // Alarms API may not be available in all contexts
}

async function saveAnalyticsEvent(event) {
    var current = await chrome.storage.local.get({ copyAnalytics: utils.DEFAULT_ANALYTICS });
    var nextAnalytics = utils.recordAnalyticsEvent(current.copyAnalytics, event || {});
    await chrome.storage.local.set({ copyAnalytics: nextAnalytics });
}

