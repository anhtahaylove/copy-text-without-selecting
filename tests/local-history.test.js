const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/shared/core.js");
const {
  createIndexedDBOutboxStore,
  createLocalHistoryController,
} = require("../src/background/local-history.js");

function sendRuntimeMessage(controller, message) {
  return new Promise(function (resolve) {
    controller.handleRuntimeMessage(message, {}, resolve);
  });
}

function createStorage(initial) {
  const input = Object.assign({}, initial || {});
  const syncInput = Object.assign({}, input.sync || {});
  const syncThrows = !!input.syncThrows;
  delete input.sync;
  delete input.syncThrows;
  let state = Object.assign({
    copyHistory: [],
    copyHistorySyncOutbox: [],
  }, input);
  let syncState = Object.assign({}, core.DEFAULT_SETTINGS, syncInput);

  return {
    utils: Object.assign({}, core, {
      safeStorageGet: async function (area, defaults) {
        if (area === "local") {
          return Object.assign({}, defaults, structuredClone(state));
        }
        if (area === "sync") {
          if (syncThrows) {
            throw new Error("sync storage unavailable");
          }
          return Object.assign({}, defaults, structuredClone(syncState));
        }
        throw new Error("Unexpected storage area: " + area);
      },
      safeStorageSet: async function (area, value) {
        if (area === "local") {
          state = Object.assign({}, state, structuredClone(value));
          return true;
        }
        if (area === "sync") {
          syncState = Object.assign({}, syncState, structuredClone(value));
          return true;
        }
        throw new Error("Unexpected storage area: " + area);
      },
    }),
    read: function () {
      return structuredClone(state);
    },
  };
}

function createNativeBridge(options) {
  const config = options || {};
  let connected = config.connected !== false;
  let connectedHandler = null;
  const calls = [];

  async function respond(type, payload) {
    calls.push({ type, payload: structuredClone(payload || {}) });
    if (!connected) {
      return {
        ok: false,
        error: { code: "HOST_UNAVAILABLE", message: "offline", recoverable: true },
      };
    }
    return {
      ok: true,
      payload: type === "CLIPBOARD_EVENT"
        ? { stored: true, id: "native-" + payload.text }
        : {},
    };
  }

  return {
    calls,
    setConnectedHandler: function (handler) {
      connectedHandler = handler;
    },
    setConnected: async function (value) {
      connected = value;
      if (connected && connectedHandler) {
        await connectedHandler();
      }
    },
    forwardClipboardEvent: function (payload) {
      return respond("CLIPBOARD_EVENT", payload);
    },
    listHistory: async function () {
      if (!connected) {
        return {
          ok: false,
          error: { code: "HOST_UNAVAILABLE", message: "offline", recoverable: true },
        };
      }
      return {
        ok: true,
        payload: {
          history: config.nativeHistory || [],
        },
      };
    },
    deleteHistory: function (payload) {
      return respond("HISTORY_DELETE", payload);
    },
    clearHistory: function (payload) {
      return respond("HISTORY_CLEAR", payload);
    },
    pinHistory: function (payload) {
      return respond("HISTORY_PIN", payload);
    },
  };
}

