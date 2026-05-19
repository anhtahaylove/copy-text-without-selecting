(function (root, factory) {
    var api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    root.CopyTextUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    var DEFAULT_SETTINGS = {
        metaKey: "Alt",
        excludedDomains: [],
        previewEnabled: true,
        avoidEditable: true,
        toastDurationMs: 1400,
        uiLanguage: "auto",
        copyHistoryLimit: 20,
        keyboardShortcutEnabled: true
    };
    var VI_RUNTIME_OVERRIDES = {
        meta_key_help: "Giữ phím copy rồi click để copy nhanh nội dung trên trang.",
        analytics_append_actions: "Lượt copy theo selection",
        popup_append_hint: "Dùng popup này để điều chỉnh nhanh hành vi copy, độ an toàn và lịch sử gần đây."
    };

    var DEFAULT_ANALYTICS = {
        totals: {
            totalActions: 0,
            copied: 0,
            nativeCopies: 0,
            selectionCopies: 0,
            shortcuts: 0,
            historyReplayCopy: 0,
            historyPinnedCount: 0,
            historyReplayCount: 0,
            excludedBlocked: 0,
            editableSkipped: 0
        },
        toastCounts: { copied: 0, status: 0 },
        domainStats: {},
        lastUpdatedAt: 0
    };

    var SUPPORTED_META_KEYS = ["Alt", "Ctrl", "Shift"];
    var SUPPORTED_UI_LANGUAGES = ["auto", "en", "vi"];
    var DEFAULT_COPY_HISTORY_LIMIT = 20;
    var MAX_COPY_HISTORY_LIMIT = 9999;
    var VI_MESSAGES = {
        save_status_saved: "Đã lưu",
        settings_eyebrow: "Thiết lập",
        settings_title: "Copy text with Alt-Click",
        settings_intro: "Cấu hình thao tác copy, hover preview, chế độ an toàn và lịch sử trên các website.",
        tab_general: "Chung", tab_sites: "Website", tab_feedback: "Phản hồi", tab_language: "Ngôn ngữ", tab_history: "Lịch sử",
        general_section_title: "Điều khiển chung", sites_section_title: "Domain loại trừ",
        meta_key_label: "Phím thao tác copy", meta_key_help: "Chế độ append dùng thêm phím Shift cùng với phím copy bạn chọn.",
        preview_enabled_label: "Hover preview", preview_enabled_help: "Hiển thị khung nét đứt trên phần tử đích khi giữ phím copy.",
        avoid_editable_label: "Bỏ qua vùng có thể chỉnh sửa", avoid_editable_help: "Tránh kích hoạt copy trong editor contenteditable và vùng nhập liệu nâng cao.",
        keyboard_shortcut_enabled_label: "Chế độ phím tắt", keyboard_shortcut_enabled_help: "Cho phép dùng phím tắt của extension để copy phần tử đang hover hoặc đang focus mà không cần click.",
        keyboard_shortcut_hint: "Bạn có thể đổi phím tắt trong chrome://extensions/shortcuts.",
        excluded_domains_add_label: "Thêm domain", excluded_domains_add_placeholder: "vi-du.com", excluded_domains_empty: "Chưa có domain nào bị loại trừ.",
        excluded_domains_import_label: "Dán nhiều domain", excluded_domains_import_help: "Dán mỗi domain trên một dòng rồi bấm Áp dụng.",
        excluded_domains_help: "Các domain bị loại trừ sẽ tắt cả hover preview và hành động copy.",
        add_domain_button: "Thêm domain", apply_bulk_button: "Áp dụng danh sách", domain_remove_button: "Xóa",
        feedback_title: "Hiển thị phản hồi", toast_duration_label: "Thời lượng phản hồi", toast_duration_help: "Tùy chỉnh thời gian hiển thị hiệu ứng copy nổi.", toast_duration_unit: "ms",
        language_title: "Ngôn ngữ", ui_language_label: "Ngôn ngữ extension", ui_language_help: "Auto dùng ngôn ngữ trình duyệt. Có thể ép sang English hoặc Tiếng Việt.",
        ui_language_auto: "Tự động", ui_language_en: "English", ui_language_vi: "Tiếng Việt",
        history_title: "Lịch sử copy", copy_history_limit_label: "Số mục lịch sử lưu lại", copy_history_limit_help: "Số mục copy gần đây sẽ được giữ trong bộ nhớ cục bộ.",
        copy_history_empty: "Chưa có mục copy nào.", copy_history_recopied: "Đã copy lại từ lịch sử", copy_history_appended: "Đã append từ lịch sử", copy_history_cleared: "Đã xóa lịch sử",
        copy_history_source_click: "Click từ extension", copy_history_source_shortcut: "Phím tắt extension", copy_history_source_history: "Replay lịch sử", copy_history_source_native: "Copy mặc định",
        history_copy_button: "Copy lại", history_append_button: "Append", history_delete_button: "Xóa", history_expand_button: "Xem đầy đủ", history_collapse_button: "Ẩn bớt",
        history_pin_button: "Ghim", history_unpin_button: "Bỏ ghim", history_bulk_select_button: "Chọn nhiều mục", history_bulk_cancel_button: "Hủy chọn",
        history_bulk_delete_button: "Xóa mục đã chọn", history_bulk_copy_button: "Copy mục đã chọn", history_bulk_append_button: "Append mục đã chọn",
        history_search_label: "Tìm trong lịch sử", history_search_placeholder: "Tìm theo nội dung hoặc hostname",
        history_filter_source_label: "Nguồn", history_filter_mode_label: "Chế độ", history_filter_domain_label: "Domain", history_filter_all: "Tất cả",
        history_filter_click: "Click từ extension", history_filter_shortcut: "Phím tắt extension", history_filter_history: "Replay lịch sử", history_filter_native: "Copy mặc định",
        history_filter_copy: "Copy", history_filter_append: "Append", history_filter_append_fallback: "Append fallback", history_filter_pinned_label: "Chỉ hiện mục ghim",
        history_group_label: "Nhóm theo", history_group_none: "Không nhóm", history_group_domain: "Domain", history_group_source: "Nguồn", history_group_date: "Ngày",
        history_sort_label: "Sắp xếp", history_sort_newest: "Mới nhất", history_sort_oldest: "Cũ nhất", history_sort_replayed: "Replay nhiều nhất", history_sort_pinned: "Ưu tiên ghim",
        history_recency_now: "Vừa xong", history_no_results: "Không có mục lịch sử phù hợp.",
        analytics_title: "Phân tích nội bộ", analytics_total_actions: "Tổng hành động", analytics_append_actions: "Lượt append", analytics_native_actions: "Lượt copy mặc định",
        analytics_selection_actions: "Lượt copy theo selection", analytics_shortcut_actions: "Lượt dùng phím tắt", analytics_blocked_actions: "Lượt bị chặn", analytics_toast_events: "Lượt toast hiển thị",
        analytics_top_domains: "Domain dùng nhiều nhất", analytics_empty_domains: "Chưa có hoạt động domain nào.", analytics_reset_done: "Đã xóa analytics", reset_analytics_button: "Xóa analytics",
        history_deleted: "Đã xóa mục lịch sử", history_selection_cleared: "Đã bỏ chọn", history_bulk_done: "Đã hoàn thành thao tác hàng loạt",
        popup_eyebrow: "Điều khiển nhanh", popup_title: "Copy text with Alt-Click", popup_subtitle: "Điều chỉnh nhanh website hiện tại và các thiết lập hay dùng mà không cần mở trang settings đầy đủ.",
        popup_site_label: "Website hiện tại", popup_modifier_label: "Phím copy", popup_preview_label: "Hover preview", popup_preview_hint: "Hiển thị overlay trên phần tử đích khi giữ phím copy.",
        popup_safe_label: "Bỏ qua editor", popup_safe_hint: "Tránh copy trong contenteditable và rich text editor.", popup_duration_label: "Thời lượng phản hồi", popup_append_hint: "Chế độ append vẫn dùng được với Shift + phím copy + Click.",
        popup_site_active: "Đang bật", popup_site_excluded: "Đã loại trừ", popup_site_unsupported: "Không hỗ trợ", popup_site_unknown: "Trang này không thể chạy script",
        popup_toggle_include: "Cho phép website này", popup_toggle_exclude: "Loại trừ website này", popup_history_title: "Lịch sử gần đây", popup_history_empty: "Chưa có mục copy gần đây.",
        clear_history: "Xóa lịch sử", open_options: "Mở cài đặt đầy đủ",
        toast_copied: "Đã copy!", toast_appended: "Đã append!", toast_append_fallback: "Đã copy thay thế",
        shortcut_unavailable: "Không có phần tử hover/focus nào để copy.", unsupported_surface_status: "Đã bỏ qua vùng đang chỉnh sửa"
    };

    function normalizeDomain(value) {
        var trimmed = String(value || "").trim().toLowerCase();
        if (!trimmed) return "";
        var normalized = trimmed.replace(/^\.+/, "");
        try {
            var candidate = normalized.includes("://") ? normalized : "https://" + normalized;
            normalized = new URL(candidate).hostname.toLowerCase();
        } catch (error) {
            normalized = normalized.split(/[/?#]/, 1)[0];
        }
        return normalized.replace(/^\.+/, "");
    }

    function normalizeExcludedDomains(input) {
        var seen = new Set();
        return (Array.isArray(input) ? input : String(input || "").split(/\r?\n/)).map(normalizeDomain).filter(function (domain) {
            if (!domain || seen.has(domain)) return false;
            seen.add(domain);
            return true;
        });
    }

    function normalizeMetaKey(value) { return SUPPORTED_META_KEYS.includes(value) ? value : DEFAULT_SETTINGS.metaKey; }
    function normalizeToastDuration(value) {
        var duration = Number(value);
        return Number.isFinite(duration) ? Math.min(8000, Math.max(300, Math.round(duration))) : DEFAULT_SETTINGS.toastDurationMs;
    }
    function normalizeUiLanguage(value) { return SUPPORTED_UI_LANGUAGES.includes(value) ? value : DEFAULT_SETTINGS.uiLanguage; }
    function normalizeCopyHistoryLimit(value) {
        var limit = Number(value);
        return Number.isFinite(limit) ? Math.min(MAX_COPY_HISTORY_LIMIT, Math.max(0, Math.round(limit))) : DEFAULT_COPY_HISTORY_LIMIT;
    }

    function mergeSettings(rawSettings) {
        var input = rawSettings || {};
        return {
            metaKey: normalizeMetaKey(input.metaKey),
            excludedDomains: normalizeExcludedDomains(input.excludedDomains),
            previewEnabled: input.previewEnabled !== false,
            avoidEditable: input.avoidEditable !== false,
            toastDurationMs: normalizeToastDuration(input.toastDurationMs),
            uiLanguage: normalizeUiLanguage(input.uiLanguage),
            copyHistoryLimit: normalizeCopyHistoryLimit(input.copyHistoryLimit),
            keyboardShortcutEnabled: input.keyboardShortcutEnabled !== false
        };
    }

    function isExcludedHost(hostname, excludedDomains) {
        var normalizedHost = normalizeDomain(hostname);
        return normalizeExcludedDomains(excludedDomains).some(function (domain) {
            return normalizedHost === domain || normalizedHost.endsWith("." + domain);
        });
    }

    function buildExcludeMatches(excludedDomains) {
        var patterns = new Set();
        normalizeExcludedDomains(excludedDomains).forEach(function (domain) {
            patterns.add("*://" + domain + "/*");
            patterns.add("*://*." + domain + "/*");
        });
        return Array.from(patterns);
    }

    function getCopyMode(metaKey, event) {
        var normalizedMetaKey = normalizeMetaKey(metaKey);
        if (!isPrimaryModifierPressed(normalizedMetaKey, event)) return null;
        return "copy";
    }

    function isPrimaryModifierPressed(metaKey, event) {
        switch (normalizeMetaKey(metaKey)) {
            case "Alt": return !!event.altKey;
            case "Ctrl": return !!event.ctrlKey;
            case "Shift": return !!event.shiftKey;
            default: return false;
        }
    }

    function isModifierKeyEvent(event) {
        return event.key === "Alt" || event.key === "Control" || event.key === "Shift";
    }

    function isEditableSurface(element) {
        if (!element || typeof element.closest !== "function") return false;
        var tagName = String(element.nodeName || "").toUpperCase();
        if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return false;
        return !!element.closest(["[contenteditable]:not([contenteditable='false'])","[role='textbox']", ".CodeMirror", ".cm-editor", ".ProseMirror", ".monaco-editor", ".ace_editor"].join(","));
    }

    function toggleDomain(excludedDomains, domain) {
        var normalizedDomains = normalizeExcludedDomains(excludedDomains);
        var normalizedDomain = normalizeDomain(domain);
        if (!normalizedDomain) return normalizedDomains;
        if (normalizedDomains.includes(normalizedDomain)) {
            return normalizedDomains.filter(function (item) { return item !== normalizedDomain; });
        }
        return normalizedDomains.concat(normalizedDomain).sort();
    }

    function getHostnameFromUrl(url) {
        try { return new URL(url).hostname.toLowerCase(); } catch (error) { return ""; }
    }

    function getTextSnippet(text, maxLength) {
        var collapsed = String(text || "").replace(/\s+/g, " ").trim();
        var limit = Number.isFinite(Number(maxLength)) ? Math.max(4, Math.round(Number(maxLength))) : 80;
        if (!collapsed) return "(empty)";
        return collapsed.length > limit ? collapsed.slice(0, limit - 3) + "..." : collapsed;
    }

    function getLanguage(settingsOrLanguage, browserLanguage) {
        var requested = typeof settingsOrLanguage === "string" ? settingsOrLanguage : normalizeUiLanguage((settingsOrLanguage || {}).uiLanguage);
        if (requested !== "auto") return requested;
        var normalizedBrowserLanguage = String(browserLanguage || "").toLowerCase();
        if (normalizedBrowserLanguage.startsWith("vi")) return "vi";
        if (normalizedBrowserLanguage.startsWith("en")) return "en";
        return "auto";
    }

    function translate(settingsOrLanguage, key, fallback, browserLanguage) {
        var language = getLanguage(settingsOrLanguage, browserLanguage);
        if (language === "vi" && VI_RUNTIME_OVERRIDES[key]) return VI_RUNTIME_OVERRIDES[key];
        if (language === "vi" && VI_MESSAGES[key]) return VI_MESSAGES[key];
        return fallback || key;
    }

    function normalizeHistoryEntry(entry) {
        if (!entry) return null;
        var normalizedText = String(entry.text || "").trim();
        if (!normalizedText) return null;
        return {
            id: String(entry.id || (Date.now() + "-" + Math.random().toString(16).slice(2))),
            text: normalizedText,
            snippet: getTextSnippet(entry.snippet || normalizedText),
            createdAt: Number(entry.createdAt || Date.now()),
            source: String(entry.source || "click"),
            url: String(entry.url || ""),
            hostname: normalizeDomain(entry.hostname || getHostnameFromUrl(entry.url || "")),
            mode: String(entry.mode || "copy"),
            pinned: !!entry.pinned,
            replayCount: Number(entry.replayCount || 0),
            lastReplayedAt: Number(entry.lastReplayedAt || 0)
        };
    }

    function pushHistoryEntry(entries, entry, limit) {
        var nextEntries = (Array.isArray(entries) ? entries : []).map(normalizeHistoryEntry).filter(Boolean);
        var maxItems = normalizeCopyHistoryLimit(limit || DEFAULT_COPY_HISTORY_LIMIT);
        var normalizedEntry = normalizeHistoryEntry(entry);
        if (!normalizedEntry || maxItems === 0) return nextEntries.slice(0, maxItems);

        var existing = nextEntries.find(function (item) { return item.text === normalizedEntry.text; });
        if (existing) {
            existing.snippet = normalizedEntry.snippet;
            existing.createdAt = normalizedEntry.createdAt;
            existing.source = normalizedEntry.source;
            existing.url = normalizedEntry.url;
            existing.hostname = normalizedEntry.hostname;
            existing.mode = normalizedEntry.mode;
            existing.pinned = existing.pinned || normalizedEntry.pinned;
            nextEntries = nextEntries.filter(function (item) { return item.id !== existing.id; });
            nextEntries.unshift(existing);
        } else {
            nextEntries.unshift(normalizedEntry);
        }
        return nextEntries.slice(0, maxItems);
    }

    function updateHistoryEntry(entries, historyId, updater, limit) {
        return (Array.isArray(entries) ? entries : []).map(normalizeHistoryEntry).filter(Boolean).map(function (entry) {
            if (entry.id !== historyId) return entry;
            var updated = typeof updater === "function" ? updater(Object.assign({}, entry)) : entry;
            return normalizeHistoryEntry(Object.assign({}, entry, updated || {}));
        }).slice(0, normalizeCopyHistoryLimit(limit || DEFAULT_COPY_HISTORY_LIMIT));
    }

    function deleteHistoryEntries(entries, ids) {
        var idSet = new Set(Array.isArray(ids) ? ids : [ids]);
        return (Array.isArray(entries) ? entries : []).map(normalizeHistoryEntry).filter(function (entry) {
            return entry && !idSet.has(entry.id);
        });
    }

    function sortHistoryEntries(entries, sortBy) {
        var nextEntries = (Array.isArray(entries) ? entries : []).map(normalizeHistoryEntry).filter(Boolean).slice();
        switch (sortBy) {
            case "oldest":
                return nextEntries.sort(function (left, right) { return left.createdAt - right.createdAt; });
            case "replayed":
                return nextEntries.sort(function (left, right) { return (right.replayCount - left.replayCount) || (right.createdAt - left.createdAt); });
            case "pinned":
                return nextEntries.sort(function (left, right) { return Number(!!right.pinned) - Number(!!left.pinned) || (right.createdAt - left.createdAt); });
            default:
                return nextEntries.sort(function (left, right) { return right.createdAt - left.createdAt; });
        }
    }

    function groupHistoryEntries(entries, groupBy) {
        if (!groupBy || groupBy === "none") return [{ key: "all", label: "", entries: entries }];
        var groups = new Map();
        (Array.isArray(entries) ? entries : []).map(normalizeHistoryEntry).filter(Boolean).forEach(function (entry) {
            var key = "other";
            if (groupBy === "domain") key = entry.hostname || "other";
            else if (groupBy === "source") key = entry.source || "other";
            else if (groupBy === "date") key = new Date(entry.createdAt).toISOString().slice(0, 10);
            if (!groups.has(key)) groups.set(key, { key: key, label: key, entries: [] });
            groups.get(key).entries.push(entry);
        });
        return Array.from(groups.values());
    }

    function normalizeAnalytics(rawAnalytics) {
        var input = rawAnalytics || {};
        var totals = Object.assign({}, DEFAULT_ANALYTICS.totals, input.totals || {});
        var toastCounts = Object.assign({}, DEFAULT_ANALYTICS.toastCounts, input.toastCounts || {});
        var domainStats = {};
        Object.keys(input.domainStats || {}).forEach(function (hostname) {
            var normalizedHost = normalizeDomain(hostname);
            if (!normalizedHost) return;
            var value = input.domainStats[hostname] || {};
            domainStats[normalizedHost] = {
                totalActions: Number(value.totalActions || 0),
                copied: Number(value.copied || 0),
                shortcuts: Number(value.shortcuts || 0),
                selectionCopies: Number(value.selectionCopies || 0),
                historyReplays: Number(value.historyReplays || 0),
                blockedExcluded: Number(value.blockedExcluded || 0),
                editableSkipped: Number(value.editableSkipped || 0),
                lastUsedAt: Number(value.lastUsedAt || 0)
            };
        });
        return {
            totals: totals,
            toastCounts: toastCounts,
            domainStats: domainStats,
            lastUpdatedAt: Number(input.lastUpdatedAt || 0)
        };
    }

    function ensureDomainStats(analytics, hostname, timestamp) {
        if (!hostname) return null;
        if (!analytics.domainStats[hostname]) {
            analytics.domainStats[hostname] = {
                totalActions: 0,
                copied: 0,
                shortcuts: 0,
                selectionCopies: 0,
                historyReplays: 0,
                blockedExcluded: 0,
                editableSkipped: 0,
                lastUsedAt: timestamp
            };
        }
        analytics.domainStats[hostname].lastUsedAt = timestamp;
        return analytics.domainStats[hostname];
    }

    function incrementCounter(container, key) {
        container[key] = Number(container[key] || 0) + 1;
    }

    function recordAnalyticsEvent(rawAnalytics, event) {
        var analytics = normalizeAnalytics(rawAnalytics);
        var timestamp = Number((event && event.timestamp) || Date.now());
        var hostname = normalizeDomain((event && event.hostname) || getHostnameFromUrl((event && event.url) || ""));
        var domainStats = ensureDomainStats(analytics, hostname, timestamp);
        var type = String((event && event.type) || "");
        var toastKind = String((event && event.toastKind) || "");

        switch (type) {
            case "copy":
                incrementCounter(analytics.totals, "totalActions"); incrementCounter(analytics.totals, "copied");
                if (domainStats) { incrementCounter(domainStats, "totalActions"); incrementCounter(domainStats, "copied"); }
                break;
            case "nativeCopy":
                incrementCounter(analytics.totals, "totalActions"); incrementCounter(analytics.totals, "nativeCopies");
                if (domainStats) { incrementCounter(domainStats, "totalActions"); incrementCounter(domainStats, "copied"); }
                break;
            case "selectionCopy":
                incrementCounter(analytics.totals, "totalActions"); incrementCounter(analytics.totals, "selectionCopies");
                if (domainStats) { incrementCounter(domainStats, "totalActions"); incrementCounter(domainStats, "selectionCopies"); }
                break;
            case "shortcut":
                incrementCounter(analytics.totals, "shortcuts");
                if (domainStats) incrementCounter(domainStats, "shortcuts");
                break;
            case "historyReplayCopy":
                incrementCounter(analytics.totals, "totalActions"); incrementCounter(analytics.totals, "historyReplayCopy"); incrementCounter(analytics.totals, "historyReplayCount");
                if (domainStats) { incrementCounter(domainStats, "totalActions"); incrementCounter(domainStats, "historyReplays"); }
                break;
            case "blockedExcluded":
                incrementCounter(analytics.totals, "excludedBlocked");
                if (domainStats) incrementCounter(domainStats, "blockedExcluded");
                break;
            case "editableSkipped":
                incrementCounter(analytics.totals, "editableSkipped");
                if (domainStats) incrementCounter(domainStats, "editableSkipped");
                break;
            case "historyPinned":
                analytics.totals.historyPinnedCount = Math.max(0, Number(analytics.totals.historyPinnedCount || 0) + 1);
                break;
            case "historyUnpinned":
                analytics.totals.historyPinnedCount = Math.max(0, Number(analytics.totals.historyPinnedCount || 0) - 1);
                break;
        }

        if (toastKind) {
            if (analytics.toastCounts.hasOwnProperty(toastKind)) incrementCounter(analytics.toastCounts, toastKind);
        }
        analytics.lastUpdatedAt = timestamp;
        return analytics;
    }

    function getTopDomainStats(rawAnalytics, limit) {
        var analytics = normalizeAnalytics(rawAnalytics);
        var maxItems = Math.max(1, Number(limit) || 5);
        return Object.keys(analytics.domainStats).map(function (hostname) {
            var stats = analytics.domainStats[hostname];
            return {
                hostname: hostname,
                totalActions: stats.totalActions,
                copied: stats.copied,
                shortcuts: stats.shortcuts,
                selectionCopies: stats.selectionCopies,
                historyReplays: stats.historyReplays,
                blockedExcluded: stats.blockedExcluded,
                editableSkipped: stats.editableSkipped,
                lastUsedAt: stats.lastUsedAt
            };
        }).sort(function (left, right) {
            return right.totalActions - left.totalActions || right.lastUsedAt - left.lastUsedAt;
        }).slice(0, maxItems);
    }

    function filterHistoryEntries(entries, filters) {
        var search = String((filters && filters.search) || "").trim().toLowerCase();
        var source = String((filters && filters.source) || "all");
        var mode = String((filters && filters.mode) || "all");
        var hostnameFilter = String((filters && filters.hostname) || "all");
        var hostname = hostnameFilter === "all" ? "" : normalizeDomain(hostnameFilter);
        var pinnedOnly = !!(filters && filters.pinnedOnly);

        return (Array.isArray(entries) ? entries : []).map(normalizeHistoryEntry).filter(Boolean).filter(function (item) {
            var itemHostname = normalizeDomain(item.hostname || getHostnameFromUrl(item.url || ""));
            var haystack = [String(item.text || ""), String(item.snippet || ""), itemHostname].join("\n").toLowerCase();
            if (search && !haystack.includes(search)) return false;
            if (source !== "all" && item.source !== source) return false;
            if (mode !== "all" && item.mode !== mode) return false;
            if (hostname && itemHostname !== hostname) return false;
            if (pinnedOnly && !item.pinned) return false;
            return true;
        });
    }

    function getHistoryHostOptions(entries) {
        var seen = new Set();
        return (Array.isArray(entries) ? entries : []).map(function (item) {
            return normalizeDomain(item && (item.hostname || getHostnameFromUrl(item.url || "")));
        }).filter(function (hostname) {
            if (!hostname || seen.has(hostname)) return false;
            seen.add(hostname);
            return true;
        }).sort();
    }

    function sanitizeText(text) {
        return String(text || "")
            .replace(/\u200B/g, "")            // zero-width spaces
            .replace(/\u200C/g, "")            // zero-width non-joiner
            .replace(/\u200D/g, "")            // zero-width joiner
            .replace(/\uFEFF/g, "")            // BOM
            .replace(/\u00A0/g, " ")           // non-breaking space → regular space
            .replace(/[ \t]+/g, " ")           // collapse horizontal whitespace
            .replace(/(\r?\n){3,}/g, "\n\n")   // max 2 consecutive newlines
            .trim();
    }

    function isExtensionContextValid() {
        try {
            return typeof chrome !== "undefined"
                && !!chrome.runtime
                && typeof chrome.runtime.id === "string"
                && chrome.runtime.id.length > 0;
        } catch (error) {
            return false;
        }
    }

    function isExtensionContextInvalidatedError(error) {
        var message = String((error && error.message) || error || "");
        return /Extension context invalidated/i.test(message);
    }

    async function safeChromeAsync(action, fallbackValue) {
        if (!isExtensionContextValid()) {
            return fallbackValue;
        }

        try {
            return await action();
        } catch (error) {
            if (isExtensionContextInvalidatedError(error)) {
                return fallbackValue;
            }

            throw error;
        }
    }

    async function safeStorageGet(area, defaults) {
        return safeChromeAsync(function () {
            return chrome.storage[area].get(defaults);
        }, defaults);
    }

    async function safeStorageSet(area, value) {
        return safeChromeAsync(async function () {
            await chrome.storage[area].set(value);
            return true;
        }, false);
    }

    async function safeTabsQuery(queryInfo) {
        return safeChromeAsync(function () {
            return chrome.tabs.query(queryInfo);
        }, []);
    }

    async function safeExecuteScript(details) {
        return safeChromeAsync(function () {
            return chrome.scripting.executeScript(details);
        }, []);
    }

    async function safeSendMessage(tabId, message, options) {
        return safeChromeAsync(function () {
            return chrome.tabs.sendMessage(tabId, message, options);
        }, null);
    }

    async function safeOpenOptionsPage() {
        return safeChromeAsync(async function () {
            await chrome.runtime.openOptionsPage();
            return true;
        }, false);
    }

    function addListenerSafely(eventObject, listener) {
        if (!isExtensionContextValid() || !eventObject || typeof eventObject.addListener !== "function") {
            return false;
        }

        try {
            eventObject.addListener(listener);
            return true;
        } catch (error) {
            if (isExtensionContextInvalidatedError(error)) {
                return false;
            }

            throw error;
        }
    }

    function removeListenerSafely(eventObject, listener) {
        if (!eventObject || typeof eventObject.removeListener !== "function") {
            return false;
        }

        try {
            eventObject.removeListener(listener);
            return true;
        } catch (error) {
            if (isExtensionContextInvalidatedError(error)) {
                return false;
            }

            throw error;
        }
    }

    return {
        DEFAULT_SETTINGS: DEFAULT_SETTINGS,
        DEFAULT_ANALYTICS: DEFAULT_ANALYTICS,
        SUPPORTED_META_KEYS: SUPPORTED_META_KEYS,
        SUPPORTED_UI_LANGUAGES: SUPPORTED_UI_LANGUAGES,
        UI_MESSAGES: VI_MESSAGES,
        normalizeDomain: normalizeDomain,
        normalizeExcludedDomains: normalizeExcludedDomains,
        normalizeMetaKey: normalizeMetaKey,
        normalizeToastDuration: normalizeToastDuration,
        normalizeUiLanguage: normalizeUiLanguage,
        normalizeCopyHistoryLimit: normalizeCopyHistoryLimit,
        mergeSettings: mergeSettings,
        isExcludedHost: isExcludedHost,
        buildExcludeMatches: buildExcludeMatches,
        getCopyMode: getCopyMode,
        isPrimaryModifierPressed: isPrimaryModifierPressed,
        isModifierKeyEvent: isModifierKeyEvent,
        isEditableSurface: isEditableSurface,
        toggleDomain: toggleDomain,
        getHostnameFromUrl: getHostnameFromUrl,
        getTextSnippet: getTextSnippet,
        getLanguage: getLanguage,
        translate: translate,
        normalizeHistoryEntry: normalizeHistoryEntry,
        pushHistoryEntry: pushHistoryEntry,
        updateHistoryEntry: updateHistoryEntry,
        deleteHistoryEntries: deleteHistoryEntries,
        sortHistoryEntries: sortHistoryEntries,
        groupHistoryEntries: groupHistoryEntries,
        normalizeAnalytics: normalizeAnalytics,
        recordAnalyticsEvent: recordAnalyticsEvent,
        getTopDomainStats: getTopDomainStats,
        filterHistoryEntries: filterHistoryEntries,
        getHistoryHostOptions: getHistoryHostOptions,
        sanitizeText: sanitizeText,
        isExtensionContextValid: isExtensionContextValid,
        isExtensionContextInvalidatedError: isExtensionContextInvalidatedError,
        safeChromeAsync: safeChromeAsync,
        safeStorageGet: safeStorageGet,
        safeStorageSet: safeStorageSet,
        safeTabsQuery: safeTabsQuery,
        safeExecuteScript: safeExecuteScript,
        safeSendMessage: safeSendMessage,
        safeOpenOptionsPage: safeOpenOptionsPage,
        addListenerSafely: addListenerSafely,
        removeListenerSafely: removeListenerSafely,
    };
});
