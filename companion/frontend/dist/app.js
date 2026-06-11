(function () {
  const state = {
    history: [],
    selectedId: "",
    selectedText: "",
    settings: null,
  };

  const elements = {
    search: document.getElementById("search_input"),
    historyEnabled: document.getElementById("history_enabled"),
    maxItems: document.getElementById("max_items"),
    hotkey: document.getElementById("hotkey"),
    autoStart: document.getElementById("auto_start"),
    refresh: document.getElementById("refresh_button"),
    clear: document.getElementById("clear_button"),
    hide: document.getElementById("hide_button"),
    status: document.getElementById("status"),
    count: document.getElementById("count_label"),
    storagePath: document.getElementById("storage_path"),
    historyList: document.getElementById("history_list"),
    previewMeta: document.getElementById("preview_meta"),
    previewActions: document.getElementById("preview_actions"),
    previewText: document.getElementById("preview_text"),
  };

  function api() {
    return window.go && window.go.main && window.go.main.App;
  }

  async function call(method, ...args) {
    const app = api();
    if (!app || typeof app[method] !== "function") {
      throw new Error("Wails bindings are not ready.");
    }
    return app[method](...args);
  }

  async function initialize() {
    bindEvents();
    await refreshSettings();
    await refreshHistory();
    setStatus("Ready");
  }

  function bindEvents() {
    elements.search.addEventListener("input", debounce(refreshHistory, 160));
    elements.refresh.addEventListener("click", refreshHistory);
    elements.clear.addEventListener("click", clearHistory);
    elements.hide.addEventListener("click", function () {
      call("HideApp").catch(showError);
    });

    elements.historyEnabled.addEventListener("change", saveSettings);
    elements.maxItems.addEventListener("change", saveSettings);
    elements.hotkey.addEventListener("change", saveSettings);
    elements.autoStart.addEventListener("change", saveSettings);
  }

  async function refreshSettings() {
    try {
      const settings = await call("GetSettings");
      state.settings = settings;
      elements.historyEnabled.checked = !!settings.historyEnabled;
      elements.maxItems.value = settings.maxItems || 500;
      elements.hotkey.value = settings.hotkey || "Ctrl+Shift+Space";
      elements.autoStart.checked = !!settings.autoStart;
      const storePath = await call("StorePath");
      elements.storagePath.textContent = storePath;
      elements.storagePath.title = storePath;
    } catch (error) {
      showError(error);
    }
  }

  async function saveSettings() {
    try {
      const settings = await call("UpdateSettings", {
        historyEnabled: elements.historyEnabled.checked,
        maxItems: Number(elements.maxItems.value) || 500,
        hotkey: elements.hotkey.value,
        autoStart: elements.autoStart.checked,
      });
      state.settings = settings;
      setStatus("Settings saved");
      await refreshHistory();
    } catch (error) {
      showError(error);
      await refreshSettings();
    }
  }

  async function refreshHistory() {
    try {
      const query = elements.search.value || "";
      const history = await call("ListHistory", query);
      state.history = Array.isArray(history) ? history : [];
      syncSelection();
      renderHistory();
      if (state.selectedText) {
        await renderPreview(state.selectedText, "");
      } else {
        resetPreview();
      }
    } catch (error) {
      showError(error);
    }
  }

  function renderHistory() {
    elements.count.textContent = state.history.length + (state.history.length === 1 ? " item" : " items");
    elements.historyList.textContent = "";

    if (!state.history.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No clipboard history yet.";
      elements.historyList.appendChild(empty);
      return;
    }

    for (const entry of state.history) {
      const item = document.createElement("article");
      item.className = "history-item" + (entry.id === state.selectedId ? " selected" : "");

      const top = document.createElement("div");
      top.className = "item-top";

      const copy = document.createElement("div");
      copy.className = "item-copy";

      const snippet = document.createElement("div");
      snippet.className = "snippet";
      snippet.textContent = entry.snippet || entry.text || "";
      copy.appendChild(snippet);

      const subtitle = document.createElement("div");
      subtitle.className = "item-subtitle";
      subtitle.textContent = itemSubtitle(entry);
      copy.appendChild(subtitle);
      top.appendChild(copy);

      const actions = document.createElement("div");
      actions.className = "item-actions";
      actions.appendChild(button("Copy", "primary", function () { copyEntry(entry); }));
      actions.appendChild(button(entry.pinned ? "Unpin" : "Pin", "", function () { pinEntry(entry); }));
      actions.appendChild(button("Delete", "danger", function () { deleteEntry(entry); }));
      top.appendChild(actions);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.appendChild(chip(entry.format || "plain", "format"));
      meta.appendChild(chip(sourceLabel(entry.source), ""));
      if (entry.hostname) {
        meta.appendChild(chip(entry.hostname, ""));
      }
      if (entry.pinned) {
        meta.appendChild(chip("pinned", "pinned"));
      }

      item.appendChild(top);
      item.appendChild(meta);
      item.tabIndex = 0;
      item.addEventListener("click", function (event) {
        if (event.target && event.target.tagName === "BUTTON") {
          return;
        }
        selectEntry(entry);
      });
      item.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectEntry(entry);
        }
      });
      elements.historyList.appendChild(item);
    }
  }

  function syncSelection() {
    if (!state.history.length) {
      state.selectedId = "";
      state.selectedText = "";
      return;
    }
    const selected = state.history.find(function (entry) {
      return entry.id === state.selectedId;
    });
    const next = selected || state.history[0];
    state.selectedId = next.id;
    state.selectedText = next.text || "";
  }

  async function selectEntry(entry) {
    state.selectedId = entry.id;
    state.selectedText = entry.text || "";
    renderHistory();
    await renderPreview(state.selectedText, "");
  }

  async function renderPreview(text, action) {
    try {
      const preview = await call("FormatPreview", text, action);
      elements.previewMeta.textContent = (preview.format || "plain") + " preview";
      elements.previewText.textContent = preview.text || "";
      elements.previewActions.textContent = "";

      const actions = Array.isArray(preview.actions) ? preview.actions : [];
      for (const smartAction of actions) {
        elements.previewActions.appendChild(button(smartAction.label, "", function () {
          renderPreview(text, smartAction.id);
        }));
      }
      if (preview.text) {
        elements.previewActions.appendChild(button("Copy preview", "primary", function () {
          call("CopyText", elements.previewText.textContent).then(function () {
            setStatus("Preview copied");
          }).catch(showError);
        }));
      }
    } catch (error) {
      showError(error);
    }
  }

  async function copyEntry(entry) {
    try {
      await call("CopyText", entry.text || "");
      setStatus("Copied");
    } catch (error) {
      showError(error);
    }
  }

  async function pinEntry(entry) {
    try {
      await call("PinHistory", entry.id, !entry.pinned);
      await refreshHistory();
    } catch (error) {
      showError(error);
    }
  }

  async function deleteEntry(entry) {
    try {
      await call("DeleteHistory", entry.id);
      if (state.selectedId === entry.id) {
        state.selectedId = "";
        state.selectedText = "";
        resetPreview();
      }
      await refreshHistory();
    } catch (error) {
      showError(error);
    }
  }

  async function clearHistory() {
    if (!window.confirm("Clear all companion history, including pinned items?")) {
      return;
    }
    try {
      await call("ClearHistory");
      state.selectedId = "";
      state.selectedText = "";
      await refreshHistory();
      resetPreview();
    } catch (error) {
      showError(error);
    }
  }

  function resetPreview() {
    elements.previewMeta.textContent = "Select a history item";
    elements.previewText.textContent = "";
    elements.previewActions.textContent = "";
  }

  function button(label, kind, onClick) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    if (kind) {
      element.className = kind;
    }
    element.addEventListener("click", onClick);
    return element;
  }

  function chip(text, kind) {
    const element = document.createElement("span");
    element.className = "chip" + (kind ? " " + kind : "");
    element.textContent = text;
    return element;
  }

  function itemSubtitle(entry) {
    const parts = [];
    const when = formatTimestamp(entry.createdAt || entry.updatedAt);
    if (when) {
      parts.push(when);
    }
    if (entry.hostname) {
      parts.push(entry.hostname);
    } else if (entry.source) {
      parts.push(sourceLabel(entry.source));
    }
    return parts.join(" · ");
  }

  function formatTimestamp(value) {
    const timestamp = Number(value || 0);
    if (!timestamp) {
      return "";
    }
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(timestamp));
    } catch (error) {
      return "";
    }
  }

  function sourceLabel(value) {
    const source = String(value || "unknown");
    if (source === "desktop-clipboard") {
      return "desktop";
    }
    if (source === "web-extension") {
      return "browser";
    }
    return source;
  }

  function setStatus(message) {
    elements.status.textContent = message;
  }

  function showError(error) {
    const message = error && error.message ? error.message : String(error);
    elements.status.textContent = message;
    console.error(error);
  }

  function debounce(fn, delay) {
    let timer = 0;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
  }

  document.addEventListener("DOMContentLoaded", function () {
    initialize().catch(showError);
  });
})();
