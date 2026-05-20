const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type MarkdownOptions = {
  resolveImageSrc?: (src: string) => string;
};

const inlineMarkdownToHtml = (value: string, options: MarkdownOptions = {}) => {
  let html = escapeHtml(value);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, src: string) => {
    const resolvedSrc = options.resolveImageSrc?.(src) ?? src;
    return `<img src="${escapeHtml(resolvedSrc)}" alt="${escapeHtml(alt)}" data-markdown-src="${escapeHtml(src)}" />`;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
};

function isTableRow(line: string) {
  return /^\|.+\|/.test(line.trim());
}

function isTableSeparator(line: string) {
  return /^\|[\s|:-]+\|/.test(line.trim()) && /[-]/.test(line);
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

export function markdownToHtml(markdown: string, options: MarkdownOptions = {}) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  type ListLevel = { type: "ul" | "ol" | "task"; indent: number; openLi: boolean };
  const listStack: ListLevel[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let tableRows: string[][] = [];
  let inTable = false;

  const openTag = (type: ListLevel["type"]) =>
    type === "ol" ? "<ol>" : type === "task" ? '<ul data-type="taskList">' : "<ul>";
  const closeTag = (type: ListLevel["type"]) => (type === "ol" ? "</ol>" : "</ul>");

  const closeOpenLi = () => {
    const top = listStack[listStack.length - 1];
    if (top?.openLi) {
      html.push("</li>");
      top.openLi = false;
    }
  };

  const popList = () => {
    closeOpenLi();
    const top = listStack.pop()!;
    html.push(closeTag(top.type));
  };

  const closeList = () => {
    while (listStack.length) {
      popList();
      // After popping a nested list, also close the parent's li before next iteration.
      closeOpenLi();
    }
  };

  const emitListItem = (indent: number, type: ListLevel["type"], openItemHtml: string) => {
    // Pop nested levels deeper than this indent.
    while (listStack.length) {
      const top = listStack[listStack.length - 1];
      if (top.indent < indent) break;
      if (top.indent === indent && top.type === type) break;
      popList();
    }
    let top = listStack[listStack.length - 1];

    if (!top || top.indent < indent) {
      // Open a new (possibly nested) list. If nested, parent's <li> stays open so
      // the new <ul>/<ol> renders INSIDE it.
      html.push(openTag(type));
      listStack.push({ type, indent, openLi: false });
      top = listStack[listStack.length - 1];
    } else if (top.indent === indent && top.type !== type) {
      closeOpenLi();
      html.push(closeTag(top.type));
      listStack.pop();
      html.push(openTag(type));
      listStack.push({ type, indent, openLi: false });
      top = listStack[listStack.length - 1];
    }

    // Close any previously-open sibling <li>, then emit the new <li> open part.
    closeOpenLi();
    html.push(openItemHtml);
    top.openLi = true;
  };

  const indentOf = (raw: string) => {
    let n = 0;
    for (const ch of raw) {
      if (ch === " ") n += 1;
      else if (ch === "\t") n += 4;
      else break;
    }
    return n;
  };

  const closeTable = () => {
    if (!inTable || tableRows.length === 0) return;
    // First row is header, second is separator (skip), rest are body rows
    const [headerRow, , ...bodyRows] = tableRows;
    if (!headerRow) { inTable = false; tableRows = []; return; }
    html.push("<table>");
    html.push("<thead><tr>");
    for (const cell of headerRow) {
        html.push(`<th>${inlineMarkdownToHtml(cell, options)}</th>`);
    }
    html.push("</tr></thead>");
    if (bodyRows.length > 0) {
      html.push("<tbody>");
      for (const row of bodyRows) {
        html.push("<tr>");
        for (const cell of row) {
          html.push(`<td>${inlineMarkdownToHtml(cell, options)}</td>`);
        }
        html.push("</tr>");
      }
      html.push("</tbody>");
    }
    html.push("</table>");
    inTable = false;
    tableRows = [];
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        closeList();
        closeTable();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // GFM table rows
    if (isTableRow(line) && !isTableSeparator(line)) {
      closeList();
      if (!inTable) inTable = true;
      tableRows.push(parseTableRow(line));
      continue;
    }
    if (inTable && isTableSeparator(line)) {
      tableRows.push([]); // placeholder so header/body split works
      continue;
    }
    if (inTable) {
      closeTable();
    }

    if (!line.trim()) {
      closeList();
      closeTable();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      html.push(`<h${heading[1].length}>${inlineMarkdownToHtml(heading[2], options)}</h${heading[1].length}>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      closeList();
      html.push("<hr />");
      continue;
    }

    const standaloneImage = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim());
    if (standaloneImage) {
      closeList();
      closeTable();
      const [, alt, src] = standaloneImage;
      const resolvedSrc = options.resolveImageSrc?.(src) ?? src;
      html.push(`<img src="${escapeHtml(resolvedSrc)}" alt="${escapeHtml(alt)}" data-markdown-src="${escapeHtml(src)}" />`);
      continue;
    }

    // Handle raw <img> HTML lines (resized images stored with width attribute)
    if (/^<img\s/i.test(line.trim())) {
      closeList();
      closeTable();
      const trimmed = line.trim();
      const srcMatch = /\bsrc="([^"]*)"/.exec(trimmed);
      if (srcMatch) {
        const src = srcMatch[1].replace(/&quot;/g, '"');
        const altMatch = /\balt="([^"]*)"/.exec(trimmed);
        const widthMatch = /\bwidth="([^"]*)"/.exec(trimmed);
        const alt = altMatch ? altMatch[1].replace(/&quot;/g, '"') : "Image";
        const width = widthMatch ? widthMatch[1] : null;
        const resolvedSrc = options.resolveImageSrc?.(src) ?? src;
        const attrs = [
          `src="${escapeHtml(resolvedSrc)}"`,
          `alt="${escapeHtml(alt)}"`,
          `data-markdown-src="${escapeHtml(src)}"`,
          width ? `width="${width}"` : null,
        ].filter(Boolean).join(" ");
        html.push(`<img ${attrs} />`);
      } else {
        html.push(trimmed);
      }
      continue;
    }

    const quote = /^>\s+(.*)$/.exec(line);
    if (quote) {
      closeList();
      html.push(`<blockquote><p>${inlineMarkdownToHtml(quote[1], options)}</p></blockquote>`);
      continue;
    }

    const indent = indentOf(line);
    const stripped = line.slice(indent);

    const task = /^-\s+\[( |x)\]\s+(.*)$/i.exec(stripped);
    if (task) {
      const checked = task[1].toLowerCase() === "x";
      emitListItem(
        indent,
        "task",
        `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked ? " checked" : ""}><span></span></label><div><p>${inlineMarkdownToHtml(task[2], options)}</p></div>`,
      );
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(stripped);
    if (bullet) {
      emitListItem(indent, "ul", `<li><p>${inlineMarkdownToHtml(bullet[1], options)}</p>`);
      continue;
    }

    const ordered = /^\d+\.\s+(.*)$/.exec(stripped);
    if (ordered) {
      emitListItem(indent, "ol", `<li><p>${inlineMarkdownToHtml(ordered[1], options)}</p>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdownToHtml(line, options)}</p>`);
  }

  closeList();
  closeTable();
  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  return html.join("\n");
}

function inlineHtmlToMarkdown(element: Element): string {
  let value = "";
  element.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      value += node.textContent ?? "";
      return;
    }

    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    // Skip nested lists — they're handled separately by serializeList so the
    // recursion doesn't flatten nested bullets into the parent line.
    if (tag === "ul" || tag === "ol") return;
    const content = inlineHtmlToMarkdown(node);

    if (tag === "strong" || tag === "b") value += `**${content}**`;
    else if (tag === "em" || tag === "i") value += `*${content}*`;
    else if (tag === "s" || tag === "strike" || tag === "del") value += `~~${content}~~`;
    else if (tag === "code") value += `\`${content}\``;
    else if (tag === "a") value += `[${content}](${node.getAttribute("href") ?? ""})`;
    else if (tag === "img") value += imageElementToMarkdown(node);
    else value += content;
  });
  return value;
}

