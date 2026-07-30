const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/shared/core.js");
const {
  LEGACY_OUTBOX_DB_NAME,
  LEGACY_OUTBOX_KEY,
  cleanupLegacyCompanionState,
  createLocalHistoryController,
} = require("../src/background/local-history.js");

function sendRuntimeMessage(controller, message) {
  return new Promise(function (resolve) {
    controller.handleRuntimeMessage(message, {}, resolve);
  });
}

function createStorage(initial, options) {
  let state = Object.assign({ copyHistory: [] }, structuredClone(initial || {}));
  const config = options || {};
  return {
    utils: Object.assign({}, core, {
      safeStorageGet: async function (area, defaults) {
        if (config.delay) {
          await new Promise(function (resolve) { setTimeout(resolve, config.delay); });
        }
        if (area === "local") {
          return Object.assign({}, defaults, structuredClone(state));
        }
        if (area === "sync") {
          if (config.syncThrows) {
            throw new Error("sync storage unavailable");
          }
          return Object.assign({}, core.DEFAULT_SETTINGS, config.sync || {});
        }
        throw new Error("Unexpected storage area: " + area);
      },
      safeStorageSet: async function (area, value) {
        assert.equal(area, "local");
        if (config.delay) {
          await new Promise(function (resolve) { setTimeout(resolve, config.delay); });
        }
        if (config.writeFails) {
          return false;
        }
        state = Object.assign({}, state, structuredClone(value));
        return true;
      },
    }),
    read: function () {
      return structuredClone(state);
    },
  };
}

test("local history stays disabled when the configured limit is zero", async function () {
  const storage = createStorage();
  const controller = createLocalHistoryController(storage.utils);
  const response = await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: {
      limit: 0,
      entry: { text: "not stored", createdAt: 1 },
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(response.payload.local, {
    ok: true,
    stored: false,
    reason: "local-history-disabled",
  });
  assert.deepEqual(storage.read().copyHistory, []);
});

test("local history serializes concurrent writes", async function () {
  const storage = createStorage({}, { delay: 5 });
  const controller = createLocalHistoryController(storage.utils);

  await Promise.all([
    sendRuntimeMessage(controller, {
      type: "COPY_TEXT_LOCAL_HISTORY_ADD",
      payload: { limit: 10, entry: { text: "first", createdAt: 1 } },
    }),
    sendRuntimeMessage(controller, {
      type: "COPY_TEXT_LOCAL_HISTORY_ADD",
      payload: { limit: 10, entry: { text: "second", createdAt: 2 } },
    }),
  ]);

  assert.deepEqual(storage.read().copyHistory.map(function (entry) {
    return entry.text;
  }), ["second", "first"]);
});

test("history list filters and limits local entries", async function () {
  const storage = createStorage({
    copyHistory: [
      { id: "a", text: "Alpha JSON", createdAt: 3, hostname: "example.com" },
      { id: "b", text: "Beta SQL", createdAt: 2, hostname: "example.net" },
      { id: "c", text: "Gamma JSON", createdAt: 1, hostname: "example.org" },
    ],
  });
  const controller = createLocalHistoryController(storage.utils);
  const response = await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_LIST",
    payload: { query: "json", limit: 1 },
  });

  assert.equal(response.ok, true);
  assert.equal(response.payload.mode, "local");
  assert.equal(response.payload.pending, 0);
  assert.deepEqual(response.payload.history.map(function (entry) {
    return entry.text;
  }), ["Alpha JSON"]);
});

test("pin, bulk delete, and clear mutate local history", async function () {
  const storage = createStorage({
    copyHistory: [
      { id: "a", text: "Alpha", createdAt: 2 },
      { id: "b", text: "Beta", createdAt: 1 },
    ],
  }, {
    sync: { copyHistoryLimit: 9999 },
  });
  const controller = createLocalHistoryController(storage.utils);

  assert.equal((await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_PIN",
    payload: { id: "a", pinned: true },
  })).ok, true);
  assert.equal(storage.read().copyHistory.find(function (entry) {
    return entry.id === "a";
  }).pinned, true);

  assert.equal((await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_DELETE",
    payload: { ids: ["a", "b"] },
  })).ok, true);
  assert.deepEqual(storage.read().copyHistory, []);

  await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: { limit: 10, entry: { text: "new", createdAt: 3 } },
  });
  assert.equal((await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_CLEAR",
  })).ok, true);
  assert.deepEqual(storage.read().copyHistory, []);
});

test("pin keeps the current history length when sync settings are unavailable", async function () {
  const entries = Array.from({ length: 60 }, function (_, index) {
    return { id: String(index), text: "item-" + index, createdAt: 100 - index };
  });
  const storage = createStorage({ copyHistory: entries }, { syncThrows: true });
  const controller = createLocalHistoryController(storage.utils);

  const response = await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_PIN",
    payload: { id: "59", pinned: true },
  });

  assert.equal(response.ok, true);
  assert.equal(storage.read().copyHistory.length, 60);
  assert.equal(storage.read().copyHistory.find(function (entry) {
    return entry.id === "59";
  }).pinned, true);
});

test("local history reports storage write failures", async function () {
  const storage = createStorage({}, { writeFails: true });
  const controller = createLocalHistoryController(storage.utils);
  const response = await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: { limit: 10, entry: { text: "lost", createdAt: 1 } },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "HISTORY_ADD_FAILED");
  assert.equal(response.payload.local.ok, false);
});

test("upgrade cleanup removes obsolete companion outbox storage", async function () {
  const originalChrome = global.chrome;
  const removedKeys = [];
  let deletedDatabase = "";
  global.chrome = {
    runtime: { id: "test-extension" },
    storage: {
      local: {
        remove: async function (key) {
          removedKeys.push(key);
        },
      },
    },
  };

  const indexedDB = {
    deleteDatabase: function (name) {
      deletedDatabase = name;
      const request = {};
      setTimeout(function () {
        request.onsuccess();
      }, 0);
      return request;
    },
  };
  const utils = Object.assign({}, core, { indexedDB });

  try {
    const result = await cleanupLegacyCompanionState(utils);
    assert.deepEqual(result, { storageRemoved: true, databaseRemoved: true });
    assert.deepEqual(removedKeys, [LEGACY_OUTBOX_KEY]);
    assert.equal(deletedDatabase, LEGACY_OUTBOX_DB_NAME);
  } finally {
    global.chrome = originalChrome;
  }
});
