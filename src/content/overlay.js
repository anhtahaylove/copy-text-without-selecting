function createContentOverlay(context, targeting, extraction) {
  const hoverState = context.state.hoverState;

  function settings() {
    return context.state.settings;
  }

  function shouldShowPreview() {
    return settings().previewEnabled
      && hoverState.previewModifierActive
      && !context.isCurrentHostExcluded()
      && !!hoverState.hoveredElement
      && hoverState.hoveredElement.isConnected
      && !targeting.shouldIgnoreElement(hoverState.hoveredElement);
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

    const precisionTarget = targeting.resolvePrecisionTarget(hoverState.hoveredElement, {
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

    const textLength = extraction.getText(precisionTarget).length;
    if (textLength > 3000) {
      overlayState.warnBadge.textContent = "! " + Math.round(textLength / 1000) + "k chars";
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
      ".layer { position: relative; pointer-events: none; }",
      ".preview, .feedback, .cursor-toast, .scope-badge, .warn-badge { position: absolute; pointer-events: none; box-sizing: border-box; }",
      ".preview { z-index: 99998; opacity: 0; border: 2px solid rgba(250, 204, 21, 0.7); border-radius: 6px; background: rgba(250, 204, 21, 0.18); mix-blend-mode: multiply; box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.08), inset 0 0 12px rgba(250, 204, 21, 0.12); transition: opacity 150ms cubic-bezier(0.22, 1, 0.36, 1), top 100ms ease, left 100ms ease, width 100ms ease, height 100ms ease; }",
      ".preview.visible { opacity: 1; }",
      "@media (prefers-color-scheme: dark) { .preview { border-color: rgba(56, 189, 248, 0.6); background: rgba(56, 189, 248, 0.12); mix-blend-mode: screen; box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.1), inset 0 0 12px rgba(56, 189, 248, 0.08); } }",
      ".scope-badge { z-index: 100001; display: none; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 10px; font-weight: 700; line-height: 1; letter-spacing: 0.04em; text-transform: uppercase; color: #92400e; background: rgba(253, 230, 138, 0.92); border: 1px solid rgba(250, 204, 21, 0.4); padding: 3px 7px; border-radius: 6px; white-space: nowrap; }",
      "@media (prefers-color-scheme: dark) { .scope-badge { color: #bae6fd; background: rgba(7, 89, 133, 0.88); border-color: rgba(56, 189, 248, 0.35); } }",
      ".warn-badge { z-index: 100001; display: none; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 10px; font-weight: 700; line-height: 1; color: #b91c1c; background: rgba(254, 226, 226, 0.94); border: 1px solid rgba(248, 113, 113, 0.4); padding: 3px 7px; border-radius: 6px; white-space: nowrap; }",
      "@media (prefers-color-scheme: dark) { .warn-badge { color: #fca5a5; background: rgba(127, 29, 29, 0.88); border-color: rgba(248, 113, 113, 0.35); } }",
      ".feedback { z-index: 99999; opacity: 0; border: 1px solid rgba(110, 231, 183, 0.96); border-radius: 8px; background: linear-gradient(135deg, rgba(45, 212, 191, 0.22), rgba(34, 197, 94, 0.18)); box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.14), 0 0 28px rgba(45, 212, 191, 0.35); }",
      ".feedback.visible { animation: feedbackPulse 1150ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }",
      "@keyframes feedbackPulse { 0% { opacity: 0.96; transform: scale(0.985); } 58% { opacity: 0.7; transform: scale(1); } 100% { opacity: 0; transform: scale(1.02); } }",
      ".cursor-toast { z-index: 100000; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; font-weight: 650; line-height: 1; letter-spacing: 0.01em; color: #ecfeff; white-space: nowrap; padding: 7px 10px; border-radius: 999px; border: 1px solid rgba(125, 211, 252, 0.32); background: linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(8, 47, 73, 0.92)); box-shadow: 0 10px 24px rgba(2, 6, 23, 0.28), 0 0 18px rgba(45, 212, 191, 0.24); animation: cursorToastFloat 1250ms cubic-bezier(0.22, 1, 0.36, 1) forwards; }",
      "@keyframes cursorToastFloat { 0% { opacity: 0; transform: translateY(4px); } 12% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-28px); } }",
      "@media (prefers-reduced-motion: reduce) { .preview { transition: none; } .feedback.visible { animation-duration: 350ms; } .cursor-toast { animation-duration: 700ms; } }",
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
    shouldShowPreview,
    schedulePreviewUpdate,
    renderPreview,
    hidePreview,
    showCopyFeedback,
    getCopyToastText,
    getToastPageX,
    getToastPageY,
    spawnCursorToast,
    showStatusToast,
    positionOverlayBox,
    hasRenderableRect,
    restartAnimation,
    getOverlayState,
  };
}

module.exports = {
  createContentOverlay,
};