function createFakeIndexedDB() {
  const databases = new Map();

  function clone(value) {
    return value === undefined ? value : structuredClone(value);
  }

  function createRequest(executor, transaction) {
    const request = {};
    if (transaction) {
      transaction.pending += 1;
    }
    setTimeout(function () {
      try {
        request.result = executor();
        if (request.onsuccess) {
          request.onsuccess({ target: request });
        }
      } catch (error) {
        request.error = error;
        if (request.onerror) {
          request.onerror({ target: request });
        }
        if (transaction && transaction.onerror) {
          transaction.onerror({ target: transaction });
        }
      } finally {
        if (transaction) {
          transaction.pending -= 1;
          transaction.scheduleComplete();
        }
      }
    }, 0);
    return request;
  }

  function createTransaction(state) {
    let completeHandler = null;
    const transaction = {
      pending: 0,
      error: null,
      onerror: null,
      onabort: null,
      objectStore: function (name) {
        if (!state.stores.has(name)) {
          state.stores.set(name, new Map());
        }
        const records = state.stores.get(name);
        return {
          getAll: function () {
            return createRequest(function () {
              return Array.from(records.values()).map(clone);
            }, transaction);
          },
          get: function (key) {
            return createRequest(function () {
              return clone(records.get(key));
            }, transaction);
          },
          put: function (record) {
            return createRequest(function () {
              const key = record.id || record.key;
              records.set(key, clone(record));
              return key;
            }, transaction);
          },
          clear: function () {
            return createRequest(function () {
              records.clear();
              return undefined;
            }, transaction);
          },
          delete: function (key) {
            return createRequest(function () {
              records.delete(key);
              return undefined;
            }, transaction);
          },
        };
      },
      scheduleComplete: function () {
        if (transaction.pending !== 0 || !completeHandler) {
          return;
        }
        setTimeout(function () {
          if (transaction.pending === 0 && completeHandler) {
            completeHandler({ target: transaction });
          }
        }, 0);
      },
    };
    Object.defineProperty(transaction, "oncomplete", {
      get: function () {
        return completeHandler;
      },
      set: function (handler) {
        completeHandler = handler;
        transaction.scheduleComplete();
      },
    });
    return transaction;
  }

  function createDatabase(state) {
    return {
      objectStoreNames: {
        contains: function (name) {
          return state.stores.has(name);
        },
      },
      createObjectStore: function (name) {
        if (!state.stores.has(name)) {
          state.stores.set(name, new Map());
        }
      },
      transaction: function () {
        return createTransaction(state);
      },
    };
  }

  return {
    open: function (name) {
      const request = {};
      setTimeout(function () {
        let state = databases.get(name);
        const needsUpgrade = !state;
        if (!state) {
          state = { stores: new Map() };
          databases.set(name, state);
        }
        request.result = createDatabase(state);
        if (needsUpgrade && request.onupgradeneeded) {
          request.onupgradeneeded({ target: request });
        }
        if (request.onsuccess) {
          request.onsuccess({ target: request });
        }
      }, 0);
      return request;
    },
  };
}

test("local history add still forwards native event when local history is disabled", async function () {
  const storage = createStorage();
  const nativeBridge = createNativeBridge();
  const controller = createLocalHistoryController(storage.utils, nativeBridge);

  const response = await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: {
      limit: 0,
      entry: { text: "local", createdAt: 1 },
      nativeEvent: { text: "native", source: "web-extension" },
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(response.payload.local, {
    ok: true,
    stored: false,
    reason: "local-history-disabled",
  });
  assert.equal(response.payload.native.ok, true);
  const forwarded = structuredClone(nativeBridge.calls);
  assert.equal(typeof forwarded[0].payload.operationAt, "number");
  delete forwarded[0].payload.operationAt;
  assert.deepEqual(forwarded, [{
    type: "CLIPBOARD_EVENT",
    payload: { text: "native", source: "web-extension", createdAt: 1 },
  }]);
  assert.deepEqual(storage.read().copyHistorySyncOutbox, []);
});

test("local history add serializes storage updates", async function () {
  let copyHistory = [];
  let outbox = [];
  const utils = Object.assign({}, core, {
    safeStorageGet: async function (area, defaults) {
      await new Promise(function (resolve) { setTimeout(resolve, 5); });
      return Object.assign({}, defaults, {
        copyHistory: copyHistory.slice(),
        copyHistorySyncOutbox: structuredClone(outbox),
      });
    },
    safeStorageSet: async function (area, value) {
      assert.equal(area, "local");
      await new Promise(function (resolve) { setTimeout(resolve, 5); });
      if (value.copyHistory) {
        copyHistory = value.copyHistory.slice();
      }
      if (value.copyHistorySyncOutbox) {
        outbox = structuredClone(value.copyHistorySyncOutbox);
      }
      return true;
    },
  });
  const nativeBridge = createNativeBridge();
  const controller = createLocalHistoryController(utils, nativeBridge);

  const first = sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: {
      limit: 10,
      entry: { text: "first", createdAt: 1 },
      nativeEvent: { text: "first" },
    },
  });
  const second = sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: {
      limit: 10,
      entry: { text: "second", createdAt: 2 },
      nativeEvent: { text: "second" },
    },
  });

  const responses = await Promise.all([first, second]);

  assert.equal(responses[0].ok, true);
  assert.equal(responses[1].ok, true);
  assert.deepEqual(copyHistory.map(function (entry) { return entry.text; }), ["second", "first"]);
  assert.deepEqual(nativeBridge.calls.filter(function (call) {
    return call.type === "CLIPBOARD_EVENT";
  }).map(function (call) {
    return call.payload.text;
  }).sort(), ["first", "second"]);
});

