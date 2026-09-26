// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { collectExportNotes, buildNotebookExportHtml, buildNotebookExportMarkdown } from "./notebookExport";
import { createPdf, createPdfDefinition, createWordDocument } from "./exportFormats";
import type { WorkspaceMetadata } from "../types";
const createDefaultMetadata = (): WorkspaceMetadata => ({ revision: 0, folderOrder: {}, noteOrder: {}, pinnedNotes: {}, folderIcons: {}, folderColors: {}, noteIcons: {}, notePositions: {}, bookmarks: [], bookmarksExpanded: true, expandedFolders: {}, welcomeNoteAdded: false });

const note = (path: string) => ({ path, title: path.split("/").pop()!, parent_path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" });

describe("notebook print and export", () => {
  it("combines Markdown in supplied order with readable note boundaries", () => {
    const output = buildNotebookExportMarkdown([
      { title: "First [draft]", markdown: "**Body**\n\n| A | B |\n| - | - |\n| 1 | 2 |" },
      { title: "Second", markdown: "![image](.assets/image.png)" },
    ]);
    expect(output).toContain("# First \\[draft\\]");
    expect(output).toContain("**Body**");
    expect(output).toContain("\n\n---\n\n# Second\n\n![image](.assets/image.png)");
    expect(output).toContain("| 1 | 2 |");
  });
  it("includes descendants in folder order and preserves pinned/manual note order", () => {
    const metadata = createDefaultMetadata();
    metadata.folderOrder["A"] = ["A/Z", "A/B"];
    metadata.noteOrder["A/Z"] = ["A/Z/second.md", "A/Z/first.md", "A/Z/pinned.md"];
    metadata.pinnedNotes["A/Z/pinned.md"] = true;
    const notes = ["outside.md", "A/local.md", "A/B/child.md", "A/Z/first.md", "A/Z/second.md", "A/Z/pinned.md"].map(note);
    const folders = ["A", "A/B", "A/Z"].map(path => ({ ...note(path), name: path }));
    expect(collectExportNotes("A", notes, folders, metadata).map(n => n.path)).toEqual([
      "A/Z/pinned.md", "A/Z/second.md", "A/Z/first.md", "A/B/child.md", "A/local.md",
    ]);
    expect(collectExportNotes("A", notes, folders, metadata, { alphabetical: true }).map(n => n.path)).toEqual([
      "A/B/child.md", "A/Z/first.md", "A/Z/pinned.md", "A/Z/second.md", "A/local.md",
    ]);
    expect(collectExportNotes("empty", notes, folders, metadata)).toEqual([]);
    expect(collectExportNotes("", notes, folders, metadata, { includeDescendants: false }).map(n => n.path)).toEqual(["outside.md"]);
  });

  it("creates ordered print sections and scopes mixed writing styles", async () => {
    const html = await buildNotebookExportHtml([{ title: "<First>", markdown: "First body" }, { title: "Second", markdown: "Second body", writingStyle: "story" }]);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(Array.from(doc.querySelectorAll(".note-title")).map(n => n.textContent)).toEqual(["<First>", "Second"]);
    expect(doc.querySelectorAll(".export-note")).toHaveLength(2);
    expect(html).toContain("page-break-before: always");
    expect(html).toContain('[data-writing-style="story"] main > p');
    await expect(buildNotebookExportHtml([])).rejects.toThrow("no notes");
  });

  it("writes real PDF and Word files with every note and page boundaries", async () => {
    const html = await buildNotebookExportHtml([
      { title: "First", markdown: "**Bold** and [link](https://example.com)\n\n- [x] done\n\n```js\nconst x = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |" },
      { title: "Second", markdown: "Last note" },
    ]);
    const definition = await createPdfDefinition(html, "Collection");
    expect(definition.content).toHaveLength(2);
    expect(Array.isArray(definition.content) && definition.content[1]).toHaveProperty("pageBreak", "before");
    const pdf = await createPdf(html, "Collection");
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    const word = unzipSync(await createWordDocument(html, "Collection"));
    const xml = strFromU8(word["word/document.xml"]);
    expect(xml).toContain("First"); expect(xml).toContain("Second");
    expect(xml).toContain("Last note"); expect(xml).toContain("[x]");
    expect(xml).toContain("<w:tbl>"); expect(xml).toContain("<w:b/>");
    expect(xml.match(/<w:sectPr/g)).toHaveLength(2);
    expect(xml).toContain('w:val="nextPage"');
    expect(strFromU8(word["word/_rels/document.xml.rels"])).toContain("https://example.com");
  });
  it("embeds images in PDF and Word, including standalone image blocks", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMw7lj1HwAEvAJllikswwAAAABJRU5ErkJggg==";
    vi.stubGlobal("Image", class { src = ""; naturalWidth = 100; naturalHeight = 50; decode() { return Promise.resolve(); } });
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL() { return "blob:test-image"; }
      static revokeObjectURL() {}
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(png);
    try {
      const html = `<section class="export-note"><h1>Image note</h1><img src="${png}" alt="Diagram"></section>`;
      const pdf = await createPdf(html, "Image note");
      expect(new TextDecoder().decode(pdf)).toContain("/Subtype /Image");
      const word = unzipSync(await createWordDocument(html, "Image note"));
      expect(Object.keys(word).some(path => path.startsWith("word/media/") && path.endsWith(".png"))).toBe(true);
      expect(strFromU8(word["word/document.xml"])).toContain("<w:drawing>");
      expect(strFromU8(word["word/document.xml"])).toContain('descr="Diagram"');
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

});
