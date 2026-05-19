function createAnalyticsView(context) {
  function renderAnalytics(analytics) {
    document.getElementById("analytics_total_actions_value").textContent = String(analytics.totals.totalActions || 0);
    document.getElementById("analytics_append_actions_value").textContent = String(analytics.totals.selectionCopies || 0);
    document.getElementById("analytics_native_actions_value").textContent = String(analytics.totals.nativeCopies || 0);
    document.getElementById("analytics_shortcut_actions_value").textContent = String(analytics.totals.shortcuts || 0);
    document.getElementById("analytics_blocked_actions_value").textContent = String((analytics.totals.excludedBlocked || 0) + (analytics.totals.editableSkipped || 0));
    document.getElementById("analytics_toast_events_value").textContent = String(
      (analytics.toastCounts.copied || 0) + (analytics.toastCounts.status || 0)
    );

    const list = document.getElementById("analytics_top_domains_list");
    list.textContent = "";

    const topDomains = context.utils.getTopDomainStats(analytics, 5);
    if (!topDomains.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = context.ui.t("analytics_empty_domains", "No domain activity yet.");
      list.appendChild(empty);
      return;
    }

    topDomains.forEach(function (item) {
      const card = document.createElement("div");
      card.className = "domain-item";

      const row = document.createElement("div");
      row.className = "domain-row";

      const name = document.createElement("div");
      name.className = "domain-name";
      name.textContent = item.hostname;

      const meta = document.createElement("div");
      meta.className = "history-meta";
      meta.appendChild(createHistoryChip(context.ui.t("analytics_total_actions", "Total actions") + ": " + item.totalActions, "domain-metric"));
      meta.appendChild(createHistoryChip(context.ui.t("analytics_shortcut_actions", "Shortcut usage") + ": " + item.shortcuts, "domain-metric"));

      row.appendChild(name);
      card.appendChild(row);
      card.appendChild(meta);
      list.appendChild(card);
    });
  }

  function createHistoryChip(label, extraClass) {
    const chip = document.createElement("span");
    chip.className = "history-chip" + (extraClass ? " " + extraClass : "");
    chip.textContent = label;
    return chip;
  }

  return {
    renderAnalytics,
  };
}

module.exports = {
  createAnalyticsView,
};
