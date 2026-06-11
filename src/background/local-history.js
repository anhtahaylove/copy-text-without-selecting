const OUTBOX_KEY = "copyHistorySyncOutbox";
const OUTBOX_DB_NAME = "copyTextHistorySyncOutbox";
const OUTBOX_DB_VERSION = 1;
const OUTBOX_OPERATION_STORE = "operations";
const OUTBOX_META_STORE = "metadata";
const OUTBOX_LEGACY_MIGRATED_IDS_KEY = "legacyMigratedIds";
const SUPPORTED_OPERATION_TYPES = new Set(["upsert", "pin", "delete", "clear"]);

function createLocalHistoryController(utils, nativeBridge, options) {
  let storageQueue = Promise.resolve();
  let flushQueue = Promise.resolve();
  let nextOperationId = 1;
  let nextQueueOrder = Date.now() * 1000;
  const outboxStore = options && options.outboxStore
    ? options.outboxStore
    : createIndexedDBOutboxStore(utils);

  function enqueueStorage(work) {
    const next = storageQueue.then(work, work);
    storageQueue = next.catch(function () {});
    return next;
  }

  function enqueueFlush() {
    const next = flushQueue.then(flushOutboxInternal, flushOutboxInternal);
    flushQueue = next.catch(function () {});
    return next;
  }

  function handleRuntimeMessage(message, sender, sendResponse) {
    if (!message || typeof message.type !== "string" || !message.type.startsWith("COPY_TEXT_LOCAL_HISTORY_")) {
      return false;
    }

    const payload = message.payload || {};
    let work = null;
    if (message.type === "COPY_TEXT_LOCAL_HISTORY_ADD") {
      work = handleAdd(payload);
    } else if (message.type === "COPY_TEXT_LOCAL_HISTORY_LIST") {
      work = handleList(payload);
    } else if (message.type === "COPY_TEXT_LOCAL_HISTORY_DELETE") {
      work = handleDelete(payload);
    } else if (message.type === "COPY_TEXT_LOCAL_HISTORY_CLEAR") {
      work = handleClear(payload);
    } else if (message.type === "COPY_TEXT_LOCAL_HISTORY_PIN") {
      work = handlePin(payload);
    } else if (message.type === "COPY_TEXT_LOCAL_HISTORY_SYNC") {
      work = enqueueFlush();
    } else if (message.type === "COPY_TEXT_LOCAL_HISTORY_OUTBOX_STATUS") {
      work = handleOutboxStatus();
    }

    if (work) {
      work.then(sendResponse, function (error) {
        sendResponse({
          ok: false,
          error: {
            code: "HISTORY_OPERATION_FAILED",
            message: error && error.message ? error.message : String(error),
            recoverable: true,
          },
        });
      });
      return true;
    }

    sendResponse({
      ok: false,
      error: {
        code: "UNKNOWN_MESSAGE",
        message: "Unknown local history message.",
        recoverable: false,
      },
    });
    return false;
  }

  async function handleAdd(payload) {
    const limit = utils.normalizeCopyHistoryLimit(payload.limit);
    const entry = payload.entry || {};
    let nativeEvent = Object.assign({}, payload.nativeEvent || {});
    if (!nativeEvent.text && entry.text) {
      nativeEvent.text = entry.text;
    }
    if (!nativeEvent.createdAt && entry.createdAt) {
      nativeEvent.createdAt = entry.createdAt;
    }
    if (nativeBridge && typeof nativeBridge.normalizeClipboardEventPayload === "function") {
      nativeEvent = nativeBridge.normalizeClipboardEventPayload(nativeEvent);
    }

    const queued = await enqueueStorage(async function () {
      const state = await readState();
      const history = limit
        ? utils.pushHistoryEntry(state.copyHistory, entry, limit)
        : state.copyHistory;
      const operation = createOperation("upsert", { event: nativeEvent });
      const localOK = limit
        ? await writeLocalHistory(history)
        : true;
      const outboxOK = await appendOutboxOperation(operation);
      return {
        ok: !!(localOK || outboxOK),
        outboxOK,
        operation,
        local: limit
          ? { ok: !!localOK, stored: !!localOK, count: history.length }
          : { ok: true, stored: false, reason: "local-history-disabled" },
      };
    });

    const nativeResult = queued.outboxOK
      ? await enqueueFlush()
      : await sendOperation(queued.operation);
    const ok = !!(queued.outboxOK || (nativeResult && nativeResult.ok));

    return {
      ok,
      payload: {
        local: queued.local,
        outbox: { ok: !!queued.outboxOK },
        native: nativeResult,
      },
      error: ok ? undefined : {
        code: "HISTORY_ADD_FAILED",
        message: "Failed to store local history and forward to the companion.",
        recoverable: true,
      },
    };
  }

  async function handleList(payload) {
    const syncResult = await enqueueFlush();
    if (syncResult.ok && syncResult.pending === 0 && nativeBridge && typeof nativeBridge.listHistory === "function") {
      const nativeResponse = await nativeBridge.listHistory(payload || {});
      if (nativeResponse && nativeResponse.ok && nativeResponse.payload && Array.isArray(nativeResponse.payload.history)) {
        return {
          ok: true,
          payload: {
            history: nativeResponse.payload.history,
            mode: "companion",
            pending: 0,
          },
        };
      }
    }

    const state = await enqueueStorage(readState);
    let history = state.copyHistory;
    const query = String((payload && payload.query) || "").trim().toLowerCase();
    if (query) {
      history = history.filter(function (entry) {
        return [entry.text, entry.snippet, entry.source, entry.hostname, entry.url]
          .join(" ")
          .toLowerCase()
          .includes(query);
      });
    }
    const limit = Number((payload && payload.limit) || 0);
    if (limit > 0 && history.length > limit) {
      history = history.slice(0, limit);
    }
    return {
      ok: true,
      payload: {
        history,
        mode: "local",
        pending: state.outbox.length,
      },
    };
  }

  async function handleDelete(payload) {
    const requestedIds = Array.isArray(payload.ids)
      ? payload.ids.map(String)
      : [String(payload.id || "")];
    const ids = requestedIds.filter(Boolean);
    if (!ids.length) {
      return badPayload("history id is required.");
    }

    const queued = await enqueueStorage(async function () {
      const state = await readState();
      const textById = new Map(state.copyHistory.map(function (entry) {
        return [entry.id, entry.text];
      }));
      const explicitItems = Array.isArray(payload.items) ? payload.items : [];
      explicitItems.forEach(function (item) {
        if (item && item.id && item.text) {
          textById.set(String(item.id), String(item.text));
        }
      });
      if (payload.id && payload.text) {
        textById.set(String(payload.id), String(payload.text));
      }

      const history = utils.deleteHistoryEntries(state.copyHistory, ids);
      const localOK = await writeLocalHistory(history);
      const operations = [];
      let outboxOK = true;
      for (const id of ids) {
        const operation = createOperation("delete", {
          id,
          text: textById.get(id) || "",
        });
        operations.push(operation);
        outboxOK = (await appendOutboxOperation(operation)) && outboxOK;
      }
      return { ok: !!(localOK || outboxOK), localOK, outboxOK, operations };
    });

    const nativeResult = queued.outboxOK ? await enqueueFlush() : await sendOperations(queued.operations);
    return mutationResponse(queued.localOK, queued.outboxOK, nativeResult);
  }

  async function handleClear() {
    const queued = await enqueueStorage(async function () {
      const operation = createOperation("clear", {});
      const localOK = await writeLocalHistory([]);
      const outboxOK = await appendOutboxOperation(operation);
      return { ok: !!(localOK || outboxOK), localOK, outboxOK, operation };
    });
    const nativeResult = queued.outboxOK ? await enqueueFlush() : await sendOperation(queued.operation);
    return mutationResponse(queued.localOK, queued.outboxOK, nativeResult);
  }

  async function handlePin(payload) {
    const id = String(payload.id || "");
    if (!id) {
      return badPayload("history id is required.");
    }

    const queued = await enqueueStorage(async function () {
      const state = await readState();
      const limit = await readCopyHistoryLimit(payload.limit, state.copyHistory);
      const existing = state.copyHistory.find(function (entry) {
        return entry.id === id;
      });
      const text = String(payload.text || (existing && existing.text) || "");
      const history = utils.updateHistoryEntry(state.copyHistory, id, function (entry) {
        entry.pinned = !!payload.pinned;
        return entry;
      }, limit);
      const operation = createOperation("pin", {
        id,
        text,
        pinned: !!payload.pinned,
      });
      const localOK = await writeLocalHistory(history);
      const outboxOK = await appendOutboxOperation(operation);
      return { ok: !!(localOK || outboxOK), localOK, outboxOK, operation };
    });

    const nativeResult = queued.outboxOK ? await enqueueFlush() : await sendOperation(queued.operation);
    return mutationResponse(queued.localOK, queued.outboxOK, nativeResult);
  }

  async function readCopyHistoryLimit(value, fallbackHistory) {
    if (value !== undefined && value !== null && value !== "") {
      return utils.normalizeCopyHistoryLimit(value);
    }
    try {
      const settings = await utils.safeStorageGet("sync", utils.DEFAULT_SETTINGS || {});
      const merged = typeof utils.mergeSettings === "function"
        ? utils.mergeSettings(settings)
        : settings;
      return utils.normalizeCopyHistoryLimit(merged && merged.copyHistoryLimit);
    } catch (error) {
      const currentLength = Array.isArray(fallbackHistory) ? fallbackHistory.length : 0;
      return utils.normalizeCopyHistoryLimit(Math.max(1, currentLength));
    }
  }

  function trimLocalHistory(limit) {
    return enqueueStorage(async function () {
      const state = await readState();
      const normalizedLimit = utils.normalizeCopyHistoryLimit(limit);
      let history = utils.pushHistoryEntry(state.copyHistory, null, normalizedLimit);
      const maxBytes = 4 * 1024 * 1024;
      let serialized = JSON.stringify(history);
      while (serialized.length > maxBytes && history.length > 1) {
        let indexToRemove = -1;
        for (let index = history.length - 1; index >= 0; index -= 1) {
          if (!history[index].pinned) {
            indexToRemove = index;
            break;
          }
        }
        if (indexToRemove === -1) {
          indexToRemove = history.length - 1;
        }
        history.splice(indexToRemove, 1);
        serialized = JSON.stringify(history);
      }
      return writeLocalHistory(history);
    });
  }

  async function handleOutboxStatus() {
    const outbox = await enqueueStorage(function () {
      return outboxStore.list();
    });
    return {
      ok: true,
      payload: {
        pending: outbox.length,
        operations: outbox.map(function (operation) {
          return {
            id: operation.id,
            type: operation.type,
            createdAt: operation.createdAt,
            queueOrder: operation.queueOrder,
          };
        }),
      },
    };
  }

  async function flushOutboxInternal() {
    let synced = 0;
    let lastResponse = null;

    while (true) {
      const state = await enqueueStorage(readState);
      if (!state.outbox.length) {
        return {
          ok: true,
          synced,
          pending: 0,
          response: lastResponse,
        };
      }

      const operation = state.outbox[0];
      const response = await sendOperation(operation);
      lastResponse = response;
      if (!response || !response.ok) {
        return Object.assign({
          ok: false,
          synced,
          pending: state.outbox.length,
          response,
        }, response && response.error ? { error: response.error } : {});
      }

      const removed = await enqueueStorage(function () {
        return outboxStore.remove(operation.id);
      });
      if (!removed) {
        return {
          ok: false,
          synced,
          pending: state.outbox.length,
          response,
          error: {
            code: "OUTBOX_WRITE_FAILED",
            message: "Could not remove a synced history operation from local storage.",
            recoverable: true,
          },
        };
      }
      synced += 1;
    }
  }

  async function sendOperations(operations) {
    let last = { ok: true };
    for (const operation of operations || []) {
      last = await sendOperation(operation);
      if (!last || !last.ok) {
        return last;
      }
    }
    return last;
  }

  async function sendOperation(operation) {
    if (!operation || !nativeBridge) {
      return nativeUnavailable();
    }
    const payload = operation.payload || {};
    try {
      if (operation.type === "upsert" && typeof nativeBridge.forwardClipboardEvent === "function") {
        const event = Object.assign({}, payload.event || {}, {
          operationAt: operation.createdAt,
        });
        if (!event.createdAt) {
          event.createdAt = operation.createdAt;
        }
        return await nativeBridge.forwardClipboardEvent(event);
      }
      if (operation.type === "delete" && typeof nativeBridge.deleteHistory === "function") {
        return await nativeBridge.deleteHistory(Object.assign({}, payload, { operationAt: operation.createdAt }));
      }
      if (operation.type === "clear" && typeof nativeBridge.clearHistory === "function") {
        return await nativeBridge.clearHistory({ operationAt: operation.createdAt });
      }
      if (operation.type === "pin" && typeof nativeBridge.pinHistory === "function") {
        return await nativeBridge.pinHistory(Object.assign({}, payload, { operationAt: operation.createdAt }));
      }
      return nativeUnavailable();
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "NATIVE_FORWARD_FAILED",
          message: error && error.message ? error.message : String(error),
          recoverable: true,
        },
      };
    }
  }

  async function readState() {
    const current = await utils.safeStorageGet("local", { copyHistory: [] });
    return {
      copyHistory: Array.isArray(current.copyHistory)
        ? current.copyHistory.map(utils.normalizeHistoryEntry).filter(Boolean)
        : [],
      outbox: await outboxStore.list(),
    };
  }

  function writeLocalHistory(copyHistory) {
    return utils.safeStorageSet("local", {
      copyHistory: Array.isArray(copyHistory) ? copyHistory : [],
    });
  }

  async function appendOutboxOperation(operation) {
    try {
      if (operation.type === "clear") {
        return await outboxStore.replace([operation]);
      }
      return await outboxStore.append(operation);
    } catch (error) {
      return false;
    }
  }

  function createOperation(type, payload) {
    const createdAt = Date.now();
    nextQueueOrder = Math.max(nextQueueOrder + 1, createdAt * 1000 + nextOperationId);
    return {
      id: "history-op-" + createdAt + "-" + nextOperationId++ + "-" + Math.random().toString(16).slice(2),
      type,
      createdAt,
      queueOrder: nextQueueOrder,
      payload: payload || {},
    };
  }

  function mutationResponse(localOK, outboxOK, nativeResult) {
    const nativeOK = !!(nativeResult && nativeResult.ok);
    const ok = !!(outboxOK || nativeOK);
    return {
      ok,
      payload: {
        local: { ok: !!localOK },
        outbox: { ok: !!outboxOK },
        native: nativeResult,
      },
      error: ok ? undefined : {
        code: "HISTORY_MUTATION_FAILED",
        message: "Failed to update local history and the companion.",
        recoverable: true,
      },
    };
  }

  function badPayload(message) {
    return {
      ok: false,
      error: {
        code: "BAD_PAYLOAD",
        message,
        recoverable: false,
      },
    };
  }

  function nativeUnavailable() {
    return {
      ok: false,
      error: {
        code: "HOST_UNAVAILABLE",
        message: "Native history bridge is unavailable.",
        recoverable: true,
      },
    };
  }

  if (nativeBridge && typeof nativeBridge.setConnectedHandler === "function") {
    nativeBridge.setConnectedHandler(enqueueFlush);
  }

  return {
    handleRuntimeMessage,
    flushOutbox: enqueueFlush,
    trimHistory: trimLocalHistory,
  };
}

