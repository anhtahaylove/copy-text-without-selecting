const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { resolveGo } = require("./lib/native-tools.cjs");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const COMPANION_ROOT = path.join(PROJECT_ROOT, "companion");

function main() {
  const go = resolveGo();
  const goVersion = spawnSync(go, ["version"], { encoding: "utf8" });
  if (goVersion.error || goVersion.status !== 0) {
    throw new Error("Go is required to test the companion.");
  }

  const result = spawnSync(go, ["test", "./..."], {
    cwd: COMPANION_ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Companion tests failed.");
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