test("offline add remains queued and flushes after reconnect", async function () {
  const storage = createStorage();
  const nativeBridge = createNativeBridge({ connected: false });
  const controller = createLocalHistoryController(storage.utils, nativeBridge);

  const response = await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: {
      limit: 10,
      entry: { id: "local-a", text: "offline item", createdAt: 10 },
      nativeEvent: { text: "offline item", createdAt: 10 },
    },
  });

  assert.equal(response.ok, true);
  assert.equal(response.payload.native.ok, false);
  assert.equal(storage.read().copyHistorySyncOutbox.length, 1);

  await nativeBridge.setConnected(true);

  assert.deepEqual(nativeBridge.calls.map(function (call) { return call.type; }), [
    "CLIPBOARD_EVENT",
    "CLIPBOARD_EVENT",
  ]);
  assert.deepEqual(storage.read().copyHistorySyncOutbox, []);
});

test("offline pin and delete operations flush in FIFO order with text fallback", async function () {
  const storage = createStorage({
    copyHistory: [
      { id: "local-a", text: "keep pinned", createdAt: 2 },
      { id: "local-b", text: "remove later", createdAt: 1 },
    ],
  });
  const nativeBridge = createNativeBridge({ connected: false });
  const controller = createLocalHistoryController(storage.utils, nativeBridge);

  await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_PIN",
    payload: { id: "local-a", pinned: true },
  });
  await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_DELETE",
    payload: { id: "local-b" },
  });

  const offlineState = storage.read();
  assert.equal(offlineState.copyHistory[0].pinned, true);
  assert.deepEqual(offlineState.copyHistory.map(function (entry) { return entry.text; }), ["keep pinned"]);
  assert.deepEqual(offlineState.copyHistorySyncOutbox.map(function (op) { return op.type; }), ["pin", "delete"]);

  await nativeBridge.setConnected(true);

  const syncedCalls = nativeBridge.calls.filter(function (call) {
    return call.type !== "CLIPBOARD_EVENT";
  }).slice(-2);
  assert.deepEqual(syncedCalls, [
    {
      type: "HISTORY_PIN",
      payload: { id: "local-a", text: "keep pinned", pinned: true, operationAt: syncedCalls[0].payload.operationAt },
    },
    {
      type: "HISTORY_DELETE",
      payload: { id: "local-b", text: "remove later", operationAt: syncedCalls[1].payload.operationAt },
    },
  ]);
  assert.deepEqual(storage.read().copyHistorySyncOutbox, []);
});

