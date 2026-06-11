const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  HOST_NAME,
  REGISTRY_PATHS,
  INSTALL_ROOT,
  INSTALLED_HOST_EXE,
} = require("./install-native-host-windows.cjs");

function main() {
  if (process.platform !== "win32") {
    throw new Error("Native host registry removal is Windows-only.");
  }

  for (const registryPath of REGISTRY_PATHS) {
    deleteRegistryPath(registryPath);
  }

  const installDir = path.join(INSTALL_ROOT, "NativeMessagingHosts");
  const manifestPath = path.join(installDir, `${HOST_NAME}.json`);
  fs.rmSync(manifestPath, { force: true });
  fs.rmSync(INSTALLED_HOST_EXE, { force: true });
  fs.rmSync(installDir, { recursive: true, force: true });

  console.log(`Unregistered ${HOST_NAME}`);
}

function deleteRegistryPath(registryPath) {
  const result = spawnSync("reg", ["delete", registryPath, "/f"], {
    encoding: "utf8",
  });
  if (result.status !== 0 && !/unable to find|cannot find/i.test(result.stderr + result.stdout)) {
    throw new Error((result.stderr || result.stdout || `Failed to delete ${registryPath}`).trim());
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { main };
