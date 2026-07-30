const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/shared/core.js");
const {
  ensureSettings,
  initializeExtension,
  syncContentScriptRegistration,
} = require("../src/background/registration.js");

test("ensureSettings does not rewrite already normalized settings", async function () {
  let writes = 0;
  const settings = core.mergeSettings();
  const utils = Object.assign({}, core, {
    safeStorageGet: async function () { return settings; },
    safeStorageSet: async function () { writes += 1; return true; },
  });

  assert.deepEqual(await ensureSettings(utils), settings);
  assert.equal(writes, 0);
});

test("content registration updates in place with normalized exclude matches", async function () {
  const originalChrome = global.chrome;
  let definition;
  let unregisterCalls = 0;
  global.chrome = {
    runtime: { id: "test-extension" },
    scripting: {
      getRegisteredContentScripts: async function () { return [{ id: "content" }]; },
      updateContentScripts: async function (items) { definition = items[0]; },
      registerContentScripts: async function () { throw new Error("unexpected register"); },
      unregisterContentScripts: async function () { unregisterCalls += 1; },
    },
  };
  const utils = Object.assign({}, core, {
    safeChromeAsync: async function (work) { return work(); },
  });

  try {
    await syncContentScriptRegistration(utils, {
      excludedDomains: ["*.example.com", "bad host"],
    }, "content");
    assert.deepEqual(definition.excludeMatches, [
      "*://example.com/*",
      "*://*.example.com/*",
    ]);
    assert.equal(unregisterCalls, 0);
  } finally {
    global.chrome = originalChrome;
  }
});

test("extension initialization is serialized", async function () {
  const originalChrome = global.chrome;
  let activeRegistrations = 0;
  let maxActiveRegistrations = 0;
  global.chrome = {
    runtime: { id: "test-extension" },
    scripting: {
      getRegisteredContentScripts: async function () { return [{ id: "content" }]; },
      updateContentScripts: async function () {
        activeRegistrations += 1;
        maxActiveRegistrations = Math.max(maxActiveRegistrations, activeRegistrations);
        await new Promise(function (resolve) { setTimeout(resolve, 5); });
        activeRegistrations -= 1;
      },
    },
  };
  const settings = core.mergeSettings();
  const utils = Object.assign({}, core, {
    safeStorageGet: async function () { return settings; },
    safeStorageSet: async function () { return true; },
    safeChromeAsync: async function (work) { return work(); },
    safeTabsQuery: async function () { return []; },
  });

  try {
    await Promise.all([
      initializeExtension(utils, "content", async function () {}),
      initializeExtension(utils, "content", async function () {}),
    ]);
    assert.equal(maxActiveRegistrations, 1);
  } finally {
    global.chrome = originalChrome;
  }
});
