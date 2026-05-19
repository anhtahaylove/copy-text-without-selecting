const core = require("./core.js");

module.exports = {
  DEFAULT_ANALYTICS: core.DEFAULT_ANALYTICS,
  normalizeAnalytics: core.normalizeAnalytics,
  recordAnalyticsEvent: core.recordAnalyticsEvent,
  getTopDomainStats: core.getTopDomainStats,
};
