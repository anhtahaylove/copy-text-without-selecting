const test = require("node:test");
const assert = require("node:assert/strict");
const { createContentTargeting } = require("../src/content/targeting.js");

function createTargeting() {
  return createContentTargeting({
    utils: {},
    state: { settings: {}, hoverState: {} },
  }, {
    getExtraction: function () { return {}; },
  });
}

test("sentence segmentation preserves abbreviations, decimals, and URLs", function () {
  const text = "Dr. Smith wrote this sentence. Version 2.5 is stable. Visit example.com/docs.";
  const segments = createTargeting().getSentenceSegments(text).map(function (segment) {
    return text.slice(segment.start, segment.end).trim();
  });

  assert.deepEqual(segments, [
    "Dr. Smith wrote this sentence.",
    "Version 2.5 is stable.",
    "Visit example.com/docs.",
  ]);
});
