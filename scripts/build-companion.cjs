const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveGo, resolveWails } = require("./lib/native-tools.cjs");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const COMPANION_ROOT = path.join(PROJECT_ROOT, "companion");
const EXTENSION_ICON = path.join(PROJECT_ROOT, "icon.png");
const COMPANION_APP_ICON_SOURCE = path.join(COMPANION_ROOT, "assets", "appicon.png");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "dist", "native");
const OUTPUT_EXE = path.join(OUTPUT_DIR, "copy-text-companion.exe");
const WAILS_APP_ICON = path.join(COMPANION_ROOT, "build", "appicon.png");
const WAILS_WINDOWS_ICON = path.join(COMPANION_ROOT, "build", "windows", "icon.ico");
const WAILS_OUTPUT_EXE = path.join(COMPANION_ROOT, "build", "bin", "copy-text-companion.exe");

function main() {
  const go = resolveGo();
  const wails = resolveWails();
  const toolEnv = createToolEnv(go, wails);
  const goVersion = spawnSync(go, ["version"], { encoding: "utf8" });
  if (goVersion.error || goVersion.status !== 0) {
    throw new Error("Go is required to build the companion native host.");
  }

  const testResult = spawnSync(go, ["test", "./..."], {
    cwd: COMPANION_ROOT,
    env: toolEnv,
    stdio: "inherit",
  });
  if (testResult.status !== 0) {
    throw new Error("Companion tests failed.");
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const wailsVersion = spawnSync(wails, ["version"], { encoding: "utf8", env: toolEnv });
  let result;
  if (!wailsVersion.error && wailsVersion.status === 0) {
    syncWailsAppIcon();
    result = spawnSync(wails, ["build", "-clean"], {
      cwd: COMPANION_ROOT,
      env: toolEnv,
      stdio: "inherit",
    });
    if (result.status === 0 && fs.existsSync(WAILS_OUTPUT_EXE)) {
      fs.copyFileSync(WAILS_OUTPUT_EXE, OUTPUT_EXE);
    }
  } else {
    console.warn("Wails CLI was not found; falling back to go build.");
    result = spawnSync(go, ["build", "-o", OUTPUT_EXE, "."], {
      cwd: COMPANION_ROOT,
      env: toolEnv,
      stdio: "inherit",
    });
  }

  if (result.status !== 0) {
    throw new Error("Companion build failed.");
  }

  console.log(`Companion build complete: ${OUTPUT_EXE}`);
}

function syncWailsAppIcon(options = {}) {
  const sourceIcon = options.sourceIcon || COMPANION_APP_ICON_SOURCE;
  const extensionIcon = options.extensionIcon || EXTENSION_ICON;
  const wailsAppIcon = options.wailsAppIcon || WAILS_APP_ICON;
  const wailsWindowsIcon = options.wailsWindowsIcon || WAILS_WINDOWS_ICON;

  if (!fs.existsSync(sourceIcon)) {
    throw new Error(`Companion app icon is missing: ${sourceIcon}`);
  }
  if (!fs.existsSync(extensionIcon)) {
    throw new Error(`Extension icon is missing: ${extensionIcon}`);
  }

  const sourceBytes = fs.readFileSync(sourceIcon);
  const extensionBytes = fs.readFileSync(extensionIcon);
  if (!sourceBytes.equals(extensionBytes)) {
    throw new Error("Companion app icon must match the extension icon.png.");
  }

  fs.mkdirSync(path.dirname(wailsAppIcon), { recursive: true });
  fs.copyFileSync(sourceIcon, wailsAppIcon);

  // Wails only regenerates the Windows .ico when it is missing.
  fs.rmSync(wailsWindowsIcon, { force: true });
}

function createToolEnv(go, wails) {
  const additions = [];
  for (const tool of [go, wails]) {
    if (tool && path.isAbsolute(tool)) {
      additions.push(path.dirname(tool));
    }
  }
  return Object.assign({}, process.env, {
    Path: additions.concat(process.env.Path || process.env.PATH || "").join(path.delimiter),
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { main, syncWailsAppIcon };
