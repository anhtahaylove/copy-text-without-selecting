const core = require("./core.js");

module.exports = {
  isExtensionContextValid: core.isExtensionContextValid,
  isExtensionContextInvalidatedError: core.isExtensionContextInvalidatedError,
  safeChromeAsync: core.safeChromeAsync,
  safeStorageGet: core.safeStorageGet,
  safeStorageSet: core.safeStorageSet,
  safeTabsQuery: core.safeTabsQuery,
  safeExecuteScript: core.safeExecuteScript,
  safeSendMessage: core.safeSendMessage,
  safeOpenOptionsPage: core.safeOpenOptionsPage,
  addListenerSafely: core.addListenerSafely,
  removeListenerSafely: core.removeListenerSafely,
};
