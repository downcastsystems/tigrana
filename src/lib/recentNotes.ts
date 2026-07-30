import type { NoteEntry, WorkspaceMetadata } from "../types";

export const recentNoteLimit = 10;

export type RecentNoteView = {
  path: string;
  title: string;
  icon?: string;
  viewedAt: number;
};

export function buildRecentNoteViews(
  notes: NoteEntry[],
  metadata: WorkspaceMetadata,
): RecentNoteView[] {
  return notes
    .map((note) => ({
      path: note.path,
      title: note.title,
      icon: metadata.noteIcons[note.path],
      viewedAt: metadata.notePositions[note.path]?.lastOpenedAt ?? 0,
    }))
    .filter((note) => note.viewedAt > 0)
    .sort((a, b) => b.viewedAt - a.viewedAt || a.title.localeCompare(b.title))
    .slice(0, recentNoteLimit);
}
