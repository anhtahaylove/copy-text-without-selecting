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

  console.log(`Chrome package created: ${archivePath}`);
  console.log(`Packed ${packedFiles.length} file(s).`);
  return {
    archivePath,
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
