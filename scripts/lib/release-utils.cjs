const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DIST_ROOT = path.join(PROJECT_ROOT, "dist");
const CHROME_DIST_DIR = path.join(DIST_ROOT, "chrome");
const RELEASE_ARCHIVE_PREFIX = "copy-text-with-alt-click-chrome";
const RELEASE_ROOT_ENTRIES = [
  "_locales",
  "icons",
  "INSTALL.md",
  "LICENSE.txt",
  "manifest.json",
  "options.css",
  "options.html",
  "popup.css",
  "popup.html",
  "PRIVACY.md",
];
const BUNDLED_OUTPUT_FILES = [
  "background.js",
  "menu.js",
  "options.js",
  "popup.js",
  "shared.js",
];

function toPosixPath(value) {
  return String(value).split(path.sep).join("/");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateManifestData(manifest, pkg) {
  const errors = [];

  if (!manifest || typeof manifest !== "object") {
    return ["manifest.json is missing or invalid JSON."];
  }

  if (manifest.manifest_version !== 3) {
    errors.push("manifest.json must use manifest_version 3.");
  }

  if (pkg && manifest.version !== pkg.version) {
    errors.push(`manifest.json version (${manifest.version}) must match package.json version (${pkg.version}).`);
  }

  if (Object.prototype.hasOwnProperty.call(manifest, "browser_specific_settings")) {
    errors.push("manifest.json must not contain browser_specific_settings in the Chrome-only release.");
  }

  if (!manifest.background || typeof manifest.background !== "object") {
    errors.push("manifest.json must define a background object.");
  } else {
    if (typeof manifest.background.service_worker !== "string" || !manifest.background.service_worker) {
      errors.push("manifest.json background.service_worker must be a non-empty string.");
    }
    if (Object.prototype.hasOwnProperty.call(manifest.background, "scripts")) {
      errors.push("manifest.json background.scripts must not be present in the Chrome-only release.");
    }
    if (Object.prototype.hasOwnProperty.call(manifest.background, "page")) {
      errors.push("manifest.json background.page must not be present in the Chrome-only release.");
    }
  }

  if (!manifest.action || typeof manifest.action.default_popup !== "string" || !manifest.action.default_popup) {
    errors.push("manifest.json action.default_popup must be a non-empty string.");
  }

  const requiredIconSizes = ["16", "32", "48", "128"];
  if (!manifest.icons || typeof manifest.icons !== "object") {
    errors.push("manifest.json icons must define 16, 32, 48, and 128 pixel assets.");
  } else {
    for (const size of requiredIconSizes) {
      if (typeof manifest.icons[size] !== "string" || !manifest.icons[size]) {
        errors.push(`manifest.json icons.${size} must be a non-empty string.`);
      }
    }
  }

  if (!manifest.action || !manifest.action.default_icon || typeof manifest.action.default_icon !== "object") {
    errors.push("manifest.json action.default_icon must define toolbar icon assets.");
  } else {
    for (const size of ["16", "32", "48"]) {
      if (typeof manifest.action.default_icon[size] !== "string" || !manifest.action.default_icon[size]) {
        errors.push(`manifest.json action.default_icon.${size} must be a non-empty string.`);
      }
    }
  }

  if (!Array.isArray(manifest.permissions)) {
    errors.push("manifest.json permissions must be an array.");
  }

  if (!Array.isArray(manifest.host_permissions)) {
    errors.push("manifest.json host_permissions must be an array.");
  }

  return errors;
}

function ensureCleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function collectFileEntries(absolutePath, relativePath, entries) {
  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    const children = fs.readdirSync(absolutePath, { withFileTypes: true }).sort(function (left, right) {
      return left.name.localeCompare(right.name);
    });

    for (const child of children) {
      collectFileEntries(
        path.join(absolutePath, child.name),
        toPosixPath(path.join(relativePath, child.name)),
        entries
      );
    }
    return;
  }

  entries.push({
    sourcePath: absolutePath,
    relativePath: toPosixPath(relativePath),
  });
}

