import type { FolderEntry, NoteEntry, WorkspaceMetadata } from "../types";
import { orderFolders, orderNotes } from "./notebookMetadata";
import { buildNoteExportHtml } from "./exportNote";
import { storyParagraphCss, type WritingStyle } from "./writingStyle";

export type ExportNote = { title: string; markdown: string; writingStyle?: WritingStyle };

/** Traverse the sidebar tree, including collapsed descendants, with folders before notes. */
export function collectExportNotes(path: string, notes: NoteEntry[], folders: FolderEntry[], metadata: WorkspaceMetadata, options: { alphabetical?: boolean; includeDescendants?: boolean } = {}): NoteEntry[] {
  const seen = new Set<string>();
  function visit(parent: string): NoteEntry[] {
    if (seen.has(parent)) return [];
    seen.add(parent);
    const children = options.includeDescendants === false ? [] : folders.filter(folder => folder.path !== "" && folder.parent_path === parent);
    const localNotes = notes.filter(note => note.parent_path === parent);
    const orderedFolders = options.alphabetical ? children.sort((a, b) => a.name.localeCompare(b.name)) : orderFolders(children, parent, metadata);
    return [
      ...orderedFolders.flatMap(folder => visit(folder.path)),
      ...(options.alphabetical ? localNotes.sort((a, b) => a.title.localeCompare(b.title)) : orderNotes(localNotes, parent, metadata)),
    ];
  }
  return visit(path);
}

export async function buildNotebookExportHtml(notes: ExportNote[], resolveImageSrc?: (src: string) => Promise<string>) {
  if (!notes.length) throw new Error("There are no notes to print or export in this folder.");
  const documents = [];
  for (const note of notes) {
    const html = await buildNoteExportHtml(note.title, note.markdown, { resolveImageSrc });
    documents.push(new DOMParser().parseFromString(html, "text/html"));
  }
  const output = documents[0].cloneNode(true) as Document;
  output.body.replaceChildren();
  for (const [index, doc] of documents.entries()) {
    const section = output.createElement("section");
    section.className = "export-note";
    section.dataset.writingStyle = notes[index].writingStyle ?? "notes";
    section.innerHTML = doc.body.innerHTML;
    output.body.append(section);
  }
  const style = output.createElement("style");
  style.textContent = `${storyParagraphCss('[data-writing-style="story"] main')}
.export-note + .export-note { break-before: page; page-break-before: always; }
    @page { margin: 18mm; } pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    img { max-height: 250mm; object-fit: contain; }
    tr, img { break-inside: avoid; } h1, h2, h3 { break-after: avoid; }`;
  output.head.append(style);
  return "<!doctype html>" + output.documentElement.outerHTML;
}

/** Collections omit per-note managed frontmatter and keep readable note boundaries. */
export function buildNotebookExportMarkdown(notes: ExportNote[]): string {
  return notes.map(note => `# ${note.title.replace(/[\r\n]+/g, " ").replace(/([\\`*_{}[\]<>])/g, "\\$1")}\n\n${note.markdown.trim()}`).join("\n\n---\n\n") + "\n";
}
