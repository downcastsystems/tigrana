const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const inlineMarkdownToHtml = (value: string) => {
  let html = escapeHtml(value);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
};

export function markdownToHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let listType: "ul" | "ol" | "task" | null = null;
  let inCode = false;
  let codeLines: string[] = [];

  const closeList = () => {
    if (!listType) return;
    html.push(listType === "ol" ? "</ol>" : "</ul>");
    listType = null;
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      html.push(`<h${heading[1].length}>${inlineMarkdownToHtml(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      closeList();
      html.push("<hr />");
      continue;
    }

    const quote = /^>\s+(.*)$/.exec(line);
    if (quote) {
      closeList();
      html.push(`<blockquote><p>${inlineMarkdownToHtml(quote[1])}</p></blockquote>`);
      continue;
    }

    const task = /^-\s+\[( |x)\]\s+(.*)$/i.exec(line);
    if (task) {
      if (listType !== "task") {
        closeList();
        html.push('<ul data-type="taskList">');
        listType = "task";
      }
      html.push(`<li data-type="taskItem" data-checked="${task[1].toLowerCase() === "x"}"><label><input type="checkbox" ${task[1].toLowerCase() === "x" ? "checked" : ""}><span></span></label><div><p>${inlineMarkdownToHtml(task[2])}</p></div></li>`);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li><p>${inlineMarkdownToHtml(bullet[1])}</p></li>`);
      continue;
    }

    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li><p>${inlineMarkdownToHtml(ordered[1])}</p></li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdownToHtml(line)}</p>`);
  }

  closeList();
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
    const content = inlineHtmlToMarkdown(node);

    if (tag === "strong" || tag === "b") value += `**${content}**`;
    else if (tag === "em" || tag === "i") value += `*${content}*`;
    else if (tag === "s" || tag === "strike" || tag === "del") value += `~~${content}~~`;
    else if (tag === "code") value += `\`${content}\``;
    else if (tag === "a") value += `[${content}](${node.getAttribute("href") ?? ""})`;
    else if (tag === "img") value += `![${node.getAttribute("alt") ?? "Image"}](${node.getAttribute("src") ?? ""})`;
    else value += content;
  });
  return value;
}

export function htmlToMarkdown(html: string) {
  const doc = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  const blocks = Array.from(doc.body.firstElementChild?.children ?? []);
  const markdown: string[] = [];

  for (const block of blocks) {
    const tag = block.tagName.toLowerCase();

    if (/h[1-6]/.test(tag)) {
      const level = Number(tag.slice(1));
      markdown.push(`${"#".repeat(Math.min(level, 3))} ${inlineHtmlToMarkdown(block)}`);
    } else if (tag === "p") {
      markdown.push(inlineHtmlToMarkdown(block));
    } else if (tag === "blockquote") {
      const text = inlineHtmlToMarkdown(block);
      markdown.push(text.split("\n").map((line) => `> ${line}`).join("\n"));
    } else if (tag === "pre") {
      markdown.push(`\`\`\`\n${block.textContent ?? ""}\n\`\`\``);
    } else if (tag === "hr") {
      markdown.push("---");
    } else if (tag === "ul" || tag === "ol") {
      const isTask = block.getAttribute("data-type") === "taskList";
      Array.from(block.children).forEach((item, index) => {
        const text = inlineHtmlToMarkdown(item);
        if (isTask) {
          const checked = item.getAttribute("data-checked") === "true";
          markdown.push(`- [${checked ? "x" : " "}] ${text}`);
        } else if (tag === "ol") {
          markdown.push(`${index + 1}. ${text}`);
        } else {
          markdown.push(`- ${text}`);
        }
      });
    }
  }

  return `${markdown.join("\n\n").trim()}\n`;
}
