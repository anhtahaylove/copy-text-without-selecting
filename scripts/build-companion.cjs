const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveGo, resolveWails } = require("./lib/native-tools.cjs");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const COMPANION_ROOT = path.join(PROJECT_ROOT, "companion");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "dist", "native");
const OUTPUT_EXE = path.join(OUTPUT_DIR, "copy-text-companion.exe");
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

module.exports = { main };
