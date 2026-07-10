import { describe, expect, it } from "vitest";
import { extractOutline, inlineMarkdownToPlainText } from "./noteDocument";

describe("note document outline", () => {
  it("strips inline Markdown formatting from heading text", () => {
    expect(extractOutline("Note Title", "# ** My Heading **\n## Plain section")).toEqual([
      { id: "heading-0", level: 1, text: "Note Title" },
      { id: "heading-1", level: 1, text: "My Heading" },
      { id: "heading-2", level: 2, text: "Plain section" },
    ]);
  });

  it("keeps readable heading labels for links, code, highlights, and emphasis", () => {
    expect(inlineMarkdownToPlainText("[Docs](https://example.com) and `code` with ==marked== *text*")).toBe(
      "Docs and code with marked text",
    );
  });
});
