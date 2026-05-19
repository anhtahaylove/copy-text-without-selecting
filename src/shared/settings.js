const core = require("./core.js");

module.exports = {
  DEFAULT_SETTINGS: core.DEFAULT_SETTINGS,
  SUPPORTED_META_KEYS: core.SUPPORTED_META_KEYS,
  SUPPORTED_UI_LANGUAGES: core.SUPPORTED_UI_LANGUAGES,
  normalizeDomain: core.normalizeDomain,
  normalizeExcludedDomains: core.normalizeExcludedDomains,
  normalizeMetaKey: core.normalizeMetaKey,
  normalizeToastDuration: core.normalizeToastDuration,
  normalizeUiLanguage: core.normalizeUiLanguage,
  normalizeCopyHistoryLimit: core.normalizeCopyHistoryLimit,
  mergeSettings: core.mergeSettings,
  isExcludedHost: core.isExcludedHost,
  buildExcludeMatches: core.buildExcludeMatches,
  getCopyMode: core.getCopyMode,
  isPrimaryModifierPressed: core.isPrimaryModifierPressed,
  isModifierKeyEvent: core.isModifierKeyEvent,
  isEditableSurface: core.isEditableSurface,
  toggleDomain: core.toggleDomain,
  getHostnameFromUrl: core.getHostnameFromUrl,
};
