const core = require("./core.js");

if (typeof globalThis !== "undefined") {
  globalThis.CopyTextUtils = core;
}

module.exports = core;
