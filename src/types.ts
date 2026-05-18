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

export type WorkspaceMetadata = {
  folderOrder: Record<string, string[]>;
  noteOrder: Record<string, string[]>;
  pinnedNotes: Record<string, boolean>;
  folderIcons: Record<string, string>;
  folderColors: Record<string, string>;
  noteIcons: Record<string, string>;
};