test("offline pin preserves configured local history limit above default", async function () {
  const entries = Array.from({ length: 30 }, function (_, index) {
    return {
      id: "item-" + index,
      text: "Item " + index,
      createdAt: 100 - index,
    };
  });
  const storage = createStorage({
    copyHistory: entries,
    sync: { copyHistoryLimit: 30 },
  });
  const nativeBridge = createNativeBridge({ connected: false });
  const controller = createLocalHistoryController(storage.utils, nativeBridge);

  const response = await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_PIN",
    payload: { id: "item-29", pinned: true },
  });

  assert.equal(response.ok, true);
  assert.equal(storage.read().copyHistory.length, 30);
  assert.equal(storage.read().copyHistory.find(function (entry) {
    return entry.id === "item-29";
  }).pinned, true);
});

test("offline pin does not trim local history when sync settings read fails", async function () {
  const entries = Array.from({ length: 30 }, function (_, index) {
    return {
      id: "item-" + index,
      text: "Item " + index,
      createdAt: 100 - index,
    };
  });
  const storage = createStorage({
    copyHistory: entries,
    syncThrows: true,
  });
  const nativeBridge = createNativeBridge({ connected: false });
  const controller = createLocalHistoryController(storage.utils, nativeBridge);

  const response = await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_PIN",
    payload: { id: "item-29", pinned: true },
  });

  assert.equal(response.ok, true);
  assert.equal(storage.read().copyHistory.length, 30);
  assert.equal(storage.read().copyHistory.find(function (entry) {
    return entry.id === "item-29";
  }).pinned, true);
});

test("newer pin and upsert operations remain ordered after offline mutations", async function () {
  const storage = createStorage({
    copyHistory: [{ id: "local-a", text: "ordered item", createdAt: 1 }],
  });
  const nativeBridge = createNativeBridge({ connected: false });
  const controller = createLocalHistoryController(storage.utils, nativeBridge);

  await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_PIN",
    payload: { id: "local-a", pinned: true },
  });
  await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_PIN",
    payload: { id: "local-a", pinned: false },
  });
  await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_DELETE",
    payload: { id: "local-a" },
  });
  await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: {
      limit: 10,
      entry: { id: "local-a-new", text: "ordered item", createdAt: 5 },
      nativeEvent: { text: "ordered item", createdAt: 5 },
    },
  });

  await nativeBridge.setConnected(true);

  const successfulCalls = nativeBridge.calls.slice(-4);
  assert.deepEqual(successfulCalls.map(function (call) { return call.type; }), [
    "HISTORY_PIN",
    "HISTORY_PIN",
    "HISTORY_DELETE",
    "CLIPBOARD_EVENT",
  ]);
  assert.equal(successfulCalls[0].payload.pinned, true);
  assert.equal(successfulCalls[1].payload.pinned, false);
  assert.deepEqual(storage.read().copyHistorySyncOutbox, []);
});

test("clear drops older pending operations but preserves operations created afterward", async function () {
  const storage = createStorage();
  const nativeBridge = createNativeBridge({ connected: false });
  const controller = createLocalHistoryController(storage.utils, nativeBridge);

  await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: {
      limit: 10,
      entry: { id: "old", text: "old item", createdAt: 1 },
      nativeEvent: { text: "old item", createdAt: 1 },
    },
  });
  await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_CLEAR",
  });
  await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: {
      limit: 10,
      entry: { id: "new", text: "new item", createdAt: 3 },
      nativeEvent: { text: "new item", createdAt: 3 },
    },
  });

  assert.deepEqual(storage.read().copyHistorySyncOutbox.map(function (op) { return op.type; }), ["clear", "upsert"]);

  await nativeBridge.setConnected(true);

  const successfulCalls = nativeBridge.calls.slice(-2);
  assert.deepEqual(successfulCalls.map(function (call) { return call.type; }), ["HISTORY_CLEAR", "CLIPBOARD_EVENT"]);
  assert.equal(successfulCalls[1].payload.text, "new item");
  assert.deepEqual(storage.read().copyHistorySyncOutbox, []);
});

