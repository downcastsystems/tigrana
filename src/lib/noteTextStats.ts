import { stripParagraphIndentMarkers } from "./writingStyle";
import { stripInlineColorSpans } from "./inlineColors";

export type NoteTextStats = {
  words: number;
  characters: number;
};

export type NoteTextStatsRequest = {
  requestId: number;
  text: string;
};

export type NoteTextStatsResponse = {
  requestId: number;
  stats: NoteTextStats;
};

export function measureNoteText(text: string): NoteTextStats {
  const plain = stripInlineColorSpans(stripParagraphIndentMarkers(text))
    .replace(/<\/?u>/gi, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    words: plain ? plain.split(/\s+/).length : 0,
    characters: plain.length,
  };
}
