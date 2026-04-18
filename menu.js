(function () {
    if (globalThis.__copyTextWithAltClickContentScriptLoaded) {
        return;
    }

    globalThis.__copyTextWithAltClickContentScriptLoaded = true;

    var utils = globalThis.CopyTextUtils;
    if (!utils) {
        console.error("CopyTextUtils is not available.");
        return;
    }

    var settings = utils.mergeSettings();
    var overlayState;
    var hoverState = {
        hoveredElement: null,
        previewModifierActive: false,
        previewAnimationFrame: 0,
        pointerPageX: null,
        pointerPageY: null,
        pointerClientX: null,
        pointerClientY: null,
        scopeLevel: 0,
        scopeAnchorClientX: null,
        scopeAnchorClientY: null,
        lastRenderedTarget: null,
    };
    var suppressNativeCopyTracking = false;

    updateSettings();

    chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName == "sync") {
            updateSettings();
        }
    });

    chrome.runtime.onMessage.addListener(function (message) {
        if (!message || message.type != "COPY_TEXT_WITHOUT_SELECTING_SHORTCUT") {
            return;
        }

        if (isCurrentHostExcluded() || !settings.keyboardShortcutEnabled) {
            if (isCurrentHostExcluded()) {
                saveAnalyticsEvent({
                    type: "blockedExcluded",
                    hostname: window.location.hostname,
                    toastKind: "status",
                });
            }
            return;
        }

        var shortcutTarget = resolveShortcutTarget();
        if (!shortcutTarget) {
            saveAnalyticsEvent({
                toastKind: "status",
                hostname: window.location.hostname,
            });
            showStatusToast(t("shortcut_unavailable", "No hovered or focused target to copy."));
            return;
        }

        if (shouldIgnoreElement(shortcutTarget)) {
            saveAnalyticsEvent({
                type: "editableSkipped",
                hostname: window.location.hostname,
                toastKind: "status",
            });
            showStatusToast(t("unsupported_surface_status", "Editing surface skipped"));
            return;
        }

        copyCommand(shortcutTarget, "shortcut", {
            preferSelection: true,
        }).catch(function (error) {
            console.error("Shortcut copy failed.", error);
        });
    });

    document.addEventListener("click", handleClick, false);
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);
    document.addEventListener("copy", handleNativeCopy, true);
    document.addEventListener("keydown", handleModifierChange, true);
    document.addEventListener("keyup", handleModifierChange, true);
    document.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    document.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("visibilitychange", handleVisibilityChange, true);
    window.addEventListener("resize", handleViewportChange);

    function handleClick(event) {
        var copyMode = utils.getCopyMode(settings.metaKey, event);
        if (!copyMode || isCurrentHostExcluded()) {
            if (copyMode && isCurrentHostExcluded()) {
                saveAnalyticsEvent({
                    type: "blockedExcluded",
                    hostname: window.location.hostname,
                });
            }
            return;
        }

        if (shouldIgnoreElement(event.target)) {
            saveAnalyticsEvent({
                type: "editableSkipped",
                hostname: window.location.hostname,
            });
            return;
        }

        var targetToCopy = hoverState.lastRenderedTarget;
        
        syncPointerState(event);

        if (targetToCopy) {
            executePrecisionCopy(targetToCopy, "click").catch(function (error) {
                console.error("Copy failed.", error);
            });
        } else {
            var composedTarget = event.composedPath ? event.composedPath()[0] : event.target;
            var deepTarget = getElementNode(pierceShadowDOM(composedTarget, event.clientX, event.clientY));
            copyCommand(deepTarget, "click", {
                clientX: event.clientX,
                clientY: event.clientY,
                preferSelection: true,
            }).catch(function (error) {
                console.error("Copy failed.", error);
            });
        }

        event.preventDefault();
    }

    function handleMouseMove(event) {
        // Fast path: only track pointer coordinates when no modifier is held
        if (!utils.isPrimaryModifierPressed(settings.metaKey, event)) {
            hoverState.pointerClientX = event.clientX;
            hoverState.pointerClientY = event.clientY;
            hoverState.pointerPageX = event.pageX;
            hoverState.pointerPageY = event.pageY;
            hoverState.previewModifierActive = false;
            return;
        }

        syncPointerState(event);
        var composedTarget = event.composedPath ? event.composedPath()[0] : event.target;
        hoverState.hoveredElement = getElementNode(pierceShadowDOM(composedTarget, event.clientX, event.clientY));
        hoverState.previewModifierActive = true;
        hoverState.scopeLevel = 0;

        if (shouldShowPreview()) {
            schedulePreviewUpdate();
        } else {
            hidePreview();
        }
    }

    function handleMouseOver(event) {
        syncPointerState(event);
        hoverState.hoveredElement = getElementNode(event.target);
        hoverState.previewModifierActive = utils.isPrimaryModifierPressed(settings.metaKey, event);

        if (shouldShowPreview()) {
            schedulePreviewUpdate();
        }
    }

    function handleMouseOut(event) {
        if (!event.relatedTarget) {
            hoverState.hoveredElement = null;
            hidePreview();
            return;
        }

        hoverState.hoveredElement = getElementNode(event.relatedTarget);

        if (shouldShowPreview()) {
            schedulePreviewUpdate();
        } else if (!hoverState.previewModifierActive) {
            hidePreview();
        }
    }

    function handleNativeCopy() {
        if (suppressNativeCopyTracking || isCurrentHostExcluded()) {
            return;
        }

        var copiedText = getNativeCopiedText();
        if (!copiedText) {
            return;
        }

        saveAnalyticsEvent({
            type: "nativeCopy",
            hostname: window.location.hostname,
        });
        saveHistory(copiedText, "copied", "native");
    }

    function handleModifierChange(event) {
        if (!utils.isModifierKeyEvent(event)) {
            return;
        }

        hoverState.previewModifierActive = utils.isPrimaryModifierPressed(settings.metaKey, event);

        if (!hoverState.previewModifierActive) {
            hoverState.scopeLevel = 0;
        }

        if (!hoverState.hoveredElement && hoverState.pointerClientX !== null && hoverState.pointerClientY !== null) {
            var pointElement = document.elementFromPoint(hoverState.pointerClientX, hoverState.pointerClientY);
            hoverState.hoveredElement = getElementNode(pierceShadowDOM(pointElement, hoverState.pointerClientX, hoverState.pointerClientY));
        }

        if (shouldShowPreview()) {
            schedulePreviewUpdate();
        } else {
            hidePreview();
        }
    }

    function handleViewportChange() {
        if (shouldShowPreview()) {
            schedulePreviewUpdate();
        }
    }

    function handleVisibilityChange() {
        if (document.hidden) {
            hidePreview();
        }
    }

    function handleWheel(event) {
        if (!hoverState.previewModifierActive || !shouldShowPreview()) {
            return;
        }

        event.preventDefault();

        var delta = event.deltaY < 0 ? 1 : -1;
        var nextLevel = Math.max(0, Math.min(3, hoverState.scopeLevel + delta));
        if (nextLevel === hoverState.scopeLevel) {
            return;
        }

        hoverState.scopeLevel = nextLevel;
        hoverState.scopeAnchorClientX = hoverState.pointerClientX;
        hoverState.scopeAnchorClientY = hoverState.pointerClientY;
        schedulePreviewUpdate();
    }

    function pierceShadowDOM(element, x, y) {
        if (!element) {
            return element;
        }
        var root = element.shadowRoot;
        if (!root) {
            return element;
        }
        var deeper = root.elementFromPoint(x, y);
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



    var SCOPE_WORD = 0;
    var SCOPE_SENTENCE = 1;
    var SCOPE_PARAGRAPH = 2;
    var SCOPE_CONTAINER = 3;

    function resolveScopedTarget(sourceNode, clientX, clientY, level) {
        if (level <= SCOPE_WORD) {
            return null;
        }

        var caretRange = getCaretRangeAtPoint(clientX, clientY);
        if (!caretRange) {
            return null;
        }

        var textNode = caretRange.startContainer;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
            return null;
        }

        var fullText = textNode.textContent || "";

        if (level === SCOPE_SENTENCE) {
            var sentenceRange = expandToSentence(textNode, caretRange.startOffset);
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
            var paragraphElement = getElementNode(textNode);
            while (paragraphElement && paragraphElement !== document.body) {
                var display = window.getComputedStyle ? window.getComputedStyle(paragraphElement).display : "";
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
            var container = getElementNode(textNode);
            if (container && container.parentElement && container.parentElement !== document.body && container.parentElement !== document.documentElement) {
                return createElementTarget(container.parentElement);
            }
        }

        return null;
    }

    function expandToSentence(textNode, offset) {
        var text = textNode.textContent || "";
        if (!text.trim()) {
            return null;
        }

        var sentenceBreaks = /[.!?。！？]+[\s]*/g;
        var sentences = [];
        var lastEnd = 0;
        var match;
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

        var target = sentences[0];
        for (var i = 0; i < sentences.length; i++) {
            if (offset >= sentences[i].start && offset <= sentences[i].end) {
                target = sentences[i];
                break;
            }
        }

        var range = document.createRange();
        range.setStart(textNode, target.start);
        range.setEnd(textNode, Math.min(target.end, text.length));
        return range;
    }

    function updateSettings() {
        chrome.storage.sync.get(utils.DEFAULT_SETTINGS, function (items) {
            settings = utils.mergeSettings(items);

            if (isCurrentHostExcluded() || !hoverState.previewModifierActive) {
                hidePreview();
            } else if (shouldShowPreview()) {
                schedulePreviewUpdate();
            }
        });
    }

    function resolvePrecisionTarget(sourceNode, options) {
        var context = options || {};
        var sourceElement = getElementNode(sourceNode);
        var clientX = Number.isFinite(context.clientX) ? context.clientX : hoverState.pointerClientX;
        var clientY = Number.isFinite(context.clientY) ? context.clientY : hoverState.pointerClientY;

        if (context.preferSelection !== false) {
            var selectionTarget = getSelectionTarget(sourceElement, clientX, clientY);
            if (selectionTarget) {
                return selectionTarget;
            }
        }

        // Scope expansion takes priority when active
        var scopeClientX = hoverState.scopeAnchorClientX !== null ? hoverState.scopeAnchorClientX : clientX;
        var scopeClientY = hoverState.scopeAnchorClientY !== null ? hoverState.scopeAnchorClientY : clientY;
        if (hoverState.scopeLevel > SCOPE_WORD) {
            var scopedTarget = resolveScopedTarget(sourceElement, scopeClientX, scopeClientY, hoverState.scopeLevel);
            if (scopedTarget) {
                return scopedTarget;
            }
        }

        var deepTextTarget = getDeepTextTarget(clientX, clientY);
        var fallbackElement = getDeepElementTarget(sourceElement, clientX, clientY);

        var preliminaryTarget = deepTextTarget || createElementTarget(fallbackElement);
        if (!preliminaryTarget) {
            return null;
        }

        var context = resolveExtractionContext(preliminaryTarget);
        if (!context) {
            return preliminaryTarget;
        }

        switch (context.kind) {
            case "selection":
            case "scope":
                return context;
            case "table":
                return { kind: "table", table: context.table, rect: context.table.getBoundingClientRect(), node: context.table };
            case "code":
                return { kind: "code", container: context.container, rect: context.container.getBoundingClientRect(), node: context.container };
            case "list":
                return { kind: "list", container: context.container, rect: context.container.getBoundingClientRect(), node: context.container };
            case "link":
                return { kind: "link", anchor: context.anchor, rect: context.anchor.getBoundingClientRect(), node: context.anchor };
            case "image":
                return { kind: "image", element: context.element, rect: context.element.getBoundingClientRect(), node: context.element };
            case "control":
                return { kind: "control", element: context.element, rect: context.element.getBoundingClientRect(), node: context.element };
            case "text":
                var rect = null;
                if (context.node && context.node.nodeType === Node.TEXT_NODE) {
                    var textRange = document.createRange();
                    textRange.selectNodeContents(context.node);
                    rect = getRangeBoundingRect(textRange);
                } else if (context.node && context.node.getBoundingClientRect) {
                    rect = context.node.getBoundingClientRect();
                }
                return { kind: "text", node: context.node, rect: rect || preliminaryTarget.rect };
            default:
                return preliminaryTarget;
        }
    }

    function getSelectionTarget(sourceElement, clientX, clientY) {
        var selection = window.getSelection ? window.getSelection() : null;
        if (selection && selection.rangeCount && !selection.isCollapsed) {
            var selectionText = String(selection.toString() || "").trim();
            if (selectionText) {
                var range = selection.getRangeAt(0).cloneRange();
                var rect = getRangeBoundingRect(range);
                var commonNode = selection.anchorNode || range.commonAncestorContainer;
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

        var activeElement = document.activeElement;
        if (activeElement && (activeElement.nodeName == "INPUT" || activeElement.nodeName == "TEXTAREA")) {
            var start = typeof activeElement.selectionStart == "number" ? activeElement.selectionStart : 0;
            var end = typeof activeElement.selectionEnd == "number" ? activeElement.selectionEnd : 0;
            if (end > start) {
                var selectedText = String(activeElement.value || "").slice(start, end).trim();
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

        var range = getCaretRangeAtPoint(clientX, clientY);
        if (!range) {
            return null;
        }

        var node = range.startContainer;
        if (node && node.nodeType == Node.TEXT_NODE && String(node.textContent || "").trim() && isNodeVisible(node)) {
            var textRange = document.createRange();
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
        var element = Number.isFinite(clientX) && Number.isFinite(clientY)
            ? pierceShadowDOM(document.elementFromPoint(clientX, clientY), clientX, clientY)
            : sourceElement;
        return getClosestMeaningfulElement(element || sourceElement);
    }

    function getCaretRangeAtPoint(clientX, clientY) {
        if (document.caretPositionFromPoint) {
            var position = document.caretPositionFromPoint(clientX, clientY);
            if (position && position.offsetNode) {
                var range = document.createRange();
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
        var current = getElementNode(element);
        while (current && current !== document.body && current !== document.documentElement) {
            if (isNodeVisible(current) && hasMeaningfulText(current)) {
                return current;
            }
            current = current.parentElement;
        }
        return getElementNode(element);
    }

    function createElementTarget(element) {
        if (!element || !isNodeVisible(element)) {
            return null;
        }

        return {
            kind: "element",
            node: element,
            rect: element.getBoundingClientRect(),
        };
    }

    function hasMeaningfulText(node) {
        if (!node) {
            return false;
        }

        if (node.nodeType == Node.TEXT_NODE) {
            return !!String(node.textContent || "").trim();
        }

        var tagName = String(node.nodeName || "").toUpperCase();
        if (tagName == "IMG" || tagName == "INPUT" || tagName == "TEXTAREA" || tagName == "SELECT") {
            return true;
        }

        return !!collectVisibleText(node).trim();
    }

    function isNodeVisible(node) {
        var current = node.nodeType == Node.TEXT_NODE ? node.parentElement : getElementNode(node);
        while (current && current !== document.documentElement) {
            if (current.getAttribute && current.getAttribute("aria-hidden") == "true") {
                return false;
            }

            var style = window.getComputedStyle ? window.getComputedStyle(current) : null;
            if (style && (style.display == "none" || style.visibility == "hidden" || Number(style.opacity) === 0)) {
                return false;
            }

            current = current.parentElement;
        }

        return true;
    }

    function getRangeBoundingRect(range) {
        if (!range) {
            return null;
        }

        var rect = range.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
            return rect;
        }

        var rects = range.getClientRects ? Array.from(range.getClientRects()) : [];
        if (!rects.length) {
            return rect;
        }

        return rects.reduce(function (acc, current) {
            if (!acc) {
                return current;
            }

            var left = Math.min(acc.left, current.left);
            var top = Math.min(acc.top, current.top);
            var right = Math.max(acc.right, current.right);
            var bottom = Math.max(acc.bottom, current.bottom);
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

    function isCurrentHostExcluded() {
        return utils.isExcludedHost(window.location.hostname, settings.excludedDomains);
    }

    function t(key, fallback) {
        return utils.translate(settings, key, fallback, chrome.i18n && chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : "");
    }

    function shouldIgnoreElement(node) {
        return settings.avoidEditable && utils.isEditableSurface(getElementNode(node));
    }

    function shouldShowPreview() {
        return settings.previewEnabled
            && hoverState.previewModifierActive
            && !isCurrentHostExcluded()
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

        var precisionTarget = resolvePrecisionTarget(hoverState.hoveredElement, {
            clientX: hoverState.pointerClientX,
            clientY: hoverState.pointerClientY,
            preferSelection: true,
        });
        if (!precisionTarget || !precisionTarget.rect) {
            hidePreview();
            return;
        }

        var rect = precisionTarget.rect;
        if (!hasRenderableRect(rect)) {
            hidePreview();
            return;
        }

        hoverState.lastRenderedTarget = precisionTarget;

        var state = getOverlayState();
        positionOverlayBox(state.preview, rect, 2);
        state.preview.classList.add("visible");

        // Scope level badge
        var scopeLabels = ["", "Sentence", "Paragraph", "Container"];
        if (hoverState.scopeLevel > 0 && hoverState.scopeLevel < scopeLabels.length) {
            state.scopeBadge.textContent = scopeLabels[hoverState.scopeLevel];
            state.scopeBadge.style.display = "block";
            var previewTop = parseFloat(state.preview.style.top) || 0;
            var previewLeft = parseFloat(state.preview.style.left) || 0;
            state.scopeBadge.style.top = (previewTop - 22) + "px";
            state.scopeBadge.style.left = previewLeft + "px";
        } else {
            state.scopeBadge.style.display = "none";
        }

        // Large selection warning
        var textLength = getText(precisionTarget).length;
        if (textLength > 3000) {
            state.warnBadge.textContent = "⚠ " + Math.round(textLength / 1000) + "k chars";
            state.warnBadge.style.display = "block";
            var pTop = parseFloat(state.preview.style.top) || 0;
            var pLeft = parseFloat(state.preview.style.left) || 0;
            var pWidth = parseFloat(state.preview.style.width) || 0;
            state.warnBadge.style.top = (pTop - 22) + "px";
            state.warnBadge.style.left = (pLeft + pWidth - 80) + "px";
        } else {
            state.warnBadge.style.display = "none";
        }
    }

    function hidePreview() {
        if (hoverState.previewAnimationFrame) {
            window.cancelAnimationFrame(hoverState.previewAnimationFrame);
            hoverState.previewAnimationFrame = 0;
        }

        if (!overlayState) {
            hoverState.lastRenderedTarget = null;
            return;
        }

        hoverState.lastRenderedTarget = null;
        overlayState.preview.classList.remove("visible");
        overlayState.scopeBadge.style.display = "none";
        overlayState.warnBadge.style.display = "none";
    }

    function getText(target) {
        var context = resolveExtractionContext(target);
        if (!context) {
            return "";
        }

        var raw;
        switch (context.kind) {
            case "selection":
                raw = context.text;
                break;
            case "scope":
                raw = context.text || collectVisibleText(context.node).trim();
                break;
            case "table":
                raw = extractTableAsTsv(context.table);
                break;
            case "code":
                raw = extractCodeText(context.container);
                break;
            case "list":
                raw = extractListAsText(context.container);
                break;
            case "image":
                raw = getImageText(context.element);
                break;
            case "link":
                raw = "[" + (collectVisibleText(context.anchor).trim() || context.anchor.href) + "](" + context.anchor.href + ")";
                break;
            case "control":
                raw = getPlainText(context.element).trim();
                break;
            default:
                raw = collectVisibleText(context.node).trim();
        }

        return sanitizeText(raw);
    }

    function resolveExtractionContext(target) {
        if (!target) {
            return null;
        }

        if (target.kind == "selection") {
            return target;
        }

        if (target.kind == "scope") {
            return target;
        }

        var node = target.node || target.element || getElementNode(target);
        var element = getElementNode(node);
        if (!element) {
            return null;
        }

        if (element.nodeName.toUpperCase() == "IMG") {
            return { kind: "image", element: element };
        }

        var table = typeof element.closest == "function" ? element.closest("table") : null;
        if (table) {
            return { kind: "table", table: table };
        }

        var codeContainer = typeof element.closest == "function" ? element.closest("pre, code") : null;
        if (codeContainer) {
            return { kind: "code", container: codeContainer };
        }

        var listContainer = typeof element.closest == "function" ? element.closest("ul, ol") : null;
        if (listContainer) {
            return { kind: "list", container: listContainer };
        }

        var anchor = typeof element.closest == "function" ? element.closest("a[href]") : null;
        if (anchor) {
            return { kind: "link", anchor: anchor };
        }

        var tagName = element.nodeName.toUpperCase();
        if (tagName == "INPUT" || tagName == "TEXTAREA" || tagName == "SELECT") {
            return { kind: "control", element: element };
        }

        return { kind: "text", node: node };
    }

    function getExtractionNode(node) {
        var element = getElementNode(node);
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

        var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
            acceptNode: function (textNode) {
                return isNodeVisible(textNode) && String(textNode.textContent || "").trim()
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        });

        var parts = [];
        var current = walker.nextNode();
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
        var clone = container.cloneNode(true);
        Array.from(clone.querySelectorAll("[aria-hidden='true'], .line-numbers, .line-number, .lineno, .gutter, .blob-num")).forEach(function (element) {
            element.remove();
        });
        return collectVisibleText(clone).replace(/\u00a0/g, " ").trim();
    }

    function extractListAsText(container) {
        var isOrdered = container.nodeName.toUpperCase() === "OL";
        var items = Array.from(container.children).filter(function (child) {
            return child.nodeName.toUpperCase() === "LI" && isNodeVisible(child);
        });

        return items.map(function (li, index) {
            var nestedList = li.querySelector("ul, ol");
            var mainText = "";

            if (nestedList) {
                var clone = li.cloneNode(true);
                Array.from(clone.querySelectorAll("ul, ol")).forEach(function (nested) {
                    nested.remove();
                });
                mainText = collectVisibleText(clone).trim();
            } else {
                mainText = collectVisibleText(li).trim();
            }

            var prefix = isOrdered ? (index + 1) + ". " : "- ";
            var line = prefix + mainText;

            if (nestedList) {
                var nestedLines = extractListAsText(nestedList).split("\n").map(function (nestedLine) {
                    return "  " + nestedLine;
                }).join("\n");
                line += "\n" + nestedLines;
            }

            return line;
        }).join("\n");
    }

    function sanitizeText(text) {
        return String(text || "")
            .replace(/\u200B/g, "")            // zero-width spaces
            .replace(/\u200C/g, "")            // zero-width non-joiner
            .replace(/\u200D/g, "")            // zero-width joiner
            .replace(/\uFEFF/g, "")            // BOM
            .replace(/\u00A0/g, " ")           // non-breaking space → regular space
            .replace(/[ \t]+/g, " ")           // collapse horizontal whitespace
            .replace(/(\r?\n){3,}/g, "\n\n")   // max 2 consecutive newlines
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
        var precisionTarget = resolvePrecisionTarget(clickedElement, options);
        if (!precisionTarget) {
            return;
        }
        await executePrecisionCopy(precisionTarget, source);
    }

    async function executePrecisionCopy(precisionTarget, source) {
        var text = getText(precisionTarget);
        if (!text) {
            return;
        }

        // Extract HTML for rich-text copy support
        var htmlContent = getHtmlContent(precisionTarget);

        var result = "copied";
        await copy(text, htmlContent);

        hoverState.scopeLevel = 0;
        hoverState.scopeAnchorClientX = null;
        hoverState.scopeAnchorClientY = null;

        showCopyFeedback(precisionTarget.rect, result);
        var analyticsEvents = [{
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
                var fragment = target.range.cloneContents();
                var wrapper = document.createElement("div");
                wrapper.appendChild(fragment);
                return sanitizeHtml(serializeNodeChildrenToHtml(wrapper));
            }

            var node = target.node;
            var element = getElementNode(node);
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
        // Try rich-text copy with both text/plain and text/html via ClipboardItem API
        if (htmlContent && navigator.clipboard && typeof navigator.clipboard.write === "function" && typeof ClipboardItem !== "undefined") {
            try {
                var textBlob = new Blob([text], { type: "text/plain" });
                var htmlBlob = new Blob([htmlContent], { type: "text/html" });
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

        // Fallback: plain-text only via writeText
        if (navigator.clipboard && typeof navigator.clipboard.writeText == "function") {
            try {
                await navigator.clipboard.writeText(text);
                return;
            } catch (error) {
                console.warn("Clipboard writeText failed, using fallback copy.", error);
            }
        }

        // Final fallback: execCommand
        var container = document.body || document.documentElement;
        var textArea = document.createElement("textarea");
        textArea.style.cssText = "position:absolute;left:-100%;top:0;";

        try {
            container.appendChild(textArea);
            textArea.value = text;
            textArea.select();
            suppressNativeCopyTracking = true;
            if (!document.execCommand("copy")) {
                console.error("Copy failed.");
            }
        } finally {
            suppressNativeCopyTracking = false;
            textArea.remove();
        }
    }

    function showCopyFeedback(rect, result) {
        var state = getOverlayState();

        if (hasRenderableRect(rect)) {
            positionOverlayBox(state.feedback, rect, 4);
            state.feedback.style.animationDuration = Math.max(350, settings.toastDurationMs) + "ms";
            restartAnimation(state.feedback, "visible");
        }

        spawnCursorToast(getCopyToastText(result), getToastPageX(rect), getToastPageY(rect));
    }

    function getCopyToastText(result) {
        return t("toast_copied", "Copied!");
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
        var state = getOverlayState();
        var toast = document.createElement("div");
        toast.className = "cursor-toast";
        toast.textContent = label;

        // Viewport-aware positioning: clamp toast within visible bounds
        var toastW = 80; // estimated width
        var toastH = 28; // estimated height
        var margin = 8;
        var clientX = pageX - window.scrollX;
        var clientY = pageY - window.scrollY;

        // Horizontal: prefer right of cursor, flip left if overflow
        var adjustedClientX = clientX + 16;
        if (adjustedClientX + toastW + margin > window.innerWidth) {
            adjustedClientX = Math.max(margin, clientX - toastW - 16);
        }

        // Vertical: prefer above cursor, flip below if overflow
        var adjustedClientY = clientY - 18;
        if (adjustedClientY - toastH < margin) {
            adjustedClientY = Math.min(window.innerHeight - toastH - margin, clientY + 24);
        }

        // Convert back to page coordinates
        var finalPageX = adjustedClientX + window.scrollX;
        var finalPageY = adjustedClientY + window.scrollY;

        toast.style.left = Math.round(finalPageX) + "px";
        toast.style.top = Math.round(finalPageY) + "px";
        toast.style.animationDuration = settings.toastDurationMs + "ms";
        state.layer.appendChild(toast);
        toast.addEventListener("animationend", function () {
            toast.remove();
        }, { once: true });
    }

    function showStatusToast(label) {
        var state = getOverlayState();
        var toast = document.createElement("div");
        toast.className = "cursor-toast";
        toast.textContent = label;
        toast.style.left = Math.round(window.scrollX + (window.innerWidth / 2)) + "px";
        toast.style.top = Math.round(window.scrollY + Math.min(window.innerHeight * 0.3, 180)) + "px";
        toast.style.transform = "translateX(-50%)";
        toast.style.animationDuration = settings.toastDurationMs + "ms";
        state.layer.appendChild(toast);
        toast.addEventListener("animationend", function () {
            toast.remove();
        }, { once: true });
    }

    async function saveHistory(text, result, source, isSelectionBased) {
        if (!settings.copyHistoryLimit) {
            return;
        }

        try {
            var current = await chrome.storage.local.get({ copyHistory: [] });
            var nextHistory = utils.pushHistoryEntry(current.copyHistory, {
                text: text,
                snippet: utils.getTextSnippet(text),
                source: source,
                mode: "copy",
                url: window.location.href,
                hostname: window.location.hostname,
                pinned: false,
                replayCount: 0,
                lastReplayedAt: isSelectionBased ? Date.now() : 0,
            }, settings.copyHistoryLimit);

            await chrome.storage.local.set({ copyHistory: nextHistory });
        } catch (error) {
            console.warn("Saving copy history failed.", error);
        }
    }

    async function saveAnalyticsEvent(event) {
        return saveAnalyticsEvents([event]);
    }

    async function saveAnalyticsEvents(events) {
        try {
            var current = await chrome.storage.local.get({ copyAnalytics: utils.DEFAULT_ANALYTICS });
            var nextAnalytics = current.copyAnalytics;
            (Array.isArray(events) ? events : [events]).forEach(function (event) {
                nextAnalytics = utils.recordAnalyticsEvent(nextAnalytics, event || {});
            });
            await chrome.storage.local.set({ copyAnalytics: nextAnalytics });
        } catch (error) {
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

        var selection = window.getSelection ? window.getSelection() : null;
        if (selection && selection.anchorNode) {
            return selection.anchorNode;
        }

        return null;
    }

    function getNativeCopiedText() {
        var activeElement = document.activeElement;
        if (activeElement && (activeElement.nodeName == "INPUT" || activeElement.nodeName == "TEXTAREA")) {
            var start = typeof activeElement.selectionStart == "number" ? activeElement.selectionStart : 0;
            var end = typeof activeElement.selectionEnd == "number" ? activeElement.selectionEnd : 0;
            var value = String(activeElement.value || "");
            if (end > start) {
                return value.slice(start, end).trim();
            }
        }

        var selection = window.getSelection ? window.getSelection() : null;
        return selection ? String(selection.toString() || "").trim() : "";
    }

    function positionOverlayBox(element, rect, expansion) {
        var pageTop = rect.top + window.scrollY - expansion;
        var pageLeft = rect.left + window.scrollX - expansion;
        var width = rect.width + (expansion * 2);
        var height = rect.height + (expansion * 2);

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
        if (overlayState && overlayState.host.isConnected) {
            return overlayState;
        }

        var host = document.createElement("div");
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

        var shadowRoot = host.attachShadow({ mode: "closed" });
        var style = document.createElement("style");
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
            /* ── Highlighter-style preview ── */
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
            /* Dark mode: switch to additive blend for white text */
            "@media (prefers-color-scheme: dark) {",
            "  .preview {",
            "    border-color: rgba(56, 189, 248, 0.6);",
            "    background: rgba(56, 189, 248, 0.12);",
            "    mix-blend-mode: screen;",
            "    box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.1), inset 0 0 12px rgba(56, 189, 248, 0.08);",
            "  }",
            "}",
            /* ── Scope badge ── */
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
            /* ── Large selection warning ── */
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
            /* ── Copy feedback pulse ── */
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
            /* ── Cursor toast ── */
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
            "}"
        ].join("\n");

        var layer = document.createElement("div");
        layer.className = "layer";

        var preview = document.createElement("div");
        preview.className = "preview";

        var feedback = document.createElement("div");
        feedback.className = "feedback";

        var scopeBadge = document.createElement("div");
        scopeBadge.className = "scope-badge";

        var warnBadge = document.createElement("div");
        warnBadge.className = "warn-badge";

        layer.appendChild(preview);
        layer.appendChild(feedback);
        layer.appendChild(scopeBadge);
        layer.appendChild(warnBadge);
        shadowRoot.appendChild(style);
        shadowRoot.appendChild(layer);

        (document.documentElement || document.body).appendChild(host);

        overlayState = {
            host: host,
            layer: layer,
            preview: preview,
            feedback: feedback,
            scopeBadge: scopeBadge,
            warnBadge: warnBadge,
        };

        return overlayState;
    }
})();
