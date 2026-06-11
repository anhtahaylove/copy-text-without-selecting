function createContentClipboard(context, targeting, extraction, overlay, persistence) {
  const hoverState = context.state.hoverState;

  async function copyCommand(clickedElement, source, options) {
    const precisionTarget = targeting.resolvePrecisionTarget(clickedElement, options);
    if (!precisionTarget) {
      return false;
    }
    return executePrecisionCopy(precisionTarget, source);
  }

  async function executePrecisionCopy(precisionTarget, source) {
    const text = extraction.getText(precisionTarget);
    if (!text) {
      return false;
    }

    const htmlContent = extraction.getHtmlContent(precisionTarget);
    const result = "copied";
    await copy(text, htmlContent);

    hoverState.scopeLevel = 0;
    hoverState.scopeAnchorClientX = null;
    hoverState.scopeAnchorClientY = null;

    overlay.showCopyFeedback(precisionTarget.rect, result);
    const analyticsEvents = [{
      type: persistence.getAnalyticsTypeForResult(result, source || "click", precisionTarget.kind == "selection"),
      hostname: window.location.hostname,
      toastKind: persistence.getToastAnalyticsKind(result),
    }];
    if ((source || "click") == "shortcut") {
      analyticsEvents.push({
        type: "shortcut",
        hostname: window.location.hostname,
      });
    }
    persistence.saveAnalyticsEvents(analyticsEvents);
    await persistence.saveHistory(text, result, source || "click", precisionTarget.kind == "selection");
    return true;
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

  return {
    copyCommand,
    executePrecisionCopy,
    copy,
  };
}

module.exports = {
  createContentClipboard,
};
