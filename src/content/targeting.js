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

    if (level === SCOPE_PARAGRAPH) {
      let paragraphElement = getElementNode(textNode);
      while (paragraphElement && paragraphElement !== document.body) {
        const display = window.getComputedStyle ? window.getComputedStyle(paragraphElement).display : "";
        if (display === "block" || display === "list-item" || display === "flex" || paragraphElement.nodeName === "P" || paragraphElement.nodeName === "LI") {
          break;
        }
        paragraphElement = paragraphElement.parentElement;
      }
      if (paragraphElement && paragraphElement !== document.body) {
        return createElementTarget(paragraphElement);
      }
    }

    if (level === SCOPE_CONTAINER) {
      const container = getElementNode(textNode);
      if (container && container.parentElement && container.parentElement !== document.body && container.parentElement !== document.documentElement) {
        return createElementTarget(container.parentElement);
      }
    }

    return null;
  }

  function expandToSentence(textNode, offset) {
    const text = textNode.textContent || "";
    if (!text.trim()) {
      return null;
    }

    const sentenceBreaks = /[.!?\u3002\uff01\uff1f]+[\s]*/g;
    const sentences = [];
    let lastEnd = 0;
    let match;
    while ((match = sentenceBreaks.exec(text)) !== null) {
      sentences.push({ start: lastEnd, end: match.index + match[0].length });
      lastEnd = match.index + match[0].length;
    }
    if (lastEnd < text.length) {
      sentences.push({ start: lastEnd, end: text.length });
    }

    if (sentences.length === 0) {
      sentences.push({ start: 0, end: text.length });
    }

    let target = sentences[0];
    for (let index = 0; index < sentences.length; index += 1) {
      if (offset >= sentences[index].start && offset <= sentences[index].end) {
        target = sentences[index];
        break;
      }
    }

    const range = document.createRange();
    range.setStart(textNode, target.start);
    range.setEnd(textNode, Math.min(target.end, text.length));
    return range;
  }

  function resolvePrecisionTarget(sourceNode, options) {
    const localContext = options || {};
    const sourceElement = getElementNode(sourceNode);
    const clientX = Number.isFinite(localContext.clientX) ? localContext.clientX : hoverState.pointerClientX;
    const clientY = Number.isFinite(localContext.clientY) ? localContext.clientY : hoverState.pointerClientY;

    if (localContext.preferSelection !== false) {
      const selectionTarget = getSelectionTarget(sourceElement, clientX, clientY);
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
    return settings().avoidEditable && utils.isEditableSurface(getElementNode(node));
  }

  function getPrecisionTargetIdentity(target) {
    if (!target) {
      return null;
    }
    return target.node || target.element || target.anchor || target.table || target.container || null;
  }

  function isSamePrecisionTarget(left, right) {
    return !!left
      && !!right
      && left.kind === right.kind
      && getPrecisionTargetIdentity(left) === getPrecisionTargetIdentity(right);
  }

  function resetScopeState() {
    hoverState.scopeLevel = SCOPE_EXACT;
    hoverState.scopeAnchorClientX = null;
    hoverState.scopeAnchorClientY = null;
    hoverState.scopeBaseTarget = null;
  }

  function resolveShortcutTarget() {
    if (hoverState.hoveredElement && hoverState.hoveredElement.isConnected) {
      return hoverState.hoveredElement;
    }

    const activeElement = getDeepActiveElement(document);
    if (activeElement && activeElement !== document.body && activeElement !== document.documentElement) {
      return activeElement;
    }

    const selection = window.getSelection ? window.getSelection() : null;
    if (selection && selection.anchorNode) {
      return selection.anchorNode;
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
