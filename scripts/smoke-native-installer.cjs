const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const pkg = require(path.join(PROJECT_ROOT, "package.json"));
const SETUP_EXE = path.join(PROJECT_ROOT, "dist", "native", `CopyTextCompanionSetup-v${pkg.version}.exe`);
const HOST_NAME = "com.copy_text_without_selecting.companion";
const TEST_EXTENSION_ID = "pahmaphhgccgealefimmgjcfmobgofpp";
const GOOGLE_NATIVE_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
const CHROMIUM_NATIVE_KEY = `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`;
const UNINSTALL_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CopyTextWithoutSelectingCompanion";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "CopyTextCompanion";

async function main() {
  if (process.platform !== "win32") {
    console.log("Windows installer smoke skipped on non-Windows platforms.");
    return;
  }
  if (!fs.existsSync(SETUP_EXE)) {
    throw new Error(`Installer executable is missing. Run npm run native:package-installer first: ${SETUP_EXE}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copy-text-installer-smoke-"));
  const installRoot = path.join(tempRoot, "install");
  const appData = path.join(tempRoot, "appdata");
  const nativeData = path.join(tempRoot, "native-data");
  const uninstallExport = path.join(tempRoot, "uninstall.reg");
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(nativeData, { recursive: true });

  const state = captureRegistryState(uninstallExport);
  try {
    runSetup([
      "--silent",
      "--extension-id",
      TEST_EXTENSION_ID,
      "--install-root",
      installRoot,
      "--no-launch",
    ], appData);

    const installedExe = path.join(installRoot, "copy-text-companion.exe");
    const installedSetup = path.join(installRoot, "CopyTextCompanionSetup.exe");
    const manifestPath = path.join(installRoot, "NativeMessagingHosts", `${HOST_NAME}.json`);
    assertFile(installedExe, "installed companion executable");
    assertFile(installedSetup, "installed setup executable");
    assertFile(manifestPath, "native host manifest");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assertEqual(manifest.name, HOST_NAME, "manifest name");
    assertEqual(path.normalize(manifest.path), path.normalize(installedExe), "manifest path");
    assertIncludes(manifest.allowed_origins, "chrome-extension://obhagoegpnbklgknnmbglghkfdidegkl/", "production allowed origin");
    assertIncludes(manifest.allowed_origins, `chrome-extension://${TEST_EXTENSION_ID}/`, "developer allowed origin");
    assertEqual(readRegistryDefault(GOOGLE_NATIVE_KEY), manifestPath, "Google native host registry");
    assertEqual(readRegistryDefault(CHROMIUM_NATIVE_KEY), manifestPath, "Chromium native host registry");
    assertEqual(readRegistryValue(UNINSTALL_KEY, "DisplayName"), "Copy Text Companion", "uninstall DisplayName");
    assertEqual(readRegistryValue(UNINSTALL_KEY, "DisplayVersion"), pkg.version, "uninstall DisplayVersion");

    await assertNativePing(installedExe, nativeData);

    const dataDir = path.join(appData, "CopyTextWithoutSelecting");
    fs.mkdirSync(dataDir, { recursive: true });
    const marker = path.join(dataDir, "history.json");
    fs.writeFileSync(marker, "{\"preserve\":true}", "utf8");

    runSetup([
      "--uninstall",
      "--silent",
      "--install-root",
      installRoot,
    ], appData);
    assertMissing(path.join(installRoot, "copy-text-companion.exe"), "companion executable after uninstall");
    assertMissing(manifestPath, "manifest after uninstall");
    assertEqual(readRegistryDefault(GOOGLE_NATIVE_KEY), null, "Google native host registry after uninstall");
    assertEqual(readRegistryDefault(CHROMIUM_NATIVE_KEY), null, "Chromium native host registry after uninstall");
    assertFile(marker, "preserved user data marker");

    runSetup([
      "--silent",
      "--extension-id",
      TEST_EXTENSION_ID,
      "--install-root",
      installRoot,
      "--no-launch",
    ], appData);
    runSetup([
      "--uninstall",
      "--silent",
      "--install-root",
      installRoot,
      "--purge-data",
    ], appData);
    assertMissing(dataDir, "purged user data directory");

    console.log("Windows companion installer smoke passed.");
  } finally {
    restoreRegistryState(state);
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

function runSetup(args, appData) {
  const result = spawnSync(SETUP_EXE, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: Object.assign({}, process.env, { APPDATA: appData }),
  });
  if (result.status !== 0) {
    throw new Error(`Setup failed (${args.join(" ")}): ${result.stderr || result.stdout}`);
  }
}

async function assertNativePing(exePath, appData) {
  const host = spawn(exePath, ["--native-messaging"], {
    env: Object.assign({}, process.env, { APPDATA: appData }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const reader = createNativeReader(host.stdout);
  const stderr = [];
  host.stderr.on("data", function (chunk) {
    stderr.push(chunk);
  });

  try {
    host.stdin.write(encodeNativeMessage({
      id: "installer-smoke-ping",
      version: 1,
      type: "PING",
      payload: { extensionVersion: "installer-smoke" },
    }));
    const response = await reader.next();
    if (!response || !response.ok) {
      throw new Error(`PING failed: ${JSON.stringify(response)}`);
    }
  } finally {
    host.kill();
    await waitForExit(host);
  }

  const stderrText = Buffer.concat(stderr).toString("utf8").trim();
  if (stderrText) {
    console.warn(stderrText);
  }
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
        }, 5000);
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

function captureRegistryState(uninstallExport) {
  return {
    googleDefault: readRegistryDefault(GOOGLE_NATIVE_KEY),
    chromiumDefault: readRegistryDefault(CHROMIUM_NATIVE_KEY),
    runValue: readRegistryValue(RUN_KEY, RUN_VALUE),
    uninstallExport,
    uninstallExisted: exportRegistryKey(UNINSTALL_KEY, uninstallExport),
  };
}

function restoreRegistryState(state) {
  restoreRegistryDefault(GOOGLE_NATIVE_KEY, state.googleDefault);
  restoreRegistryDefault(CHROMIUM_NATIVE_KEY, state.chromiumDefault);
  restoreRegistryValue(RUN_KEY, RUN_VALUE, state.runValue);
  deleteRegistryKey(UNINSTALL_KEY);
  if (state.uninstallExisted) {
    runReg(["import", state.uninstallExport], "restore uninstall registry key");
  }
}

function exportRegistryKey(registryPath, outputPath) {
  const result = spawnSync("reg", ["export", registryPath, outputPath, "/y"], { encoding: "utf8" });
  return result.status === 0;
}

function restoreRegistryDefault(registryPath, value) {
  if (value === null) {
    deleteRegistryKey(registryPath);
    return;
  }
  runReg(["add", registryPath, "/ve", "/t", "REG_SZ", "/d", value, "/f"], `restore ${registryPath}`);
}

function restoreRegistryValue(registryPath, name, value) {
  if (value === null) {
    const result = spawnSync("reg", ["delete", registryPath, "/v", name, "/f"], { encoding: "utf8" });
    if (result.status !== 0 && !/unable to find|cannot find/i.test(result.stdout + result.stderr)) {
      throw new Error(result.stderr || result.stdout || `delete ${registryPath} ${name}`);
    }
    return;
  }
  runReg(["add", registryPath, "/v", name, "/t", "REG_SZ", "/d", value, "/f"], `restore ${registryPath} ${name}`);
}

function deleteRegistryKey(registryPath) {
  const result = spawnSync("reg", ["delete", registryPath, "/f"], { encoding: "utf8" });
  if (result.status !== 0 && !/unable to find|cannot find/i.test(result.stdout + result.stderr)) {
    throw new Error(result.stderr || result.stdout || `delete ${registryPath}`);
  }
}

function readRegistryDefault(registryPath) {
  const result = spawnSync("reg", ["query", registryPath, "/ve"], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  const match = result.stdout.match(/\(Default\)\s+REG_SZ\s+(.+)/);
  return match ? match[1].trim() : null;
}

function readRegistryValue(registryPath, name) {
  const result = spawnSync("reg", ["query", registryPath, "/v", name], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  const pattern = new RegExp(escapeRegExp(name) + String.raw`\s+REG_SZ\s+(.+)`);
  const match = result.stdout.match(pattern);
  return match ? match[1].trim() : null;
}

function runReg(args, label) {
  const result = spawnSync("reg", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${label}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Expected ${label}: ${filePath}`);
  }
}

function assertMissing(filePath, label) {
  if (fs.existsSync(filePath)) {
    throw new Error(`Expected ${label} to be removed: ${filePath}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(values, expected, label) {
  if (!Array.isArray(values) || !values.includes(expected)) {
    throw new Error(`${label}: expected ${expected}, got ${JSON.stringify(values)}`);
  }
}

if (require.main === module) {
  main().catch(function (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
