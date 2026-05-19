function createDomainsController(context) {
  async function addDomainFromInput() {
    const input = document.getElementById("domain_input");
    const normalized = context.utils.normalizeDomain(input.value);
    if (!normalized) {
      return;
    }

    context.state.settings.excludedDomains = context.utils.toggleDomain(context.state.settings.excludedDomains, normalized);
    document.getElementById("excluded_domains_bulk").value = context.state.settings.excludedDomains.join("\n");
    input.value = "";

    await context.utils.safeStorageSet("sync", context.state.settings);
    await renderExcludedDomains();
    context.ui.showStatus(context.ui.t("save_status_saved", "Saved"));
  }

  async function applyBulkDomains() {
    context.state.settings.excludedDomains = context.utils.normalizeExcludedDomains(document.getElementById("excluded_domains_bulk").value);
    document.getElementById("excluded_domains_bulk").value = context.state.settings.excludedDomains.join("\n");

    await context.utils.safeStorageSet("sync", context.state.settings);
    await renderExcludedDomains();
    context.ui.showStatus(context.ui.t("save_status_saved", "Saved"));
  }

  async function renderExcludedDomains() {
    const list = document.getElementById("excluded_domains_list");
    list.textContent = "";

    if (!context.state.settings.excludedDomains.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = context.ui.t("excluded_domains_empty", "No excluded domains yet.");
      list.appendChild(empty);
      return;
    }

    context.state.settings.excludedDomains.forEach(function (domain) {
      const item = document.createElement("div");
      item.className = "domain-item";

      const row = document.createElement("div");
      row.className = "domain-row";

      const name = document.createElement("div");
      name.className = "domain-name";
      name.textContent = domain;

      const remove = document.createElement("button");
      remove.className = "secondary-button";
      remove.type = "button";
      remove.textContent = context.ui.t("domain_remove_button", "Remove");
      remove.addEventListener("click", async function () {
        context.state.settings.excludedDomains = context.utils.toggleDomain(context.state.settings.excludedDomains, domain);
        document.getElementById("excluded_domains_bulk").value = context.state.settings.excludedDomains.join("\n");
        await context.utils.safeStorageSet("sync", context.state.settings);
        await renderExcludedDomains();
        context.ui.showStatus(context.ui.t("save_status_saved", "Saved"));
      });

      row.appendChild(name);
      row.appendChild(remove);
      item.appendChild(row);
      list.appendChild(item);
    });
  }

  return {
    addDomainFromInput,
    applyBulkDomains,
    renderExcludedDomains,
  };
}

module.exports = {
  createDomainsController,
};
