const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const releaseUtils = require("../scripts/lib/release-utils.cjs");
const installNativeHost = require("../scripts/install-native-host-windows.cjs");

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
  assert.ok(relativePaths.includes("popup.css"));
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

test("native host installer validates unpacked Chrome extension ids", function () {
  assert.doesNotThrow(function () {
    installNativeHost.validateExtensionId("abcdefghijklmnopabcdefghijklmnop");
  });
  assert.throws(function () {
    installNativeHost.validateExtensionId("ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP");
  }, /32-character Chrome extension ID/);
  assert.throws(function () {
    installNativeHost.validateExtensionId("abcdefghijklmnopabcdefghijklmnq");
  }, /32-character Chrome extension ID/);
  assert.throws(function () {
    installNativeHost.validateExtensionId("short");
  }, /32-character Chrome extension ID/);
});
