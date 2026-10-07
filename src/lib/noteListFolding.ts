import type { NoteListFoldingMetadata } from "../types";
import { normalizeNoteMarkdown } from "./noteDocument";

/** Two independent 32-bit hashes and the length; computed only at idle or Note load. */
export function foldingContentFingerprint(markdown: string): string {
  const value = normalizeNoteMarkdown(markdown);
  let first = 2166136261, second = 5381;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return `${value.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

export function restorableListFolding(saved: NoteListFoldingMetadata | null | undefined, markdown: string): NoteListFoldingMetadata | null {
  if (!saved || saved.version !== 1 || !Number.isSafeInteger(saved.docSize) || saved.docSize < 0
    || !Array.isArray(saved.collapsed) || saved.collapsed.length > saved.docSize
    || saved.collapsed.some(range => !Array.isArray(range) || range.length !== 3
      || range.some(value => !Number.isSafeInteger(value) || value < 0)
      || range[0] + range[1] > saved.docSize || range[2] >= range[1])
    || saved.contentFingerprint !== foldingContentFingerprint(markdown)) return null;
  return saved;
}

export function equalListFolding(left: NoteListFoldingMetadata | null, right: NoteListFoldingMetadata | null): boolean {
  if (left === right) return true;
  return Boolean(left && right && left.contentFingerprint === right.contentFingerprint && left.docSize === right.docSize
    && left.collapsed.length === right.collapsed.length
    && left.collapsed.every((range, index) => range.every((value, column) => value === right.collapsed[index][column])));
}
