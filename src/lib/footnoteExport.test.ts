// @vitest-environment jsdom
import { expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildNotebookExportHtml, buildNotebookExportMarkdown } from "./notebookExport";
import { createPdf, createPdfDefinition, createWordDocument } from "./exportFormats";

const notes = [
  { title: "First", markdown: 'Later label first[^b], then[^a], repeated[^b].\n\n[^a]: **Second** definition\n\n[^b]: First definition\n\n    - One\n    - Two\n\n    Another paragraph.' },
  { title: "Second", markdown: 'Same label[^b]. Missing[^missing].\n\n[^b]: Separate definition' },
];
it("exports ordered compact footnotes with unique working targets and rich content", async () => {
  const html = await buildNotebookExportHtml(notes);
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelectorAll("button, [contenteditable], [data-markdown]")).toHaveLength(0);
  expect([...doc.querySelectorAll(".export-footnote-reference")].map(node => node.textContent)).toEqual(["1", "2", "1", "1", "2"]);
  const ids = [...doc.querySelectorAll("[id]")].map(node => node.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const link of doc.querySelectorAll('a[href^="#"]')) expect(doc.getElementById(link.getAttribute("href")!.slice(1))).not.toBeNull();
  expect(doc.querySelector(".export-footnote-table td:nth-child(2)")?.textContent).toContain("First definition");
  expect(doc.querySelectorAll(".export-footnotes ul li")).toHaveLength(2);
  expect(doc.querySelector(".export-footnotes strong")?.textContent).toBe("Second");
  expect(html).toContain("Footnote text is missing.");
});
it("writes PDF destinations, superscripts and borderless footnotes", async () => {
  const html = await buildNotebookExportHtml(notes);
  const definition = JSON.stringify(await createPdfDefinition(html, "Footnotes"));
  expect(definition).toContain('"linkToDestination":"note_1_fn_1"');
  expect(definition).toContain('"sup":');
  expect(definition).toContain('"layout":"noBorders"');
  const bytes = await createPdf(html, "Footnotes");
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
});
it("writes Word superscripts, bookmarks, internal links and rich footnote blocks", async () => {
  const files = unzipSync(await createWordDocument(await buildNotebookExportHtml(notes), "Footnotes"));
  const xml = strFromU8(files["word/document.xml"]);
  expect(xml).toContain('w:val="superscript"');
  expect(xml).toContain('w:anchor="note_1_fn_1"');
  expect(xml).toContain('w:name="note_1_fn_1"');
  expect(xml).toContain("Another paragraph.");
  expect(xml).toContain('w:val="none"');
});
it("keeps combined Markdown labels distinct and single-note source unchanged", () => {
  const markdown = buildNotebookExportMarkdown(notes);
  expect(markdown).toContain("Later label first[^note-1-1], then[^note-1-2], repeated[^note-1-1]");
  expect(markdown).toContain("[^note-1-1]: First definition");
  expect(markdown).toContain("[^note-2-1]: Separate definition");
  expect(buildNotebookExportMarkdown([notes[0]])).toContain(notes[0].markdown);
});
