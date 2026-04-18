(function () {
  var utils = globalThis.CopyTextUtils;
  var settings = utils ? utils.mergeSettings() : null;
  var historyFilters = {
    search: "",
    source: "all",
    mode: "all",
    hostname: "all",
    sort: "newest",
    group: "none",
  };
  var bulkSelectionMode = false;
  var selectedHistoryIds = new Set();
  var statusTimerId;

  if (!utils) {
    console.error("CopyTextUtils is not available.");
    return;
  }

  document.addEventListener("DOMContentLoaded", initializeOptions);

  async function initializeOptions() {
    await restoreOptions();
    applyMessages();
    bindEvents();
    await renderExcludedDomains();
    await renderHistoryAndAnalytics();
  }

  function bindEvents() {
    document.querySelectorAll(".tab-button").forEach(function (button) {
      button.addEventListener("click", function () {
        activateTab(button.dataset.tab);
      });
      button.addEventListener("keydown", function (event) {
        var tabs = Array.from(document.querySelectorAll(".tab-button"));
        var index = tabs.indexOf(button);
        var next = -1;
        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
          next = (index + 1) % tabs.length;
        } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
          next = (index - 1 + tabs.length) % tabs.length;
        } else if (event.key === "Home") {
          next = 0;
        } else if (event.key === "End") {
          next = tabs.length - 1;
        }
        if (next >= 0) {
          event.preventDefault();
          tabs[next].focus();
          activateTab(tabs[next].dataset.tab);
        }
      });
    });

    document.getElementById("meta_key").addEventListener("change", saveOptions);
    document.getElementById("preview_enabled").addEventListener("change", saveOptions);
    document.getElementById("avoid_editable").addEventListener("change", saveOptions);
    document.getElementById("keyboard_shortcut_enabled").addEventListener("change", saveOptions);
    document.getElementById("ui_language").addEventListener("change", handleLanguageChange);
    document.getElementById("copy_history_limit").addEventListener("change", saveOptions);

    document.getElementById("toast_duration").addEventListener("input", syncDurationControls);
    document.getElementById("toast_duration_range").addEventListener("input", syncDurationControls);
    document.getElementById("toast_duration").addEventListener("change", saveOptions);
    document.getElementById("toast_duration_range").addEventListener("change", saveOptions);

    document.getElementById("add_domain_button").addEventListener("click", addDomainFromInput);
    document.getElementById("domain_input").addEventListener("keydown", function (event) {
      if (event.key == "Enter") {
        event.preventDefault();
        addDomainFromInput();
      }
    });
    document.getElementById("apply_bulk_button").addEventListener("click", applyBulkDomains);

    document.getElementById("history_search").addEventListener("input", function (event) {
      historyFilters.search = event.target.value;
      renderHistoryAndAnalytics();
    });
    document.getElementById("history_source_filter").addEventListener("change", function (event) {
      historyFilters.source = event.target.value;
      renderHistoryAndAnalytics();
    });
    document.getElementById("history_mode_filter").addEventListener("change", function (event) {
      historyFilters.mode = event.target.value;
      renderHistoryAndAnalytics();
    });
    document.getElementById("history_domain_filter").addEventListener("change", function (event) {
      historyFilters.hostname = event.target.value;
      renderHistoryAndAnalytics();
    });
    document.getElementById("history_sort").addEventListener("change", function (event) {
      historyFilters.sort = event.target.value;
      renderHistoryAndAnalytics();
    });
    document.getElementById("history_group").addEventListener("change", function (event) {
      historyFilters.group = event.target.value;
      renderHistoryAndAnalytics();
    });

    document.getElementById("history_bulk_toggle_button").addEventListener("click", enableBulkSelection);
    document.getElementById("history_bulk_cancel_button").addEventListener("click", disableBulkSelection);
    document.getElementById("history_bulk_delete_button").addEventListener("click", bulkDeleteHistory);
    document.getElementById("history_bulk_copy_button").addEventListener("click", function () {
      bulkReplayHistory();
    });
    document.getElementById("clear_history_button").addEventListener("click", clearHistory);
    document.getElementById("reset_analytics_button").addEventListener("click", resetAnalytics);

    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName == "sync") {
        restoreOptions().then(function () {
          applyMessages();
          renderExcludedDomains();
          renderHistoryAndAnalytics();
        });
      }

      if (areaName == "local" && (changes.copyHistory || changes.copyAnalytics)) {
        renderHistoryAndAnalytics();
      }
    });
  }

  async function handleLanguageChange() {
    await saveOptions();
    applyMessages();
    await renderExcludedDomains();
    await renderHistoryAndAnalytics();
  }

  async function restoreOptions() {
    settings = utils.mergeSettings(await chrome.storage.sync.get(utils.DEFAULT_SETTINGS));

    document.getElementById("meta_key").value = settings.metaKey;
    document.getElementById("preview_enabled").checked = settings.previewEnabled;
    document.getElementById("avoid_editable").checked = settings.avoidEditable;
    document.getElementById("keyboard_shortcut_enabled").checked = settings.keyboardShortcutEnabled;
    document.getElementById("ui_language").value = settings.uiLanguage;
    document.getElementById("copy_history_limit").value = String(settings.copyHistoryLimit);
    document.getElementById("toast_duration").value = String(settings.toastDurationMs);
    document.getElementById("toast_duration_range").value = String(settings.toastDurationMs);
    document.getElementById("excluded_domains_bulk").value = settings.excludedDomains.join("\n");
    document.getElementById("history_sort").value = historyFilters.sort;
    document.getElementById("history_group").value = historyFilters.group;
  }

  async function saveOptions() {
    settings = utils.mergeSettings({
      metaKey: document.getElementById("meta_key").value,
      previewEnabled: document.getElementById("preview_enabled").checked,
      avoidEditable: document.getElementById("avoid_editable").checked,
      keyboardShortcutEnabled: document.getElementById("keyboard_shortcut_enabled").checked,
      toastDurationMs: document.getElementById("toast_duration").value,
      uiLanguage: document.getElementById("ui_language").value,
      copyHistoryLimit: document.getElementById("copy_history_limit").value,
      excludedDomains: document.getElementById("excluded_domains_bulk").value,
    });

    await chrome.storage.sync.set(settings);
    showStatus(t("save_status_saved", "Saved"));
    await renderExcludedDomains();
  }

  function syncDurationControls(event) {
    var value = utils.normalizeToastDuration(event.target.value);
    document.getElementById("toast_duration").value = String(value);
    document.getElementById("toast_duration_range").value = String(value);
  }

  async function addDomainFromInput() {
    var input = document.getElementById("domain_input");
    var normalized = utils.normalizeDomain(input.value);
    if (!normalized) {
      return;
    }

    settings.excludedDomains = utils.toggleDomain(settings.excludedDomains, normalized);
    document.getElementById("excluded_domains_bulk").value = settings.excludedDomains.join("\n");
    input.value = "";

    await chrome.storage.sync.set(settings);
    await renderExcludedDomains();
    showStatus(t("save_status_saved", "Saved"));
  }

  async function applyBulkDomains() {
    settings.excludedDomains = utils.normalizeExcludedDomains(document.getElementById("excluded_domains_bulk").value);
    document.getElementById("excluded_domains_bulk").value = settings.excludedDomains.join("\n");

    await chrome.storage.sync.set(settings);
    await renderExcludedDomains();
    showStatus(t("save_status_saved", "Saved"));
  }

  async function renderExcludedDomains() {
    var list = document.getElementById("excluded_domains_list");
    list.textContent = "";

    if (!settings.excludedDomains.length) {
      var empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = t("excluded_domains_empty", "No excluded domains yet.");
      list.appendChild(empty);
      return;
    }

    settings.excludedDomains.forEach(function (domain) {
      var item = document.createElement("div");
      item.className = "domain-item";

      var row = document.createElement("div");
      row.className = "domain-row";

      var name = document.createElement("div");
      name.className = "domain-name";
      name.textContent = domain;

      var remove = document.createElement("button");
      remove.className = "secondary-button";
      remove.type = "button";
      remove.textContent = t("domain_remove_button", "Remove");
      remove.addEventListener("click", async function () {
        settings.excludedDomains = utils.toggleDomain(settings.excludedDomains, domain);
        document.getElementById("excluded_domains_bulk").value = settings.excludedDomains.join("\n");
        await chrome.storage.sync.set(settings);
        await renderExcludedDomains();
        showStatus(t("save_status_saved", "Saved"));
      });

      row.appendChild(name);
      row.appendChild(remove);
      item.appendChild(row);
      list.appendChild(item);
    });
  }

  async function renderHistoryAndAnalytics() {
    var current = await chrome.storage.local.get({
      copyHistory: [],
      copyAnalytics: utils.DEFAULT_ANALYTICS,
    });

    var history = Array.isArray(current.copyHistory) ? current.copyHistory : [];
    var analytics = utils.normalizeAnalytics(current.copyAnalytics);

    populateHistoryDomainFilter(history);
    renderAnalytics(analytics);
    renderHistory(history);
  }

  function populateHistoryDomainFilter(history) {
    var filter = document.getElementById("history_domain_filter");
    var currentValue = historyFilters.hostname;
    var hosts = utils.getHistoryHostOptions(history);

    filter.textContent = "";

    var allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = t("history_filter_all", "All");
    filter.appendChild(allOption);

    hosts.forEach(function (hostname) {
      var option = document.createElement("option");
      option.value = hostname;
      option.textContent = hostname;
      filter.appendChild(option);
    });

    filter.value = hosts.includes(currentValue) ? currentValue : "all";
    historyFilters.hostname = filter.value;
  }

  function renderAnalytics(analytics) {
    document.getElementById("analytics_total_actions_value").textContent = String(analytics.totals.totalActions || 0);
    document.getElementById("analytics_append_actions_value").textContent = String(analytics.totals.selectionCopies || 0);
    document.getElementById("analytics_native_actions_value").textContent = String(analytics.totals.nativeCopies || 0);
    document.getElementById("analytics_shortcut_actions_value").textContent = String(analytics.totals.shortcuts || 0);
    document.getElementById("analytics_blocked_actions_value").textContent = String((analytics.totals.excludedBlocked || 0) + (analytics.totals.editableSkipped || 0));
    document.getElementById("analytics_toast_events_value").textContent = String(
      (analytics.toastCounts.copied || 0)
      + (analytics.toastCounts.status || 0)
    );

    var list = document.getElementById("analytics_top_domains_list");
    list.textContent = "";

    var topDomains = utils.getTopDomainStats(analytics, 5);
    if (!topDomains.length) {
      var empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = t("analytics_empty_domains", "No domain activity yet.");
      list.appendChild(empty);
      return;
    }

    topDomains.forEach(function (item) {
      var card = document.createElement("div");
      card.className = "domain-item";

      var row = document.createElement("div");
      row.className = "domain-row";

      var name = document.createElement("div");
      name.className = "domain-name";
      name.textContent = item.hostname;

      var meta = document.createElement("div");
      meta.className = "history-meta";
      meta.appendChild(createHistoryChip(t("analytics_total_actions", "Total actions") + ": " + item.totalActions, "domain-metric"));
      meta.appendChild(createHistoryChip(t("analytics_shortcut_actions", "Shortcut usage") + ": " + item.shortcuts, "domain-metric"));

      row.appendChild(name);
      card.appendChild(row);
      card.appendChild(meta);
      list.appendChild(card);
    });
  }

  function renderHistory(history) {
    var filteredHistory = utils.filterHistoryEntries(history, historyFilters);
    var sortedHistory = utils.sortHistoryEntries(filteredHistory, historyFilters.sort);
    var groupedHistory = utils.groupHistoryEntries(sortedHistory, historyFilters.group);
    var list = document.getElementById("options_history_list");
    list.textContent = "";

    if (!sortedHistory.length) {
      var empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = history.length
        ? t("history_no_results", "No matching history entries.")
        : t("copy_history_empty", "No copied items yet.");
      list.appendChild(empty);
      updateBulkToolbar();
      return;
    }

    groupedHistory.forEach(function (group) {
      if (historyFilters.group != "none") {
        var groupWrap = document.createElement("div");
        groupWrap.className = "history-group";

        var groupLabel = document.createElement("div");
        groupLabel.className = "history-group-label";
        groupLabel.textContent = getGroupLabel(group);
        groupWrap.appendChild(groupLabel);

        group.entries.forEach(function (item) {
          groupWrap.appendChild(createHistoryItem(item));
        });
        list.appendChild(groupWrap);
        return;
      }

      group.entries.forEach(function (item) {
        list.appendChild(createHistoryItem(item));
      });
    });

    updateBulkToolbar();
  }

  function createHistoryItem(item) {
    var wrapper = document.createElement("div");
    wrapper.className = "history-item";
    wrapper.classList.toggle("selected", selectedHistoryIds.has(item.id));

    var top = document.createElement("div");
    top.className = "history-top";

    var content = document.createElement("div");
    content.className = "field-group";

    if (bulkSelectionMode) {
      var selector = document.createElement("input");
      selector.type = "checkbox";
      selector.checked = selectedHistoryIds.has(item.id);
      selector.addEventListener("change", function () {
        if (selector.checked) {
          selectedHistoryIds.add(item.id);
        } else {
          selectedHistoryIds.delete(item.id);
        }
        updateBulkToolbar();
        wrapper.classList.toggle("selected", selectedHistoryIds.has(item.id));
      });
      content.appendChild(selector);
    }

    var snippet = document.createElement("div");
    snippet.className = "history-snippet";
    snippet.textContent = item.snippet || item.text;

    var meta = createHistoryMeta(item);

    content.appendChild(snippet);
    content.appendChild(meta);

    var actions = document.createElement("div");
    actions.className = "history-actions";

    var copyButton = document.createElement("button");
    copyButton.className = "secondary-button";
    copyButton.type = "button";
    copyButton.textContent = t("history_copy_button", "Copy again");
    copyButton.addEventListener("click", function () {
      replayHistory(item);
    });

    var deleteButton = document.createElement("button");
    deleteButton.className = "secondary-button";
    deleteButton.type = "button";
    deleteButton.textContent = t("history_delete_button", "Delete");
    deleteButton.addEventListener("click", function () {
      deleteHistoryItem(item.id);
    });

    var fullText = document.createElement("pre");
    fullText.className = "history-fulltext";
    fullText.hidden = true;
    fullText.textContent = item.text;

    var expandButton = document.createElement("button");
    expandButton.className = "secondary-button";
    expandButton.type = "button";
    expandButton.textContent = t("history_expand_button", "View full text");
    expandButton.addEventListener("click", function () {
      var isHidden = fullText.hidden;
      fullText.hidden = !isHidden;
      expandButton.textContent = isHidden
        ? t("history_collapse_button", "Hide full text")
        : t("history_expand_button", "View full text");
    });

    actions.appendChild(copyButton);
    actions.appendChild(expandButton);
    actions.appendChild(deleteButton);
    top.appendChild(content);
    wrapper.appendChild(top);
    wrapper.appendChild(actions);
    wrapper.appendChild(fullText);

    return wrapper;
  }

  function createHistoryMeta(item) {
    var sourceMap = {
      click: t("copy_history_source_click", "Extension click"),
      shortcut: t("copy_history_source_shortcut", "Extension shortcut"),
      history: t("copy_history_source_history", "History replay"),
      native: t("copy_history_source_native", "Native copy"),
    };
    var modeMap = {
      copy: t("history_filter_copy", "Copy"),
    };
    var meta = document.createElement("div");
    meta.className = "history-meta";
    meta.appendChild(createHistoryChip(sourceMap[item.source] || item.source, "source-" + normalizeSourceClass(item.source)));
    meta.appendChild(createHistoryChip(modeMap[item.mode] || item.mode, "mode-chip"));

    var timeChip = createHistoryChip(formatRelativeTime(item.createdAt), "time-chip");
    timeChip.title = formatAbsoluteTime(item.createdAt);
    meta.appendChild(timeChip);

    var hostname = item.hostname || utils.getHostnameFromUrl(item.url || "");
    if (hostname) {
      meta.appendChild(createHistoryChip(hostname, "domain-chip"));
    }

    if (item.replayCount) {
      meta.appendChild(createHistoryChip("Replay ×" + item.replayCount, "replay-chip"));
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

  async function deleteHistoryItem(historyId) {
    var current = await chrome.storage.local.get({ copyHistory: [] });
    var nextHistory = utils.deleteHistoryEntries(current.copyHistory, [historyId]);
    selectedHistoryIds.delete(historyId);
    await chrome.storage.local.set({ copyHistory: nextHistory });
    await renderHistoryAndAnalytics();
    showStatus(t("history_deleted", "History item deleted"));
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
    selectedHistoryIds.clear();
    bulkSelectionMode = false;
    await renderHistoryAndAnalytics();
    showStatus(t("copy_history_cleared", "History cleared"));
  }

  async function resetAnalytics() {
    await chrome.storage.local.set({ copyAnalytics: utils.DEFAULT_ANALYTICS });
    await renderHistoryAndAnalytics();
    showStatus(t("analytics_reset_done", "Analytics reset"));
  }

  function applyMessages() {
    setText("settings_eyebrow", "Settings");
    setText("settings_title", "Copy text with Alt-Click");
    setText("settings_intro", "Configure how copy gestures, hover previews, safe-mode protections, and history behave across websites.");
    setText("tab_general", "General");
    setText("tab_sites", "Sites");
    setText("tab_feedback", "Feedback");
    setText("tab_language", "Language");
    setText("tab_history", "History");
    setText("general_section_title", "General controls");
    setText("meta_key_label", "Copy operation");
    setText("meta_key_help", "Hold your copy modifier and click to copy page content quickly.");
    setText("preview_enabled_label", "Hover preview");
    setText("preview_enabled_help", "Show the dashed outline overlay while holding the copy modifier.");
    setText("avoid_editable_label", "Skip editable apps");
    setText("avoid_editable_help", "Avoid contenteditable editors and rich text surfaces where copy gestures might be disruptive.");
    setText("keyboard_shortcut_enabled_label", "Keyboard shortcut mode");
    setText("keyboard_shortcut_enabled_help", "Allow the browser shortcut to copy the hovered target or the focused element without clicking.");
    setText("keyboard_shortcut_hint", "You can customize the extension shortcut in chrome://extensions/shortcuts.");
    setText("sites_section_title", "Excluded domains");
    setText("excluded_domains_add_label", "Add domain");
    setText("add_domain_button", "Add domain");
    document.getElementById("domain_input").placeholder = t("excluded_domains_add_placeholder", "example.com");
    setText("excluded_domains_import_label", "Bulk paste domains");
    setText("excluded_domains_import_help", "Paste one domain per line and click Apply.");
    setText("apply_bulk_button", "Apply list");
    setText("excluded_domains_help", "Excluded domains disable both hover previews and copy actions.");
    setText("feedback_title", "Feedback behavior");
    setText("toast_duration_label", "Feedback duration");
    setText("toast_duration_help", "Custom duration for the floating copy feedback.");
    setText("toast_duration_unit", "ms");
    setText("language_title", "Language");
    setText("ui_language_label", "Extension language");
    setText("ui_language_help", "Auto follows the browser locale. English and Vietnamese are available as manual overrides.");
    setText("ui_language_auto", "Auto");
    setText("ui_language_en", "English");
    setText("ui_language_vi", "Tiếng Việt");
    setText("history_title", "Copy history");
    setText("analytics_title", "Local analytics");
    setText("reset_analytics_button", "Reset analytics");
    setText("analytics_total_actions", "Total actions");
    setText("analytics_append_actions", "Selection-first copies");
    setText("analytics_native_actions", "Native copies");
    setText("analytics_shortcut_actions", "Shortcut usage");
    setText("analytics_blocked_actions", "Blocked attempts");
    setText("analytics_toast_events", "Toast events");
    setText("analytics_top_domains", "Top domains");
    setText("history_search_label", "Search history");
    document.getElementById("history_search").placeholder = t("history_search_placeholder", "Search copied text or hostname");
    setText("history_filter_source_label", "Source");
    setText("history_filter_mode_label", "Mode");
    setText("history_filter_domain_label", "Domain");
    setText("history_sort_label", "Sort by");
    setText("history_group_label", "Group by");
    setHistorySelectOptions();
    setText("copy_history_limit_label", "Saved history items");
    setText("copy_history_limit_help", "How many recent copied entries should be kept locally.");
    setText("history_bulk_toggle_button", "Select items");
    setText("history_bulk_cancel_button", "Cancel selection");
    setText("history_bulk_copy_button", "Copy selected");
    setText("history_bulk_delete_button", "Delete selected");
    setText("clear_history_button", "Clear history");
  }

  function setHistorySelectOptions() {
    setSelectOptionText("history_source_filter", "all", t("history_filter_all", "All"));
    setSelectOptionText("history_source_filter", "click", t("history_filter_click", "Click"));
    setSelectOptionText("history_source_filter", "shortcut", t("history_filter_shortcut", "Shortcut"));
    setSelectOptionText("history_source_filter", "history", t("history_filter_history", "History replay"));
    setSelectOptionText("history_source_filter", "native", t("history_filter_native", "Native copy"));
    setSelectOptionText("history_mode_filter", "all", t("history_filter_all", "All"));
    setSelectOptionText("history_mode_filter", "copy", t("history_filter_copy", "Copy"));
    setSelectOptionText("history_domain_filter", "all", t("history_filter_all", "All"));
    setSelectOptionText("history_sort", "newest", t("history_sort_newest", "Newest"));
    setSelectOptionText("history_sort", "oldest", t("history_sort_oldest", "Oldest"));
    setSelectOptionText("history_sort", "replayed", t("history_sort_replayed", "Most replayed"));
    setSelectOptionText("history_group", "none", t("history_group_none", "None"));
    setSelectOptionText("history_group", "domain", t("history_group_domain", "Domain"));
    setSelectOptionText("history_group", "source", t("history_group_source", "Source"));
    setSelectOptionText("history_group", "date", t("history_group_date", "Date"));
  }

  function enableBulkSelection() {
    bulkSelectionMode = true;
    selectedHistoryIds.clear();
    renderHistoryAndAnalytics();
  }

  function disableBulkSelection() {
    bulkSelectionMode = false;
    selectedHistoryIds.clear();
    updateBulkToolbar();
    renderHistoryAndAnalytics();
    showStatus(t("history_selection_cleared", "Selection cleared"));
  }

  async function bulkDeleteHistory() {
    if (!selectedHistoryIds.size) {
      return;
    }
    var current = await chrome.storage.local.get({ copyHistory: [] });
    var nextHistory = utils.deleteHistoryEntries(current.copyHistory, Array.from(selectedHistoryIds));
    await chrome.storage.local.set({ copyHistory: nextHistory });
    selectedHistoryIds.clear();
    bulkSelectionMode = false;
    await renderHistoryAndAnalytics();
    showStatus(t("history_bulk_done", "Bulk action completed"));
  }

  async function bulkReplayHistory() {
    if (!selectedHistoryIds.size) {
      return;
    }

    var current = await chrome.storage.local.get({ copyHistory: [] });
    var selectedItems = (Array.isArray(current.copyHistory) ? current.copyHistory : []).filter(function (item) {
      return item && selectedHistoryIds.has(item.id);
    });
    var combinedText = selectedItems.map(function (item) { return item.text; }).join("\n\n").trim();
    if (!combinedText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(combinedText);
      showStatus(t("history_bulk_done", "Bulk action completed"));
    } catch (error) {
      showStatus(error.message || "Clipboard error");
    }
  }

  function updateBulkToolbar() {
    var hasSelection = selectedHistoryIds.size > 0;
    document.getElementById("history_bulk_toggle_button").hidden = bulkSelectionMode;
    document.getElementById("history_bulk_cancel_button").hidden = !bulkSelectionMode;
    document.getElementById("history_bulk_delete_button").hidden = !bulkSelectionMode;
    document.getElementById("history_bulk_copy_button").hidden = !bulkSelectionMode;
    document.getElementById("history_bulk_delete_button").disabled = !hasSelection;
    document.getElementById("history_bulk_copy_button").disabled = !hasSelection;
  }

  function getGroupLabel(group) {
    if (historyFilters.group == "source") {
      var sourceMap = {
        click: t("copy_history_source_click", "Extension click"),
        shortcut: t("copy_history_source_shortcut", "Extension shortcut"),
        history: t("copy_history_source_history", "History replay"),
        native: t("copy_history_source_native", "Native copy"),
      };
      return sourceMap[group.key] || group.label;
    }

    if (historyFilters.group == "date") {
      var today = new Date().toISOString().slice(0, 10);
      var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (group.key == today) return "Today";
      if (group.key == yesterday) return "Yesterday";
      return "Earlier";
    }

    return group.label;
  }

  function setSelectOptionText(selectId, value, text) {
    var select = document.getElementById(selectId);
    var option = select && select.querySelector('option[value="' + value + '"]');
    if (option) {
      option.textContent = text;
    }
  }

  function activateTab(tabId) {
    document.querySelectorAll(".tab-button").forEach(function (button) {
      var isActive = button.dataset.tab == tabId;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.setAttribute("tabindex", isActive ? "0" : "-1");
    });

    document.querySelectorAll(".tab-panel").forEach(function (panel) {
      panel.classList.toggle("active", panel.dataset.panel == tabId);
    });
  }

  function showStatus(message) {
    var status = document.getElementById("save_status");
    status.textContent = message;
    clearTimeout(statusTimerId);
    statusTimerId = setTimeout(function () {
      status.textContent = "";
    }, 1800);
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
