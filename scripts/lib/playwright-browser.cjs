const fs = require("node:fs");
const { chromium } = require("@playwright/test");

function resolveBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
  ];
  const executablePath = candidates.find(function (candidate) {
    return candidate && fs.existsSync(candidate);
  });

  if (!executablePath) {
    throw new Error("No Playwright-compatible Chromium executable found. Run `npx playwright install chromium` or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.");
  }
  return executablePath;
}

module.exports = {
  chromium,
  resolveBrowserExecutable,
};
