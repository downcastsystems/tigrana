// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

const { htmlToMarkdown, markdownToHtml } = await import("./markdown");

describe("Markdown round trips", () => {
  const cases = [
    ["paragraph", "A quiet place to write."],
    ["heading", "# Story Notes"],
    ["bullet list", "- First scene\n- Second scene"],
    ["numbered list", "1. First scene\n2. Second scene"],
    ["task list", "- [ ] Draft chapter\n- [x] Name characters"],
    ["blockquote", "> Keep writing"],
    ["code block", "```ts\nconst chapter = 1;\n```"],
    ["divider", "---"],
    ["inline marks and link", "**Bold** *italic* ~~cut~~ `code` [reference](https://example.com)"],
    ["image", "![Map](.assets/map.png)"],
    ["table", "| Character | Role |\n| --- | --- |\n| Mina | Lead |"],
  ] as const;

  it.each(cases)("round-trips %s through the editor HTML policy", (_name, markdown) => {
    expect(htmlToMarkdown(markdownToHtml(markdown)).trimEnd()).toBe(markdown);
  });

  it("renders known emoji shortcodes as plain emoji text", () => {
    const html = markdownToHtml("# :white_check_mark: SSA");

    expect(html).toContain("<h1>✅ SSA</h1>");
    expect(html).not.toContain('data-type="emoji"');
  });

  it("renders alternate fenced code blocks and normalizes them on save", () => {
    const markdown = "~~~~ts\n# This is code\n~~~~";
    const html = markdownToHtml(markdown);

    expect(html).toBe('<pre><code class="language-ts"># This is code</code></pre>');
    expect(htmlToMarkdown(html).trimEnd()).toBe("```ts\n# This is code\n```");
  });

  it("uses a longer saved fence when code contains triple backticks", () => {
    const markdown = "````md\n```\n# This is still code\n````";

    expect(htmlToMarkdown(markdownToHtml(markdown)).trimEnd()).toBe(markdown);
  });

  it("uses the same policy for clipboard-like HTML fragments", () => {
    const html = [
      "<h2>Scene</h2>",
      "<p><strong>Bold</strong> and <a href=\"https://example.com\">linked</a></p>",
      "<ul><li><p>First</p></li><li><p>Second</p></li></ul>",
    ].join("");

    expect(htmlToMarkdown(html).trimEnd()).toBe("## Scene\n\n**Bold** and [linked](https://example.com)\n\n- First\n- Second");
  });

  it("serializes copied tables as readable GFM Markdown", () => {
    const html = "<table><tbody><tr><th>Character</th><th>Role</th></tr><tr><td>Mina</td><td>Lead</td></tr></tbody></table>";

    expect(htmlToMarkdown(html).trimEnd()).toBe("| Character | Role |\n| --- | --- |\n| Mina | Lead |");
  });

  it("serializes headerless copied tables as valid GFM Markdown", () => {
    const html = "<table><tbody><tr><td>Character</td><td>Role</td></tr><tr><td>Mina</td><td>Lead</td></tr></tbody></table>";

    expect(htmlToMarkdown(html).trimEnd()).toBe("| Character | Role |\n| --- | --- |\n| Mina | Lead |");
  });

  it.fails("keeps consecutive quoted lines in one blockquote", () => {
    const markdown = "> First quoted line\n> Second quoted line";

    expect(htmlToMarkdown(markdownToHtml(markdown)).trimEnd()).toBe(markdown);
  });
});
