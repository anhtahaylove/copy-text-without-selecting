function createContentExtraction(context, targeting) {
  const ACTION_SELECTOR = "button, [role='button'], [role='menuitem']";
  const CONTROL_SELECTOR = "input, textarea, select";
  const LINK_SELECTOR = "a[href]";
  const MAX_ACCESSIBLE_LABEL_LENGTH = 500;

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
        return sanitizeTableText(extractTableAsTsv(extractionContext.table));
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
        raw = "[" + (getAccessibleElementLabel(extractionContext.anchor).text || extractionContext.anchor.href) + "](" + extractionContext.anchor.href + ")";
        break;
      case "action":
        raw = extractionContext.label || "";
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

    const node = target.node || target.element || targeting.getElementNode(target);
    const element = targeting.getElementNode(node);
    if (!element) {
      return null;
    }

    const semanticElement = getClosestSemanticElement(element);
    if (semanticElement && semanticElement.matches(ACTION_SELECTOR)) {
      const accessibleLabel = getAccessibleActionLabel(semanticElement);
      return {
        kind: "action",
        element: semanticElement,
        label: accessibleLabel.text,
        labelSource: accessibleLabel.source,
      };
    }

    if (semanticElement && semanticElement.matches(CONTROL_SELECTOR)) {
      return { kind: "control", element: semanticElement };
    }

    if (semanticElement && semanticElement.matches(LINK_SELECTOR)) {
      return { kind: "link", anchor: semanticElement };
    }

    if (element.nodeName.toUpperCase() == "IMG") {
      return { kind: "image", element: element };
    }

    const table = getClosestMatchingElement(element, "table");
    if (table) {
      return { kind: "table", table: table };
    }

    const codeContainer = getClosestMatchingElement(element, "pre, code");
    if (codeContainer) {
      return { kind: "code", container: codeContainer };
    }

    const listContainer = getClosestMatchingElement(element, "ul, ol");
    if (listContainer) {
      return { kind: "list", container: listContainer };
    }

    return { kind: "text", node: node };
  }

  function getClosestSemanticElement(node) {
    const element = targeting.getElementNode(node);
    return getClosestMatchingElement(element, ACTION_SELECTOR + ", " + CONTROL_SELECTOR + ", " + LINK_SELECTOR);
  }

  function getClosestMatchingElement(element, selector) {
    let current = element;
    while (current) {
      if (typeof current.matches == "function" && current.matches(selector)) {
        return current;
      }
      current = getComposedParentElement(current);
    }
    return null;
  }

  function getComposedParentElement(element) {
    if (!element) {
      return null;
    }
    if (element.assignedSlot) {
      return element.assignedSlot;
    }
    if (element.parentElement) {
      return element.parentElement;
    }
    const root = typeof element.getRootNode == "function" ? element.getRootNode() : null;
    return root && root.host && root.host.nodeType == Node.ELEMENT_NODE ? root.host : null;
  }

  function getAccessibleActionLabel(element) {
    return getAccessibleElementLabel(element);
  }

  function getAccessibleElementLabel(element) {
    if (!element) {
      return { text: "", source: "" };
    }

    const labelledBy = String(element.getAttribute("aria-labelledby") || "").trim();
    if (labelledBy) {
      const labelledText = labelledBy.split(/\s+/).map(function (id) {
        const root = typeof element.getRootNode == "function" ? element.getRootNode() : null;
        const labelledElement = root && typeof root.getElementById == "function" ? root.getElementById(id) : null;
        return labelledElement ? labelledElement.textContent : "";
      }).join(" ");
      const normalizedLabelledText = normalizeAccessibleLabel(labelledText);
      if (normalizedLabelledText) {
        return { text: normalizedLabelledText, source: "aria-labelledby" };
      }
    }

    const ariaLabel = normalizeAccessibleLabel(element.getAttribute("aria-label"));
    if (ariaLabel) {
      return { text: ariaLabel, source: "aria-label" };
    }

    const visibleText = normalizeAccessibleLabel(collectVisibleText(element));
    if (visibleText) {
      return { text: visibleText, source: "text" };
    }

    const title = normalizeAccessibleLabel(element.getAttribute("title"));
    if (title) {
      return { text: title, source: "title" };
    }

    const descendantAlternative = getDescendantAlternativeText(element);
    if (descendantAlternative) {
      return { text: descendantAlternative, source: "alt" };
    }

    return { text: "", source: "" };
  }

  function getDescendantAlternativeText(element) {
    if (!element || typeof element.querySelectorAll != "function") {
      return "";
    }
    const text = Array.from(element.querySelectorAll("img[alt], input[type='image'][alt]")).filter(function (candidate) {
      return targeting.isNodeVisible(candidate);
    }).map(function (candidate) {
      return candidate.getAttribute("alt") || "";
    }).join(" ");
    return normalizeAccessibleLabel(text);
  }

  function normalizeAccessibleLabel(value) {
    return sanitizeText(value).replace(/\s+/g, " ").slice(0, MAX_ACCESSIBLE_LABEL_LENGTH).trim();
  }

  function getExtractionNode(node) {
    const element = targeting.getElementNode(node);
    if (!element) {
      return null;
    }
    return element;
  }

  function getImageText(node) {
    return node.getAttribute("src") || node.getAttribute("alt") || "";
  }

  function collectVisibleText(node) {
    if (!node) {
      return "";
    }

    if (node.nodeType == Node.TEXT_NODE) {
      return targeting.isNodeVisible(node) ? String(node.textContent || "") : "";
    }

    const parts = [];
    collectComposedText(node, parts);

    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function collectComposedText(node, parts) {
    if (!node) {
      return;
    }
    if (node.nodeType == Node.TEXT_NODE) {
      if (targeting.isNodeVisible(node) && String(node.textContent || "").trim()) {
        parts.push(String(node.textContent || "").trim());
      }
      return;
    }
    if (node.nodeType == Node.ELEMENT_NODE && !targeting.isNodeVisible(node)) {
      return;
    }

    let children;
    if (node.nodeType == Node.ELEMENT_NODE && node.nodeName.toUpperCase() === "SLOT" && typeof node.assignedNodes == "function") {
      const assignedNodes = node.assignedNodes({ flatten: true });
      children = assignedNodes.length ? assignedNodes : Array.from(node.childNodes || []);
    } else if (node.nodeType == Node.ELEMENT_NODE && node.shadowRoot) {
      children = Array.from(node.shadowRoot.childNodes || []);
    } else {
      children = Array.from(node.childNodes || []);
    }

    children.forEach(function (child) {
      collectComposedText(child, parts);
    });
  }

  function extractTableAsTsv(table) {
    return Array.from(table.rows || []).map(function (row) {
      return Array.from(row.cells || []).filter(targeting.isNodeVisible).map(function (cell) {
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
      return child.nodeName.toUpperCase() === "LI" && targeting.isNodeVisible(child);
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

  function sanitizeTableText(text) {
    return String(text || "")
      .replace(/\u200B/g, "")
      .replace(/\u200C/g, "")
      .replace(/\u200D/g, "")
      .replace(/\uFEFF/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/[ ]+\t/g, "\t")
      .replace(/\t[ ]+/g, "\t")
      .replace(/(\r?\n){3,}/g, "\n\n")
      .trim();
  }

  function getPlainText(node) {
    if (!node) {
      return "";
    }

    switch (node.nodeName.toUpperCase()) {
      case "INPUT":
        if (String(node.type || "").toLowerCase() === "image") {
          return node.getAttribute("alt") || node.value || node.getAttribute("title") || "";
        }
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

  function getHtmlContent(target) {
    if (!target) {
      return "";
    }

    try {
      const extractionContext = resolveExtractionContext(target);
      if (extractionContext && extractionContext.kind === "action") {
        return escapeHtmlText(extractionContext.label || "");
      }

      if (target.range) {
        const fragment = target.range.cloneContents();
        const wrapper = document.createElement("div");
        wrapper.appendChild(fragment);
        return sanitizeHtml(serializeNodeChildrenToHtml(wrapper));
      }

      const node = target.node;
      const element = targeting.getElementNode(node);
      if (element && element.outerHTML) {
        return sanitizeHtml(element.outerHTML);
      }
    } catch (error) {
      // Fall back to plain text when DOM serialization is unavailable.
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

  return {
    getText,
    resolveExtractionContext,
    getClosestSemanticElement,
    getAccessibleActionLabel,
    getAccessibleElementLabel,
    getClosestMatchingElement,
    getComposedParentElement,
    getDescendantAlternativeText,
    normalizeAccessibleLabel,
    getExtractionNode,
    getImageText,
    collectVisibleText,
    collectComposedText,
    extractTableAsTsv,
    extractCodeText,
    extractListAsText,
    sanitizeText,
    sanitizeTableText,
    getPlainText,
    getHtmlContent,
    serializeNodeChildrenToHtml,
    serializeNodeToHtml,
    escapeHtmlText,
    sanitizeHtml,
  };
}

module.exports = {
  createContentExtraction,
};
