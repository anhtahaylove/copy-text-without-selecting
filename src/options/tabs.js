function createTabController() {
  function activateTab(tabId) {
    document.querySelectorAll(".tab-button").forEach(function (button) {
      const isActive = button.dataset.tab == tabId;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.setAttribute("tabindex", isActive ? "0" : "-1");
    });

    document.querySelectorAll(".tab-panel").forEach(function (panel) {
      panel.classList.toggle("active", panel.dataset.panel == tabId);
    });
  }

  function bindTabEvents() {
    document.querySelectorAll(".tab-button").forEach(function (button) {
      button.addEventListener("click", function () {
        activateTab(button.dataset.tab);
      });
      button.addEventListener("keydown", function (event) {
        const tabs = Array.from(document.querySelectorAll(".tab-button"));
        const index = tabs.indexOf(button);
        let next = -1;
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
  }

  return {
    activateTab,
    bindTabEvents,
  };
}

module.exports = {
  createTabController,
};
