const HOST_NAME = "com.copy_text_without_selecting.companion";
const PROTOCOL_VERSION = 1;
const MAX_EXTENSION_EVENT_TEXT_BYTES = 512 * 1024;

function utf8CodePointBytes(codePoint) {
  if (codePoint <= 0x7F) {
    return 1;
  }
  if (codePoint <= 0x7FF) {
    return 2;
  }
  if (codePoint <= 0xFFFF) {
    return 3;
  }
  return 4;
}

function truncateUtf8Bytes(value, maxBytes) {
  const text = String(value || "");
  const limit = Math.max(0, Number(maxBytes) || 0);
  if (!limit) {
    return { text: "", truncated: text.length > 0 };
  }

  let bytes = 0;
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    const width = codePoint > 0xFFFF ? 2 : 1;
    const nextBytes = utf8CodePointBytes(codePoint);
    if (bytes + nextBytes > limit) {
      return {
        text: text.slice(0, index),
        truncated: true,
      };
    }
    bytes += nextBytes;
    index += width;
  }

  return { text, truncated: false };
}

function createNativeMessagingBridge(utils) {
  let port = null;
  let lastStatus = {
    connected: false,
    hostName: HOST_NAME,
    lastError: "",
    checkedAt: 0,
  };
  let nextRequestId = 1;
  let connectedHandler = null;
  const pending = new Map();
  const recycledPorts = new WeakSet();

  function canUseNativeMessaging() {
    return utils.isExtensionContextValid()
      && chrome.runtime
      && typeof chrome.runtime.connectNative === "function";
  }

  function connect() {
    if (port) {
      return port;
    }

    if (!canUseNativeMessaging()) {
      updateStatus(false, "nativeMessaging API is unavailable.");
      return null;
    }

    try {
      const activePort = chrome.runtime.connectNative(HOST_NAME);
      port = activePort;
      activePort.onMessage.addListener(handleHostMessage);
      activePort.onDisconnect.addListener(function () {
        handleDisconnect(activePort);
      });
      return port;
    } catch (error) {
      updateStatus(false, error && error.message ? error.message : String(error));
      port = null;
      return null;
    }
  }

  function handleDisconnect(disconnectedPort) {
    const runtimeError = chrome.runtime.lastError;
    const message = runtimeError && runtimeError.message ? runtimeError.message : "Native host disconnected.";
    const wasRecycled = disconnectedPort && recycledPorts.has(disconnectedPort);
    if (wasRecycled) {
      recycledPorts.delete(disconnectedPort);
    }
    port = null;
    if (wasRecycled && pending.size === 0) {
      return;
    }
    updateStatus(false, message);
    pending.forEach(function (request) {
      clearTimeout(request.timeoutId);
      request.resolve(createErrorResponse(request.id, "HOST_DISCONNECTED", message, true));
    });
    pending.clear();
  }

  function handleHostMessage(message) {
    if (!message || !message.id || !pending.has(message.id)) {
      return;
    }

    const request = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(request.timeoutId);
    const wasConnected = lastStatus.connected;
    updateStatus(true, "");
    if (!wasConnected) {
      notifyConnected();
    }
    request.resolve(message);
  }

  function notifyConnected() {
    if (typeof connectedHandler !== "function") {
      return;
    }
    Promise.resolve().then(function () {
      return connectedHandler();
    }).catch(function () {
      // Sync retry remains best-effort; pending operations stay in local storage.
    });
  }

  function setConnectedHandler(handler) {
    connectedHandler = typeof handler === "function" ? handler : null;
  }

  function updateStatus(connected, lastError) {
    lastStatus = {
      connected: !!connected,
      hostName: HOST_NAME,
      lastError: String(lastError || ""),
      checkedAt: Date.now(),
    };
  }

  function request(type, payload, timeoutMs) {
    const id = "ext-" + Date.now() + "-" + nextRequestId++;
    const activePort = connect();
    if (!activePort) {
      return Promise.resolve(createErrorResponse(id, "HOST_UNAVAILABLE", lastStatus.lastError || "Native host is unavailable.", true));
    }

    return new Promise(function (resolve) {
      const timeoutId = setTimeout(function () {
        if (!pending.has(id)) {
          return;
        }
        pending.delete(id);
        updateStatus(false, "Native host did not respond in time.");
        recyclePort(activePort);
        resolve(createErrorResponse(id, "HOST_TIMEOUT", "Native host did not respond in time.", true));
      }, timeoutMs || 1800);

      pending.set(id, { id: id, resolve: resolve, timeoutId: timeoutId });
      try {
        activePort.postMessage({
          id: id,
          version: PROTOCOL_VERSION,
          type: type,
          payload: payload || {},
        });
      } catch (error) {
        clearTimeout(timeoutId);
        pending.delete(id);
        updateStatus(false, error && error.message ? error.message : String(error));
        recyclePort(activePort);
        resolve(createErrorResponse(id, "HOST_SEND_FAILED", lastStatus.lastError, true));
      }
    });
  }

  function recyclePort(activePort) {
    if (port !== activePort) {
      return;
    }
    try {
      if (activePort && typeof activePort.disconnect === "function") {
        recycledPorts.add(activePort);
        activePort.disconnect();
      }
    } catch (error) {
      // The disconnect path is best-effort; status was already updated.
    }
    port = null;
  }

  function createErrorResponse(id, code, message, recoverable) {
    return {
      id: id,
      ok: false,
      error: {
        code: code,
        message: message,
        recoverable: recoverable !== false,
      },
    };
  }

  function normalizeClipboardEventPayload(payload) {
    const text = String((payload && payload.text) || "");
    const boundedText = truncateUtf8Bytes(text, MAX_EXTENSION_EVENT_TEXT_BYTES);
    return {
      source: String((payload && payload.source) || "web-extension"),
      mode: String((payload && payload.mode) || "copy"),
      text: boundedText.text,
      truncated: boundedText.truncated,
      snippet: utils.getTextSnippet(boundedText.text),
      format: utils.detectSmartFormat(boundedText.text),
      url: String((payload && payload.url) || ""),
      hostname: utils.normalizeDomain((payload && payload.hostname) || utils.getHostnameFromUrl((payload && payload.url) || "")),
      title: String((payload && payload.title) || ""),
      createdAt: Number((payload && payload.createdAt) || Date.now()),
      operationAt: Number((payload && payload.operationAt) || Date.now()),
      selectionBased: !!(payload && payload.selectionBased),
    };
  }

  function getStatus() {
    return Object.assign({}, lastStatus);
  }

  async function ping() {
    const response = await request("PING", {
      extensionVersion: chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : "",
    }, 1200);
    if (response && response.ok) {
      updateStatus(true, "");
      notifyConnected();
    }
    return response;
  }

  async function forwardClipboardEvent(payload) {
    return request("CLIPBOARD_EVENT", normalizeClipboardEventPayload(payload), 1200);
  }

  async function listHistory(payload) {
    return request("HISTORY_LIST", {
      query: String((payload && payload.query) || ""),
      limit: Number((payload && payload.limit) || 100),
    }, 1800);
  }

  async function deleteHistory(payload) {
    const text = String((payload && payload.text) || "");
    const boundedText = truncateUtf8Bytes(text, MAX_EXTENSION_EVENT_TEXT_BYTES);
    return request("HISTORY_DELETE", {
      id: String((payload && payload.id) || ""),
      text: boundedText.text,
      operationAt: Number((payload && payload.operationAt) || Date.now()),
    }, 1800);
  }

  async function clearHistory(payload) {
    return request("HISTORY_CLEAR", {
      operationAt: Number((payload && payload.operationAt) || Date.now()),
    }, 2500);
  }

  async function pinHistory(payload) {
    const text = String((payload && payload.text) || "");
    const boundedText = truncateUtf8Bytes(text, MAX_EXTENSION_EVENT_TEXT_BYTES);
    return request("HISTORY_PIN", {
      id: String((payload && payload.id) || ""),
      text: boundedText.text,
      pinned: !!(payload && payload.pinned),
      operationAt: Number((payload && payload.operationAt) || Date.now()),
    }, 1800);
  }

  async function formatPreview(payload) {
    return request("FORMAT_PREVIEW", {
      text: String((payload && payload.text) || ""),
      action: String((payload && payload.action) || ""),
    }, 1800);
  }

  async function getSettings() {
    return request("SETTINGS_GET", {}, 1800);
  }

  async function updateSettings(payload) {
    return request("SETTINGS_UPDATE", payload || {}, 1800);
  }

  async function openApp() {
    return request("OPEN_APP", {}, 1200);
  }

  function handleRuntimeMessage(message, sender, sendResponse) {
    if (!message || typeof message.type !== "string" || !message.type.startsWith("COPY_TEXT_NATIVE_")) {
      return false;
    }

    if (message.type === "COPY_TEXT_NATIVE_STATUS") {
      sendResponse({ ok: true, payload: getStatus() });
      return false;
    }

    if (message.type === "COPY_TEXT_NATIVE_PING") {
      ping().then(function (response) {
        sendResponse(response);
      });
      return true;
    }

    if (message.type === "COPY_TEXT_NATIVE_CLIPBOARD_EVENT") {
      forwardClipboardEvent(message.payload || {}).then(function (response) {
        sendResponse(response);
      });
      return true;
    }

    if (message.type === "COPY_TEXT_NATIVE_HISTORY_LIST") {
      listHistory(message.payload || {}).then(function (response) {
        sendResponse(response);
      });
      return true;
    }

    if (message.type === "COPY_TEXT_NATIVE_HISTORY_DELETE") {
      deleteHistory(message.payload || {}).then(function (response) {
        sendResponse(response);
      });
      return true;
    }

    if (message.type === "COPY_TEXT_NATIVE_HISTORY_CLEAR") {
      clearHistory(message.payload || {}).then(function (response) {
        sendResponse(response);
      });
      return true;
    }

    if (message.type === "COPY_TEXT_NATIVE_HISTORY_PIN") {
      pinHistory(message.payload || {}).then(function (response) {
        sendResponse(response);
      });
      return true;
    }

    if (message.type === "COPY_TEXT_NATIVE_FORMAT_PREVIEW") {
      formatPreview(message.payload || {}).then(function (response) {
        sendResponse(response);
      });
      return true;
    }

    if (message.type === "COPY_TEXT_NATIVE_SETTINGS_GET") {
      getSettings().then(function (response) {
        sendResponse(response);
      });
      return true;
    }

    if (message.type === "COPY_TEXT_NATIVE_SETTINGS_UPDATE") {
      updateSettings(message.payload || {}).then(function (response) {
        sendResponse(response);
      });
      return true;
    }

    if (message.type === "COPY_TEXT_NATIVE_OPEN_APP") {
      openApp().then(function (response) {
        sendResponse(response);
      });
      return true;
    }

    sendResponse(createErrorResponse("", "UNKNOWN_MESSAGE", "Unknown native bridge message.", false));
    return false;
  }

  return {
    HOST_NAME: HOST_NAME,
    setConnectedHandler: setConnectedHandler,
    getStatus: getStatus,
    normalizeClipboardEventPayload: normalizeClipboardEventPayload,
    ping: ping,
    forwardClipboardEvent: forwardClipboardEvent,
    listHistory: listHistory,
    deleteHistory: deleteHistory,
    clearHistory: clearHistory,
    pinHistory: pinHistory,
    formatPreview: formatPreview,
    getSettings: getSettings,
    updateSettings: updateSettings,
    openApp: openApp,
    handleRuntimeMessage: handleRuntimeMessage,
  };
}

module.exports = {
  HOST_NAME,
  createNativeMessagingBridge,
  truncateUtf8Bytes,
};
