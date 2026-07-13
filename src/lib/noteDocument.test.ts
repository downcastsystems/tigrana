import { describe, expect, it } from "vitest";
import {
  createNoteDocument,
  measureNoteText,
  normalizeNoteMarkdown,
  readNoteDocument,
  reviseNoteDocument,
  updateNoteDocumentFrontmatterField,
} from "./noteDocument";

describe("Note document", () => {
  it("reads frontmatter, body, and every derived value together", () => {
    const markdown = "---\nid: note-1\nauthor: Ursula\n---\n\n# **My Heading**\n\nA [quiet](https://example.com) place to write.";

    const document = readNoteDocument(markdown, "Story Notes");

    expect(document).toMatchObject({
      title: "Story Notes",
      markdown,
      frontmatter: "id: note-1\nauthor: Ursula",
      body: "# **My Heading**\n\nA [quiet](https://example.com) place to write.",
      frontmatterError: null,
      outline: [
        { id: "heading-0", level: 1, text: "Story Notes" },
        { id: "heading-1", level: 1, text: "My Heading" },
      ],
      preview: "A quiet place to write.",
      stats: { words: 7, characters: 34 },
    });
    expect(document.frontmatterFields.map(({ key, value, editable }) => ({ key, value, editable }))).toEqual([
      { key: "id", value: "note-1", editable: true },
      { key: "author", value: "Ursula", editable: true },
    ]);
  });

  it("preserves malformed frontmatter as raw Markdown", () => {
    const markdown = "---\nid: note-1\nmissing value\n\nDraft";

    const document = readNoteDocument(markdown, "Draft");

    expect(document.markdown).toBe(markdown);
    expect(document.body).toBe(markdown);
    expect(document.frontmatter).toBe("");
    expect(document.frontmatterError).toContain("closing --- line is missing");
  });

  it("revises structured content without making callers reassemble derived values", () => {
    const original = createNoteDocument({
      title: "Draft",
      frontmatter: "id: note-1\nstatus: seed",
      body: "# :x: Discover\n\nFirst scene",
    });

    const revised = reviseNoteDocument(original, {
      title: "Novel",
      body: "# :white_check_mark: Discover\n\nFirst scene revised",
    });

    expect(revised.markdown).toBe("---\nid: note-1\nstatus: seed\n---\n\n# :white_check_mark: Discover\n\nFirst scene revised");
    expect(revised.outline).toEqual([
      { id: "heading-0", level: 1, text: "Novel" },
      { id: "heading-1", level: 1, text: "✅ Discover" },
    ]);
    expect(revised.preview).toBe("First scene revised");
  });

  it("keeps invalid edited frontmatter visible and reports its validation state", () => {
    const document = createNoteDocument({ title: "Draft", frontmatter: "id: note-1", body: "Body" });
    const revised = reviseNoteDocument(document, { frontmatter: "id: note-1\nnot yaml" });

    expect(revised.frontmatter).toBe("id: note-1\nnot yaml");
    expect(revised.markdown).toBe("---\nid: note-1\nnot yaml\n---\n\nBody");
    expect(revised.frontmatterError).toBe('This note has malformed frontmatter: expected "key: value" near "not yaml".');
  });

  it("updates an editable frontmatter field through the Note document interface", () => {
    const document = createNoteDocument({ title: "Draft", frontmatter: "id: note-1\nstatus: seed", body: "Body" });
    const status = document.frontmatterFields.find((field) => field.key === "status");

    expect(status).toBeDefined();
    expect(updateNoteDocumentFrontmatterField(document, status!, "revised").frontmatter).toBe("id: note-1\nstatus: revised");
  });

  it("normalizes watcher comparisons and measures selected text", () => {
    expect(normalizeNoteMarkdown("Body\r\n\r\n  ")).toBe("Body");
    expect(measureNoteText("A [quiet](https://example.com) scene")).toEqual({ words: 3, characters: 13 });
  });
});
