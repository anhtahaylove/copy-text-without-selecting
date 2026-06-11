const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HOST_NAME = "com.copy_text_without_selecting.companion";
const PROJECT_ROOT = path.resolve(__dirname, "..");
const HOST_EXE = path.join(PROJECT_ROOT, "dist", "native", "copy-text-companion.exe");
const INSTALL_ROOT = process.env.COPY_TEXT_NATIVE_INSTALL_ROOT
  ? path.resolve(process.env.COPY_TEXT_NATIVE_INSTALL_ROOT)
  : path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CopyTextWithoutSelecting");
const INSTALLED_HOST_EXE = path.join(INSTALL_ROOT, "copy-text-companion.exe");
const DEFAULT_PRODUCTION_EXTENSION_ID = "obhagoegpnbklgknnmbglghkfdidegkl";
const REGISTRY_PATHS = [
  `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
  `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
];

function main() {
  if (process.platform !== "win32") {
    throw new Error("Native host registry installation is Windows-only.");
  }

  if (!fs.existsSync(HOST_EXE)) {
    throw new Error(`Native host executable is missing. Run npm run native:build first: ${HOST_EXE}`);
  }

  const snapshot = snapshotInstallState();
  fs.mkdirSync(INSTALL_ROOT, { recursive: true });
  let manifestPath = "";
  try {
    fs.copyFileSync(HOST_EXE, INSTALLED_HOST_EXE);

    manifestPath = writeHostManifest();
    for (const registryPath of REGISTRY_PATHS) {
      runReg(["add", registryPath, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], "Registry registration failed.");
    }
  } catch (error) {
    try {
      restoreInstallState(snapshot);
    } catch (restoreError) {
      throw new Error(`${error.message || error}; rollback failed: ${restoreError.message || restoreError}`);
    }
    throw error;
  }

  console.log(`Registered ${HOST_NAME}`);
  console.log(manifestPath);
}

function writeHostManifest() {
  const installDir = path.join(INSTALL_ROOT, "NativeMessagingHosts");
  fs.mkdirSync(installDir, { recursive: true });

  const allowedOrigins = [
    `chrome-extension://${DEFAULT_PRODUCTION_EXTENSION_ID}/`,
  ];

  if (process.env.COPY_TEXT_DEV_EXTENSION_ID) {
    validateExtensionId(process.env.COPY_TEXT_DEV_EXTENSION_ID);
    allowedOrigins.push(`chrome-extension://${process.env.COPY_TEXT_DEV_EXTENSION_ID}/`);
  }

  const manifest = {
    name: HOST_NAME,
    description: "Copy Text Without Selecting native clipboard companion",
    path: INSTALLED_HOST_EXE,
    type: "stdio",
    allowed_origins: allowedOrigins,
  };

  const manifestPath = path.join(installDir, `${HOST_NAME}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

function validateExtensionId(extensionId) {
  if (!/^[a-p]{32}$/.test(String(extensionId || ""))) {
    throw new Error("COPY_TEXT_DEV_EXTENSION_ID must be a 32-character Chrome extension ID.");
  }
}

function runReg(args, message) {
  const result = spawnSync("reg", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || message).trim());
  }
  return result.stdout;
}

function snapshotInstallState() {
  const manifestPath = path.join(INSTALL_ROOT, "NativeMessagingHosts", `${HOST_NAME}.json`);
  return {
    exe: readOptionalFile(INSTALLED_HOST_EXE),
    manifest: readOptionalFile(manifestPath),
    manifestPath,
    registry: REGISTRY_PATHS.map(function (registryPath) {
      return { path: registryPath, value: readRegistryDefault(registryPath) };
    }),
  };
}

function restoreInstallState(snapshot) {
  const restoreErrors = [];
  try {
    restoreOptionalFile(INSTALLED_HOST_EXE, snapshot.exe);
  } catch (error) {
    restoreErrors.push(`restore ${INSTALLED_HOST_EXE}: ${error.message || error}`);
  }
  try {
    restoreOptionalFile(snapshot.manifestPath, snapshot.manifest);
  } catch (error) {
    restoreErrors.push(`restore ${snapshot.manifestPath}: ${error.message || error}`);
  }
  snapshot.registry.forEach(function (entry) {
    if (entry.value === null) {
      const result = spawnSync("reg", ["delete", entry.path, "/f"], { encoding: "utf8" });
      if (result.status !== 0 && !/unable to find|cannot find/i.test(result.stderr + result.stdout)) {
        restoreErrors.push((result.stderr || result.stdout || `Failed to delete ${entry.path}`).trim());
      }
      return;
    }
    const result = spawnSync("reg", ["add", entry.path, "/ve", "/t", "REG_SZ", "/d", entry.value, "/f"], { encoding: "utf8" });
    if (result.status !== 0) {
      restoreErrors.push((result.stderr || result.stdout || `Failed to restore ${entry.path}`).trim());
    }
  });
  if (restoreErrors.length) {
    throw new Error(restoreErrors.join("; "));
  }
}

function readOptionalFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

function restoreOptionalFile(filePath, contents) {
  if (contents === null) {
    fs.rmSync(filePath, { force: true });
    return;
  }
  if (fs.existsSync(filePath) && Buffer.compare(fs.readFileSync(filePath), contents) === 0) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function readRegistryDefault(registryPath) {
  const result = spawnSync("reg", ["query", registryPath, "/ve"], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  const match = result.stdout.match(/\(Default\)\s+REG_SZ\s+(.+)/);
  return match ? match[1].trim() : null;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  writeHostManifest,
  REGISTRY_PATHS,
  INSTALL_ROOT,
  INSTALLED_HOST_EXE,
  HOST_NAME,
  validateExtensionId,
  readRegistryDefault,
};
