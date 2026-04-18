(function () {
    var utils = globalThis.CopyTextUtils;
    var currentHostname = "";
    var settings = utils ? utils.mergeSettings() : null;

    if (!utils) {
        console.error("CopyTextUtils is not available.");
        return;
    }

    var elements = {
        site: document.getElementById("current_site"),
        siteStatus: document.getElementById("current_site_status"),
        toggleSite: document.getElementById("toggle_site"),
        metaKey: document.getElementById("popup_meta_key"),
        previewEnabled: document.getElementById("popup_preview_enabled"),
        avoidEditable: document.getElementById("popup_avoid_editable"),
        toastDuration: document.getElementById("popup_toast_duration"),
        copyHistoryLimit: document.getElementById("popup_copy_history_limit"),
        openOptions: document.getElementById("open_options"),
        clearHistory: document.getElementById("clear_history"),
        historyList: document.getElementById("history_list"),
        status: document.getElementById("popup_status"),
    };

    document.addEventListener("DOMContentLoaded", initializePopup);

    async function initializePopup() {
        await restoreSettings();
        applyMessages();
        await Promise.all([detectCurrentSite(), renderHistory()]);

        elements.metaKey.addEventListener("change", saveSettings);
        elements.previewEnabled.addEventListener("change", saveSettings);
        elements.avoidEditable.addEventListener("change", saveSettings);
        elements.toastDuration.addEventListener("input", saveSettings);
        elements.toastDuration.addEventListener("change", saveSettings);
        elements.copyHistoryLimit.addEventListener("input", saveSettings);
        elements.copyHistoryLimit.addEventListener("change", saveSettings);
        elements.toggleSite.addEventListener("click", toggleCurrentSite);
        elements.clearHistory.addEventListener("click", clearHistory);
        elements.openOptions.addEventListener("click", function () {
            chrome.runtime.openOptionsPage();
        });

        chrome.storage.onChanged.addListener(function (changes, areaName) {
            if (areaName == "sync") {
                restoreSettings().then(function () {
                    applyMessages();
                    refreshSiteState();
                    renderHistory();
                });
            }

            if (areaName == "local" && changes.copyHistory) {
                renderHistory();
            }
        });
    }

    function applyMessages() {
        setText("popup_eyebrow", "Quick controls");
        setText("popup_title", "Copy text with Alt-Click");
        setText("popup_subtitle", "Tweak the current site and the most-used interaction settings without opening the full options page.");
        setText("popup_site_label", "Current site");
        setText("popup_modifier_label", "Copy modifier");
        setText("popup_preview_label", "Hover preview");
        setText("popup_preview_hint", "Show the target overlay while the modifier key is held.");
        setText("popup_safe_label", "Skip editable apps");
        setText("popup_safe_hint", "Avoid copying inside contenteditable editors and rich text surfaces.");
        setText("popup_duration_label", "Feedback duration");
        setText("copy_history_limit_label", "Saved history items");
        setText("popup_append_hint", "Quick controls for copy behavior, preview safety, and recent history.");
        setText("popup_history_title", "Recent copies");
        setText("clear_history", "Clear history");
        setText("open_options", "Open full settings");
    }

    async function restoreSettings() {
        settings = utils.mergeSettings(await chrome.storage.sync.get(utils.DEFAULT_SETTINGS));
        elements.metaKey.value = settings.metaKey;
        elements.previewEnabled.checked = settings.previewEnabled;
        elements.avoidEditable.checked = settings.avoidEditable;
        elements.toastDuration.value = String(settings.toastDurationMs);
        if (elements.copyHistoryLimit) {
            elements.copyHistoryLimit.value = String(settings.copyHistoryLimit);
        }
    }

    async function detectCurrentSite() {
        var tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        var activeTab = tabs[0];
        currentHostname = activeTab ? utils.getHostnameFromUrl(activeTab.url) : "";

        if (!currentHostname) {
            elements.site.textContent = t("popup_site_unknown", "This page is not scriptable");
            setSiteStatus("unsupported");
            elements.toggleSite.disabled = true;
            return;
        }

        elements.site.textContent = currentHostname;
        elements.toggleSite.disabled = false;
        await refreshSiteState();
    }

    async function refreshSiteState() {
        var currentSettings = utils.mergeSettings(await chrome.storage.sync.get(utils.DEFAULT_SETTINGS));
        var isExcluded = utils.isExcludedHost(currentHostname, currentSettings.excludedDomains);

        setSiteStatus(isExcluded ? "excluded" : "active");
        elements.toggleSite.textContent = isExcluded
            ? t("popup_toggle_include", "Allow this site")
            : t("popup_toggle_exclude", "Exclude this site");
    }

    function setSiteStatus(status) {
        elements.siteStatus.className = "badge " + status;

        switch (status) {
            case "active":
                elements.siteStatus.textContent = t("popup_site_active", "Active");
                break;
            case "excluded":
                elements.siteStatus.textContent = t("popup_site_excluded", "Excluded");
                break;
            default:
                elements.siteStatus.textContent = t("popup_site_unsupported", "Unsupported");
                break;
        }
    }

    async function saveSettings() {
        settings = utils.mergeSettings(Object.assign({}, settings, {
            metaKey: elements.metaKey.value,
            previewEnabled: elements.previewEnabled.checked,
            avoidEditable: elements.avoidEditable.checked,
            toastDurationMs: elements.toastDuration.value,
            copyHistoryLimit: elements.copyHistoryLimit ? elements.copyHistoryLimit.value : settings.copyHistoryLimit,
        }));

        await chrome.storage.sync.set(settings);
        showStatus(t("save_status_saved", "Saved"));
    }

    async function toggleCurrentSite() {
        if (!currentHostname) {
            return;
        }

        var currentSettings = utils.mergeSettings(await chrome.storage.sync.get(utils.DEFAULT_SETTINGS));
        currentSettings.excludedDomains = utils.toggleDomain(currentSettings.excludedDomains, currentHostname);

        await chrome.storage.sync.set(currentSettings);
        await refreshSiteState();
        showStatus(t("save_status_saved", "Saved"));
    }

    async function renderHistory() {
        var current = await chrome.storage.local.get({ copyHistory: [] });
        var history = Array.isArray(current.copyHistory) ? current.copyHistory : [];
        elements.historyList.textContent = "";

        if (!history.length) {
            var empty = document.createElement("div");
            empty.className = "empty-state";

            var icon = document.createElement("div");
            icon.className = "empty-state-icon";
            icon.textContent = "📋";

            var text = document.createElement("div");
            text.className = "empty-state-text";
            text.textContent = t("popup_history_empty", "No recent copies yet.");

            var hint = document.createElement("div");
            hint.className = "empty-state-hint";
            hint.textContent = t("popup_history_onboarding", "Hold " + (settings.metaKey || "Alt") + " + Click any text to copy it.");

            empty.appendChild(icon);
            empty.appendChild(text);
            empty.appendChild(hint);
            elements.historyList.appendChild(empty);
            return;
        }

        history.forEach(function (item) {
            elements.historyList.appendChild(createHistoryItem(item));
        });
    }

    function createHistoryItem(item) {
        var wrapper = document.createElement("div");
        wrapper.className = "history-item";

        var top = document.createElement("div");
        top.className = "history-top";

        var snippet = document.createElement("div");
        snippet.className = "history-snippet";
        snippet.textContent = item.snippet || item.text;

        var meta = createHistoryMeta(item);

        var content = document.createElement("div");
        content.className = "stack";
        content.appendChild(snippet);
        content.appendChild(meta);

        var actions = document.createElement("div");
        actions.className = "history-actions";

        var copyButton = document.createElement("button");
        copyButton.className = "button secondary small";
        copyButton.type = "button";
        copyButton.textContent = t("history_copy_button", "Copy again");
        copyButton.addEventListener("click", function () {
            replayHistory(item);
        });

        var deleteButton = document.createElement("button");
        deleteButton.className = "button secondary small";
        deleteButton.type = "button";
        deleteButton.textContent = t("history_delete_button", "Delete");
        deleteButton.addEventListener("click", function () {
            deleteHistoryItem(item.id);
        });

        actions.appendChild(copyButton);
        actions.appendChild(deleteButton);
        top.appendChild(content);
        wrapper.appendChild(top);
        wrapper.appendChild(actions);

        return wrapper;
    }

    function createHistoryMeta(item) {
        var sourceMap = {
            click: t("copy_history_source_click", "Extension click"),
            shortcut: t("copy_history_source_shortcut", "Extension shortcut"),
            history: t("copy_history_source_history", "History replay"),
            native: t("copy_history_source_native", "Native copy"),
        };

        var meta = document.createElement("div");
        meta.className = "history-meta";
        meta.appendChild(createHistoryChip(sourceMap[item.source] || item.source || t("copy_history_source_click", "Extension click"), "source-" + normalizeSourceClass(item.source)));

        var timeChip = createHistoryChip(formatRelativeTime(item.createdAt), "time-chip");
        timeChip.title = formatAbsoluteTime(item.createdAt);
        meta.appendChild(timeChip);

        var host = item.hostname || (item.url ? utils.getHostnameFromUrl(item.url) : "");
        if (host) {
            meta.appendChild(createHistoryChip(host, "domain-chip"));
        }

        return meta;
    }

    function formatRelativeTime(value) {
        var delta = Date.now() - Number(value || 0);
        if (!Number.isFinite(delta) || delta < 60000) {
            return t("history_recency_now", "Just now");
        }

        var minutes = Math.round(delta / 60000);
        if (minutes < 60) {
            return minutes + "m ago";
        }

        var hours = Math.round(minutes / 60);
        if (hours < 24) {
            return hours + "h ago";
        }

        return Math.round(hours / 24) + "d ago";
    }

    function formatAbsoluteTime(value) {
        var timestamp = Number(value || 0);
        if (!Number.isFinite(timestamp) || !timestamp) {
            return "";
        }

        try {
            return new Intl.DateTimeFormat(undefined, {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
            }).format(new Date(timestamp));
        } catch (error) {
            return new Date(timestamp).toLocaleString();
        }
    }

    function createHistoryChip(label, extraClass) {
        var chip = document.createElement("span");
        chip.className = "history-chip" + (extraClass ? " " + extraClass : "");
        chip.textContent = label;
        return chip;
    }

    function normalizeSourceClass(source) {
        if (source == "click") return "extension";
        if (source == "shortcut") return "shortcut";
        if (source == "history") return "history";
        if (source == "native") return "native";
        return "unknown";
    }

    async function replayHistory(item) {
        try {
            await navigator.clipboard.writeText(item.text);
            showStatus(t("copy_history_recopied", "Copied from history"));
            await recordReplayUsage(item, "historyReplayCopy");
        } catch (error) {
            showStatus(error.message || "Clipboard error");
        }
    }

    async function recordReplayUsage(item, analyticsType) {
        var current = await chrome.storage.local.get({
            copyHistory: [],
            copyAnalytics: utils.DEFAULT_ANALYTICS,
        });
        var hostname = item.hostname || utils.getHostnameFromUrl(item.url || "");
        var nextHistory = utils.pushHistoryEntry(current.copyHistory, {
            text: item.text,
            snippet: item.snippet || item.text,
            source: "history",
            mode: "copy",
            url: item.url || "",
            hostname: hostname,
        }, settings.copyHistoryLimit);
        var nextAnalytics = utils.recordAnalyticsEvent(current.copyAnalytics, {
            type: analyticsType,
            hostname: hostname,
            toastKind: "status",
        });

        await chrome.storage.local.set({
            copyHistory: nextHistory,
            copyAnalytics: nextAnalytics,
        });
    }

    async function clearHistory() {
        await chrome.storage.local.set({ copyHistory: [] });
        await renderHistory();
        showStatus(t("copy_history_cleared", "History cleared"));
    }

    async function deleteHistoryItem(historyId) {
        var current = await chrome.storage.local.get({ copyHistory: [] });
        var nextHistory = utils.deleteHistoryEntries(current.copyHistory, [historyId]);
        await chrome.storage.local.set({ copyHistory: nextHistory });
        await renderHistory();
        showStatus(t("history_deleted", "History item deleted"));
    }

    function showStatus(message) {
        elements.status.textContent = message;
        clearTimeout(showStatus.timerId);
        showStatus.timerId = setTimeout(function () {
            elements.status.textContent = "";
        }, 1600);
    }

    function setText(id, fallback) {
        var element = document.getElementById(id);
        if (element) {
            element.textContent = t(id, fallback);
        }
    }

    function t(key, fallback) {
        return utils.translate(settings, key, chrome.i18n.getMessage(key) || fallback, chrome.i18n.getUILanguage());
    }
})();
