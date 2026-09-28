import { remark } from "remark";
import remarkGfm from "remark-gfm";
import type { RootContent } from "mdast";
import type { LinkIndex, NoteEntry } from "../types";

/** Browser demos have no native index. Rebuild only when their saved contents change. */
export function buildDemoLinkIndex(contents: Map<string, string>, notes: NoteEntry[]): LinkIndex {
  const index: LinkIndex = { schemaVersion: 1, notesById: {}, foldersById: {}, pathToId: {}, inbound: {}, outbound: {} };
  for (const note of notes) {
    index.notesById[note.path] = { id: note.path, path: note.path, title: note.title };
    index.pathToId[note.path] = note.path;
  }
  const parser = remark().use(remarkGfm);
  for (const [sourceId, markdown] of contents) {
    if (!index.notesById[sourceId]) continue;
    const visit = (node: RootContent) => {
      if (node.type === "link" && !/^(?:[a-z][\w+.-]*:|#|\/\/)/i.test(node.url)) {
        let path = node.url.split("#")[0].replace(/^\.\//, "");
        try { path = decodeURIComponent(path); } catch { /* Preserve malformed URLs as missing targets. */ }
        const target = index.notesById[path] ?? Object.values(index.notesById).find(note => note.title === path || `${note.title}.md` === path);
        if (target || /\.md$/i.test(path)) {
          const ref = { sourceId, targetId: target?.id ?? null, targetKind: "note" as const,
            targetPath: target?.path ?? path, displayText: path, anchor: node.url.split("#")[1] ?? null,
            occurrence: index.outbound[sourceId]?.length ?? 0, broken: !target };
          (index.outbound[sourceId] ??= []).push(ref);
          if (target) (index.inbound[target.id] ??= []).push(ref);
        }
      }
      if ("children" in node) node.children.forEach(child => visit(child as RootContent));
    };
    parser.parse(markdown).children.forEach(visit);
  }
  return index;
}
