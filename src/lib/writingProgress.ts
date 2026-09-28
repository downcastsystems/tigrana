import type { WorkspaceMetadata } from "../types";
import { readNoteDocument } from "./noteDocument";
import { measureNoteText } from "./noteTextStats";

export type WritingProgress = {
  notebookGoal?: number;
  savedSessions?: Record<string, number>;
  noteGoals: Record<string, number>;
  days: Record<string, Record<string, number>>;
};

const sessionId = crypto.randomUUID();
let saveSequence = 0;

export function localWritingDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function readWritingProgress(metadata: WorkspaceMetadata): WritingProgress {
  const stored = metadata.writingProgress;
  return { savedSessions: stored?.savedSessions, notebookGoal: stored?.notebookGoal, noteGoals: stored?.noteGoals ?? {}, days: stored?.days ?? {} };
}

export function dailyWritingCounts(metadata: WorkspaceMetadata, day: string, noteId: string | null) {
  const entries = readWritingProgress(metadata).days[day] ?? {};
  return {
    notebook: Object.values(entries).reduce((sum, value) => sum + Math.max(0, Number.isFinite(value) ? value : 0), 0),
    note: noteId ? Math.max(0, entries[noteId] ?? 0) : 0,
  };
}

export function setWritingGoal(metadata: WorkspaceMetadata, noteId: string | null, goal: number | null): WorkspaceMetadata {
  if (goal !== null && (!Number.isSafeInteger(goal) || goal < 1 || goal > 1000000)) return metadata;
  const progress = readWritingProgress(metadata);
  const noteGoals = { ...progress.noteGoals };
  if (noteId) {
    if (goal === null) delete noteGoals[noteId];
    else noteGoals[noteId] = goal;
  }
  return { ...metadata, writingProgress: { ...progress, noteGoals,
    notebookGoal: noteId ? progress.notebookGoal : goal ?? undefined } };
}

/** Compute once at the successful-save boundary; replay only the semantic delta on CAS conflicts. */
export function writingProgressMutation(before: string, after: string, day: string, fallbackId: string) {
  const previous = readNoteDocument(before, "");
  const next = readNoteDocument(after, "");
  if (previous.frontmatterError || next.frontmatterError) return null;
  const delta = measureNoteText(next.body).words - measureNoteText(previous.body).words;
  if (!delta) return null;
  const id = next.frontmatterFields.find(field => field.key === "id")?.value.trim() || fallbackId;
  const sequence = ++saveSequence;
  return (metadata: WorkspaceMetadata): WorkspaceMetadata => {
    const progress = readWritingProgress(metadata);
    // Metadata updaters run optimistically and can be replayed over that state.
    // One high-water mark per app session makes each saved delta idempotent,
    // including multiple queued saves and CAS retries from other windows.
    if ((progress.savedSessions?.[sessionId] ?? 0) >= sequence) return metadata;
    const entries = progress.days[day] ?? {};
    // Keep signed balances: deleting old words and retyping them is not new writing.
    return { ...metadata, writingProgress: { ...progress, savedSessions: { ...progress.savedSessions, [sessionId]: sequence }, days: {
      ...progress.days, [day]: { ...entries, [id]: (entries[id] ?? 0) + delta },
    } } };
  };
}
