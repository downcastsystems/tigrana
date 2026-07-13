import type { FolderEntry, NoteEntry } from "../types";

const FILENAME_SLASH = "／"; // FULLWIDTH SOLIDUS
const FILENAME_LEADING_DOT = "．"; // FULLWIDTH FULL STOP
const FILENAME_HASH = "＃"; // FULLWIDTH NUMBER SIGN
const FILENAME_PERCENT = "％"; // FULLWIDTH PERCENT SIGN

export function encodeTitleForFilename(title: string): string {
  return title
    .replace(/\//g, FILENAME_SLASH)
    .replace(/#/g, FILENAME_HASH)
    .replace(/%/g, FILENAME_PERCENT)
    .replace(/^\.+/, (dots) => FILENAME_LEADING_DOT.repeat(dots.length));
}

export function decodeTitleFromFilename(name: string): string {
  return name.replace(/／/g, "/").replace(/．/g, ".").replace(/＃/g, "#").replace(/％/g, "%");
}

export function decodeNoteEntry(entry: NoteEntry): NoteEntry {
  return { ...entry, title: decodeTitleFromFilename(entry.title) };
}

export function decodeFolderEntry(entry: FolderEntry): FolderEntry {
  return { ...entry, name: decodeTitleFromFilename(entry.name) };
}

export function validateNoteTitle(title: string) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Add a title before saving this note.");
  if (/[\\:*?"<>|]/.test(trimmed)) {
    throw new Error('Note titles cannot contain \\ : * ? " < > |');
  }
  if (Array.from(trimmed).some((char) => {
    const code = char.charCodeAt(0);
    return code >= 0 && code <= 31;
  })) {
    throw new Error("Note titles cannot contain line breaks or control characters.");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("That title is reserved by the filesystem.");
  }
}
