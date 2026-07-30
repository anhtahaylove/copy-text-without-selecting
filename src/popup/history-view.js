function createPopupHistoryView(context) {
  async function renderHistory() {
    const history = await loadHistory();
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
      deleteHistoryItem(item.id, item.text).catch(function (error) {
        context.reportPopupError("Deleting popup history failed.", error);
      });
    });

    actions.appendChild(copyButton);
    actions.appendChild(deleteButton);
    top.appendChild(content);
    wrapper.appendChild(top);
    wrapper.appendChild(actions);

    const smartActions = createSmartActions(item);
    if (smartActions) {
      wrapper.appendChild(smartActions);
    }

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

    const format = context.utils.normalizeSmartFormat(item.format || context.utils.detectSmartFormat(item.text));
    if (format !== "plain") {
      meta.appendChild(context.ui.createHistoryChip(format.toUpperCase(), "format-" + format));
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

  function createSmartActions(item) {
    const actions = context.utils.getSmartHistoryActions(item);
    if (!actions.length) {
      return null;
    }

    const container = document.createElement("div");
    container.className = "history-smart-actions";

    actions.forEach(function (action) {
      const button = document.createElement("button");
      button.className = "button secondary small smart-action-button";
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", function () {
        replaySmartAction(item, action).catch(function (error) {
          context.reportPopupError("Applying smart history action failed.", error);
        });
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
      text: replayText || item.text,
      snippet: context.utils.getTextSnippet(text),
      source: "history",
      mode: "copy",
      url: item.url || "",
      hostname: hostname,
      format: context.utils.detectSmartFormat(text),
    };
    await sendHistoryMessage("COPY_TEXT_LOCAL_HISTORY_ADD", {
      entry,
      limit: context.getSettings().copyHistoryLimit,
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
    await renderHistory();
    context.ui.showStatus(context.ui.t("copy_history_cleared", "History cleared"));
  }

  async function deleteHistoryItem(historyId, text) {
    await sendHistoryMessage("COPY_TEXT_LOCAL_HISTORY_DELETE", {
      id: historyId,
      text: text || "",
    });
    await renderHistory();
    context.ui.showStatus(context.ui.t("history_deleted", "History item deleted"));
  }

  async function loadHistory() {
    const response = await sendHistoryMessage("COPY_TEXT_LOCAL_HISTORY_LIST", {
      limit: context.getSettings().copyHistoryLimit || 100,
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

  return {
    renderHistory,
    clearHistory,
  };
}

module.exports = {
  createPopupHistoryView,
};
