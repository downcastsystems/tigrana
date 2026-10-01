import { footnoteAnchor, footnoteKey, footnoteMarkdown, parseFootnotes } from "./footnotes";
import { alignmentOpening, readTextAlignment } from "./textAlignment";
import { readParagraphIndentMarker } from "./writingStyle";
import { replaceEmojiShortcodes } from "./emoji";
import { inlineColorValue, restoreInlineColorSpans } from "./inlineColors";
import { isSupportedOrderedListNumber } from "./orderedListNumbers";
import {
  closesMarkdownCodeFence,
  markdownCodeFenceDelimiter,
  readMarkdownCodeFence,
  type MarkdownCodeFence,
} from "./markdownCodeFence";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type MarkdownOptions = {
  resolveImageSrc?: (src: string) => string;
  renderEquation?: (latex: string, block: boolean) => string;
};

// Internal marker used to represent a hard line break (Shift+Enter) inside a
// single block's text, so it survives escapeHtml and round-trips through the
// list/paragraph pipelines without colliding with normal text.
export const HARD_BREAK_PLACEHOLDER = "";

const inlineMarkdownToHtml = (value: string, options: MarkdownOptions = {}) => {
  const images: string[] = [];
  let imageToken = "\u0002";
  while (value.includes(imageToken)) imageToken += "\u0002";
  // Resized images can also occur inside list items.
  const protectedValue = value.replace(/`[^`]+`|<img\s[^>]*\/?>/gi, image => {
    if (image.startsWith("`")) return image;
    const src = /\bsrc="([^"]*)"/.exec(image)?.[1];
    if (src === undefined) return image;
    const decode = (text: string) => text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const source = decode(src);
    const alt = decode(/\balt="([^"]*)"/.exec(image)?.[1] ?? "");
    const width = /\bwidth="(\d+)"/.exec(image)?.[1];
    const rendered = `<img src="${escapeHtml(options.resolveImageSrc?.(source) ?? source)}" alt="${escapeHtml(alt)}" data-markdown-src="${escapeHtml(source)}"${width ? ` width="${width}"` : ""} />`;
    return `${imageToken}${images.push(rendered) - 1}${imageToken}`;
  });
  let html = escapeHtml(protectedValue);
  html = html.replace(new RegExp(HARD_BREAK_PLACEHOLDER, "g"), "<br>");
  html = replaceEmojiShortcodes(html);
  // Protect code before recognizing inline markup, including literal <u> examples.
  const codeSpans: string[] = [];
  let codeToken = "\u0000";
  while (html.includes(codeToken)) codeToken += "\u0000";
  html = html.replace(/`([^`]+)`/g, (_match, code: string) => {
    const index = codeSpans.push(`<code>${code}</code>`) - 1;
    return `${codeToken}${index}${codeToken}`;
  });
  // Protect TeX before emphasis, links and other inline Markdown can rewrite it.
  // Delimiter whitespace and following digits distinguish common currency text.
  html = html.replace(/(?<![\\$])\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<!\s)\$(?![\d$])/g, (match, latex: string, offset: number, sourceHtml: string) => {
    // Dollar signs in link/image destinations are part of the URL.
    const prefix = sourceHtml.slice(0, offset);
    if (prefix.lastIndexOf("](") > prefix.lastIndexOf(")")) return match;
    const source = latex.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const rendered = options.renderEquation?.(source, false) ?? latex;
    const index = codeSpans.push(`<span data-type="inlineMath" data-latex="${latex}">${rendered}</span>`) - 1;
    return `${codeToken}${index}${codeToken}`;
  });
  // Markdown has no underline delimiter. Accept only the bare HTML pair we emit,
  // keeping arbitrary tags and attributes escaped.
  html = html.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/gi, "<u>$1</u>");
  html = restoreInlineColorSpans(html);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, src: string) => {
    const resolvedSrc = options.resolveImageSrc?.(src) ?? src;
    return `<img src="${escapeHtml(resolvedSrc)}" alt="${escapeHtml(alt)}" data-markdown-src="${escapeHtml(src)}" />`;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/==([^=]+)==/g, "<mark>$1</mark>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\\(\[\^[^\]\s<>]+\])/g, "$1");
  return html.replace(new RegExp(`${codeToken}(\\d+)${codeToken}`, "g"), (_match, index: string) => codeSpans[Number(index)])
    .replace(new RegExp(`${imageToken}(\\d+)${imageToken}`, "g"), (_match, index: string) => images[Number(index)]);
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

function startsHtmlTable(line: string) {
  return /^<table\b/i.test(line.trim());
}

function endsHtmlTable(line: string) {
  return /<\/table>\s*$/i.test(line.trim());
}

export function markdownToHtml(markdown: string, options: MarkdownOptions = {}): string {
  const footnotes = parseFootnotes(markdown);
  if (footnotes.definitions.length || footnotes.references.length) {
    let token = "\u0003";
    while (markdown.includes(token)) token += "\u0003";
    const replacements = [
      ...footnotes.references.map(reference => ({ ...reference, html: `<sup data-type="footnoteReference" data-label="${escapeHtml(reference.label)}" data-number="${reference.number}"><a href="#${footnoteAnchor(reference.label)}">${reference.number}</a></sup>`, block: false })),
      ...footnotes.definitions.map(definition => ({ ...definition, html: "", block: true })),
    ].sort((a, b) => a.from - b.from);
    // Assemble slices once, rather than copying the entire note for every
    // reference/definition. Track the suffix's first two characters to preserve
    // the existing blank-line handling between adjacent definitions.
    const parts: string[] = [];
    let cursor = markdown.length;
    let suffixStart = "";
    for (let n = replacements.length - 1; n >= 0; n--) {
      const replacement = replacements[n];
      const marker = `${token}${n}${token}`;
      const after = markdown.slice(replacement.to, cursor);
      const beforeEnd = markdown.slice(Math.max(0, replacement.from - 2), replacement.from);
      const afterStart = (after.slice(0, 2) + suffixStart).slice(0, 2);
      let beforePadding = "";
      let afterPadding = "";
      if (replacement.block) {
        if (beforeEnd && beforeEnd !== "\n\n") beforePadding = beforeEnd.endsWith("\n") ? "\n" : "\n\n";
        if (afterStart && afterStart !== "\n\n") afterPadding = afterStart.startsWith("\n") ? "\n" : "\n\n";
      }
      parts.push(after, afterPadding, marker, beforePadding);
      suffixStart = (beforePadding + marker).slice(0, 2);
      cursor = replacement.from;
    }
    parts.push(markdown.slice(0, cursor));
    const source = parts.reverse().join("");
    const rendered = markdownToHtml(source, options).replace(new RegExp(`<p>${token}(\\d+)${token}</p>|${token}(\\d+)${token}`, "g"), (match, blockIndex, inlineIndex) => {
      const replacement = replacements[Number(blockIndex ?? inlineIndex)];
      if (blockIndex !== undefined) return replacement.block ? replacement.html : `<p>${replacement.html}</p>`;
      return replacement.block ? match : replacement.html;
    });
    const numbers = new Map(footnotes.references.map(reference => [footnoteKey(reference.label), reference.number]));
    const definitions = [...footnotes.definitions].sort((a, b) =>
      (numbers.get(footnoteKey(a.label)) ?? Infinity) - (numbers.get(footnoteKey(b.label)) ?? Infinity));
    return rendered + definitions.map(definition => {
      const number = numbers.get(footnoteKey(definition.label)) ?? "–";
      return `<aside data-type="footnoteDefinition" data-label="${escapeHtml(definition.label)}" data-markdown="${escapeHtml(definition.markdown)}" id="${footnoteAnchor(definition.label)}" class="footnote-definition"><button type="button" contenteditable="false" class="footnote-backlink" data-footnote-backlink="${escapeHtml(definition.label)}">${number}</button><div class="footnote-content">${markdownToHtml(definition.body, options) || "<p></p>"}</div></aside>`;
    }).join("");
  }
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  type ListLevel = { type: "ul" | "ol" | "task"; indent: number; openLi: boolean; lastLiIndex: number };
  const listStack: ListLevel[] = [];
  let codeFence: MarkdownCodeFence | null = null;
  let codeLines: string[] = [];
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
    if (alignmentOpening.test(raw)) return true;
    if (trimmed.startsWith("$$")) return true;
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

    if (codeFence) {
      if (closesMarkdownCodeFence(line, codeFence)) {
        const langAttr = codeFence.info ? ` class="language-${escapeHtml(codeFence.info)}"` : "";
        html.push(`<pre><code${langAttr}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        codeFence = null;
      } else {
        codeLines.push(line);
      }
      i += 1;
      continue;
    }

    const alignment = alignmentOpening.exec(line);
    if (alignment) {
      let end = i + 1;
      while (end < lines.length && lines[end] !== "</div>") end++;
      if (end < lines.length) {
        closeList(); closeTable(); flushBlankParagraphs();
        const inner = markdownToHtml(lines.slice(i + 1, end).join("\n").replace(/^\n|\n$/g, ""), options) || "<p></p>";
        // Put alignment directly on text blocks so loading through Tiptap and
        // exporting through htmlToMarkdown follow the same representation.
        html.push(inner.replace(/<(p|h[1-6])(?=[ >])/g, `<$1 style="text-align: ${alignment[1]}"`));
        i = end + 1;
        continue;
      }
    }

    const paragraphIndent = readParagraphIndentMarker(line);
    const nextLine = lines[i + 1] ?? "";
    if (paragraphIndent && (!nextLine.trim() || !startsNewBlock(nextLine) && !readMarkdownCodeFence(nextLine) && !readParagraphIndentMarker(nextLine))) {
      closeList();
      closeTable();
      flushBlankParagraphs();
      const gathered = gatherParagraphContinuation(i + 1, nextLine);
      html.push(`<p data-story-indent="${paragraphIndent}">${inlineMarkdownToHtml(paragraphIndentToEditor(gathered.content), options)}</p>`);
      i = gathered.lastIndex + 1;
      continue;
    }

    const openingFence = readMarkdownCodeFence(line);
    if (openingFence) {
      closeList();
      closeTable();
      flushBlankParagraphs();
      codeFence = openingFence;
      i += 1;
      continue;
    }

    if (line.trim().startsWith("$$")) {
      const trimmed = line.trim();
      const single = trimmed.length > 4 && trimmed.endsWith("$$");
      let end = i + 1;
      if (trimmed === "$$") {
        while (end < lines.length && lines[end].trim() !== "$$") end++;
      }
      if (single || (trimmed === "$$" && end < lines.length)) {
        closeList(); closeTable(); flushBlankParagraphs();
        const latex = single ? trimmed.slice(2, -2).trim() : lines.slice(i + 1, end).join("\n");
        html.push(`<div data-type="blockMath" data-latex="${escapeHtml(latex)}">${options.renderEquation?.(latex, true) ?? escapeHtml(latex)}</div>`);
        i = single ? i + 1 : end + 1;
        continue;
      }
    }

    if (startsHtmlTable(line)) {
      closeList();
      closeTable();
      flushBlankParagraphs();
      const tableLines = [line];
      while (!endsHtmlTable(lines[i] ?? "") && i + 1 < lines.length) {
        i += 1;
        tableLines.push(lines[i]);
      }
      html.push(tableLines.join("\n"));
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

    const ordered = /^(\d+)\.\s+(.*)$/.exec(stripped);
    if (ordered && isSupportedOrderedListNumber(ordered[1])) {
      const gathered = gatherListContinuation(i, indent, ordered[2]);
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
  if (codeFence) {
    const langAttr = codeFence.info ? ` class="language-${escapeHtml(codeFence.info)}"` : "";
    html.push(`<pre><code${langAttr}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  return html.join("\n");
}

function inlineHtmlToMarkdown(element: Element): string {
  let value = "";
  element.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Literal rich-text labels must not become references on the next reload.
      value += element.closest("code, pre") ? node.textContent ?? ""
        : (node.textContent ?? "").replace(/(?<!\\)\[\^([^\]\s<>]+)\]/g, "\\$&");
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
    if (node.getAttribute("data-type") === "footnoteReference") {
      value += `[^${node.getAttribute("data-markdown-label") ?? node.getAttribute("data-label") ?? ""}]`;
      return;
    }
    if (node.getAttribute("data-type") === "inlineMath") {
      value += `$${node.getAttribute("data-latex") ?? ""}$`;
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
    else if (tag === "u") value += `<u>${content}</u>`;
    else if (tag === "s" || tag === "strike" || tag === "del") value += `~~${content}~~`;
    else if (tag === "span" || tag === "mark") {
      const color = inlineColorValue(node, "text");
      const background = inlineColorValue(node, "highlight");
      const styles = [color && `color: ${color}`, background && `background-color: ${background}`].filter(Boolean);
      value += styles.length ? `<span style="${styles.join("; ")}">${content}</span>` : tag === "mark" ? `==${content}==` : content;
    }
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

export type MarkdownBlockCache = WeakMap<Element, { neighbors: string; markdown: string[] }>;

/** Immutable offscreen blocks may reuse their conversion between editor saves. */
export function htmlToMarkdown(html: string | readonly Element[], cache?: MarkdownBlockCache) {
  const blocks = typeof html === "string"
    ? Array.from(new DOMParser().parseFromString(`<main>${html}</main>`, "text/html").body.firstElementChild?.children ?? [])
    : html;
  const markdown: string[] = [];
  blocks.forEach((block, index) => {
    // Empty landing paragraphs depend on their immediate code/table neighbors.
    const neighbors = block.tagName.toLowerCase() === "p"
      ? `${blocks[index - 1]?.tagName ?? ""}/${blocks[index + 1]?.tagName ?? ""}` : "";
    const cached = cache?.get(block);
    const converted = cached?.neighbors === neighbors ? cached.markdown : serializeMarkdownBlock(block, index, blocks);
    if (cache && converted !== cached?.markdown) cache.set(block, { neighbors, markdown: converted });
    markdown.push(...converted);
  });
  return `${normalizeMarkdownImageLines(joinMarkdownBlocks(markdown)).trimEnd()}\n`;
}

function serializeMarkdownBlock(block: Element, index: number, blocks: readonly Element[]) {
  const markdown: string[] = [];
  const tag = block.tagName.toLowerCase();

  if (block.getAttribute("data-type") === "footnoteDefinition") {
    const content = block.querySelector(":scope > .footnote-content");
    const original = block.getAttribute("data-markdown") ?? "";
    const label = block.getAttribute("data-markdown-label") ?? block.getAttribute("data-label") ?? "1";
    const body = content ? htmlToMarkdown(content.innerHTML).trimEnd() : "";
    const originalBody = original ? parseFootnotes(original).definitions[0]?.body : undefined;
    // Keep untouched source, including soft line breaks, until its editable content changes.
    const unchanged = originalBody !== undefined && body === htmlToMarkdown(markdownToHtml(originalBody)).trimEnd();
    markdown.push(unchanged || !content ? original.replace(/^\[\^[^\]]+\]:/, () => `[^${label}]:`) : footnoteMarkdown(label, body));
    return markdown;
  }
  const alignment = readTextAlignment(block.getAttribute("style"));
  if ((tag === "p" || /^h[1-6]$/.test(tag)) && (alignment === "center" || alignment === "right")) {
    const copy = block.cloneNode(true) as HTMLElement;
    copy.style.removeProperty("text-align");
    markdown.push(`<div style="text-align: ${alignment}">\n\n${htmlToMarkdown(copy.outerHTML).trimEnd()}\n\n</div>`);
  } else if (block.getAttribute("data-type") === "blockMath") {
    markdown.push(`$$\n${block.getAttribute("data-latex") ?? ""}\n$$`);
  } else if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    markdown.push(`${"#".repeat(level)} ${inlineHtmlToMarkdown(block)}`);
  } else if (tag === "p") {
    const inline = inlineHtmlToMarkdown(block);
    const storyIndent = block.getAttribute("data-story-indent");
    const hasIndentOverride = storyIndent === "indent" || storyIndent === "none";
    if (!hasIndentOverride && !inline.trim() && isCodeBlockNeighbor(blocks, index)) {
      return markdown;
    }
    if (!hasIndentOverride && !inline.trim() && isTableLandingParagraph(blocks, index)) {
      return markdown;
    }
    const segments = inline.split(HARD_BREAK_PLACEHOLDER).map(paragraphIndentToMarkdown);
    const lastIndex = segments.length - 1;
    const joined = segments.map((segment, idx) => (idx < lastIndex ? `${segment}  ` : segment)).join("\n");
    const marker = hasIndentOverride ? `<!-- tigrana:paragraph ${storyIndent} -->\n` : "";
    markdown.push(marker + joined);
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
    const code = block.textContent ?? "";
    const fence = markdownCodeFenceDelimiter(code);
    markdown.push(`${fence}${language}\n${code}\n${fence}`);
  } else if (tag === "hr") {
    markdown.push("---");
  } else if (tag === "ul" || tag === "ol") {
    markdown.push(serializeList(block, 0));
  } else if (tag === "table" && (block.getAttribute("data-tigrana-table") === "true" || block.querySelector('[data-type="inlineMath"], [data-type="blockMath"]'))) {
    markdown.push(serializeTigranaHtmlTable(block));
  } else if (tag === "table") {
    // Handle both standard <thead>/<tbody> and TipTap's tbody-only structure
    // (TipTap puts all rows in <tbody>, using <th> for the header row).
    // Push the entire table as ONE entry so the final \n\n join doesn't insert
    // blank lines between rows, which would break markdownToHtml's table parser.
    const allRows = Array.from(block.querySelectorAll("tr"));
    if (allRows.length > 0) {
      const tableLines: string[] = [];
      const firstCells = Array.from(allRows[0].children);
      // GFM requires a delimiter row, so a headerless HTML table promotes
      // its first row to a Markdown header instead of producing invalid syntax.
      tableLines.push("| " + firstCells.map((c) => inlineHtmlToMarkdown(c).trim()).join(" | ") + " |");
      tableLines.push("| " + firstCells.map(() => "---").join(" | ") + " |");
      for (const row of allRows.slice(1)) {
        const cells = Array.from(row.children);
        tableLines.push("| " + cells.map((c) => inlineHtmlToMarkdown(c).trim()).join(" | ") + " |");
      }
      markdown.push(tableLines.join("\n"));
    }
  }
  return markdown;
}

function serializeTigranaHtmlTable(table: Element) {
  const rows = Array.from(table.querySelectorAll("tr"));
  const columnCount = rows.reduce((max, row) => Math.max(max, row.children.length), 0);
  const widths = getTigranaTableWidths(table, columnCount);
  const headerRow = table.getAttribute("data-header-row") !== "false";
  const headerColumn = table.getAttribute("data-header-column") === "true";
  const lines: string[] = [
    `<table data-tigrana-table="true" data-header-row="${headerRow ? "true" : "false"}" data-header-column="${headerColumn ? "true" : "false"}">`,
  ];

  if (columnCount > 0) {
    lines.push("  <colgroup>");
    for (const width of widths) {
      lines.push(`    <col data-width="${width}">`);
    }
    lines.push("  </colgroup>");
  }

  const writeRow = (row: Element, indent: string) => {
    lines.push(`${indent}<tr>`);
    Array.from(row.children).forEach((cell, cellIndex) => {
      const tag = headerColumn && cellIndex === 0 ? "th" : cell.tagName.toLowerCase() === "th" ? "th" : "td";
      lines.push(`${indent}  <${tag}>${serializeTableCellHtml(cell)}</${tag}>`);
    });
    lines.push(`${indent}</tr>`);
  };

  const [firstRow, ...bodyRows] = rows;
  if (headerRow && firstRow) {
    lines.push("  <thead>");
    writeRow(firstRow, "    ");
    lines.push("  </thead>");
    if (bodyRows.length > 0) {
      lines.push("  <tbody>");
      bodyRows.forEach((row) => writeRow(row, "    "));
      lines.push("  </tbody>");
    }
  } else if (rows.length > 0) {
    lines.push("  <tbody>");
    rows.forEach((row) => writeRow(row, "    "));
    lines.push("  </tbody>");
  }

  lines.push("</table>");
  return lines.join("\n");
}

function getTigranaTableWidths(table: Element, columnCount: number) {
  const cols = Array.from(table.querySelectorAll("colgroup > col"));
  return Array.from({ length: columnCount }, (_value, index) => {
    const col = cols[index] as HTMLElement | undefined;
    const raw =
      col?.getAttribute("data-width") ??
      col?.getAttribute("width") ??
      (/width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(col?.getAttribute("style") ?? "")?.[1] ?? null);
    const width = raw ? Math.round(Number(raw)) : 160;
    return Number.isFinite(width) && width > 0 ? width : 160;
  });
}

function serializeTableCellHtml(cell: Element) {
  const clone = cell.cloneNode(true) as Element;
  // Runtime palette variables never belong in portable HTML-table content.
  clone.querySelectorAll("[data-text-color], [data-highlight-color]").forEach(element => {
    const color = inlineColorValue(element, "text");
    const background = inlineColorValue(element, "highlight");
    const styles = [color && `color: ${color}`, background && `background-color: ${background}`].filter(Boolean);
    element.removeAttribute("data-text-color");
    element.removeAttribute("data-highlight-color");
    if (styles.length) element.setAttribute("style", styles.join("; "));
    else element.removeAttribute("style");
  });
  clone.querySelectorAll("[data-node-view-wrapper], [data-node-view-content], [data-node-view-content-react]").forEach((element) => {
    element.removeAttribute("data-node-view-wrapper");
    element.removeAttribute("data-node-view-content");
    element.removeAttribute("data-node-view-content-react");
  });
  clone.querySelectorAll("[class]").forEach((element) => {
    const className = element.getAttribute("class") ?? "";
    const kept = className.split(/\s+/).filter((name) => !/^ProseMirror/.test(name) && name !== "selectedCell");
    if (kept.length > 0) element.setAttribute("class", kept.join(" "));
    else element.removeAttribute("class");
  });

  const elementChildren = Array.from(clone.children);
  if (elementChildren.length === 1 && elementChildren[0].tagName.toLowerCase() === "p") {
    return elementChildren[0].innerHTML;
  }
  return clone.innerHTML;
}

function isCodeBlockNeighbor(blocks: readonly Element[], index: number) {
  const previous = blocks[index - 1]?.tagName.toLowerCase();
  const next = blocks[index + 1]?.tagName.toLowerCase();
  return previous === "pre" || next === "pre";
}

function isTableLandingParagraph(blocks: readonly Element[], index: number) {
  return blocks[index - 1]?.tagName.toLowerCase() === "table";
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
  return markdown.split("\n").map(line => /^\s*(?:[-*]|\d+\.)\s/.test(line) ? line : line
    .replace(/([^\n])(<img\s[^>]*\/>)/gi, "$1\n\n$2")
    .replace(/(<img\s[^>]*\/>)([^\n])/gi, "$1\n\n$2")
    .replace(/([^\n])(!\[[^\]]*\]\([^)]+\))/g, "$1\n\n$2")
    .replace(/(!\[[^\]]*\]\([^)]+\))([^\n])/g, "$1\n\n$2")).join("\n");
}
