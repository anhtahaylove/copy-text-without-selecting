const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/shared/core.js");
const { createLocalHistoryController } = require("../src/background/local-history.js");

function sendRuntimeMessage(controller, message) {
  return new Promise(function (resolve) {
    controller.handleRuntimeMessage(message, {}, resolve);
  });
}

test("local history add reports failure when local and native writes both fail", async function () {
  const utils = Object.assign({}, core, {
    safeStorageGet: async function (area, defaults) {
      return Object.assign({}, defaults, { copyHistory: [], copyHistorySyncOutbox: [] });
    },
    safeStorageSet: async function () {
      return false;
    },
  });
  const nativeBridge = {
    forwardClipboardEvent: async function () {
      throw new Error("native unavailable");
    },
  };
  const controller = createLocalHistoryController(utils, nativeBridge);

  const response = await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: {
      limit: 10,
      entry: { text: "lost", createdAt: 1 },
      nativeEvent: { text: "lost" },
    },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "HISTORY_ADD_FAILED");
  assert.equal(response.payload.local.ok, false);
  assert.equal(response.payload.native.ok, false);
});

test("failed outbox operation is retained for retry", async function () {
  let state = {
    copyHistory: [],
    copyHistorySyncOutbox: [],
  };
  const utils = Object.assign({}, core, {
    safeStorageGet: async function (area, defaults) {
      return Object.assign({}, defaults, structuredClone(state));
    },
    safeStorageSet: async function (area, value) {
      state = Object.assign({}, state, structuredClone(value));
      return true;
    },
  });
  const nativeBridge = {
    setConnectedHandler: function () {},
    forwardClipboardEvent: async function () {
      return {
        ok: false,
        error: { code: "STORE_WRITE_FAILED", message: "disk full", recoverable: true },
      };
    },
  };
  const controller = createLocalHistoryController(utils, nativeBridge);

  await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: {
      limit: 10,
      entry: { id: "local-a", text: "retry me", createdAt: 1 },
      nativeEvent: { text: "retry me", createdAt: 1 },
    },
  });

  assert.equal(state.copyHistorySyncOutbox.length, 1);
  assert.equal(state.copyHistorySyncOutbox[0].type, "upsert");
});

test("local cache success does not hide failed outbox and native writes", async function () {
  let state = {
    copyHistory: [],
    copyHistorySyncOutbox: [],
  };
  const utils = Object.assign({}, core, {
    safeStorageGet: async function (area, defaults) {
      return Object.assign({}, defaults, structuredClone(state));
    },
    safeStorageSet: async function (area, value) {
      state = Object.assign({}, state, structuredClone(value));
      return true;
    },
  });
  const nativeBridge = {
    forwardClipboardEvent: async function () {
      return {
        ok: false,
        error: { code: "HOST_UNAVAILABLE", message: "offline", recoverable: true },
      };
    },
  };
  const controller = createLocalHistoryController(utils, nativeBridge, {
    outboxStore: {
      list: async function () { return []; },
      append: async function () { return false; },
      replace: async function () { return false; },
      remove: async function () { return false; },
    },
  });

  const response = await sendRuntimeMessage(controller, {
    type: "COPY_TEXT_LOCAL_HISTORY_ADD",
    payload: {
      limit: 10,
      entry: { id: "local-only", text: "not synced", createdAt: 1 },
      nativeEvent: { text: "not synced", createdAt: 1 },
    },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "HISTORY_ADD_FAILED");
  assert.equal(state.copyHistory.length, 1);
});