function getReleaseEntries(projectRoot = PROJECT_ROOT) {
  const entries = [];

  for (const relativeEntry of RELEASE_ROOT_ENTRIES) {
    const sourcePath = path.join(projectRoot, relativeEntry);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Release file is missing: ${relativeEntry}`);
    }
    collectFileEntries(sourcePath, relativeEntry, entries);
  }

  return entries.sort(function (left, right) {
    return left.relativePath.localeCompare(right.relativePath);
  });
}

function getExpectedChromeOutputPaths(projectRoot = PROJECT_ROOT) {
  const copiedEntries = getReleaseEntries(projectRoot).map(function (entry) {
    return entry.relativePath;
  });
  return copiedEntries.concat(BUNDLED_OUTPUT_FILES).sort();
}

function copyReleaseFiles(projectRoot = PROJECT_ROOT, outputDir = CHROME_DIST_DIR) {
  ensureCleanDir(outputDir);

  const entries = getReleaseEntries(projectRoot);
  for (const entry of entries) {
    const destinationPath = path.join(outputDir, entry.relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(entry.sourcePath, destinationPath);
  }

  return entries.map(function (entry) {
    return entry.relativePath;
  });
}

function listFilesRecursive(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const results = [];

  function visit(currentDir) {
    const children = fs.readdirSync(currentDir, { withFileTypes: true }).sort(function (left, right) {
      return left.name.localeCompare(right.name);
    });

    for (const child of children) {
      const absoluteChild = path.join(currentDir, child.name);
      if (child.isDirectory()) {
        visit(absoluteChild);
        continue;
      }

      results.push(toPosixPath(path.relative(rootDir, absoluteChild)));
    }
  }

  visit(rootDir);
  return results;
}

function verifyChromeBuildOutput(outputDir, expectedRelativePaths) {
  const actual = listFilesRecursive(outputDir).sort();
  const expected = Array.from(new Set(expectedRelativePaths.map(toPosixPath))).sort();

  return {
    actual,
    expected,
    missing: expected.filter(function (item) {
      return !actual.includes(item);
    }),
    extras: actual.filter(function (item) {
      return !expected.includes(item);
    }),
  };
}

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = buildCrc32Table();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createDeterministicZipFromDirectory(sourceDir, zipPath) {
  const files = listFilesRecursive(sourceDir).sort();
  const fixedDosTime = 0;
  const fixedDosDate = ((1980 - 1980) << 9) | (1 << 5) | 1;
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;

  for (const relativePath of files) {
    const absolutePath = path.join(sourceDir, relativePath);
    const nameBuffer = Buffer.from(toPosixPath(relativePath), "utf8");
    const fileBuffer = fs.readFileSync(absolutePath);
    const checksum = crc32(fileBuffer);

    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(fixedDosTime, 10);
    localHeader.writeUInt16LE(fixedDosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(fileBuffer.length, 18);
    localHeader.writeUInt32LE(fileBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuffer.copy(localHeader, 30);

    localChunks.push(localHeader, fileBuffer);

    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(fixedDosTime, 12);
    centralHeader.writeUInt16LE(fixedDosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(fileBuffer.length, 20);
    centralHeader.writeUInt32LE(fileBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    nameBuffer.copy(centralHeader, 46);
    centralChunks.push(centralHeader);

    localOffset += localHeader.length + fileBuffer.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(files.length, 8);
  endOfCentralDirectory.writeUInt16LE(files.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(localOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, Buffer.concat(localChunks.concat([centralDirectory, endOfCentralDirectory])));
  return files;
}

module.exports = {
  BUNDLED_OUTPUT_FILES,
  CHROME_DIST_DIR,
  DIST_ROOT,
  PROJECT_ROOT,
  RELEASE_ARCHIVE_PREFIX,
  RELEASE_ROOT_ENTRIES,
  copyReleaseFiles,
  createDeterministicZipFromDirectory,
  ensureCleanDir,
  getExpectedChromeOutputPaths,
  getReleaseEntries,
  listFilesRecursive,
  readJson,
  toPosixPath,
  validateManifestData,
  verifyChromeBuildOutput,
};
