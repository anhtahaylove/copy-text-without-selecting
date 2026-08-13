const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const releaseUtils = require("../scripts/lib/release-utils.cjs");

test("validateManifestData rejects Firefox-only fields in the Chrome manifest", function () {
  const errors = releaseUtils.validateManifestData({
    version: "1.0.0",
    manifest_version: 3,
    browser_specific_settings: { gecko: {} },
    background: {
      service_worker: "background.js",
      scripts: ["background.js"],
    },
    action: {
      default_popup: "popup.html",
    },
    permissions: [],
    host_permissions: [],
  }, {
    version: "1.0.1",
  });

  assert.ok(errors.some(function (error) {
    return error.includes("browser_specific_settings");
  }));
  assert.ok(errors.some(function (error) {
    return error.includes("background.scripts");
  }));
  assert.ok(errors.some(function (error) {
    return error.includes("package.json version");
  }));
});

test("getReleaseEntries includes shipped files and excludes repo-only files", function () {
  const entries = releaseUtils.getReleaseEntries();
  const relativePaths = entries.map(function (entry) {
    return entry.relativePath;
  });
  const expectedOutputPaths = releaseUtils.getExpectedChromeOutputPaths();

  assert.ok(relativePaths.includes("manifest.json"));
  assert.ok(relativePaths.includes("INSTALL.md"));
  assert.ok(relativePaths.includes("PRIVACY.md"));
  assert.ok(relativePaths.includes("popup.css"));
  assert.ok(relativePaths.includes("icons/icon-16.png"));
  assert.ok(relativePaths.includes("icons/icon-32.png"));
  assert.ok(relativePaths.includes("icons/icon-48.png"));
  assert.ok(relativePaths.includes("icons/icon-128.png"));
  assert.ok(expectedOutputPaths.includes("background.js"));
  assert.ok(expectedOutputPaths.includes("shared.js"));
  assert.ok(relativePaths.some(function (entry) {
    return entry.startsWith("_locales/") && entry.endsWith("/messages.json");
  }));
  assert.ok(!relativePaths.includes("manifest.firefox.json"));
  assert.ok(!relativePaths.some(function (entry) {
    return entry.startsWith(".omx/");
  }));
});

test("Chrome release does not request native messaging", function () {
  const manifest = releaseUtils.readJson(path.join(__dirname, "..", "manifest.json"));
  assert.ok(!manifest.permissions.includes("nativeMessaging"));
});

test("Chrome manifest defines complete extension and toolbar icon sets", function () {
  const manifest = releaseUtils.readJson(path.join(__dirname, "..", "manifest.json"));
  assert.deepEqual(Object.keys(manifest.icons).sort(), ["128", "16", "32", "48"]);
  assert.deepEqual(Object.keys(manifest.action.default_icon).sort(), ["16", "32", "48"]);

  for (const size of [16, 32, 48, 128]) {
    const iconPath = path.join(__dirname, "..", manifest.icons[String(size)]);
    const png = fs.readFileSync(iconPath);
    assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

test("createDeterministicZipFromDirectory produces stable bytes", function () {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copy-text-zip-"));
  const sourceDir = path.join(tempRoot, "source");
  const zipA = path.join(tempRoot, "a.zip");
  const zipB = path.join(tempRoot, "b.zip");

  fs.mkdirSync(path.join(sourceDir, "nested"), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "alpha.txt"), "alpha");
  fs.writeFileSync(path.join(sourceDir, "nested", "beta.txt"), "beta");

  releaseUtils.createDeterministicZipFromDirectory(sourceDir, zipA);
  releaseUtils.createDeterministicZipFromDirectory(sourceDir, zipB);

  assert.deepEqual(fs.readFileSync(zipA), fs.readFileSync(zipB));

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
