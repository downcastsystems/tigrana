import { gitHubEmojis, shortcodeToEmoji } from "@tiptap/extension-emoji";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type MarkdownOptions = {
  resolveImageSrc?: (src: string) => string;
};

// Internal marker used to represent a hard line break (Shift+Enter) inside a
// single block's text, so it survives escapeHtml and round-trips through the
// list/paragraph pipelines without colliding with normal text.
export const HARD_BREAK_PLACEHOLDER = "";

const inlineMarkdownToHtml = (value: string, options: MarkdownOptions = {}) => {
  let html = escapeHtml(value);
  html = html.replace(new RegExp(HARD_BREAK_PLACEHOLDER, "g"), "<br>");
  html = html.replace(/:([a-zA-Z0-9_+-]+):/g, (match, shortcode: string) => {
    const emoji = shortcodeToEmoji(shortcode, gitHubEmojis);
    if (!emoji) return match;
    return `<span data-type="emoji" data-name="${escapeHtml(emoji.name)}"></span>`;
  });
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

const EM_SPACE = " ";

// Convert leading 4-space groups to em-spaces so the editor preserves
// paragraph indents visually (HTML collapses runs of regular spaces, but not
// em-spaces).
function paragraphIndentToEditor(line: string) {
  let i = 0;
  let prefix = "";
  while (line.slice(i, i + 4) === "    ") {
    prefix += EM_SPACE;
    i += 4;
  }
  return prefix + line.slice(i);
}

// Convert leading em-spaces back to 4 regular spaces each so the .md file
// reads cleanly in plain text editors.
export function paragraphIndentToMarkdown(text: string) {
  return text.replace(new RegExp(`^${EM_SPACE}+`), (match) => "    ".repeat(match.length));
}

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
  type ListLevel = { type: "ul" | "ol" | "task"; indent: number; openLi: boolean; lastLiIndex: number };
  const listStack: ListLevel[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let codeLanguage = "";
  let tableRows: string[][] = [];
  let inTable = false;
  let blankLineRun = 0;
  // Blank lines that occurred while a list was open. They might be item
  // separators ("loose list") or end-of-list — decided when the next line is
  // processed.
  let listInternalBlankRun = 0;

  const flushBlankParagraphs = () => {
    if (blankLineRun > 1 && html.length > 0) {
      for (let k = 0; k < blankLineRun - 1; k += 1) {
        html.push("<p></p>");
      }
    }
    blankLineRun = 0;
  };

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
    // Buffered blanks that turned out to be end-of-list blanks count toward
    // paragraph spacing instead of item separators.
    if (listInternalBlankRun > 0) {
      blankLineRun += listInternalBlankRun;
      listInternalBlankRun = 0;
    }
    while (listStack.length) {
      popList();
      closeOpenLi();
    }
  };

  const emitListItem = (indent: number, type: ListLevel["type"], openItemHtml: string) => {
    while (listStack.length) {
      const top = listStack[listStack.length - 1];
      if (top.indent < indent) break;
      if (top.indent === indent && top.type === type) break;
      popList();
    }
    let top = listStack[listStack.length - 1];

    if (!top || top.indent < indent) {
      html.push(openTag(type));
      listStack.push({ type, indent, openLi: false, lastLiIndex: -1 });
      top = listStack[listStack.length - 1];
    } else if (top.indent === indent && top.type !== type) {
      closeOpenLi();
      html.push(closeTag(top.type));
      listStack.pop();
      html.push(openTag(type));
      listStack.push({ type, indent, openLi: false, lastLiIndex: -1 });
      top = listStack[listStack.length - 1];
    }

    // If blank lines were buffered while inside this list and we have a
    // previous item at the same level, the blanks were a "spacer" — mark the
    // previous item rather than emitting empty paragraphs.
    if (listInternalBlankRun > 0 && top.lastLiIndex >= 0) {
      html[top.lastLiIndex] = html[top.lastLiIndex].replace(/^<li/, '<li data-separator-after="true"');
    }
    listInternalBlankRun = 0;

    closeOpenLi();
    top.lastLiIndex = html.length;
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

  const startsNewBlock = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return true;
    if (trimmed.startsWith("```")) return true;
    if (isTableRow(raw)) return true;
    if (/^(#{1,6})\s+/.test(trimmed)) return true;
    if (/^---+$/.test(trimmed)) return true;
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)) return true;
    if (/^<img\s/i.test(trimmed)) return true;
    if (/^>\s+/.test(trimmed)) return true;
    const indent = indentOf(raw);
    const stripped = raw.slice(indent);
    if (/^-\s+\[( |x)\]\s+/i.test(stripped)) return true;
    if (/^[-*]\s+/.test(stripped)) return true;
    if (/^\d+\.\s+/.test(stripped)) return true;
    return false;
  };

  // Consume indented continuation lines under a list item that uses
  // two-trailing-spaces hard breaks. Returns the merged content (with hard
  // breaks encoded as the placeholder) and the index of the last line
  // consumed.
  const gatherListContinuation = (startIndex: number, bulletIndent: number, firstContent: string) => {
    let content = firstContent;
    let j = startIndex;
    while (/ {2,}$/.test(content) && j + 1 < lines.length) {
      const next = lines[j + 1];
      if (!next.trim()) break;
      const nextIndent = indentOf(next);
      if (nextIndent < bulletIndent + 2) break;
      const nextStripped = next.slice(nextIndent);
      if (/^[-*]\s/.test(nextStripped)) break;
      if (/^\d+\.\s/.test(nextStripped)) break;
      if (/^-\s+\[( |x)\]\s/i.test(nextStripped)) break;
      content = content.replace(/ {2,}$/, "") + HARD_BREAK_PLACEHOLDER + nextStripped;
      j += 1;
    }
    content = content.replace(/ {2,}$/, "");
    return { content, lastIndex: j };
  };

  // Consume following non-blank lines as continuation of the current paragraph
  // when the current content ends with two trailing spaces.
  const gatherParagraphContinuation = (startIndex: number, firstContent: string) => {
    let content = firstContent;
    let j = startIndex;
    while (/ {2,}$/.test(content) && j + 1 < lines.length) {
      const next = lines[j + 1];
      if (!next.trim()) break;
      if (startsNewBlock(next)) break;
      content = content.replace(/ {2,}$/, "") + HARD_BREAK_PLACEHOLDER + next;
      j += 1;
    }
    content = content.replace(/ {2,}$/, "");
    return { content, lastIndex: j };
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      if (inCode) {
        const langAttr = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : "";
        html.push(`<pre><code${langAttr}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        codeLanguage = "";
        inCode = false;
      } else {
        closeList();
        closeTable();
        flushBlankParagraphs();
        inCode = true;
        codeLanguage = line.slice(3).trim();
      }
      i += 1;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      i += 1;
      continue;
    }

    // GFM table rows
    if (isTableRow(line) && !isTableSeparator(line)) {
      closeList();
      if (!inTable) inTable = true;
      tableRows.push(parseTableRow(line));
      i += 1;
      continue;
    }
    if (inTable && isTableSeparator(line)) {
      tableRows.push([]); // placeholder so header/body split works
      i += 1;
      continue;
    }
    if (inTable) {
      closeTable();
    }

    if (!line.trim()) {
      closeTable();
      if (listStack.length > 0) {
        // Defer the decision: might be an item separator or end-of-list. The
        // next non-blank line resolves it (see emitListItem / closeList).
        listInternalBlankRun += 1;
      } else {
        blankLineRun += 1;
      }
      i += 1;
      continue;
    }

    flushBlankParagraphs();

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      flushBlankParagraphs();
      html.push(`<h${heading[1].length}>${inlineMarkdownToHtml(heading[2], options)}</h${heading[1].length}>`);
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      closeList();
      flushBlankParagraphs();
      html.push("<hr />");
      i += 1;
      continue;
    }

    const standaloneImage = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim());
    if (standaloneImage) {
      closeList();
      closeTable();
      flushBlankParagraphs();
      const [, alt, src] = standaloneImage;
      const resolvedSrc = options.resolveImageSrc?.(src) ?? src;
      html.push(`<img src="${escapeHtml(resolvedSrc)}" alt="${escapeHtml(alt)}" data-markdown-src="${escapeHtml(src)}" />`);
      i += 1;
      continue;
    }

    // Handle raw <img> HTML lines (resized images stored with width attribute)
    if (/^<img\s/i.test(line.trim())) {
      closeList();
      closeTable();
      flushBlankParagraphs();
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
      i += 1;
      continue;
    }

    const quote = /^>\s+(.*)$/.exec(line);
    if (quote) {
      closeList();
      flushBlankParagraphs();
      html.push(`<blockquote><p>${inlineMarkdownToHtml(quote[1], options)}</p></blockquote>`);
      i += 1;
      continue;
    }

    const indent = indentOf(line);
    const stripped = line.slice(indent);

    const task = /^-\s+\[( |x)\]\s+(.*)$/i.exec(stripped);
    if (task) {
      const checked = task[1].toLowerCase() === "x";
      const gathered = gatherListContinuation(i, indent, task[2]);
      i = gathered.lastIndex;
      emitListItem(
        indent,
        "task",
        `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked ? " checked" : ""}><span></span></label><div><p>${inlineMarkdownToHtml(gathered.content, options)}</p></div>`,
      );
      i += 1;
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(stripped);
    if (bullet) {
      const gathered = gatherListContinuation(i, indent, bullet[1]);
      i = gathered.lastIndex;
      emitListItem(indent, "ul", `<li><p>${inlineMarkdownToHtml(gathered.content, options)}</p>`);
      i += 1;
      continue;
    }

    const ordered = /^\d+\.\s+(.*)$/.exec(stripped);
    if (ordered) {
      const gathered = gatherListContinuation(i, indent, ordered[1]);
      i = gathered.lastIndex;
      emitListItem(indent, "ol", `<li><p>${inlineMarkdownToHtml(gathered.content, options)}</p>`);
      i += 1;
      continue;
    }

    closeList();
    flushBlankParagraphs();
    const gathered = gatherParagraphContinuation(i, line);
    i = gathered.lastIndex;
    html.push(`<p>${inlineMarkdownToHtml(paragraphIndentToEditor(gathered.content), options)}</p>`);
    i += 1;
    continue;
  }

  closeList();
  closeTable();
  if (inCode) {
    const langAttr = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : "";
    html.push(`<pre><code${langAttr}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
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
    if (tag === "br") {
      value += HARD_BREAK_PLACEHOLDER;
      return;
    }
    if (tag === "span" && node.getAttribute("data-type") === "emoji") {
      const name = node.getAttribute("data-name");
      value += name ? `:${name}:` : node.textContent ?? "";
      return;
    }
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
  const items = Array.from(list.children).filter((c) => c.tagName.toLowerCase() === "li");
  items.forEach((item, index) => {
    const rawText = inlineHtmlToMarkdown(item);
    let prefix = "- ";
    if (isTask) {
      const checked = item.getAttribute("data-checked") === "true";
      prefix = `- [${checked ? "x" : " "}] `;
    } else if (tag === "ol") {
      prefix = `${index + 1}. `;
    }
    const segments = rawText
      .split(HARD_BREAK_PLACEHOLDER)
      .map((segment) => segment.trim())
      .filter((segment, segmentIndex, all) => segment.length > 0 || segmentIndex < all.length - 1);
    const continuationPad = " ".repeat(prefix.length);
    const lastIndex = segments.length - 1;
    segments.forEach((segment, segmentIndex) => {
      const isFirst = segmentIndex === 0;
      const trailing = segmentIndex < lastIndex ? "  " : "";
      if (isFirst) {
        lines.push(`${indent}${prefix}${segment}${trailing}`);
      } else {
        lines.push(`${indent}${continuationPad}${segment}${trailing}`);
      }
    });
    Array.from(item.children).forEach((child) => {
      const childTag = child.tagName.toLowerCase();
      if (childTag === "ul" || childTag === "ol") {
        lines.push(serializeList(child, depth + 1));
      }
    });
    if (item.getAttribute("data-separator-after") === "true" && index < items.length - 1) {
      lines.push("");
    }
  });
  return lines.join("\n");
}

export function htmlToMarkdown(html: string) {
  const doc = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  const blocks = Array.from(doc.body.firstElementChild?.children ?? []);
  const markdown: string[] = [];

  blocks.forEach((block, index) => {
    const tag = block.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      markdown.push(`${"#".repeat(level)} ${inlineHtmlToMarkdown(block)}`);
    } else if (tag === "p") {
      const inline = inlineHtmlToMarkdown(block);
      if (!inline.trim() && isCodeBlockNeighbor(blocks, index)) {
        return;
      }
      const segments = inline.split(HARD_BREAK_PLACEHOLDER).map(paragraphIndentToMarkdown);
      const lastIndex = segments.length - 1;
      const joined = segments.map((segment, idx) => (idx < lastIndex ? `${segment}  ` : segment)).join("\n");
      markdown.push(joined);
    } else if (tag === "img") {
      markdown.push(imageElementToMarkdown(block));
    } else if (tag === "blockquote") {
      const text = inlineHtmlToMarkdown(block);
      markdown.push(text.split("\n").map((line) => `> ${line}`).join("\n"));
    } else if (tag === "pre") {
      const codeEl = block.querySelector("code");
      const className = codeEl?.getAttribute("class") ?? "";
      const langMatch = /language-([\w+#.-]+)/.exec(className);
      const language = langMatch ? langMatch[1] : "";
      markdown.push(`\`\`\`${language}\n${block.textContent ?? ""}\n\`\`\``);
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
  });

  return `${normalizeMarkdownImageLines(joinMarkdownBlocks(markdown)).trim()}\n`;
}

function isCodeBlockNeighbor(blocks: Element[], index: number) {
  const previous = blocks[index - 1]?.tagName.toLowerCase();
  const next = blocks[index + 1]?.tagName.toLowerCase();
  return previous === "pre" || next === "pre";
}

// Join blocks with paragraph breaks, but let empty entries (from empty
// paragraphs) contribute one extra blank line each instead of being joined
// as normal blocks. So [Hello, "", World] becomes "Hello\n\n\nWorld" — one
// empty paragraph between two real ones.
function joinMarkdownBlocks(blocks: string[]) {
  let result = "";
  let pendingEmpties = 0;
  let started = false;
  for (const block of blocks) {
    if (block === "") {
      if (started) pendingEmpties += 1;
      continue;
    }
    if (started) {
      result += "\n".repeat(2 + pendingEmpties);
    }
    result += block;
    pendingEmpties = 0;
    started = true;
  }
  return result;
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
