const core = require("./core.js");

module.exports = {
  normalizeHistoryEntry: core.normalizeHistoryEntry,
  pushHistoryEntry: core.pushHistoryEntry,
  updateHistoryEntry: core.updateHistoryEntry,
  deleteHistoryEntries: core.deleteHistoryEntries,
  sortHistoryEntries: core.sortHistoryEntries,
  groupHistoryEntries: core.groupHistoryEntries,
  filterHistoryEntries: core.filterHistoryEntries,
  getHistoryHostOptions: core.getHistoryHostOptions,
};
