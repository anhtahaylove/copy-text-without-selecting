const path = require("node:path");
const {
  CHROME_DIST_DIR,
  PROJECT_ROOT,
  copyReleaseFiles,
  readJson,
  validateManifestData,
  verifyChromeBuildOutput,
} = require("./lib/release-utils.cjs");

function buildChrome() {
  const manifest = readJson(path.join(PROJECT_ROOT, "manifest.json"));
  const pkg = readJson(path.join(PROJECT_ROOT, "package.json"));
  const errors = validateManifestData(manifest, pkg);
  if (errors.length) {
    throw new Error(errors.join("\n"));
  }

  const expectedFiles = copyReleaseFiles(PROJECT_ROOT, CHROME_DIST_DIR);
  const verification = verifyChromeBuildOutput(CHROME_DIST_DIR, expectedFiles);
  if (verification.missing.length || verification.extras.length) {
    const messages = [];
    if (verification.missing.length) {
      messages.push("Missing files: " + verification.missing.join(", "));
    }
    if (verification.extras.length) {
      messages.push("Unexpected files: " + verification.extras.join(", "));
    }
    throw new Error(messages.join("\n"));
  }

  console.log(`Chrome build complete: ${expectedFiles.length} file(s) -> ${CHROME_DIST_DIR}`);
  return {
    outputDir: CHROME_DIST_DIR,
    files: verification.actual,
  };
}

if (require.main === module) {
  try {
    buildChrome();
  } catch (error) {
    console.error("Chrome build failed.");
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { buildChrome };
