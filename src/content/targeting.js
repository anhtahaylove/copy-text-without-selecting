function createContentTargeting(context, dependencies) {
  const utils = context.utils;
  const hoverState = context.state.hoverState;

  const SCOPE_EXACT = 0;
  const SCOPE_SENTENCE = 1;
  const SCOPE_PARAGRAPH = 2;
  const SCOPE_CONTAINER = 3;

  function settings() {
    return context.state.settings;
  }

  function extraction() {
    return dependencies.getExtraction();
  }

  function pierceShadowDOM(element, x, y) {
    if (!element) {
      return element;
    }
    const root = element.shadowRoot;
    if (!root) {
      return element;
    }
    const deeper = root.elementFromPoint(x, y);
    if (!deeper || deeper === element) {
      return element;
    }
    return pierceShadowDOM(deeper, x, y);
  }

  function syncPointerState(event) {
    hoverState.pointerPageX = event.pageX;
    hoverState.pointerPageY = event.pageY;
    hoverState.pointerClientX = event.clientX;
    hoverState.pointerClientY = event.clientY;
  }

  function resolveScopedTarget(sourceNode, clientX, clientY, level) {
    if (level <= SCOPE_EXACT) {
      return null;
    }

    const caretRange = getCaretRangeAtPoint(clientX, clientY);
    if (!caretRange) {
      return null;
    }

    const textNode = caretRange.startContainer;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      return null;
    }

    if (level === SCOPE_SENTENCE) {
      const sentenceRange = expandToSentence(textNode, caretRange.startOffset);
      if (sentenceRange) {
        return {
          kind: "scope",
          node: textNode,
          range: sentenceRange,
          rect: getRangeBoundingRect(sentenceRange),
          text: sentenceRange.toString().trim(),
        };
      }
    }

    const paragraphElement = findScopeParagraphElement(textNode);
    if (level === SCOPE_PARAGRAPH) {
      if (paragraphElement && paragraphElement !== document.body) {
        return createScopeElementTarget(paragraphElement, SCOPE_PARAGRAPH);
      }
    }

    if (level === SCOPE_CONTAINER) {
      const container = paragraphElement && paragraphElement.parentElement;
      if (container && container !== document.body && container !== document.documentElement) {
        return createScopeElementTarget(container, SCOPE_CONTAINER);
      }
    }

    return null;
  }

  function expandToSentence(textNode, offset) {
    const paragraphElement = findScopeParagraphElement(textNode) || getElementNode(textNode);
    const textNodes = getVisibleTextNodes(paragraphElement);
    const targetNodeIndex = textNodes.indexOf(textNode);
    if (targetNodeIndex < 0) {
      return null;
    }

    const text = textNodes.map(function (node) { return node.textContent || ""; }).join("");
    if (!text.trim()) {
      return null;
    }

    const absoluteOffset = textNodes.slice(0, targetNodeIndex).reduce(function (total, node) {
      return total + String(node.textContent || "").length;
    }, 0) + Math.min(Math.max(0, offset), String(textNode.textContent || "").length);

    const sentences = getSentenceSegments(text);

    let target = sentences[0];
    for (let index = 0; index < sentences.length; index += 1) {
      const sentence = sentences[index];
      const includesOffset = absoluteOffset >= sentence.start
        && (absoluteOffset < sentence.end || (index === sentences.length - 1 && absoluteOffset === sentence.end));
      if (includesOffset) {
        target = sentences[index];
        break;
      }
    }

    const startBoundary = getTextBoundary(textNodes, target.start, false);
    const endBoundary = getTextBoundary(textNodes, Math.min(target.end, text.length), true);
    if (!startBoundary || !endBoundary) {
      return null;
    }

    const range = document.createRange();
    range.setStart(startBoundary.node, startBoundary.offset);
    range.setEnd(endBoundary.node, endBoundary.offset);
    return range;
  }

  function getSentenceSegments(text) {
    let sentences = [];
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
      sentences = Array.from(segmenter.segment(text)).map(function (segment) {
        return { start: segment.index, end: segment.index + segment.segment.length };
      });
    } else {
      const sentenceBreaks = /[.!?\u3002\uff01\uff1f]+(?:\s+|$)/g;
      let lastEnd = 0;
      let match;
      while ((match = sentenceBreaks.exec(text)) !== null) {
        sentences.push({ start: lastEnd, end: match.index + match[0].length });
        lastEnd = match.index + match[0].length;
      }
      if (lastEnd < text.length) {
        sentences.push({ start: lastEnd, end: text.length });
      }
    }

    if (!sentences.length) {
      sentences.push({ start: 0, end: text.length });
    }

    return mergeAbbreviationSegments(text, sentences);
  }

  function mergeAbbreviationSegments(text, sentences) {
    return sentences.reduce(function (merged, sentence) {
      const previous = merged[merged.length - 1];
      if (previous && endsWithNonTerminalAbbreviation(text.slice(previous.start, previous.end))) {
        previous.end = sentence.end;
        return merged;
      }
      merged.push({ start: sentence.start, end: sentence.end });
      return merged;
    }, []);
  }

  function endsWithNonTerminalAbbreviation(value) {
    const trimmed = String(value || "").trim();
    return /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|No)\.|\b(?:e\.g|i\.e)\.|(?:\b[A-Z]\.){2,})$/i.test(trimmed);
  }

  function findScopeParagraphElement(node) {
    let element = getElementNode(node);
    while (element && element !== document.body && element !== document.documentElement) {
      const display = window.getComputedStyle ? window.getComputedStyle(element).display : "";
      if (element.nodeName === "P" || element.nodeName === "LI" || display === "block" || display === "list-item" || display === "flex" || display === "grid") {
        return element;
      }
      element = element.parentElement;
    }
    return null;
  }

  function getVisibleTextNodes(root) {
    if (!root) {
      return [];
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        return isNodeVisible(node) && String(node.textContent || "").length
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current);
      current = walker.nextNode();
    }
    return nodes;
  }

  function getTextBoundary(textNodes, absoluteOffset, isEnd) {
    let consumed = 0;
    for (let index = 0; index < textNodes.length; index += 1) {
      const node = textNodes[index];
      const length = String(node.textContent || "").length;
      const next = consumed + length;
      if (absoluteOffset < next || (isEnd && absoluteOffset <= next) || index === textNodes.length - 1) {
        return { node: node, offset: Math.min(length, Math.max(0, absoluteOffset - consumed)) };
      }
      consumed = next;
    }
    return null;
  }

  function createScopeElementTarget(element, level) {
    return {
      kind: "scope",
      node: element,
      rect: element.getBoundingClientRect ? element.getBoundingClientRect() : null,
      text: extraction().collectVisibleText(element).trim(),
      scopeLevel: level,
    };
  }

  function resolvePrecisionTarget(sourceNode, options) {
    const localContext = options || {};
    const sourceElement = getElementNode(sourceNode);
    const clientX = Number.isFinite(localContext.clientX) ? localContext.clientX : hoverState.pointerClientX;
    const clientY = Number.isFinite(localContext.clientY) ? localContext.clientY : hoverState.pointerClientY;

    if (localContext.preferSelection !== false) {
      const selectionTarget = getSelectionTarget(
        sourceElement,
        localContext.ignoreSelectionPointer ? null : clientX,
        localContext.ignoreSelectionPointer ? null : clientY
      );
      if (selectionTarget) {
        return selectionTarget;
      }
    }

    const requestedScopeLevel = Number.isFinite(localContext.scopeLevel) ? localContext.scopeLevel : hoverState.scopeLevel;
    const scopeClientX = hoverState.scopeAnchorClientX !== null ? hoverState.scopeAnchorClientX : clientX;
    const scopeClientY = hoverState.scopeAnchorClientY !== null ? hoverState.scopeAnchorClientY : clientY;
    if (requestedScopeLevel > SCOPE_EXACT) {
      const scopedTarget = resolveScopedTarget(sourceElement, scopeClientX, scopeClientY, requestedScopeLevel);
      if (scopedTarget) {
        return scopedTarget;
      }
    }

    const fallbackElement = getDeepElementTarget(sourceElement, clientX, clientY);
    const semanticElement = extraction().getClosestSemanticElement(fallbackElement);
    const deepTextTarget = semanticElement ? null : getDeepTextTarget(clientX, clientY);
    const preliminaryTarget = deepTextTarget || createElementTarget(semanticElement || fallbackElement);
    if (!preliminaryTarget) {
      return null;
    }

    const extractionContext = extraction().resolveExtractionContext(preliminaryTarget);
    if (!extractionContext) {
      return preliminaryTarget;
    }

    switch (extractionContext.kind) {
      case "selection":
      case "scope":
        return extractionContext;
      case "table":
        return { kind: "table", table: extractionContext.table, rect: extractionContext.table.getBoundingClientRect(), node: extractionContext.table };
      case "code":
        return { kind: "code", container: extractionContext.container, rect: extractionContext.container.getBoundingClientRect(), node: extractionContext.container };
      case "list":
        return { kind: "list", container: extractionContext.container, rect: extractionContext.container.getBoundingClientRect(), node: extractionContext.container };
      case "link":
        return { kind: "link", anchor: extractionContext.anchor, rect: extractionContext.anchor.getBoundingClientRect(), node: extractionContext.anchor };
      case "action":
        if (!extractionContext.label) {
          return null;
        }
        return {
          kind: "action",
          element: extractionContext.element,
          label: extractionContext.label,
          labelSource: extractionContext.labelSource,
          rect: extractionContext.element.getBoundingClientRect(),
          node: extractionContext.element,
        };
      case "image":
        return { kind: "image", element: extractionContext.element, rect: extractionContext.element.getBoundingClientRect(), node: extractionContext.element };
      case "control":
        return { kind: "control", element: extractionContext.element, rect: extractionContext.element.getBoundingClientRect(), node: extractionContext.element };
      case "text": {
        let rect = null;
        if (extractionContext.node && extractionContext.node.nodeType === Node.TEXT_NODE) {
          const textRange = document.createRange();
          textRange.selectNodeContents(extractionContext.node);
          rect = getRangeBoundingRect(textRange);
        } else if (extractionContext.node && extractionContext.node.getBoundingClientRect) {
          rect = extractionContext.node.getBoundingClientRect();
        }
        return { kind: "text", node: extractionContext.node, rect: rect || preliminaryTarget.rect };
      }
      default:
        return preliminaryTarget;
    }
  }

  function getSelectionTarget(sourceElement, clientX, clientY) {
    const selection = window.getSelection ? window.getSelection() : null;
    if (selection && selection.rangeCount && !selection.isCollapsed) {
      const selectionText = String(selection.toString() || "").trim();
      if (selectionText) {
        const range = selection.getRangeAt(0).cloneRange();
        const rect = getRangeBoundingRect(range);
        const commonNode = selection.anchorNode || range.commonAncestorContainer;
        if ((!Number.isFinite(clientX) || !Number.isFinite(clientY)) || isPointInsideRect(rect, clientX, clientY) || (sourceElement && commonNode && sourceElement.contains(getElementNode(commonNode)))) {
          return {
            kind: "selection",
            range: range,
            rect: rect,
            text: selectionText,
            node: commonNode,
          };
        }
      }
    }

    const activeElement = getDeepActiveElement(document);
    if (activeElement && (activeElement.nodeName == "INPUT" || activeElement.nodeName == "TEXTAREA")) {
      const start = typeof activeElement.selectionStart == "number" ? activeElement.selectionStart : 0;
      const end = typeof activeElement.selectionEnd == "number" ? activeElement.selectionEnd : 0;
      if (end > start) {
        const selectedText = String(activeElement.value || "").slice(start, end).trim();
        if (selectedText && (!sourceElement || sourceElement === activeElement || activeElement.contains(sourceElement))) {
          return {
            kind: "selection",
            rect: activeElement.getBoundingClientRect(),
            text: selectedText,
            node: activeElement,
          };
        }
      }
    }

    return null;
  }

  function getDeepTextTarget(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return null;
    }

    const range = getCaretRangeAtPoint(clientX, clientY);
    if (!range) {
      return null;
    }

    const node = range.startContainer;
    if (node && node.nodeType == Node.TEXT_NODE && String(node.textContent || "").trim() && isNodeVisible(node)) {
      const textRange = document.createRange();
      textRange.selectNodeContents(node);
      return {
        kind: "text",
        node: node,
        rect: getRangeBoundingRect(textRange),
      };
    }

    return null;
  }

  function getDeepElementTarget(sourceElement, clientX, clientY) {
    const element = Number.isFinite(clientX) && Number.isFinite(clientY)
      ? pierceShadowDOM(document.elementFromPoint(clientX, clientY), clientX, clientY)
      : sourceElement;
    return getClosestMeaningfulElement(element || sourceElement);
  }

  function getCaretRangeAtPoint(clientX, clientY) {
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(clientX, clientY);
      if (position && position.offsetNode) {
        if (position.offsetNode.nodeType !== Node.TEXT_NODE && position.offset > position.offsetNode.childNodes.length) {
          return null;
        }

        const range = document.createRange();
        try {
          range.setStart(position.offsetNode, position.offset);
          range.setEnd(position.offsetNode, position.offset);
          return range;
        } catch (error) {
          return null;
        }
      }
    }

    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(clientX, clientY);
    }

    return null;
  }

  function getClosestMeaningfulElement(element) {
    const initialElement = getElementNode(element);
    const semanticElement = extraction().getClosestSemanticElement(initialElement);
    if (semanticElement) {
      return semanticElement;
    }

    if (isGraphicOnlyTarget(initialElement)) {
      return null;
    }

    let current = initialElement;
    while (current) {
      const tagName = current.nodeName.toUpperCase();
      if (hasMeaningfulText(current) || tagName == "IMG" || tagName == "INPUT" || tagName == "TEXTAREA" || tagName == "SELECT") {
        return current;
      }
      current = extraction().getComposedParentElement(current);
    }
    return null;
  }

  function isGraphicOnlyTarget(element) {
    let current = element;
    while (current) {
      const tagName = current.nodeName.toUpperCase();
      if (["SVG", "PATH", "CIRCLE", "ELLIPSE", "G", "LINE", "POLYGON", "POLYLINE", "RECT", "USE"].includes(tagName)) {
        return true;
      }
      if (String(current.textContent || "").trim()) {
        return false;
      }
      current = current.parentElement;
    }
    return false;
  }

  function createElementTarget(element) {
    if (!element) {
      return null;
    }

    return {
      kind: "element",
      node: element,
      rect: element.getBoundingClientRect ? element.getBoundingClientRect() : null,
    };
  }

  function hasMeaningfulText(node) {
    if (!node) {
      return false;
    }
    if (node.nodeType == Node.TEXT_NODE) {
      return String(node.textContent || "").trim().length > 0;
    }
    if (node.nodeType != Node.ELEMENT_NODE) {
      return false;
    }
    const semanticElement = extraction().getClosestSemanticElement(node);
    if (semanticElement === node && extraction().resolveExtractionContext(createElementTarget(node)).kind == "action") {
      return !!extraction().getAccessibleActionLabel(node).text;
    }
    if (node.nodeName.toUpperCase() == "IMG") {
      return !!extraction().getImageText(node);
    }
    return extraction().collectVisibleText(node).length > 0;
  }

  function isNodeVisible(node) {
    let current = getElementNode(node);
    if (!current) {
      return false;
    }

    while (current) {
      if (current.hidden || current.getAttribute("aria-hidden") == "true") {
        return false;
      }
      const style = window.getComputedStyle ? window.getComputedStyle(current) : null;
      if (style && (style.display == "none" || style.visibility == "hidden")) {
        return false;
      }
      current = extraction().getComposedParentElement(current);
    }
    return true;
  }

  function getRangeBoundingRect(range) {
    if (!range) {
      return null;
    }

    const rects = Array.from(range.getClientRects ? range.getClientRects() : []).filter(function (rect) {
      return rect.width > 0 && rect.height > 0;
    });
    if (!rects.length) {
      const fallback = range.getBoundingClientRect ? range.getBoundingClientRect() : null;
      return fallback && fallback.width > 0 && fallback.height > 0 ? fallback : null;
    }

    return rects.reduce(function (acc, current) {
      if (!acc) {
        return {
          left: current.left,
          top: current.top,
          right: current.right,
          bottom: current.bottom,
          width: current.width,
          height: current.height,
        };
      }

      const left = Math.min(acc.left, current.left);
      const top = Math.min(acc.top, current.top);
      const right = Math.max(acc.right, current.right);
      const bottom = Math.max(acc.bottom, current.bottom);
      return {
        left: left,
        top: top,
        right: right,
        bottom: bottom,
        width: right - left,
        height: bottom - top,
      };
    }, null);
  }

  function isPointInsideRect(rect, clientX, clientY) {
    if (!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return false;
    }
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function shouldIgnoreElement(node) {
    if (!settings().avoidEditable) {
      return false;
    }
    let element = getElementNode(node);
    while (element) {
      if (utils.isEditableSurface(element)) {
        return true;
      }
      element = extraction().getComposedParentElement(element);
    }
    return false;
  }

  function getPrecisionTargetIdentity(target) {
    if (!target) {
      return null;
    }
    if (target.kind === "text" || target.kind === "element") {
      return findScopeParagraphElement(target.node) || target.node || null;
    }
    return target.node || target.element || target.anchor || target.table || target.container || null;
  }

  function isSamePrecisionTarget(left, right) {
    return !!left
      && !!right
      && left.kind === right.kind
      && getPrecisionTargetIdentity(left) === getPrecisionTargetIdentity(right);
  }

  function doesTargetContain(containerTarget, innerTarget) {
    const containerRange = getTargetRange(containerTarget);
    const innerRange = getTargetRange(innerTarget);
    if (!containerRange || !innerRange) {
      return false;
    }

    return containerRange.compareBoundaryPoints(Range.START_TO_START, innerRange) <= 0
      && containerRange.compareBoundaryPoints(Range.END_TO_END, innerRange) >= 0;
  }

  function getTargetRange(target) {
    if (!target) {
      return null;
    }
    if (target.range && typeof target.range.cloneRange === "function") {
      return target.range.cloneRange();
    }

    const node = target.node || target.element || target.anchor || target.table || target.container;
    if (!node) {
      return null;
    }

    const range = document.createRange();
    try {
      range.selectNodeContents(node);
      return range;
    } catch (error) {
      return null;
    }
  }

  function resetScopeState() {
    hoverState.scopeLevel = SCOPE_EXACT;
    hoverState.scopeAnchorClientX = null;
    hoverState.scopeAnchorClientY = null;
    hoverState.scopeBaseTarget = null;
  }

  function resolveShortcutTarget() {
    const selection = window.getSelection ? window.getSelection() : null;
    if (selection && selection.rangeCount && !selection.isCollapsed && String(selection.toString() || "").trim()) {
      return selection.anchorNode || selection.getRangeAt(0).commonAncestorContainer;
    }

    const activeElement = getDeepActiveElement(document);
    if (activeElement && (activeElement.nodeName == "INPUT" || activeElement.nodeName == "TEXTAREA")) {
      const start = typeof activeElement.selectionStart == "number" ? activeElement.selectionStart : 0;
      const end = typeof activeElement.selectionEnd == "number" ? activeElement.selectionEnd : 0;
      if (end > start) {
        return activeElement;
      }
    }
    if (activeElement && activeElement !== document.body && activeElement !== document.documentElement) {
      return activeElement;
    }

    if (hoverState.hoveredElement && hoverState.hoveredElement.isConnected) {
      return hoverState.hoveredElement;
    }

    return null;
  }

  function getDeepActiveElement(root) {
    let activeElement = root && root.activeElement;
    while (activeElement && activeElement.shadowRoot && activeElement.shadowRoot.activeElement) {
      activeElement = activeElement.shadowRoot.activeElement;
    }
    return activeElement || null;
  }

  function getNativeCopiedText() {
    const activeElement = getDeepActiveElement(document);
    if (activeElement && (activeElement.nodeName == "INPUT" || activeElement.nodeName == "TEXTAREA")) {
      const start = typeof activeElement.selectionStart == "number" ? activeElement.selectionStart : 0;
      const end = typeof activeElement.selectionEnd == "number" ? activeElement.selectionEnd : 0;
      const value = String(activeElement.value || "");
      if (end > start) {
        return value.slice(start, end).trim();
      }
    }

    const selection = window.getSelection ? window.getSelection() : null;
    return selection ? String(selection.toString() || "").trim() : "";
  }

  function getElementNode(node) {
    if (!node) {
      return null;
    }

    if (node.nodeType == Node.TEXT_NODE) {
      return node.parentNode;
    }

    return node.nodeType == Node.ELEMENT_NODE ? node : null;
  }

  return {
    SCOPE_EXACT,
    SCOPE_SENTENCE,
    SCOPE_PARAGRAPH,
    SCOPE_CONTAINER,
    pierceShadowDOM,
    syncPointerState,
    resolveScopedTarget,
    expandToSentence,
    getSentenceSegments,
    findScopeParagraphElement,
    getVisibleTextNodes,
    getTextBoundary,
    createScopeElementTarget,
    resolvePrecisionTarget,
    getSelectionTarget,
    getDeepTextTarget,
    getDeepElementTarget,
    getCaretRangeAtPoint,
    getClosestMeaningfulElement,
    createElementTarget,
    hasMeaningfulText,
    isNodeVisible,
    getRangeBoundingRect,
    isPointInsideRect,
    shouldIgnoreElement,
    getPrecisionTargetIdentity,
    isSamePrecisionTarget,
    doesTargetContain,
    resetScopeState,
    resolveShortcutTarget,
    getDeepActiveElement,
    getNativeCopiedText,
    getElementNode,
  };
}

module.exports = {
  createContentTargeting,
};