function serializeList(list: Element, depth: number): string {
  const indent = "  ".repeat(depth);
  const isTask = list.getAttribute("data-type") === "taskList";
  const tag = list.tagName.toLowerCase();
  const lines: string[] = [];
  Array.from(list.children).forEach((item, index) => {
    if (item.tagName.toLowerCase() !== "li") return;
    const text = inlineHtmlToMarkdown(item).trim();
    let prefix = "- ";
    if (isTask) {
      const checked = item.getAttribute("data-checked") === "true";
      prefix = `- [${checked ? "x" : " "}] `;
    } else if (tag === "ol") {
      prefix = `${index + 1}. `;
    }
    lines.push(`${indent}${prefix}${text}`);
    Array.from(item.children).forEach((child) => {
      const childTag = child.tagName.toLowerCase();
      if (childTag === "ul" || childTag === "ol") {
        lines.push(serializeList(child, depth + 1));
      }
    });
  });
  return lines.join("\n");
}

export function htmlToMarkdown(html: string) {
  const doc = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  const blocks = Array.from(doc.body.firstElementChild?.children ?? []);
  const markdown: string[] = [];

  for (const block of blocks) {
    const tag = block.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      markdown.push(`${"#".repeat(level)} ${inlineHtmlToMarkdown(block)}`);
    } else if (tag === "p") {
      markdown.push(inlineHtmlToMarkdown(block));
    } else if (tag === "img") {
      markdown.push(imageElementToMarkdown(block));
    } else if (tag === "blockquote") {
      const text = inlineHtmlToMarkdown(block);
      markdown.push(text.split("\n").map((line) => `> ${line}`).join("\n"));
    } else if (tag === "pre") {
      markdown.push(`\`\`\`\n${block.textContent ?? ""}\n\`\`\``);
    } else if (tag === "hr") {
      markdown.push("---");
    } else if (tag === "ul" || tag === "ol") {
      markdown.push(serializeList(block, 0));
    } else if (tag === "table") {
      // Handle both standard <thead>/<tbody> and TipTap's tbody-only structure
      // (TipTap puts all rows in <tbody>, using <th> for the header row).
      // Push the entire table as ONE entry so the final \n\n join doesn't insert
      // blank lines between rows, which would break markdownToHtml's table parser.
      const allRows = Array.from(block.querySelectorAll("tr"));
      if (allRows.length > 0) {
        const tableLines: string[] = [];
        const firstCells = Array.from(allRows[0].children);
        const hasHeader = firstCells.some((c) => c.tagName.toLowerCase() === "th");
        if (hasHeader) {
          tableLines.push("| " + firstCells.map((c) => inlineHtmlToMarkdown(c).trim()).join(" | ") + " |");
          tableLines.push("| " + firstCells.map(() => "---").join(" | ") + " |");
          for (const row of allRows.slice(1)) {
            const cells = Array.from(row.children);
            tableLines.push("| " + cells.map((c) => inlineHtmlToMarkdown(c).trim()).join(" | ") + " |");
          }
        } else {
          for (const row of allRows) {
            const cells = Array.from(row.children);
            tableLines.push("| " + cells.map((c) => inlineHtmlToMarkdown(c).trim()).join(" | ") + " |");
          }
        }
        markdown.push(tableLines.join("\n"));
      }
    }
  }

  return `${normalizeMarkdownImageLines(markdown.join("\n\n")).trim()}\n`;
}

function imageElementToMarkdown(image: Element): string {
  const src = image.getAttribute("data-markdown-src") ?? image.getAttribute("src") ?? "";
  const alt = image.getAttribute("alt") ?? "Image";
  const width = image.getAttribute("width");
  if (width) {
    // Resized image: preserve as HTML so the width is round-tripped
    const escapedSrc = src.replace(/"/g, "&quot;");
    const escapedAlt = alt.replace(/"/g, "&quot;");
    return `<img src="${escapedSrc}" alt="${escapedAlt}" width="${width}" />`;
  }
  return `![${alt}](${src})`;
}

export function normalizeMarkdownImageLines(markdown: string) {
  return markdown
    .replace(/([^\n])(<img\s[^>]*\/>)/gi, "$1\n\n$2")
    .replace(/(<img\s[^>]*\/>)([^\n])/gi, "$1\n\n$2")
    .replace(/([^\n])(!\[[^\]]*\]\([^)]+\))/g, "$1\n\n$2")
    .replace(/(!\[[^\]]*\]\([^)]+\))([^\n])/g, "$1\n\n$2");
}