function createIndexedDBOutboxStore(utils) {
  let initPromise = null;
  let dbPromise = null;
  let legacyMode = false;

  async function ensureInitialized() {
    if (!initPromise) {
      initPromise = initialize().catch(function (error) {
        initPromise = null;
        throw error;
      });
    }
    return initPromise;
  }

  async function initialize() {
    const db = await openDatabase();
    if (!db) {
      legacyMode = true;
      return;
    }

    const legacy = await readLegacyOutbox();
    if (!legacy.length) {
      return;
    }

    const migratedIds = new Set(await readMeta(db, OUTBOX_LEGACY_MIGRATED_IDS_KEY, []));
    const existing = await listIDBOperations(db);
    const pendingLegacy = legacy.filter(function (operation) {
      return !migratedIds.has(operation.id);
    });
    const merged = mergeOutbox(existing.concat(pendingLegacy));
    legacy.forEach(function (operation) {
      migratedIds.add(operation.id);
    });
    await writeIDBOperationsAndMeta(db, merged, OUTBOX_LEGACY_MIGRATED_IDS_KEY, Array.from(migratedIds));
    await writeLegacyOutbox([]);
  }

  async function list() {
    await ensureInitialized();
    if (legacyMode) {
      return readLegacyOutbox();
    }
    return listIDBOperations(await openDatabase());
  }

  async function append(operation) {
    await ensureInitialized();
    const normalized = normalizeOutbox([operation])[0];
    if (!normalized) {
      return false;
    }
    if (legacyMode) {
      const current = await readLegacyOutbox();
      return writeLegacyOutbox(current.concat(normalized));
    }
    await putIDBOperation(await openDatabase(), normalized);
    return true;
  }

  async function replace(operations) {
    await ensureInitialized();
    const normalized = normalizeOutbox(operations);
    if (legacyMode) {
      return writeLegacyOutbox(normalized);
    }
    await replaceIDBOperations(await openDatabase(), normalized);
    return true;
  }

  async function remove(id) {
    await ensureInitialized();
    const operationId = String(id || "");
    if (!operationId) {
      return false;
    }
    if (legacyMode) {
      const current = await readLegacyOutbox();
      return writeLegacyOutbox(current.filter(function (operation) {
        return operation.id !== operationId;
      }));
    }
    await deleteIDBOperation(await openDatabase(), operationId);
    return true;
  }

  async function openDatabase() {
    if (legacyMode) {
      return null;
    }
    if (!dbPromise) {
      dbPromise = openOutboxDatabase(utils).catch(function () {
        legacyMode = true;
        return null;
      });
    }
    return dbPromise;
  }

  async function readLegacyOutbox() {
    const current = await utils.safeStorageGet("local", { [OUTBOX_KEY]: [] });
    return normalizeOutbox(current[OUTBOX_KEY]);
  }

  async function writeLegacyOutbox(operations) {
    return utils.safeStorageSet("local", { [OUTBOX_KEY]: normalizeOutbox(operations) });
  }

  return {
    list,
    append,
    replace,
    remove,
  };
}

