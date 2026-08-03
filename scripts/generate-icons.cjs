const fs = require("node:fs");
const path = require("node:path");
const { PROJECT_ROOT } = require("./lib/release-utils.cjs");
const { chromium, resolveBrowserExecutable } = require("./lib/playwright-browser.cjs");

const ICON_SOURCE = path.join(PROJECT_ROOT, "assets", "icon.svg");
const ICON_OUTPUT_DIR = path.join(PROJECT_ROOT, "icons");
const ICON_SIZES = [16, 32, 48, 128];

async function renderIcon(browser, svgSource, size) {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: size, height: size },
  });

  try {
    const sourceUrl = `data:image/svg+xml;base64,${Buffer.from(svgSource).toString("base64")}`;
    await page.setContent([
      "<!doctype html><html><head><style>",
      `html,body{width:${size}px;height:${size}px;margin:0;overflow:hidden;background:transparent}`,
      `img{display:block;width:${size}px;height:${size}px}`,
      "</style></head><body>",
      `<img alt="" src="${sourceUrl}">`,
      "</body></html>",
    ].join(""));
    await page.locator("img").evaluate(function (image) {
      return image.decode();
    });
    await page.screenshot({
      path: path.join(ICON_OUTPUT_DIR, `icon-${size}.png`),
      omitBackground: true,
    });
  } finally {
    await page.close();
  }
}

async function main() {
  const svgSource = fs.readFileSync(ICON_SOURCE, "utf8");
  fs.mkdirSync(ICON_OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    executablePath: resolveBrowserExecutable(),
    headless: true,
  });

  try {
    for (const size of ICON_SIZES) {
      await renderIcon(browser, svgSource, size);
    }
  } finally {
    await browser.close();
  }

  console.log(`Generated ${ICON_SIZES.length} icon sizes from ${ICON_SOURCE}`);
}

if (require.main === module) {
  main().catch(function (error) {
    console.error("Icon generation failed.");
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
