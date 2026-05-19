function normalizeSourceClass(source) {
  if (source == "click") return "extension";
  if (source == "shortcut") return "shortcut";
  if (source == "history") return "history";
  if (source == "native") return "native";
  return "unknown";
}

function formatRelativeTime(t, value) {
  const delta = Date.now() - Number(value || 0);
  if (!Number.isFinite(delta) || delta < 60000) {
    return t("history_recency_now", "Just now");
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

function createHistoryChip(label, extraClass) {
  const chip = document.createElement("span");
  chip.className = "history-chip" + (extraClass ? " " + extraClass : "");
  chip.textContent = label;
  return chip;
}

function createPopupUi(context) {
  function t(key, fallback) {
    return context.utils.translate(context.getSettings(), key, chrome.i18n.getMessage(key) || fallback, chrome.i18n.getUILanguage());
  }

  function setText(id, fallback) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = t(id, fallback);
    }
  }

  function setSiteStatus(status) {
    context.elements.siteStatus.className = "badge " + status;

    switch (status) {
      case "active":
        context.elements.siteStatus.textContent = t("popup_site_active", "Active");
        break;
      case "excluded":
        context.elements.siteStatus.textContent = t("popup_site_excluded", "Excluded");
        break;
      default:
        context.elements.siteStatus.textContent = t("popup_site_unsupported", "Unsupported");
        break;
    }
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

  function showStatus(message) {
    context.elements.status.textContent = message;
    clearTimeout(showStatus.timerId);
    showStatus.timerId = setTimeout(function () {
      context.elements.status.textContent = "";
    }, 1600);
  }

  return {
    t,
    setText,
    setSiteStatus,
    applyMessages,
    showStatus,
    createHistoryChip,
    formatRelativeTime,
    formatAbsoluteTime,
    normalizeSourceClass,
  };
}

module.exports = {
  createPopupUi,
};