function openOutboxDatabase(utils) {
  const factory = (utils && utils.indexedDB) || (typeof globalThis !== "undefined" && globalThis.indexedDB);
  if (!factory || typeof factory.open !== "function") {
    return Promise.resolve(null);
  }

  return new Promise(function (resolve, reject) {
    const request = factory.open(OUTBOX_DB_NAME, OUTBOX_DB_VERSION);
    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(OUTBOX_OPERATION_STORE)) {
        db.createObjectStore(OUTBOX_OPERATION_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(OUTBOX_META_STORE)) {
        db.createObjectStore(OUTBOX_META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = function (event) {
      resolve(event.target.result);
    };
    request.onerror = function () {
      reject(request.error || new Error("Could not open history sync outbox database."));
    };
    request.onblocked = function () {
      reject(new Error("History sync outbox database upgrade was blocked."));
    };
  });
}

async function listIDBOperations(db) {
  if (!db) {
    return [];
  }
  const tx = db.transaction([OUTBOX_OPERATION_STORE], "readonly");
  const operations = await idbRequest(tx.objectStore(OUTBOX_OPERATION_STORE).getAll());
  await idbComplete(tx);
  return normalizeOutbox(operations);
}

async function putIDBOperation(db, operation) {
  const tx = db.transaction([OUTBOX_OPERATION_STORE], "readwrite");
  await idbRequest(tx.objectStore(OUTBOX_OPERATION_STORE).put(operation));
  await idbComplete(tx);
}

async function replaceIDBOperations(db, operations) {
  const tx = db.transaction([OUTBOX_OPERATION_STORE], "readwrite");
  const store = tx.objectStore(OUTBOX_OPERATION_STORE);
  await idbRequest(store.clear());
  for (const operation of operations) {
    await idbRequest(store.put(operation));
  }
  await idbComplete(tx);
}

async function deleteIDBOperation(db, id) {
  const tx = db.transaction([OUTBOX_OPERATION_STORE], "readwrite");
  await idbRequest(tx.objectStore(OUTBOX_OPERATION_STORE).delete(id));
  await idbComplete(tx);
}

async function readMeta(db, key, fallbackValue) {
  const tx = db.transaction([OUTBOX_META_STORE], "readonly");
  const record = await idbRequest(tx.objectStore(OUTBOX_META_STORE).get(key));
  await idbComplete(tx);
  return record && Object.prototype.hasOwnProperty.call(record, "value") ? record.value : fallbackValue;
}

async function writeIDBOperationsAndMeta(db, operations, key, value) {
  const tx = db.transaction([OUTBOX_OPERATION_STORE, OUTBOX_META_STORE], "readwrite");
  const operationsStore = tx.objectStore(OUTBOX_OPERATION_STORE);
  await idbRequest(operationsStore.clear());
  for (const operation of operations) {
    await idbRequest(operationsStore.put(operation));
  }
  await idbRequest(tx.objectStore(OUTBOX_META_STORE).put({ key, value }));
  await idbComplete(tx);
}

function idbRequest(request) {
  return new Promise(function (resolve, reject) {
    request.onsuccess = function (event) {
      resolve(event.target.result);
    };
    request.onerror = function () {
      reject(request.error || new Error("IndexedDB request failed."));
    };
  });
}

function idbComplete(transaction) {
  return new Promise(function (resolve, reject) {
    transaction.oncomplete = function () {
      resolve();
    };
    transaction.onerror = function () {
      reject(transaction.error || new Error("IndexedDB transaction failed."));
    };
    transaction.onabort = function () {
      reject(transaction.error || new Error("IndexedDB transaction aborted."));
    };
  });
}

function mergeOutbox(operations) {
  const seen = new Set();
  const merged = [];
  for (const operation of normalizeOutbox(operations)) {
    if (seen.has(operation.id)) {
      continue;
    }
    seen.add(operation.id);
    if (operation.type === "clear") {
      merged.length = 0;
    }
    merged.push(operation);
  }
  return merged;
}

function normalizeOutbox(value) {
  return (Array.isArray(value) ? value : []).filter(function (operation) {
    return operation
      && operation.id
      && SUPPORTED_OPERATION_TYPES.has(operation.type)
      && Number(operation.createdAt) > 0;
  }).map(function (operation, index) {
    const createdAt = Number(operation.createdAt);
    const queueOrder = Number(operation.queueOrder) > 0
      ? Number(operation.queueOrder)
      : createdAt * 1000 + index;
    return {
      id: String(operation.id),
      type: String(operation.type),
      createdAt,
      queueOrder,
      payload: operation.payload && typeof operation.payload === "object" ? operation.payload : {},
    };
  }).sort(function (left, right) {
    if (left.queueOrder !== right.queueOrder) {
      return left.queueOrder - right.queueOrder;
    }
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    return left.id.localeCompare(right.id);
  });
}

module.exports = {
  OUTBOX_KEY,
  createIndexedDBOutboxStore,
  createLocalHistoryController,
  normalizeOutbox,
};
