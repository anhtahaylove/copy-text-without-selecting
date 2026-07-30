function createOptionsHistoryView(context) {
  function normalizeSourceClass(source) {
    if (source == "click") return "extension";
    if (source == "shortcut") return "shortcut";
    if (source == "history") return "history";
    if (source == "native") return "native";
    return "unknown";
  }

  function createHistoryChip(label, extraClass) {
    const chip = document.createElement("span");
    chip.className = "history-chip" + (extraClass ? " " + extraClass : "");
    chip.textContent = label;
    return chip;
  }

  function formatRelativeTime(value) {
    const delta = Date.now() - Number(value || 0);
    if (!Number.isFinite(delta) || delta < 60000) {
      return context.ui.t("history_recency_now", "Just now");
    }

    const minutes = Math.round(delta / 60000);
    if (minutes < 60) {
      return minutes + "m ago";
    }

    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return hours + "h ago";
    }

    return Math.round(hours / 24) + "d ago";
  }

  function formatAbsoluteTime(value) {
    const timestamp = Number(value || 0);
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

  function populateHistoryDomainFilter(history) {
    const filter = document.getElementById("history_domain_filter");
    const currentValue = context.state.historyFilters.hostname;
    const hosts = context.utils.getHistoryHostOptions(history);

    filter.textContent = "";

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = context.ui.t("history_filter_all", "All");
    filter.appendChild(allOption);

    hosts.forEach(function (hostname) {
      const option = document.createElement("option");
      option.value = hostname;
      option.textContent = hostname;
      filter.appendChild(option);
    });

    filter.value = hosts.includes(currentValue) ? currentValue : "all";
    context.state.historyFilters.hostname = filter.value;
  }

  async function renderHistoryAndAnalytics() {
    const current = await context.utils.safeStorageGet("local", {
      copyAnalytics: context.utils.DEFAULT_ANALYTICS,
    });

    const history = await loadHistory();
    const analytics = context.utils.normalizeAnalytics(current.copyAnalytics);

    populateHistoryDomainFilter(history);
    context.analytics.renderAnalytics(analytics);
    renderHistory(history);
  }

  function renderHistory(history) {
    const filteredHistory = context.utils.filterHistoryEntries(history, context.state.historyFilters);
    const sortedHistory = context.utils.sortHistoryEntries(filteredHistory, context.state.historyFilters.sort);
    const groupedHistory = context.utils.groupHistoryEntries(sortedHistory, context.state.historyFilters.group);
    const list = document.getElementById("options_history_list");
    list.textContent = "";

    if (!sortedHistory.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = history.length
        ? context.ui.t("history_no_results", "No matching history entries.")
        : context.ui.t("copy_history_empty", "No copied items yet.");
      list.appendChild(empty);
      updateBulkToolbar();
      return;
    }

    groupedHistory.forEach(function (group) {
      if (context.state.historyFilters.group != "none") {
        const groupWrap = document.createElement("div");
        groupWrap.className = "history-group";

        const groupLabel = document.createElement("div");
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
    const wrapper = document.createElement("div");
    wrapper.className = "history-item";
    wrapper.classList.toggle("selected", context.state.selectedHistoryIds.has(item.id));

    const top = document.createElement("div");
    top.className = "history-top";

    const content = document.createElement("div");
    content.className = "field-group";

    if (context.state.bulkSelectionMode) {
      const selector = document.createElement("input");
      selector.type = "checkbox";
      selector.checked = context.state.selectedHistoryIds.has(item.id);
      selector.addEventListener("change", function () {
        if (selector.checked) {
          context.state.selectedHistoryIds.add(item.id);
        } else {
          context.state.selectedHistoryIds.delete(item.id);
        }
        updateBulkToolbar();
        wrapper.classList.toggle("selected", context.state.selectedHistoryIds.has(item.id));
      });
      content.appendChild(selector);
    }

    const snippet = document.createElement("div");
    snippet.className = "history-snippet";
    snippet.textContent = item.snippet || item.text;

    const meta = createHistoryMeta(item);

    content.appendChild(snippet);
    content.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const copyButton = document.createElement("button");
    copyButton.className = "secondary-button";
    copyButton.type = "button";
    copyButton.textContent = context.ui.t("history_copy_button", "Copy again");
    copyButton.addEventListener("click", function () {
      replayHistory(item);
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "secondary-button";
    deleteButton.type = "button";
    deleteButton.textContent = context.ui.t("history_delete_button", "Delete");
    deleteButton.addEventListener("click", function () {
      deleteHistoryItem(item.id, item.text);
    });

    const fullText = document.createElement("pre");
    fullText.className = "history-fulltext";
    fullText.hidden = true;
    fullText.textContent = item.text;

    const expandButton = document.createElement("button");
    expandButton.className = "secondary-button";
    expandButton.type = "button";
    expandButton.textContent = context.ui.t("history_expand_button", "View full text");
    expandButton.addEventListener("click", function () {
      const isHidden = fullText.hidden;
      fullText.hidden = !isHidden;
      expandButton.textContent = isHidden
        ? context.ui.t("history_collapse_button", "Hide full text")
        : context.ui.t("history_expand_button", "View full text");
    });

    actions.appendChild(copyButton);
    actions.appendChild(expandButton);
    actions.appendChild(deleteButton);
    top.appendChild(content);
    wrapper.appendChild(top);
    wrapper.appendChild(actions);

    const smartActions = createSmartActions(item);
    if (smartActions) {
      wrapper.appendChild(smartActions);
    }

    wrapper.appendChild(fullText);

    return wrapper;
  }

  function createHistoryMeta(item) {
    const sourceMap = {
      click: context.ui.t("copy_history_source_click", "Extension click"),
      shortcut: context.ui.t("copy_history_source_shortcut", "Extension shortcut"),
      history: context.ui.t("copy_history_source_history", "History replay"),
      native: context.ui.t("copy_history_source_native", "Native copy"),
    };
    const modeMap = {
      copy: context.ui.t("history_filter_copy", "Copy"),
    };
    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.appendChild(createHistoryChip(sourceMap[item.source] || item.source, "source-" + normalizeSourceClass(item.source)));
    meta.appendChild(createHistoryChip(modeMap[item.mode] || item.mode, "mode-chip"));

    const timeChip = createHistoryChip(formatRelativeTime(item.createdAt), "time-chip");
    timeChip.title = formatAbsoluteTime(item.createdAt);
    meta.appendChild(timeChip);

    const hostname = item.hostname || context.utils.getHostnameFromUrl(item.url || "");
    if (hostname) {
      meta.appendChild(createHistoryChip(hostname, "domain-chip"));
    }

    const format = context.utils.normalizeSmartFormat(item.format || context.utils.detectSmartFormat(item.text));
    if (format !== "plain") {
      meta.appendChild(createHistoryChip(format.toUpperCase(), "format-" + format));
    }

    if (item.replayCount) {
      meta.appendChild(createHistoryChip("Replay ×" + item.replayCount, "replay-chip"));
    }

    return meta;
  }

  async function replayHistory(item) {
    try {
      await navigator.clipboard.writeText(item.text);
      context.ui.showStatus(context.ui.t("copy_history_recopied", "Copied from history"));
      await recordReplayUsage(item, "historyReplayCopy", item.text);
    } catch (error) {
      context.ui.showStatus(error.message || "Clipboard error");
    }
  }

  async function deleteHistoryItem(historyId, text) {
    context.state.selectedHistoryIds.delete(historyId);
    await sendHistoryMessage("COPY_TEXT_LOCAL_HISTORY_DELETE", {
      id: historyId,
      text: text || "",
    });
    await renderHistoryAndAnalytics();
    context.ui.showStatus(context.ui.t("history_deleted", "History item deleted"));
  }

  function createSmartActions(item) {
    const actions = context.utils.getSmartHistoryActions(item);
    if (!actions.length) {
      return null;
    }

    const container = document.createElement("div");
    container.className = "history-smart-actions";

    actions.forEach(function (action) {
      const button = document.createElement("button");
      button.className = "secondary-button smart-action-button";
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", function () {
        replaySmartAction(item, action);
      });
      container.appendChild(button);
    });

    return container;
  }

  async function replaySmartAction(item, action) {
    const output = context.utils.applySmartAction(item.text, action.id);
    if (!output) {
      return;
    }

    try {
      await navigator.clipboard.writeText(output);
      context.ui.showStatus(action.label + " copied");
      await recordReplayUsage(Object.assign({}, item, {
        text: output,
        snippet: context.utils.getTextSnippet(output),
        format: context.utils.detectSmartFormat(output),
      }), "historyReplayCopy", output);
    } catch (error) {
      context.ui.showStatus(error.message || "Clipboard error");
    }
  }

  async function recordReplayUsage(item, analyticsType, replayText) {
    const current = await context.utils.safeStorageGet("local", {
      copyAnalytics: context.utils.DEFAULT_ANALYTICS,
    });
    const hostname = item.hostname || context.utils.getHostnameFromUrl(item.url || "");
    const text = replayText || item.text;
    const entry = {
      text,
      snippet: context.utils.getTextSnippet(text),
      source: "history",
      mode: "copy",
      url: item.url || "",
      hostname: hostname,
      format: context.utils.detectSmartFormat(text),
    };
    await sendHistoryMessage("COPY_TEXT_LOCAL_HISTORY_ADD", {
      entry,
      limit: context.state.settings.copyHistoryLimit,
    });
    const nextAnalytics = context.utils.recordAnalyticsEvent(current.copyAnalytics, {
      type: analyticsType,
      hostname: hostname,
      toastKind: "status",
    });

    await context.utils.safeStorageSet("local", {
      copyAnalytics: nextAnalytics,
    });
  }

  async function clearHistory() {
    await sendHistoryMessage("COPY_TEXT_LOCAL_HISTORY_CLEAR");
    context.state.selectedHistoryIds.clear();
    context.state.bulkSelectionMode = false;
    await renderHistoryAndAnalytics();
    context.ui.showStatus(context.ui.t("copy_history_cleared", "History cleared"));
  }

  async function resetAnalytics() {
    await context.utils.safeStorageSet("local", { copyAnalytics: context.utils.DEFAULT_ANALYTICS });
    await renderHistoryAndAnalytics();
    context.ui.showStatus(context.ui.t("analytics_reset_done", "Analytics reset"));
  }

  function enableBulkSelection() {
    context.state.bulkSelectionMode = true;
    context.state.selectedHistoryIds.clear();
    renderHistoryAndAnalytics();
  }

  function disableBulkSelection() {
    context.state.bulkSelectionMode = false;
    context.state.selectedHistoryIds.clear();
    updateBulkToolbar();
    renderHistoryAndAnalytics();
    context.ui.showStatus(context.ui.t("history_selection_cleared", "Selection cleared"));
  }

  async function bulkDeleteHistory() {
    if (!context.state.selectedHistoryIds.size) {
      return;
    }
    const history = await loadHistory();
    const items = history.filter(function (item) {
      return context.state.selectedHistoryIds.has(item.id);
    }).map(function (item) {
      return { id: item.id, text: item.text };
    });
    await sendHistoryMessage("COPY_TEXT_LOCAL_HISTORY_DELETE", {
      ids: Array.from(context.state.selectedHistoryIds),
      items,
    });
    context.state.selectedHistoryIds.clear();
    context.state.bulkSelectionMode = false;
    await renderHistoryAndAnalytics();
    context.ui.showStatus(context.ui.t("history_bulk_done", "Bulk action completed"));
  }

  async function bulkReplayHistory() {
    if (!context.state.selectedHistoryIds.size) {
      return;
    }

    const history = await loadHistory();
    const selectedItems = history.filter(function (item) {
      return item && context.state.selectedHistoryIds.has(item.id);
    });
    const combinedText = selectedItems.map(function (item) { return item.text; }).join("\n\n").trim();
    if (!combinedText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(combinedText);
      context.ui.showStatus(context.ui.t("history_bulk_done", "Bulk action completed"));
    } catch (error) {
      context.ui.showStatus(error.message || "Clipboard error");
    }
  }

  async function loadHistory() {
    const response = await sendHistoryMessage("COPY_TEXT_LOCAL_HISTORY_LIST", {
      limit: Math.max(context.state.settings.copyHistoryLimit || 0, 250),
    }, false);
    if (response && response.ok && response.payload && Array.isArray(response.payload.history)) {
      return response.payload.history;
    }
    const current = await context.utils.safeStorageGet("local", { copyHistory: [] });
    return Array.isArray(current.copyHistory) ? current.copyHistory : [];
  }

  async function sendHistoryMessage(type, payload, throwOnFailure) {
    const response = await context.utils.safeChromeAsync(function () {
      return chrome.runtime.sendMessage({
        type,
        payload: payload || {},
      });
    }, null);
    if ((!response || !response.ok) && throwOnFailure !== false) {
      const message = response && response.error && response.error.message
        ? response.error.message
        : "History operation failed.";
      throw new Error(message);
    }
    return response;
  }

  function updateBulkToolbar() {
    const hasSelection = context.state.selectedHistoryIds.size > 0;
    document.getElementById("history_bulk_toggle_button").hidden = context.state.bulkSelectionMode;
    document.getElementById("history_bulk_cancel_button").hidden = !context.state.bulkSelectionMode;
    document.getElementById("history_bulk_delete_button").hidden = !context.state.bulkSelectionMode;
    document.getElementById("history_bulk_copy_button").hidden = !context.state.bulkSelectionMode;
    document.getElementById("history_bulk_delete_button").disabled = !hasSelection;
    document.getElementById("history_bulk_copy_button").disabled = !hasSelection;
  }

  function getGroupLabel(group) {
    if (context.state.historyFilters.group == "source") {
      const sourceMap = {
        click: context.ui.t("copy_history_source_click", "Extension click"),
        shortcut: context.ui.t("copy_history_source_shortcut", "Extension shortcut"),
        history: context.ui.t("copy_history_source_history", "History replay"),
        native: context.ui.t("copy_history_source_native", "Native copy"),
      };
      return sourceMap[group.key] || group.label;
    }

    if (context.state.historyFilters.group == "date") {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (group.key == today) return "Today";
      if (group.key == yesterday) return "Yesterday";
      return "Earlier";
    }

    return group.label;
  }

  return {
    renderHistoryAndAnalytics,
    enableBulkSelection,
    disableBulkSelection,
    bulkDeleteHistory,
    bulkReplayHistory,
    clearHistory,
    resetAnalytics,
  };
}

module.exports = {
  createOptionsHistoryView,
};
