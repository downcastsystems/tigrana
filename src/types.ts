export type NoteEntry = {
  path: string;
  title: string;
  parent_path: string;
  updated_at?: number | null;
};

export type FolderEntry = {
  path: string;
  name: string;
  parent_path: string;
};

export type TreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "folder" | "note";
  children: TreeNode[];
  note?: NoteEntry;
};

export type SearchResult = NoteEntry & {
  score: number;
  snippet: string;
};

export type NotePositionMetadata = {
  path: string;
  lastOpenedAt: number;
  scrollTop: number;
  contentLength: number;
  selectionFrom?: number;
  selectionTo?: number;
};

export type BookmarkEntry = {
  id: string;
  kind: "folder" | "note";
  path: string;
  createdAt: number;
};

export type WorkspaceMetadata = {
  folderOrder: Record<string, string[]>;
  noteOrder: Record<string, string[]>;
  pinnedNotes: Record<string, boolean>;
  folderIcons: Record<string, string>;
  folderColors: Record<string, string>;
  noteIcons: Record<string, string>;
  notePositions: Record<string, NotePositionMetadata>;
  bookmarks: BookmarkEntry[];
  bookmarksExpanded: boolean;
  sessionOpenTabs: string[];
  sessionActiveTab: string | null;
};
