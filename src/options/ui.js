function createOptionsUi(context) {
  function t(key, fallback) {
    return context.utils.translate(context.getSettings(), key, chrome.i18n.getMessage(key) || fallback, chrome.i18n.getUILanguage());
  }

  function setText(id, fallback) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = t(id, fallback);
    }
  }

  function setSelectOptionText(selectId, value, text) {
    const select = document.getElementById(selectId);
    const option = select && select.querySelector('option[value="' + value + '"]');
    if (option) {
      option.textContent = text;
    }
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

  function showStatus(message) {
    const status = document.getElementById("save_status");
    status.textContent = message;
    clearTimeout(showStatus.timerId);
    showStatus.timerId = setTimeout(function () {
      status.textContent = "";
    }, 1800);
  }

  return {
    t,
    setText,
    setSelectOptionText,
    setHistorySelectOptions,
    applyMessages,
    showStatus,
  };
}

module.exports = {
  createOptionsUi,
};
