const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { buildChrome } = require("./build-chrome.cjs");
const {
  DIST_ROOT,
  PROJECT_ROOT,
  RELEASE_ARCHIVE_PREFIX,
  createDeterministicZipFromDirectory,
  readJson,
} = require("./lib/release-utils.cjs");

async function packChrome() {
  const build = await buildChrome();
  const pkg = readJson(path.join(PROJECT_ROOT, "package.json"));
  const archivePath = path.join(DIST_ROOT, `${RELEASE_ARCHIVE_PREFIX}-v${pkg.version}.zip`);
  const packedFiles = createDeterministicZipFromDirectory(build.outputDir, archivePath);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
  const checksumPath = path.join(DIST_ROOT, "SHA256SUMS.txt");
  fs.writeFileSync(checksumPath, `${digest}  ${path.basename(archivePath)}\n`, "utf8");

  console.log(`Chrome package created: ${archivePath}`);
  console.log(`SHA-256 checksum created: ${checksumPath}`);
  console.log(`Packed ${packedFiles.length} file(s).`);
  return {
    archivePath,
    checksumPath,
    digest,
    files: packedFiles,
  };
}

if (require.main === module) {
  packChrome().catch(function (error) {
    console.error("Chrome packaging failed.");
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { packChrome };
