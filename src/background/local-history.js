const LEGACY_OUTBOX_KEY = "copyHistorySyncOutbox";
const LEGACY_OUTBOX_DB_NAME = "copyTextHistorySyncOutbox";

function createLocalHistoryController(utils) {
  let storageQueue = Promise.resolve();

  function enqueueStorage(work) {
    const next = storageQueue.then(work, work);
    storageQueue = next.catch(function () {});
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
      work = handleClear();
    } else if (message.type === "COPY_TEXT_LOCAL_HISTORY_PIN") {
      work = handlePin(payload);
    }

    if (!work) {
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

  function handleAdd(payload) {
    const limit = utils.normalizeCopyHistoryLimit(payload.limit);
    if (!limit) {
      return Promise.resolve({
        ok: true,
        payload: {
          local: { ok: true, stored: false, reason: "local-history-disabled" },
        },
      });
    }

    return enqueueStorage(async function () {
      const history = trimHistoryToStorageBudget(
        utils.pushHistoryEntry(await readHistory(), payload.entry || {}, limit)
      );
      const stored = await writeHistory(history);
      return mutationResponse(stored, {
        stored: !!stored,
        count: history.length,
      }, "HISTORY_ADD_FAILED", "Failed to store local history.");
    });
  }

  function handleList(payload) {
    return enqueueStorage(async function () {
      let history = await readHistory();
      const query = String(payload.query || "").trim().toLowerCase();
      if (query) {
        history = history.filter(function (entry) {
          return [entry.text, entry.snippet, entry.source, entry.hostname, entry.url]
            .join(" ")
            .toLowerCase()
            .includes(query);
        });
      }

      const limit = Number(payload.limit || 0);
      if (limit > 0 && history.length > limit) {
        history = history.slice(0, limit);
      }
      return {
        ok: true,
        payload: {
          history,
          mode: "local",
          pending: 0,
        },
      };
    });
  }

  function handleDelete(payload) {
    const requestedIds = Array.isArray(payload.ids)
      ? payload.ids.map(String)
      : [String(payload.id || "")];
    const ids = requestedIds.filter(Boolean);
    if (!ids.length) {
      return Promise.resolve(badPayload("history id is required."));
    }

    return enqueueStorage(async function () {
      const history = utils.deleteHistoryEntries(await readHistory(), ids);
      return mutationResponse(
        await writeHistory(history),
        {},
        "HISTORY_DELETE_FAILED",
        "Failed to delete local history."
      );
    });
  }

  function handleClear() {
    return enqueueStorage(async function () {
      return mutationResponse(
        await writeHistory([]),
        {},
        "HISTORY_CLEAR_FAILED",
        "Failed to clear local history."
      );
    });
  }

  function handlePin(payload) {
    const id = String(payload.id || "");
    if (!id) {
      return Promise.resolve(badPayload("history id is required."));
    }

    return enqueueStorage(async function () {
      const current = await readHistory();
      const limit = await readCopyHistoryLimit(payload.limit, current.length);
      const history = utils.updateHistoryEntry(current, id, function (entry) {
        entry.pinned = !!payload.pinned;
        return entry;
      }, limit);
      return mutationResponse(
        await writeHistory(history),
        {},
        "HISTORY_PIN_FAILED",
        "Failed to update local history."
      );
    });
  }

  async function readCopyHistoryLimit(value, currentLength) {
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
      return utils.normalizeCopyHistoryLimit(Math.max(1, currentLength));
    }
  }

  function trimLocalHistory(limit) {
    return enqueueStorage(async function () {
      const normalizedLimit = utils.normalizeCopyHistoryLimit(limit);
      const history = trimHistoryToStorageBudget(
        utils.pushHistoryEntry(await readHistory(), null, normalizedLimit)
      );
      return writeHistory(history);
    });
  }

  async function readHistory() {
    const current = await utils.safeStorageGet("local", { copyHistory: [] });
    return Array.isArray(current.copyHistory)
      ? current.copyHistory.map(utils.normalizeHistoryEntry).filter(Boolean)
      : [];
  }

  function writeHistory(copyHistory) {
    return utils.safeStorageSet("local", {
      copyHistory: Array.isArray(copyHistory) ? copyHistory : [],
    });
  }

  return {
    handleRuntimeMessage,
    trimHistory: trimLocalHistory,
    cleanupLegacyCompanionState: function () {
      return cleanupLegacyCompanionState(utils);
    },
  };
}

function trimHistoryToStorageBudget(history) {
  const result = Array.isArray(history) ? history.slice() : [];
  const maxBytes = 4 * 1024 * 1024;
  let serializedBytes = new TextEncoder().encode(JSON.stringify(result)).length;
  while (serializedBytes > maxBytes && result.length > 1) {
    let indexToRemove = result.length - 1;
    for (let index = result.length - 1; index >= 0; index -= 1) {
      if (!result[index].pinned) {
        indexToRemove = index;
        break;
      }
    }
    result.splice(indexToRemove, 1);
    serializedBytes = new TextEncoder().encode(JSON.stringify(result)).length;
  }
  return result;
}

async function cleanupLegacyCompanionState(utils) {
  const storageRemoved = await utils.safeChromeAsync(async function () {
    if (!chrome.storage || !chrome.storage.local || typeof chrome.storage.local.remove !== "function") {
      return false;
    }
    await chrome.storage.local.remove(LEGACY_OUTBOX_KEY);
    return true;
  }, false);

  const factory = (utils && utils.indexedDB)
    || (typeof globalThis !== "undefined" && globalThis.indexedDB);
  if (!factory || typeof factory.deleteDatabase !== "function") {
    return { storageRemoved: !!storageRemoved, databaseRemoved: false };
  }

  const databaseRemoved = await new Promise(function (resolve, reject) {
    const request = factory.deleteDatabase(LEGACY_OUTBOX_DB_NAME);
    request.onsuccess = function () { resolve(true); };
    request.onerror = function () {
      reject(request.error || new Error("Could not remove obsolete companion sync data."));
    };
    request.onblocked = function () {
      reject(new Error("Removing obsolete companion sync data was blocked."));
    };
  });
  return { storageRemoved: !!storageRemoved, databaseRemoved };
}

function mutationResponse(stored, payload, code, message) {
  return {
    ok: !!stored,
    payload: {
      local: Object.assign({ ok: !!stored }, payload || {}),
    },
    error: stored ? undefined : {
      code,
      message,
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

module.exports = {
  LEGACY_OUTBOX_DB_NAME,
  LEGACY_OUTBOX_KEY,
  cleanupLegacyCompanionState,
  createLocalHistoryController,
  trimHistoryToStorageBudget,
};
