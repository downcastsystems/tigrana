import type { BulletMethodDisplay, BulletMethodStatus } from "../lib/bulletMethod";
import type { InlineColorCommand } from "../lib/inlineColors";
import type { WritingStyle } from "../lib/writingStyle";
import type { NotePositionMetadata } from "../types";
import type { SortCommand } from "./sortLines";

export type NotesEditorProps = {
  bulletMethodDisplay?: BulletMethodDisplay;
  bulletMethodStatuses?: readonly BulletMethodStatus[];
  colorToolbarElement?: HTMLElement | null;
  writingStyle?: WritingStyle;
  colorsDisabled?: boolean;
  content: string;
  commandRequest?: EditorCommandRequest | null;
  focusRequest: number;
  focusAtEndRequest: number;
  findRequest: number;
  historyKey: string | null;
  reloadRequest?: number;
  notePath: string | null;
  restorePosition: NotePositionMetadata | null;
  editable: boolean;
  spellcheckEnabled: boolean;
  workspace: string;
  onChange: (markdown: string, sourceNotePath: string | null) => void;
  onPendingChange: (change: PendingEditorChange | null) => void;
  onPersistenceReady?: (handle: EditorPersistenceHandle | null) => void;
  onLoadError: (error: unknown) => void;
  onPositionChange: (position: { selectedText: string; selectionFrom: number; selectionTo: number }) => void;
  onInternalLinkClick?: (href: string) => void;
  onRequestEmoji?: () => Promise<string | null>;
  onRequestLink?: () => Promise<{ href: string; title: string } | null>;
  onRequestImage?: () => Promise<{ src: string; alt?: string } | null>;
};

export type EditorMarkdownSnapshot = {
  markdown: string;
  sourceNotePath: string | null;
};

export type EditorPersistenceHandle = {
  capture(): EditorMarkdownSnapshot | null;
  setReadOnly(readOnly: boolean): void;
};

export type PendingEditorChange = {
  flush(): EditorMarkdownSnapshot | null;
};

export type EditorCommand =
  | InlineColorCommand
  | SortCommand
  | "equation"
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "highlight"
  | "link"
  | "clear"
  | "paragraphAuto"
  | "paragraphIndent"
  | "paragraphNoIndent"
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "quote"
  | "codeBlock"
  | "divider"
  | "table"
  | "image"
  | "findNext"
  | "findPrevious"
  | "replace"
  | "insertText";

export type EditorCommandRequest = {
  id: number;
  command: EditorCommand;
  src?: string;
  alt?: string;
  selectionFrom?: number;
  selectionTo?: number;
};
