import { describe, expect, it } from "vitest";
import { buildNoteExportHtml } from "./exportNote";
import { markdownToHtml } from "./markdown";

describe("note export", () => {
  it("renders Markdown highlight syntax as readable HTML", () => {
    expect(markdownToHtml("This is ==important==.")).toContain("<mark>important</mark>");
  });

  it("builds HTML exports with writing blocks and resolved images", async () => {
    const html = await buildNoteExportHtml(
      "Export Test",
      [
        "## Heading",
        "",
        "- [x] Finished **task**",
        "- [ ] Open task  ",
        "      With a continuation line",
        "",
        "- One",
        "- Two",
        "  - Nested",
        "",
        "> A quote",
        "",
        "[Tigrana](https://example.com)",
        "",
        "`inline code` and ==highlight==",
        "",
        "![Diagram](assets/diagram.png)",
        '<img src="assets/wide.png" alt="Wide" width="320" />',
        "",
        "| A | B |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "---",
        "",
        "```ts",
        "const value = 1;",
        "```",
      ].join("\n"),
      { resolveImageSrc: (src) => `data:image/png;base64,${src}` },
    );

    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain('<ul data-type="taskList">');
    expect(html).toContain('<li data-type="taskItem" data-checked="true">');
    expect(html).toContain('<input type="checkbox" checked>');
    expect(html).toContain('With a continuation line');
    expect(html).toContain('ul[data-type="taskList"] > li');
    expect(html).toContain("<ul>");
    expect(html).toContain("<blockquote><p>A quote</p></blockquote>");
    expect(html).toContain('<a href="https://example.com">Tigrana</a>');
    expect(html).toContain("<code>inline code</code>");
    expect(html).toContain("<mark>highlight</mark>");
    expect(html).toContain('src="data:image/png;base64,assets/diagram.png"');
    expect(html).toContain('src="data:image/png;base64,assets/wide.png"');
    expect(html).toContain('width="320"');
    expect(html).toContain("<table>");
    expect(html).toContain("<hr />");
    expect(html).toContain("<pre><code");
  });
});
