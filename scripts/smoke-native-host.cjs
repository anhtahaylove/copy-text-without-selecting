const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const HOST_EXE = path.join(PROJECT_ROOT, "dist", "native", "copy-text-companion.exe");

async function main() {
  if (!fs.existsSync(HOST_EXE)) {
    throw new Error(`Native host executable is missing. Run npm run native:build first: ${HOST_EXE}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copy-text-native-host-"));
  const host = spawn(HOST_EXE, ["--native-messaging"], {
    env: Object.assign({}, process.env, { APPDATA: tempRoot }),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const reader = createNativeReader(host.stdout);
  const stderr = [];
  host.stderr.on("data", function (chunk) {
    stderr.push(chunk);
  });

  try {
    const ping = await request(host, reader, "PING", { extensionVersion: "test" });
    assertOk(ping, "PING");

    const stored = await request(host, reader, "CLIPBOARD_EVENT", {
      text: "{\"ok\":true}",
      source: "integration-test",
      hostname: "example.com",
    });
    assertOk(stored, "CLIPBOARD_EVENT");
    if (!stored.payload || !stored.payload.stored) {
      throw new Error("Expected CLIPBOARD_EVENT to store history.");
    }

    const listed = await request(host, reader, "HISTORY_LIST", { limit: 5 });
    assertOk(listed, "HISTORY_LIST");
    if (!listed.payload || !Array.isArray(listed.payload.history) || listed.payload.history.length !== 1) {
      throw new Error("Expected HISTORY_LIST to return one item.");
    }
  } finally {
    host.kill();
    await waitForExit(host).catch(function () {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (stderr.length) {
    const text = Buffer.concat(stderr).toString("utf8").trim();
    if (text) {
      console.warn(text);
    }
  }

  console.log("Native host smoke test passed.");
}

function waitForExit(child) {
  return new Promise(function (resolve) {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", resolve);
    setTimeout(resolve, 1500);
  });
}

function request(host, reader, type, payload) {
  const message = {
    id: `${type}-${Date.now()}`,
    version: 1,
    type,
    payload: payload || {},
  };
  host.stdin.write(encodeNativeMessage(message));
  return reader.next();
}

function encodeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(payload.length, 0);
  return Buffer.concat([length, payload]);
}

function createNativeReader(stream) {
  let buffer = Buffer.alloc(0);
  const waiters = [];

  stream.on("data", function (chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    flush();
  });

  function flush() {
    while (waiters.length && buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) {
        return;
      }
      const payload = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      waiters.shift().resolve(JSON.parse(payload.toString("utf8")));
    }
  }

  return {
    next: function () {
      return new Promise(function (resolve, reject) {
        const timer = setTimeout(function () {
          reject(new Error("Timed out waiting for native host response."));
        }, 3000);
        waiters.push({
          resolve: function (value) {
            clearTimeout(timer);
            resolve(value);
          },
        });
        flush();
      });
    },
  };
}

function assertOk(response, type) {
  if (!response || !response.ok) {
    throw new Error(`${type} failed: ${JSON.stringify(response)}`);
  }
}

if (require.main === module) {
  main().catch(function (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
