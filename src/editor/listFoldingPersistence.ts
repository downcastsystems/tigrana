import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NoteListFoldingMetadata } from "../types";
import { equalListFolding, foldingContentFingerprint } from "../lib/noteListFolding";
import { listFoldingKey } from "./listFolding";
import { markdownCommitDelayMs } from "./editorContract";

type Source = {
  workspace: string;
  path: string;
  markdown: string;
  doc: ProseMirrorNode;
  saved: NoteListFoldingMetadata | null;
};

/** No React updates, document walks, serialization, or IO in transaction handlers. */
export class ListFoldingPersistence {
  private source: Source | null = null;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly report: (saved: NoteListFoldingMetadata | null, workspace: string, path: string) => void) {}

  load(editor: Editor, workspace: string, path: string | null, markdown: string, saved: NoteListFoldingMetadata | null) {
    this.cancel();
    this.source = path ? { workspace, path, markdown, saved, doc: editor.state.doc } : null;
  }

  relocate(workspace: string, path: string | null) {
    if (this.source && path) { this.source.workspace = workspace; this.source.path = path; }
  }

  changed(editor: Editor, docChanged: boolean, flushMarkdown: () => unknown) {
    const folds = listFoldingKey.getState(editor.state);
    this.clearTimer();
    if (!this.source || !folds?.enabled) return;
    if (!folds.collapsedCount && !this.source.saved) { this.dirty = false; return; }
    this.dirty = true;
    // Document changes already have a deferred Markdown commit. Share its work.
    if (docChanged) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      flushMarkdown();
      this.flush(editor);
    }, markdownCommitDelayMs);
  }

  serialized(editor: Editor, markdown: string) {
    if (!this.source) return;
    this.source.markdown = markdown;
    this.source.doc = editor.state.doc;
    this.flush(editor);
  }

  flush(editor: Editor) {
    this.clearTimer();
    const source = this.source, folds = listFoldingKey.getState(editor.state);
    // Never pair new positions with old Markdown after a cancelled editor update.
    if (!this.dirty || !source || source.doc !== editor.state.doc || !folds?.enabled) return;
    this.dirty = false;
    const collapsed: NoteListFoldingMetadata["collapsed"] = folds.collapsedCount
      ? folds.decorations.find(0, editor.state.doc.content.size, spec => spec.collapsed === true)
        .map((decoration): NoteListFoldingMetadata["collapsed"][number] => [decoration.from, decoration.to - decoration.from, decoration.spec.foldedNode.firstChild.nodeSize])
        .sort((left, right) => left[0] - right[0])
      : [];
    const saved: NoteListFoldingMetadata | null = collapsed.length ? {
      version: 1, contentFingerprint: foldingContentFingerprint(source.markdown),
      docSize: editor.state.doc.content.size, collapsed,
    } : null;
    if (equalListFolding(source.saved, saved)) return;
    source.saved = saved;
    this.report(saved, source.workspace, source.path);
  }

  cancel() {
    this.clearTimer();
    this.dirty = false;
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
