const { createContentTargeting } = require("./targeting.js");
const { createContentExtraction } = require("./extraction.js");
const { createContentOverlay } = require("./overlay.js");
const { createContentPersistence } = require("./persistence.js");
const { createContentClipboard } = require("./clipboard.js");

function createContentHelpers(context) {
  let extraction;

  const targeting = createContentTargeting(context, {
    getExtraction: function () {
      return extraction;
    },
  });
  extraction = createContentExtraction(context, targeting);
  const overlay = createContentOverlay(context, targeting, extraction);
  const persistence = createContentPersistence(context);
  const clipboard = createContentClipboard(context, targeting, extraction, overlay, persistence);

  return Object.assign({},
    targeting,
    extraction,
    overlay,
    persistence,
    clipboard
  );
}

module.exports = {
  createContentHelpers,
};