test("history list uses Companion while connected and local fallback while offline", async function () {
  const localEntry = { id: "local", text: "local item", createdAt: 1 };
  const nativeEntry = { id: "native", text: "native item", createdAt: 2 };
  const storage = createStorage({ copyHistory: [localEntry] });
  const nativeBridge = createNativeBridge({ nativeHistory: [nativeEntry] });
  const controller = createLocalHistoryController(storage.utils, nativeBridge);

  const connected = await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_LIST",
    payload: { limit: 10 },
  });
  assert.equal(connected.ok, true);
  assert.equal(connected.payload.mode, "companion");
  assert.deepEqual(connected.payload.history, [nativeEntry]);

  await nativeBridge.setConnected(false);
  const offline = await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_LIST",
    payload: { limit: 10 },
  });
  assert.equal(offline.ok, true);
  assert.equal(offline.payload.mode, "local");
  assert.equal(offline.payload.history[0].text, "local item");
});

test("history trimming shares the storage queue and preserves pending operations", async function () {
  const pending = {
    id: "pending-1",
    type: "delete",
    createdAt: 1,
    payload: { id: "a", text: "A" },
  };
  const storage = createStorage({
    copyHistory: [
      { id: "a", text: "A", createdAt: 3 },
      { id: "b", text: "B", createdAt: 2 },
      { id: "c", text: "C", createdAt: 1 },
    ],
    copyHistorySyncOutbox: [pending],
  });
  const controller = createLocalHistoryController(storage.utils, createNativeBridge({ connected: false }));

  await controller.trimHistory(1);

  assert.deepEqual(storage.read().copyHistory.map(function (entry) { return entry.text; }), ["A"]);
  assert.deepEqual(storage.read().copyHistorySyncOutbox, [pending]);
});

test("IndexedDB outbox migrates legacy storage and keeps new operations out of chrome storage", async function () {
  const legacy = {
    id: "legacy-delete",
    type: "delete",
    createdAt: 10,
    payload: { id: "a", text: "A" },
  };
  const storage = createStorage({ copyHistorySyncOutbox: [legacy] });
  storage.utils.indexedDB = createFakeIndexedDB();
  const outboxStore = createIndexedDBOutboxStore(storage.utils);

  assert.deepEqual((await outboxStore.list()).map(function (op) { return op.id; }), ["legacy-delete"]);
  assert.deepEqual(storage.read().copyHistorySyncOutbox, []);

  await outboxStore.append({
    id: "new-upsert",
    type: "upsert",
    createdAt: 20,
    payload: { event: { text: "B" } },
  });

  assert.deepEqual(storage.read().copyHistorySyncOutbox, []);
  assert.deepEqual((await outboxStore.list()).map(function (op) { return op.id; }), ["legacy-delete", "new-upsert"]);

  await outboxStore.remove("legacy-delete");
  assert.deepEqual((await outboxStore.list()).map(function (op) { return op.id; }), ["new-upsert"]);
});

test("IndexedDB outbox stores bounded large pending payloads without using chrome storage outbox", async function () {
  const storage = createStorage();
  storage.utils.indexedDB = createFakeIndexedDB();
  const outboxStore = createIndexedDBOutboxStore(storage.utils);
  const nativeBridge = createNativeBridge({ connected: false });
  nativeBridge.normalizeClipboardEventPayload = function (payload) {
    const text = String(payload.text || "");
    return {
      text: text.slice(0, 512 * 1024),
      truncated: text.length > 512 * 1024,
      createdAt: Number(payload.createdAt || 1),
      source: "web-extension",
    };
  };
  const controller = createLocalHistoryController(storage.utils, nativeBridge, { outboxStore });

  const response = await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: {
      limit: 0,
      entry: { id: "large", text: "x".repeat(512 * 1024 + 128), createdAt: 50 },
      nativeEvent: { text: "x".repeat(512 * 1024 + 128), createdAt: 50 },
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(storage.read().copyHistorySyncOutbox, []);
  const pending = await outboxStore.list();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].payload.event.text.length, 512 * 1024);
  assert.equal(pending[0].payload.event.truncated, true);
});
