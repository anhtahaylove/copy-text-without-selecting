const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createNativeMessagingBridge,
  truncateUtf8Bytes,
} = require("../src/background/native-messaging.js");

function createUtils() {
  return {
    isExtensionContextValid: function () { return true; },
    getTextSnippet: function (text) { return String(text || "").slice(0, 40); },
    detectSmartFormat: function (text) {
      return String(text || "").trim().startsWith("{") ? "json" : "plain";
    },
    normalizeDomain: function (value) { return String(value || "").toLowerCase(); },
    getHostnameFromUrl: function (value) {
      try {
        return new URL(value).hostname;
      } catch {
        return "";
      }
    },
  };
}

function createChromeWithNativeHost(onPostMessage) {
  let hostMessageListener = null;
  let disconnectListener = null;
  const port = {
    onMessage: {
      addListener: function (listener) {
        hostMessageListener = listener;
      },
    },
    onDisconnect: {
      addListener: function (listener) {
        disconnectListener = listener;
      },
    },
    postMessage: function (message) {
      onPostMessage(message);
      setTimeout(function () {
        hostMessageListener({
          id: message.id,
          ok: true,
          payload: {
            type: message.type,
            opened: message.type === "OPEN_APP",
          },
        });
      }, 0);
    },
    disconnect: function () {
      if (disconnectListener) {
        disconnectListener();
      }
    },
  };

  return {
    runtime: {
      id: "test-extension",
      lastError: null,
      getManifest: function () {
        return { version: "9.9.9" };
      },
      connectNative: function () {
        return port;
      },
    },
  };
}

function createChromeWithSilentNativeHost(onPostMessage) {
  let disconnectListener = null;
  let disconnected = false;
  const port = {
    onMessage: {
      addListener: function () {},
    },
    onDisconnect: {
      addListener: function (listener) {
        disconnectListener = listener;
      },
    },
    postMessage: function (message) {
      onPostMessage(message);
    },
    disconnect: function () {
      disconnected = true;
      if (disconnectListener) {
        disconnectListener();
      }
    },
  };

  return {
    get disconnected() {
      return disconnected;
    },
    chrome: {
      runtime: {
        id: "test-extension",
        lastError: null,
        getManifest: function () {
          return { version: "9.9.9" };
        },
        connectNative: function () {
          return port;
        },
      },
    },
  };
}

function sendRuntimeMessage(bridge, message) {
  return new Promise(function (resolve) {
    bridge.handleRuntimeMessage(message, {}, resolve);
  });
}

test("native bridge normalizes and bounds clipboard events before outbox persistence", function () {
  const bridge = createNativeMessagingBridge(createUtils());
  const payload = bridge.normalizeClipboardEventPayload({
    text: "x".repeat(512 * 1024 + 100),
    url: "https://Example.com/path",
  });

  assert.equal(payload.text.length, 512 * 1024);
  assert.equal(payload.truncated, true);
  assert.equal(payload.hostname, "example.com");
  assert.equal(typeof payload.operationAt, "number");
});

test("native bridge bounds clipboard text by UTF-8 bytes", function () {
  const bounded = truncateUtf8Bytes("😀".repeat(200000), 512 * 1024);
  const size = new TextEncoder().encode(bounded.text).length;

  assert.equal(bounded.truncated, true);
  assert.ok(size <= 512 * 1024);
  assert.equal(bounded.text.codePointAt(bounded.text.length - 2), 0x1F600);
});

test("native bridge routes open app messages to the companion host", async function () {
  const originalChrome = global.chrome;
  const posted = [];
  global.chrome = createChromeWithNativeHost(function (message) {
    posted.push(message);
  });

  const bridge = createNativeMessagingBridge(createUtils());
  const response = await sendRuntimeMessage(bridge, { type: "COPY_TEXT_NATIVE_OPEN_APP" });

  assert.equal(response.ok, true);
  assert.equal(response.payload.opened, true);
  assert.equal(posted[0].type, "OPEN_APP");
  assert.equal(posted[0].version, 1);

  global.chrome = originalChrome;
});

test("native bridge forwards history and settings messages", async function () {
  const originalChrome = global.chrome;
  const posted = [];
  global.chrome = createChromeWithNativeHost(function (message) {
    posted.push(message);
  });

  const bridge = createNativeMessagingBridge(createUtils());
  await sendRuntimeMessage(bridge, { type: "COPY_TEXT_NATIVE_HISTORY_LIST", payload: { query: "json", limit: 5 } });
  await sendRuntimeMessage(bridge, { type: "COPY_TEXT_NATIVE_HISTORY_DELETE", payload: { id: "a", text: "Alpha", operationAt: 10 } });
  await sendRuntimeMessage(bridge, { type: "COPY_TEXT_NATIVE_HISTORY_CLEAR" });
  await sendRuntimeMessage(bridge, { type: "COPY_TEXT_NATIVE_HISTORY_PIN", payload: { id: "a", text: "Alpha", pinned: true, operationAt: 11 } });
  await sendRuntimeMessage(bridge, { type: "COPY_TEXT_NATIVE_FORMAT_PREVIEW", payload: { text: "{\"ok\":true}", action: "prettyJson" } });
  await sendRuntimeMessage(bridge, { type: "COPY_TEXT_NATIVE_SETTINGS_GET" });
  await sendRuntimeMessage(bridge, { type: "COPY_TEXT_NATIVE_SETTINGS_UPDATE", payload: { maxItems: 20 } });

  assert.deepEqual(posted.map(function (message) { return message.type; }), [
    "HISTORY_LIST",
    "HISTORY_DELETE",
    "HISTORY_CLEAR",
    "HISTORY_PIN",
    "FORMAT_PREVIEW",
    "SETTINGS_GET",
    "SETTINGS_UPDATE",
  ]);
  assert.deepEqual(posted[0].payload, { query: "json", limit: 5 });
  assert.deepEqual(posted[1].payload, { id: "a", text: "Alpha", operationAt: 10 });
  assert.equal(typeof posted[2].payload.operationAt, "number");
  assert.deepEqual(posted[3].payload, { id: "a", text: "Alpha", pinned: true, operationAt: 11 });
  assert.deepEqual(posted[4].payload, { text: "{\"ok\":true}", action: "prettyJson" });
  assert.deepEqual(posted[6].payload, { maxItems: 20 });

  global.chrome = originalChrome;
});

test("native bridge falls back to local mode after host timeout", async function () {
  const originalChrome = global.chrome;
  const posted = [];
  const host = createChromeWithSilentNativeHost(function (message) {
    posted.push(message);
  });
  global.chrome = host.chrome;

  const bridge = createNativeMessagingBridge(createUtils());
  const response = await sendRuntimeMessage(bridge, { type: "COPY_TEXT_NATIVE_PING" });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "HOST_TIMEOUT");
  assert.equal(response.error.recoverable, true);
  assert.equal(host.disconnected, true);
  assert.equal(posted.length, 1);

  const status = bridge.getStatus();
  assert.equal(status.connected, false);
  assert.match(status.lastError, /did not respond/i);

  global.chrome = originalChrome;
});
