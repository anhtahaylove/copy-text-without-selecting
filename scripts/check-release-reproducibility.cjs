const fs = require("node:fs");
const path = require("node:path");
const { packChrome } = require("./pack-chrome.cjs");

async function checkReleaseReproducibility() {
  const first = await packChrome();
  const firstArchive = fs.readFileSync(first.archivePath);
  const firstChecksum = fs.readFileSync(first.checksumPath, "utf8");

  const second = await packChrome();
  const secondArchive = fs.readFileSync(second.archivePath);
  const secondChecksum = fs.readFileSync(second.checksumPath, "utf8");
  const expectedChecksum = `${second.digest}  ${path.basename(second.archivePath)}\n`;

  if (!firstArchive.equals(secondArchive)) {
    throw new Error("Two consecutive Chrome release builds produced different ZIP bytes.");
  }
  if (firstChecksum !== secondChecksum || secondChecksum !== expectedChecksum) {
    throw new Error("Chrome release checksum output is not deterministic or does not match the ZIP.");
  }

  console.log(`Release reproducibility check passed: SHA-256 ${second.digest}`);
  return second;
}

if (require.main === module) {
  checkReleaseReproducibility().catch(function (error) {
    console.error("Release reproducibility check failed.");
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { checkReleaseReproducibility };
