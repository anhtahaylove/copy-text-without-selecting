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

test("fallback sentence segmentation handles closing punctuation", function () {
  const text = '"First sentence." Next sentence. [Third sentence!] Last sentence?';
  const segments = createTargeting().getSentenceSegments(text, true).map(function (segment) {
    return text.slice(segment.start, segment.end).trim();
  });

  assert.deepEqual(segments, [
    '"First sentence."',
    "Next sentence.",
    "[Third sentence!]",
    "Last sentence?",
  ]);
});

test("cross-root containment compares explicit text slice offsets before synthetic ranges", function () {
  const targeting = createTargeting();
  const lightNode = { textContent: "First sentence. Target" };
  const shadowNode = { textContent: " continues." };
  const partialSentence = {
    textSlices: [
      { node: lightNode, startOffset: 16, endOffset: 22 },
      { node: shadowNode, startOffset: 0, endOffset: 11 },
    ],
  };
  const exactTarget = {
    textSlices: [{ node: lightNode, startOffset: 0, endOffset: 22 }],
  };
  const fullParagraph = {
    textSlices: [
      { node: lightNode, startOffset: 0, endOffset: 22 },
      { node: shadowNode, startOffset: 0, endOffset: 11 },
    ],
  };

  assert.equal(targeting.doesTargetContain(partialSentence, exactTarget), false);
  assert.equal(targeting.doesTargetContain(fullParagraph, exactTarget), true);
  assert.equal(targeting.doesTargetContain(fullParagraph, partialSentence), true);
});
