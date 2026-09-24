// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readWritingStyle, setWritingStyle } from "./writingStyle";
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
const { htmlToMarkdown, markdownToHtml } = await import("./markdown");
const { readNoteDocument, readNotePreview, measureNoteText } = await import("./noteDocument");
const { buildNoteExportHtml } = await import("./exportNote");

describe("Portable writing styles", () => {
  it("defaults existing notes to Notes and preserves unrelated frontmatter", () => {
    const original = '# Keep this\nid: 123\ncreated_at: 2026-09-23\nauthor: Name';
    expect(readWritingStyle(original)).toBe("notes");
    const story = setWritingStyle(original, "story");
    expect(story).toContain(original);
    expect(readWritingStyle(story)).toBe("story");
    const notes = setWritingStyle(story, "notes");
    expect(readWritingStyle(notes)).toBe("notes");
    expect(notes.match(/tigrana_writing_style/g)).toHaveLength(1);
    expect(readWritingStyle('tigrana_writing_style: "story" # prose')).toBe("story");
    expect(readWritingStyle('tigrana_writing_style: unknown')).toBe("notes");
    expect(readNoteDocument(`---\n${story}\n---\n\nBody`, "Title").body).toBe("Body");
  });

  it.each(["indent", "none"])("round-trips a %s exception with readable Markdown and inline formatting", indent => {
    const markdown = `<!-- tigrana:paragraph ${indent} -->\n**Opening** with a [link](Next.md).  \nAnother line.\n\nNext paragraph.`;
    const html = markdownToHtml(markdown);
    expect(html).toContain(`<p data-story-indent="${indent}">`);
    expect(html).not.toContain("&lt;!--");
    expect(htmlToMarkdown(html).trimEnd()).toBe(markdown);
    expect(readNotePreview(markdown)).not.toContain("tigrana");
    expect(measureNoteText(markdown)).toEqual(measureNoteText(markdown.split("\n").slice(1).join("\n")));
  });

  it("keeps an empty overridden paragraph across reloads", () => {
    const markdown = htmlToMarkdown('<p>Opening</p><p data-story-indent="none"></p>');
    expect(markdownToHtml(markdown)).toBe('<p>Opening</p>\n<p data-story-indent="none"></p>');
  });

  it("keeps empty paragraph exceptions next to code and tables", () => {
    const html = '<pre><code>code</code></pre><p data-story-indent="none"></p><table><tbody><tr><th>A</th></tr><tr><td>B</td></tr></tbody></table>';
    const markdown = htmlToMarkdown(html);
    expect(markdown).toContain("<!-- tigrana:paragraph none -->");
    const reloaded = new DOMParser().parseFromString(markdownToHtml(markdown), "text/html");
    expect(reloaded.querySelector('p[data-story-indent="none"]')?.textContent).toBe("");
    expect(reloaded.querySelector("pre")?.textContent).toBe("code");
    expect(reloaded.querySelector("td")?.textContent).toBe("B");
  });

  it("preserves literal markers inside fenced code", () => {
    const markdown = '```html\n<!-- tigrana:paragraph indent -->\nText\n```';
    expect(markdownToHtml(markdown)).not.toContain('data-story-indent');
    expect(htmlToMarkdown(markdownToHtml(markdown)).trimEnd()).toBe(markdown);
  });

  it("does not swallow structural blocks following an orphan marker", () => {
    const html = markdownToHtml('<!-- tigrana:paragraph indent -->\n~~~\nCode\n~~~\n\n## Heading');
    expect(html).toContain('<pre><code>Code</code></pre>');
    expect(html).toContain('<h2>Heading</h2>');
  });

  it("exports Story layout and exceptions without applying it to Notes", async () => {
    const markdown = 'Opening.\n\n<!-- tigrana:paragraph none -->\nNext.';
    const html = await buildNoteExportHtml("Story", markdown, { writingStyle: "story" });
    expect(html).toContain('main > p + p { margin-top: 0; margin-bottom: 0; text-indent: 1.5em; }');
    expect(html).toContain('<p data-story-indent="none">Next.</p>');
    expect(await buildNoteExportHtml("Notes", markdown)).not.toContain('text-indent: 1.5em');
  });
});
