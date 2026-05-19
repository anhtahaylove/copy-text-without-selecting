function createPopupHistoryView(context) {
  async function renderHistory() {
    const current = await context.utils.safeStorageGet("local", { copyHistory: [] });
    const history = Array.isArray(current.copyHistory) ? current.copyHistory : [];
    context.elements.historyList.textContent = "";

    if (!history.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";

      const icon = document.createElement("div");
      icon.className = "empty-state-icon";
      icon.textContent = "\uD83D\uDCCB";

      const text = document.createElement("div");
      text.className = "empty-state-text";
      text.textContent = context.ui.t("popup_history_empty", "No recent copies yet.");

      const hint = document.createElement("div");
      hint.className = "empty-state-hint";
      hint.textContent = context.ui.t("popup_history_onboarding", "Hold " + (context.getSettings().metaKey || "Alt") + " + Click any text to copy it.");

      empty.appendChild(icon);
      empty.appendChild(text);
      empty.appendChild(hint);
      context.elements.historyList.appendChild(empty);
      return;
    }

    history.forEach(function (item) {
      context.elements.historyList.appendChild(createHistoryItem(item));
    });
  }

  function createHistoryItem(item) {
    const wrapper = document.createElement("div");
    wrapper.className = "history-item";

    const top = document.createElement("div");
    top.className = "history-top";

    const snippet = document.createElement("div");
    snippet.className = "history-snippet";
    snippet.textContent = item.snippet || item.text;

    const meta = createHistoryMeta(item);

    const content = document.createElement("div");
    content.className = "stack";
    content.appendChild(snippet);
    content.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const copyButton = document.createElement("button");
    copyButton.className = "button secondary small";
    copyButton.type = "button";
    copyButton.textContent = context.ui.t("history_copy_button", "Copy again");
    copyButton.addEventListener("click", function () {
      replayHistory(item).catch(function (error) {
        context.reportPopupError("Replaying popup history failed.", error);
      });
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "button secondary small";
    deleteButton.type = "button";
    deleteButton.textContent = context.ui.t("history_delete_button", "Delete");
    deleteButton.addEventListener("click", function () {
      deleteHistoryItem(item.id).catch(function (error) {
        context.reportPopupError("Deleting popup history failed.", error);
      });
    });

    actions.appendChild(copyButton);
    actions.appendChild(deleteButton);
    top.appendChild(content);
    wrapper.appendChild(top);
    wrapper.appendChild(actions);

    return wrapper;
  }

  function createHistoryMeta(item) {
    const sourceMap = {
      click: context.ui.t("copy_history_source_click", "Extension click"),
      shortcut: context.ui.t("copy_history_source_shortcut", "Extension shortcut"),
      history: context.ui.t("copy_history_source_history", "History replay"),
      native: context.ui.t("copy_history_source_native", "Native copy"),
    };

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.appendChild(context.ui.createHistoryChip(sourceMap[item.source] || item.source || context.ui.t("copy_history_source_click", "Extension click"), "source-" + context.ui.normalizeSourceClass(item.source)));

    const timeChip = context.ui.createHistoryChip(context.ui.formatRelativeTime(context.ui.t, item.createdAt), "time-chip");
    timeChip.title = context.ui.formatAbsoluteTime(item.createdAt);
    meta.appendChild(timeChip);

    const host = item.hostname || (item.url ? context.utils.getHostnameFromUrl(item.url) : "");
    if (host) {
      meta.appendChild(context.ui.createHistoryChip(host, "domain-chip"));
    }

    return meta;
  }

  async function replayHistory(item) {
    try {
      await navigator.clipboard.writeText(item.text);
      context.ui.showStatus(context.ui.t("copy_history_recopied", "Copied from history"));
      await recordReplayUsage(item, "historyReplayCopy");
    } catch (error) {
      context.ui.showStatus(error.message || "Clipboard error");
    }
  }

  async function recordReplayUsage(item, analyticsType) {
    const current = await context.utils.safeStorageGet("local", {
      copyHistory: [],
      copyAnalytics: context.utils.DEFAULT_ANALYTICS,
    });
    const hostname = item.hostname || context.utils.getHostnameFromUrl(item.url || "");
    const nextHistory = context.utils.pushHistoryEntry(current.copyHistory, {
      text: item.text,
      snippet: item.snippet || item.text,
      source: "history",
      mode: "copy",
      url: item.url || "",
      hostname: hostname,
    }, context.getSettings().copyHistoryLimit);
    const nextAnalytics = context.utils.recordAnalyticsEvent(current.copyAnalytics, {
      type: analyticsType,
      hostname: hostname,
      toastKind: "status",
    });

    await context.utils.safeStorageSet("local", {
      copyHistory: nextHistory,
      copyAnalytics: nextAnalytics,
    });
  }

  async function clearHistory() {
    await context.utils.safeStorageSet("local", { copyHistory: [] });
    await renderHistory();
    context.ui.showStatus(context.ui.t("copy_history_cleared", "History cleared"));
  }

  async function deleteHistoryItem(historyId) {
    const current = await context.utils.safeStorageGet("local", { copyHistory: [] });
    const nextHistory = context.utils.deleteHistoryEntries(current.copyHistory, [historyId]);
    await context.utils.safeStorageSet("local", { copyHistory: nextHistory });
    await renderHistory();
    context.ui.showStatus(context.ui.t("history_deleted", "History item deleted"));
  }

  return {
    renderHistory,
    clearHistory,
  };
}

module.exports = {
  createPopupHistoryView,
};
