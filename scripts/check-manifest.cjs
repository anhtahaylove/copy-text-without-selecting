const path = require("node:path");
const {
  PROJECT_ROOT,
  readJson,
  validateManifestData,
} = require("./lib/release-utils.cjs");

function main() {
  const manifestPath = path.join(PROJECT_ROOT, "manifest.json");
  const packagePath = path.join(PROJECT_ROOT, "package.json");
  const manifest = readJson(manifestPath);
  const pkg = readJson(packagePath);
  const errors = validateManifestData(manifest, pkg);

  if (errors.length) {
    console.error("Manifest validation failed:");
    for (const error of errors) {
      console.error(" - " + error);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Manifest validation passed.");
}

if (require.main === module) {
  main();
}

module.exports = { main };
