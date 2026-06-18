const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveGo } = require("./lib/native-tools.cjs");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const COMPANION_ROOT = path.join(PROJECT_ROOT, "companion");
const INSTALLER_ROOT = path.join(COMPANION_ROOT, "installer");
const PAYLOAD_EXE = path.join(INSTALLER_ROOT, "payload", "copy-text-companion.exe");
const NATIVE_EXE = path.join(PROJECT_ROOT, "dist", "native", "copy-text-companion.exe");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "dist", "native");
const pkg = require(path.join(PROJECT_ROOT, "package.json"));
const OUTPUT_EXE = path.join(OUTPUT_DIR, `CopyTextCompanionSetup-v${pkg.version}.exe`);

function main() {
  if (process.platform !== "win32") {
    throw new Error("Windows installer packaging must run on Windows.");
  }
  if (!fs.existsSync(NATIVE_EXE)) {
    throw new Error(`Companion executable is missing. Run npm run native:build first: ${NATIVE_EXE}`);
  }

  const go = resolveGo();
  const goVersion = spawnSync(go, ["version"], { encoding: "utf8" });
  if (goVersion.error || goVersion.status !== 0) {
    throw new Error("Go is required to package the Windows installer.");
  }

  fs.mkdirSync(path.dirname(PAYLOAD_EXE), { recursive: true });
  fs.copyFileSync(NATIVE_EXE, PAYLOAD_EXE);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  try {
    run(go, ["test", "./installer"], COMPANION_ROOT, "Installer unit tests failed.");
    const commit = gitCommit();
    run(go, [
      "build",
      "-trimpath",
      "-ldflags",
      `-X main.version=${pkg.version} -X main.commit=${commit}`,
      "-o",
      OUTPUT_EXE,
      "./installer",
    ], COMPANION_ROOT, "Installer build failed.");
  } finally {
    fs.rmSync(PAYLOAD_EXE, { force: true });
  }

  console.log(`Windows companion installer complete: ${OUTPUT_EXE}`);
}

function run(command, args, cwd, errorMessage) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: Object.assign({}, process.env),
  });
  if (result.status !== 0) {
    throw new Error(errorMessage);
  }
}

function gitCommit() {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return "unknown";
  }
  return result.stdout.trim() || "unknown";
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
  OUTPUT_EXE,
};
