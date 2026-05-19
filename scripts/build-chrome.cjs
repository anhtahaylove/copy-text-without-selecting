const esbuild = require("esbuild");
const path = require("node:path");
const {
  BUNDLED_OUTPUT_FILES,
  CHROME_DIST_DIR,
  PROJECT_ROOT,
  copyReleaseFiles,
  getExpectedChromeOutputPaths,
  readJson,
  validateManifestData,
  verifyChromeBuildOutput,
} = require("./lib/release-utils.cjs");

const ENTRY_POINTS = [
  { out: "background", in: path.join(PROJECT_ROOT, "src", "background", "index.js") },
  { out: "menu", in: path.join(PROJECT_ROOT, "src", "content", "bootstrap.js") },
  { out: "options", in: path.join(PROJECT_ROOT, "src", "options", "index.js") },
  { out: "popup", in: path.join(PROJECT_ROOT, "src", "popup", "index.js") },
  { out: "shared", in: path.join(PROJECT_ROOT, "src", "shared", "index.js") },
];

async function bundleChromeScripts(outputDir) {
  await esbuild.build({
    entryPoints: ENTRY_POINTS,
    outdir: outputDir,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome120"],
    sourcemap: false,
    write: true,
    logLevel: "silent",
    entryNames: "[name]",
  });

  return BUNDLED_OUTPUT_FILES.slice();
}

async function buildChrome() {
  const manifest = readJson(path.join(PROJECT_ROOT, "manifest.json"));
  const pkg = readJson(path.join(PROJECT_ROOT, "package.json"));
  const errors = validateManifestData(manifest, pkg);
  if (errors.length) {
    throw new Error(errors.join("\n"));
  }

  copyReleaseFiles(PROJECT_ROOT, CHROME_DIST_DIR);
  await bundleChromeScripts(CHROME_DIST_DIR);
  const verification = verifyChromeBuildOutput(CHROME_DIST_DIR, getExpectedChromeOutputPaths(PROJECT_ROOT));
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

  console.log(`Chrome build complete: ${verification.actual.length} file(s) -> ${CHROME_DIST_DIR}`);
  return {
    outputDir: CHROME_DIST_DIR,
    files: verification.actual,
  };
}

if (require.main === module) {
  buildChrome().catch(function (error) {
    console.error("Chrome build failed.");
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { buildChrome };
