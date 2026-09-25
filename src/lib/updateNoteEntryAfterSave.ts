import type { NoteEntry } from "../types";
import { readNoteCreatedAt } from "./noteDocument";

export function updateNoteEntryAfterSave(
  note: NoteEntry,
  savedPath: string,
  written: string,
  savedAt: number,
): NoteEntry {
  if (note.path !== savedPath) return note;
  return {
    ...note,
    created_at: readNoteCreatedAt(written) ?? note.created_at,
    updated_at: savedAt,
  };
}
