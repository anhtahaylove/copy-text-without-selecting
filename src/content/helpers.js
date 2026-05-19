function createContentHelpers(context) {
  const utils = context.utils;
  const hoverState = context.state.hoverState;

  const SCOPE_WORD = 0;
  const SCOPE_SENTENCE = 1;
  const SCOPE_PARAGRAPH = 2;
  const SCOPE_CONTAINER = 3;

  function settings() {
    return context.state.settings;
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
    if (level <= SCOPE_WORD) {
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

    const fullText = textNode.textContent || "";

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

    const sentenceBreaks = /[.!?ã€‚ï¼ï¼Ÿ]+[\s]*/g;
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

    const scopeClientX = hoverState.scopeAnchorClientX !== null ? hoverState.scopeAnchorClientX : clientX;
    const scopeClientY = hoverState.scopeAnchorClientY !== null ? hoverState.scopeAnchorClientY : clientY;
    if (hoverState.scopeLevel > SCOPE_WORD) {
      const scopedTarget = resolveScopedTarget(sourceElement, scopeClientX, scopeClientY, hoverState.scopeLevel);
      if (scopedTarget) {
        return scopedTarget;
      }
    }

    const deepTextTarget = getDeepTextTarget(clientX, clientY);
    const fallbackElement = getDeepElementTarget(sourceElement, clientX, clientY);
    const preliminaryTarget = deepTextTarget || createElementTarget(fallbackElement);
    if (!preliminaryTarget) {
      return null;
    }

    const extractionContext = resolveExtractionContext(preliminaryTarget);
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

    const activeElement = document.activeElement;
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
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.setEnd(position.offsetNode, position.offset);
        return range;
      }
    }

    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(clientX, clientY);
    }

    return null;
  }

  function getClosestMeaningfulElement(element) {
    let current = getElementNode(element);
    while (current) {
      if (hasMeaningfulText(current) || current.nodeName.toUpperCase() == "IMG" || current.nodeName.toUpperCase() == "INPUT" || current.nodeName.toUpperCase() == "TEXTAREA" || current.nodeName.toUpperCase() == "SELECT") {
        return current;
      }
      current = current.parentElement;
    }
    return getElementNode(element);
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
    if (node.nodeName.toUpperCase() == "IMG") {
      return !!getImageText(node);
    }
    return collectVisibleText(node).length > 0;
  }

  function isNodeVisible(node) {
    const element = getElementNode(node);
    if (!element) {
      return false;
    }
    if (element.hidden || element.getAttribute("aria-hidden") == "true") {
      return false;
    }
    const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
    if (style && (style.display == "none" || style.visibility == "hidden")) {
      return false;
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

  function shouldShowPreview() {
    return settings().previewEnabled
      && hoverState.previewModifierActive
      && !context.isCurrentHostExcluded()
      && !!hoverState.hoveredElement
      && hoverState.hoveredElement.isConnected
      && !shouldIgnoreElement(hoverState.hoveredElement);
  }

  function schedulePreviewUpdate() {
    if (!shouldShowPreview()) {
      hidePreview();
      return;
    }

    if (hoverState.previewAnimationFrame) {
      return;
    }

    hoverState.previewAnimationFrame = window.requestAnimationFrame(function () {
      hoverState.previewAnimationFrame = 0;
      renderPreview();
    });
  }

  function renderPreview() {
    if (!shouldShowPreview()) {
      hidePreview();
      return;
    }

    const precisionTarget = resolvePrecisionTarget(hoverState.hoveredElement, {
      clientX: hoverState.pointerClientX,
      clientY: hoverState.pointerClientY,
      preferSelection: true,
    });
    if (!precisionTarget || !precisionTarget.rect) {
      hidePreview();
      return;
    }

    const rect = precisionTarget.rect;
    if (!hasRenderableRect(rect)) {
      hidePreview();
      return;
    }

    hoverState.lastRenderedTarget = precisionTarget;

    const overlayState = getOverlayState();
    positionOverlayBox(overlayState.preview, rect, 2);
    overlayState.preview.classList.add("visible");

    const scopeLabels = ["", "Sentence", "Paragraph", "Container"];
    if (hoverState.scopeLevel > 0 && hoverState.scopeLevel < scopeLabels.length) {
      overlayState.scopeBadge.textContent = scopeLabels[hoverState.scopeLevel];
      overlayState.scopeBadge.style.display = "block";
      const previewTop = parseFloat(overlayState.preview.style.top) || 0;
      const previewLeft = parseFloat(overlayState.preview.style.left) || 0;
      overlayState.scopeBadge.style.top = (previewTop - 22) + "px";
      overlayState.scopeBadge.style.left = previewLeft + "px";
    } else {
      overlayState.scopeBadge.style.display = "none";
    }

    const textLength = getText(precisionTarget).length;
    if (textLength > 3000) {
      overlayState.warnBadge.textContent = "⚠ " + Math.round(textLength / 1000) + "k chars";
      overlayState.warnBadge.style.display = "block";
      const previewTop = parseFloat(overlayState.preview.style.top) || 0;
      const previewLeft = parseFloat(overlayState.preview.style.left) || 0;
      const previewWidth = parseFloat(overlayState.preview.style.width) || 0;
      overlayState.warnBadge.style.top = (previewTop - 22) + "px";
      overlayState.warnBadge.style.left = (previewLeft + previewWidth - 80) + "px";
    } else {
      overlayState.warnBadge.style.display = "none";
    }
  }

  function hidePreview() {
    if (hoverState.previewAnimationFrame) {
      window.cancelAnimationFrame(hoverState.previewAnimationFrame);
      hoverState.previewAnimationFrame = 0;
    }

    if (!context.state.overlayState) {
      hoverState.lastRenderedTarget = null;
      return;
    }

    hoverState.lastRenderedTarget = null;
    context.state.overlayState.preview.classList.remove("visible");
    context.state.overlayState.scopeBadge.style.display = "none";
    context.state.overlayState.warnBadge.style.display = "none";
  }

  function getText(target) {
    const extractionContext = resolveExtractionContext(target);
    if (!extractionContext) {
      return "";
    }

    let raw;
    switch (extractionContext.kind) {
      case "selection":
        raw = extractionContext.text;
        break;
      case "scope":
        raw = extractionContext.text || collectVisibleText(extractionContext.node).trim();
        break;
      case "table":
        raw = extractTableAsTsv(extractionContext.table);
        break;
      case "code":
        raw = extractCodeText(extractionContext.container);
        break;
      case "list":
        raw = extractListAsText(extractionContext.container);
        break;
      case "image":
        raw = getImageText(extractionContext.element);
        break;
      case "link":
        raw = "[" + (collectVisibleText(extractionContext.anchor).trim() || extractionContext.anchor.href) + "](" + extractionContext.anchor.href + ")";
        break;
      case "control":
        raw = getPlainText(extractionContext.element).trim();
        break;
      default:
        raw = collectVisibleText(extractionContext.node).trim();
    }

    return sanitizeText(raw);
  }

  function resolveExtractionContext(target) {
    if (!target) {
      return null;
    }

    if (target.kind == "selection" || target.kind == "scope") {
      return target;
    }

    const node = target.node || target.element || getElementNode(target);
    const element = getElementNode(node);
    if (!element) {
      return null;
    }

    if (element.nodeName.toUpperCase() == "IMG") {
      return { kind: "image", element: element };
    }

    const table = typeof element.closest == "function" ? element.closest("table") : null;
    if (table) {
      return { kind: "table", table: table };
    }

    const codeContainer = typeof element.closest == "function" ? element.closest("pre, code") : null;
    if (codeContainer) {
      return { kind: "code", container: codeContainer };
    }

    const listContainer = typeof element.closest == "function" ? element.closest("ul, ol") : null;
    if (listContainer) {
      return { kind: "list", container: listContainer };
    }

    const anchor = typeof element.closest == "function" ? element.closest("a[href]") : null;
    if (anchor) {
      return { kind: "link", anchor: anchor };
    }

    const tagName = element.nodeName.toUpperCase();
    if (tagName == "INPUT" || tagName == "TEXTAREA" || tagName == "SELECT") {
      return { kind: "control", element: element };
    }

    return { kind: "text", node: node };
  }

  function getExtractionNode(node) {
    const element = getElementNode(node);
    if (!element) {
      return null;
    }
    return element;
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

  function getImageText(node) {
    return node.getAttribute("src") || node.getAttribute("alt") || "";
  }

  function collectVisibleText(node) {
    if (!node) {
      return "";
    }

    if (node.nodeType == Node.TEXT_NODE) {
      return isNodeVisible(node) ? String(node.textContent || "") : "";
    }

    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: function (textNode) {
        return isNodeVisible(textNode) && String(textNode.textContent || "").trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });

    const parts = [];
    let current = walker.nextNode();
    while (current) {
      parts.push(String(current.textContent || "").trim());
      current = walker.nextNode();
    }

    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function extractTableAsTsv(table) {
    return Array.from(table.rows || []).map(function (row) {
      return Array.from(row.cells || []).filter(isNodeVisible).map(function (cell) {
        return collectVisibleText(cell).replace(/\s*\n+\s*/g, " ").trim();
      }).join("\t");
    }).filter(Boolean).join("\n");
  }

  function extractCodeText(container) {
    const clone = container.cloneNode(true);
    Array.from(clone.querySelectorAll("[aria-hidden='true'], .line-numbers, .line-number, .lineno, .gutter, .blob-num")).forEach(function (element) {
      element.remove();
    });
    return collectVisibleText(clone).replace(/\u00a0/g, " ").trim();
  }

  function extractListAsText(container) {
    const isOrdered = container.nodeName.toUpperCase() === "OL";
    const items = Array.from(container.children).filter(function (child) {
      return child.nodeName.toUpperCase() === "LI" && isNodeVisible(child);
    });

    return items.map(function (li, index) {
      const nestedList = li.querySelector("ul, ol");
      let mainText = "";

      if (nestedList) {
        const clone = li.cloneNode(true);
        Array.from(clone.querySelectorAll("ul, ol")).forEach(function (nested) {
          nested.remove();
        });
        mainText = collectVisibleText(clone).trim();
      } else {
        mainText = collectVisibleText(li).trim();
      }

      const prefix = isOrdered ? (index + 1) + ". " : "- ";
      let line = prefix + mainText;

      if (nestedList) {
        const nestedLines = extractListAsText(nestedList).split("\n").map(function (nestedLine) {
          return "  " + nestedLine;
        }).join("\n");
        line += "\n" + nestedLines;
      }

      return line;
    }).join("\n");
  }

  function sanitizeText(text) {
    return String(text || "")
      .replace(/\u200B/g, "")
      .replace(/\u200C/g, "")
      .replace(/\u200D/g, "")
      .replace(/\uFEFF/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/(\r?\n){3,}/g, "\n\n")
      .trim();
  }

  function getPlainText(node) {
    if (!node) {
      return "";
    }

    switch (node.nodeName.toUpperCase()) {
      case "INPUT":
      case "TEXTAREA":
        return node.value || "";
      case "SELECT":
        return Array.from(node.selectedOptions).map(function (option) {
          return option.innerText;
        }).join("\n");
      case "IMG":
        return getImageText(node);
      default:
        return collectVisibleText(node);
    }
  }

  async function copyCommand(clickedElement, source, options) {
    const precisionTarget = resolvePrecisionTarget(clickedElement, options);
    if (!precisionTarget) {
      return;
    }
    await executePrecisionCopy(precisionTarget, source);
  }

  async function executePrecisionCopy(precisionTarget, source) {
    const text = getText(precisionTarget);
    if (!text) {
      return;
    }

    const htmlContent = getHtmlContent(precisionTarget);
    const result = "copied";
    await copy(text, htmlContent);

    hoverState.scopeLevel = 0;
    hoverState.scopeAnchorClientX = null;
    hoverState.scopeAnchorClientY = null;

    showCopyFeedback(precisionTarget.rect, result);
    const analyticsEvents = [{
      type: getAnalyticsTypeForResult(result, source || "click", precisionTarget.kind == "selection"),
      hostname: window.location.hostname,
      toastKind: getToastAnalyticsKind(result),
    }];
    if ((source || "click") == "shortcut") {
      analyticsEvents.push({
        type: "shortcut",
        hostname: window.location.hostname,
      });
    }
    saveAnalyticsEvents(analyticsEvents);
    await saveHistory(text, result, source || "click", precisionTarget.kind == "selection");
  }

  function getHtmlContent(target) {
    if (!target) {
      return "";
    }

    try {
      if (target.range) {
        const fragment = target.range.cloneContents();
        const wrapper = document.createElement("div");
        wrapper.appendChild(fragment);
        return sanitizeHtml(serializeNodeChildrenToHtml(wrapper));
      }

      const node = target.node;
      const element = getElementNode(node);
      if (element && element.outerHTML) {
        return sanitizeHtml(element.outerHTML);
      }
    } catch (error) {
      // Silently fall back to no HTML
    }

    return "";
  }

  function serializeNodeChildrenToHtml(node) {
    return Array.from(node.childNodes).map(serializeNodeToHtml).join("");
  }

  function serializeNodeToHtml(node) {
    if (node.nodeType == Node.TEXT_NODE) {
      return escapeHtmlText(node.textContent || "");
    }

    if (node.nodeType == Node.ELEMENT_NODE && node.outerHTML) {
      return node.outerHTML;
    }

    return new XMLSerializer().serializeToString(node);
  }

  function escapeHtmlText(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function sanitizeHtml(html) {
    if (!html) {
      return "";
    }

    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\son\w+\s*=\s*\S+/gi, "")
      .replace(/javascript\s*:/gi, "")
      .replace(/\sdata-track[\w-]*\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\sdata-analytics[\w-]*\s*=\s*["'][^"']*["']/gi, "");
  }

  async function copy(text, htmlContent) {
    if (htmlContent && navigator.clipboard && typeof navigator.clipboard.write === "function" && typeof ClipboardItem !== "undefined") {
      try {
        const textBlob = new Blob([text], { type: "text/plain" });
        const htmlBlob = new Blob([htmlContent], { type: "text/html" });
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": textBlob,
            "text/html": htmlBlob
          })
        ]);
        return;
      } catch (error) {
        console.warn("ClipboardItem write failed, falling back to writeText.", error);
      }
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText == "function") {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        console.warn("Clipboard writeText failed, using fallback copy.", error);
      }
    }

    const container = document.body || document.documentElement;
    const textArea = document.createElement("textarea");
    textArea.style.cssText = "position:absolute;left:-100%;top:0;";

    try {
      container.appendChild(textArea);
      textArea.value = text;
      textArea.select();
      context.state.suppressNativeCopyTracking = true;
      if (!document.execCommand("copy")) {
        console.error("Copy failed.");
      }
    } finally {
      context.state.suppressNativeCopyTracking = false;
      textArea.remove();
    }
  }

  function showCopyFeedback(rect, result) {
    const overlayState = getOverlayState();

    if (hasRenderableRect(rect)) {
      positionOverlayBox(overlayState.feedback, rect, 4);
      overlayState.feedback.style.animationDuration = Math.max(350, settings().toastDurationMs) + "ms";
      restartAnimation(overlayState.feedback, "visible");
    }

    spawnCursorToast(getCopyToastText(result), getToastPageX(rect), getToastPageY(rect));
  }

  function getCopyToastText(result) {
    return context.t("toast_copied", "Copied!");
  }

  function getToastPageX(rect) {
    if (hoverState.pointerPageX !== null) {
      return hoverState.pointerPageX;
    }

    return rect.left + window.scrollX + (rect.width / 2);
  }

  function getToastPageY(rect) {
    if (hoverState.pointerPageY !== null) {
      return hoverState.pointerPageY;
    }

    return rect.top + window.scrollY + Math.min(24, rect.height / 2);
  }

  function spawnCursorToast(label, pageX, pageY) {
    const overlayState = getOverlayState();
    const toast = document.createElement("div");
    toast.className = "cursor-toast";
    toast.textContent = label;

    const toastW = 80;
    const toastH = 28;
    const margin = 8;
    const clientX = pageX - window.scrollX;
    const clientY = pageY - window.scrollY;

    let adjustedClientX = clientX + 16;
    if (adjustedClientX + toastW + margin > window.innerWidth) {
      adjustedClientX = Math.max(margin, clientX - toastW - 16);
    }

    let adjustedClientY = clientY - 18;
    if (adjustedClientY - toastH < margin) {
      adjustedClientY = Math.min(window.innerHeight - toastH - margin, clientY + 24);
    }

    const finalPageX = adjustedClientX + window.scrollX;
    const finalPageY = adjustedClientY + window.scrollY;

    toast.style.left = Math.round(finalPageX) + "px";
    toast.style.top = Math.round(finalPageY) + "px";
    toast.style.animationDuration = settings().toastDurationMs + "ms";
    overlayState.layer.appendChild(toast);
    toast.addEventListener("animationend", function () {
      toast.remove();
    }, { once: true });
  }

  function showStatusToast(label) {
    const overlayState = getOverlayState();
    const toast = document.createElement("div");
    toast.className = "cursor-toast";
    toast.textContent = label;
    toast.style.left = Math.round(window.scrollX + (window.innerWidth / 2)) + "px";
    toast.style.top = Math.round(window.scrollY + Math.min(window.innerHeight * 0.3, 180)) + "px";
    toast.style.transform = "translateX(-50%)";
    toast.style.animationDuration = settings().toastDurationMs + "ms";
    overlayState.layer.appendChild(toast);
    toast.addEventListener("animationend", function () {
      toast.remove();
    }, { once: true });
  }

  async function saveHistory(text, result, source, isSelectionBased) {
    if (!settings().copyHistoryLimit) {
      return;
    }

    try {
      const current = await utils.safeStorageGet("local", { copyHistory: [] });
      const nextHistory = utils.pushHistoryEntry(current.copyHistory, {
        text: text,
        snippet: utils.getTextSnippet(text),
        source: source,
        mode: "copy",
        url: window.location.href,
        hostname: window.location.hostname,
        pinned: false,
        replayCount: 0,
        lastReplayedAt: isSelectionBased ? Date.now() : 0,
      }, settings().copyHistoryLimit);

      await utils.safeStorageSet("local", { copyHistory: nextHistory });
    } catch (error) {
      if (context.handleExtensionContextError(error)) {
        return;
      }

      console.warn("Saving copy history failed.", error);
    }
  }

  async function saveAnalyticsEvent(event) {
    return saveAnalyticsEvents([event]);
  }

  async function saveAnalyticsEvents(events) {
    try {
      const current = await utils.safeStorageGet("local", { copyAnalytics: utils.DEFAULT_ANALYTICS });
      let nextAnalytics = current.copyAnalytics;
      (Array.isArray(events) ? events : [events]).forEach(function (event) {
        nextAnalytics = utils.recordAnalyticsEvent(nextAnalytics, event || {});
      });
      await utils.safeStorageSet("local", { copyAnalytics: nextAnalytics });
    } catch (error) {
      if (context.handleExtensionContextError(error)) {
        return;
      }

      console.warn("Saving copy analytics failed.", error);
    }
  }

  function getAnalyticsTypeForResult(result, source, isSelectionBased) {
    if (source == "history") {
      return "historyReplayCopy";
    }

    if (isSelectionBased) {
      return "selectionCopy";
    }

    return "copy";
  }

  function getToastAnalyticsKind(result) {
    return "copied";
  }

  function resolveShortcutTarget() {
    if (hoverState.hoveredElement && hoverState.hoveredElement.isConnected) {
      return hoverState.hoveredElement;
    }

    if (document.activeElement && document.activeElement !== document.body && document.activeElement !== document.documentElement) {
      return document.activeElement;
    }

    const selection = window.getSelection ? window.getSelection() : null;
    if (selection && selection.anchorNode) {
      return selection.anchorNode;
    }

    return null;
  }

  function getNativeCopiedText() {
    const activeElement = document.activeElement;
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

  function positionOverlayBox(element, rect, expansion) {
    const pageTop = rect.top + window.scrollY - expansion;
    const pageLeft = rect.left + window.scrollX - expansion;
    const width = rect.width + (expansion * 2);
    const height = rect.height + (expansion * 2);

    element.style.top = Math.round(pageTop) + "px";
    element.style.left = Math.round(pageLeft) + "px";
    element.style.width = Math.max(1, Math.round(width)) + "px";
    element.style.height = Math.max(1, Math.round(height)) + "px";
  }

  function hasRenderableRect(rect) {
    return !!rect && rect.width > 0 && rect.height > 0;
  }

  function restartAnimation(element, className) {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  function getOverlayState() {
    if (context.state.overlayState && context.state.overlayState.host.isConnected) {
      return context.state.overlayState;
    }

    const host = document.createElement("div");
    host.setAttribute("data-copy-text-overlay-root", "");
    Object.assign(host.style, {
      all: "initial",
      position: "absolute",
      top: "0",
      left: "0",
      width: "0",
      height: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
    });

    const shadowRoot = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = [
      ":host { all: initial; }",
      ".layer {",
      "  position: relative;",
      "  pointer-events: none;",
      "}",
      ".preview,",
      ".feedback,",
      ".cursor-toast,",
      ".scope-badge,",
      ".warn-badge {",
      "  position: absolute;",
      "  pointer-events: none;",
      "  box-sizing: border-box;",
      "}",
      ".preview {",
      "  z-index: 99998;",
      "  opacity: 0;",
      "  border: 2px solid rgba(250, 204, 21, 0.7);",
      "  border-radius: 6px;",
      "  background: rgba(250, 204, 21, 0.18);",
      "  mix-blend-mode: multiply;",
      "  box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.08), inset 0 0 12px rgba(250, 204, 21, 0.12);",
      "  transition: opacity 150ms cubic-bezier(0.22, 1, 0.36, 1), top 100ms ease, left 100ms ease, width 100ms ease, height 100ms ease;",
      "}",
      ".preview.visible {",
      "  opacity: 1;",
      "}",
      "@media (prefers-color-scheme: dark) {",
      "  .preview {",
      "    border-color: rgba(56, 189, 248, 0.6);",
      "    background: rgba(56, 189, 248, 0.12);",
      "    mix-blend-mode: screen;",
      "    box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.1), inset 0 0 12px rgba(56, 189, 248, 0.08);",
      "  }",
      "}",
      ".scope-badge {",
      "  z-index: 100001;",
      "  display: none;",
      "  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
      "  font-size: 10px;",
      "  font-weight: 700;",
      "  line-height: 1;",
      "  letter-spacing: 0.04em;",
      "  text-transform: uppercase;",
      "  color: #92400e;",
      "  background: rgba(253, 230, 138, 0.92);",
      "  border: 1px solid rgba(250, 204, 21, 0.4);",
      "  padding: 3px 7px;",
      "  border-radius: 6px;",
      "  white-space: nowrap;",
      "}",
      "@media (prefers-color-scheme: dark) {",
      "  .scope-badge {",
      "    color: #bae6fd;",
      "    background: rgba(7, 89, 133, 0.88);",
      "    border-color: rgba(56, 189, 248, 0.35);",
      "  }",
      "}",
      ".warn-badge {",
      "  z-index: 100001;",
      "  display: none;",
      "  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
      "  font-size: 10px;",
      "  font-weight: 700;",
      "  line-height: 1;",
      "  color: #b91c1c;",
      "  background: rgba(254, 226, 226, 0.94);",
      "  border: 1px solid rgba(248, 113, 113, 0.4);",
      "  padding: 3px 7px;",
      "  border-radius: 6px;",
      "  white-space: nowrap;",
      "}",
      "@media (prefers-color-scheme: dark) {",
      "  .warn-badge {",
      "    color: #fca5a5;",
      "    background: rgba(127, 29, 29, 0.88);",
      "    border-color: rgba(248, 113, 113, 0.35);",
      "  }",
      "}",
      ".feedback {",
      "  z-index: 99999;",
      "  opacity: 0;",
      "  border: 1px solid rgba(110, 231, 183, 0.96);",
      "  border-radius: 8px;",
      "  background: linear-gradient(135deg, rgba(45, 212, 191, 0.22), rgba(34, 197, 94, 0.18));",
      "  box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.14), 0 0 28px rgba(45, 212, 191, 0.35);",
      "}",
      ".feedback.visible {",
      "  animation: feedbackPulse 1150ms cubic-bezier(0.16, 1, 0.3, 1) forwards;",
      "}",
      "@keyframes feedbackPulse {",
      "  0% { opacity: 0.96; transform: scale(0.985); }",
      "  58% { opacity: 0.7; transform: scale(1); }",
      "  100% { opacity: 0; transform: scale(1.02); }",
      "}",
      ".cursor-toast {",
      "  z-index: 100000;",
      "  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
      "  font-size: 12px;",
      "  font-weight: 650;",
      "  line-height: 1;",
      "  letter-spacing: 0.01em;",
      "  color: #ecfeff;",
      "  white-space: nowrap;",
      "  padding: 7px 10px;",
      "  border-radius: 999px;",
      "  border: 1px solid rgba(125, 211, 252, 0.32);",
      "  background: linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(8, 47, 73, 0.92));",
      "  box-shadow: 0 10px 24px rgba(2, 6, 23, 0.28), 0 0 18px rgba(45, 212, 191, 0.24);",
      "  animation: cursorToastFloat 1250ms cubic-bezier(0.22, 1, 0.36, 1) forwards;",
      "}",
      "@keyframes cursorToastFloat {",
      "  0% { opacity: 0; transform: translateY(4px); }",
      "  12% { opacity: 1; transform: translateY(0); }",
      "  100% { opacity: 0; transform: translateY(-28px); }",
      "}",
      "@media (prefers-reduced-motion: reduce) {",
      "  .preview { transition: none; }",
      "  .feedback.visible { animation-duration: 350ms; }",
      "  .cursor-toast { animation-duration: 700ms; }",
      "}",
    ].join("\n");

    const layer = document.createElement("div");
    layer.className = "layer";

    const preview = document.createElement("div");
    preview.className = "preview";

    const feedback = document.createElement("div");
    feedback.className = "feedback";

    const scopeBadge = document.createElement("div");
    scopeBadge.className = "scope-badge";

    const warnBadge = document.createElement("div");
    warnBadge.className = "warn-badge";

    layer.appendChild(preview);
    layer.appendChild(feedback);
    layer.appendChild(scopeBadge);
    layer.appendChild(warnBadge);
    shadowRoot.appendChild(style);
    shadowRoot.appendChild(layer);

    (document.documentElement || document.body).appendChild(host);

    context.state.overlayState = {
      host: host,
      layer: layer,
      preview: preview,
      feedback: feedback,
      scopeBadge: scopeBadge,
      warnBadge: warnBadge,
    };

    return context.state.overlayState;
  }

  return {
    SCOPE_WORD,
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
    shouldShowPreview,
    schedulePreviewUpdate,
    renderPreview,
    hidePreview,
    getText,
    resolveExtractionContext,
    getExtractionNode,
    getElementNode,
    getImageText,
    collectVisibleText,
    extractTableAsTsv,
    extractCodeText,
    extractListAsText,
    sanitizeText,
    getPlainText,
    copyCommand,
    executePrecisionCopy,
    getHtmlContent,
    serializeNodeChildrenToHtml,
    serializeNodeToHtml,
    escapeHtmlText,
    sanitizeHtml,
    copy,
    showCopyFeedback,
    getCopyToastText,
    getToastPageX,
    getToastPageY,
    spawnCursorToast,
    showStatusToast,
    saveHistory,
    saveAnalyticsEvent,
    saveAnalyticsEvents,
    getAnalyticsTypeForResult,
    getToastAnalyticsKind,
    resolveShortcutTarget,
    getNativeCopiedText,
    positionOverlayBox,
    hasRenderableRect,
    restartAnimation,
    getOverlayState,
  };
}

module.exports = {
  createContentHelpers,
};
