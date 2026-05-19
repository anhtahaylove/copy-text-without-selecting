function createContentExtraction(context, targeting) {
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

    const node = target.node || target.element || targeting.getElementNode(target);
    const element = targeting.getElementNode(node);
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

    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: function (textNode) {
        return targeting.isNodeVisible(textNode) && String(textNode.textContent || "").trim()
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
    getExtractionNode,
    getImageText,
    collectVisibleText,
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
