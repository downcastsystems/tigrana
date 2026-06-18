import { describe, expect, it } from "vitest";
import {
  addFolderToOrder,
  addToOrder,
  buildBookmarkViews,
  buildFolderTree,
  getNotebookName,
  moveFolderInMetadata,
  moveNoteInMetadata,
  orderFolders,
  orderNotes,
  removeFolderFromMetadata,
  removeNoteFromMetadata,
  replaceFolderPathPrefix,
  replaceOrderedPath,
  setMetadataValue,
} from "./notebookMetadata";
import type { FolderEntry, NoteEntry, WorkspaceMetadata } from "../types";

function metadata(overrides: Partial<WorkspaceMetadata> = {}): WorkspaceMetadata {
  return {
    folderOrder: {},
    noteOrder: {},
    pinnedNotes: {},
    folderIcons: {},
    folderColors: {},
    noteIcons: {},
    notePositions: {},
    bookmarks: [],
    bookmarksExpanded: true,
    expandedFolders: {},
    welcomeNoteAdded: false,
    ...overrides,
  };
}

function note(path: string, title: string, parentPath = ""): NoteEntry {
  return { path, title, parent_path: parentPath };
}

function folder(path: string, name: string, parentPath = ""): FolderEntry {
  return { path, name, parent_path: parentPath };
}

describe("notebook metadata", () => {
  it("gets the Notebook display name from the selected path", () => {
    expect(getNotebookName("/Users/dhaynes/Notes/Tigrana")).toBe("Tigrana");
    expect(getNotebookName("")).toBe("Notebook");
  });

  it("orders notes with pins first, then custom order, then title", () => {
    const notes = [
      note("Inbox/alpha.md", "Alpha", "Inbox"),
      note("Inbox/bravo.md", "Bravo", "Inbox"),
      note("Inbox/charlie.md", "Charlie", "Inbox"),
      note("Inbox/delta.md", "Delta", "Inbox"),
    ];
    const current = metadata({
      noteOrder: { Inbox: ["Inbox/charlie.md", "Inbox/alpha.md"] },
      pinnedNotes: { "Inbox/bravo.md": true },
    });

    expect(orderNotes(notes, "Inbox", current).map((entry) => entry.path)).toEqual([
      "Inbox/bravo.md",
      "Inbox/charlie.md",
      "Inbox/alpha.md",
      "Inbox/delta.md",
    ]);
  });

  it("builds an ordered Folder tree rooted at the Notebook", () => {
    const folders = [
      folder("", "Notebook"),
      folder("Projects", "Projects"),
      folder("Archive", "Archive"),
      folder("Projects/Bravo", "Bravo", "Projects"),
      folder("Projects/Alpha", "Alpha", "Projects"),
    ];
    const current = metadata({
      folderOrder: {
        "": ["Projects", "Archive"],
        Projects: ["Projects/Bravo", "Projects/Alpha"],
      },
    });

    const [root] = buildFolderTree(folders, "/Users/dhaynes/Notebook", current);

    expect(root.name).toBe("Notebook");
    expect(root.children.map((child) => child.path)).toEqual(["Projects", "Archive"]);
    expect(root.children[0].children.map((child) => child.path)).toEqual(["Projects/Bravo", "Projects/Alpha"]);
  });

  it("projects bookmark views with icons and missing targets", () => {
    const current = metadata({
      bookmarks: [
        { id: "folder-bookmark", kind: "folder", path: "Ideas", createdAt: 1 },
        { id: "note-bookmark", kind: "note", path: "Ideas/Seed.md", createdAt: 2 },
        { id: "missing-note", kind: "note", path: "Ideas/Missing.md", createdAt: 3 },
      ],
      folderIcons: { Ideas: "lucide:Lightbulb" },
      noteIcons: { "Ideas/Seed.md": "lucide:FileText" },
    });

    expect(
      buildBookmarkViews(
        current.bookmarks,
        [folder("Ideas", "Ideas")],
        [note("Ideas/Seed.md", "Seed", "Ideas")],
        current,
        "/Users/dhaynes/Notebook",
      ),
    ).toEqual([
      { id: "folder-bookmark", kind: "folder", path: "Ideas", createdAt: 1, title: "Ideas", icon: "lucide:Lightbulb", missing: false },
      { id: "note-bookmark", kind: "note", path: "Ideas/Seed.md", createdAt: 2, title: "Seed", icon: "lucide:FileText", missing: false },
      { id: "missing-note", kind: "note", path: "Ideas/Missing.md", createdAt: 3, title: "Ideas/Missing.md (missing)", icon: undefined, missing: true },
    ]);
  });

  it("repairs note path metadata when a Note is renamed", () => {
    const current = metadata({
      noteOrder: { Ideas: ["Ideas/Old.md", "Ideas/Other.md"] },
      pinnedNotes: { "Ideas/Old.md": true },
      noteIcons: { "Ideas/Old.md": "lucide:FileText" },
      notePositions: {
        "Ideas/Old.md": { path: "Ideas/Old.md", lastOpenedAt: 10, scrollTop: 12, contentLength: 20 },
      },
      bookmarks: [{ id: "bookmark", kind: "note", path: "Ideas/Old.md", createdAt: 1 }],
    });

    expect(replaceOrderedPath(current, "Ideas/Old.md", "Ideas/New.md")).toMatchObject({
      noteOrder: { Ideas: ["Ideas/New.md", "Ideas/Other.md"] },
      pinnedNotes: { "Ideas/New.md": true },
      noteIcons: { "Ideas/New.md": "lucide:FileText" },
      notePositions: {
        "Ideas/New.md": { path: "Ideas/New.md", lastOpenedAt: 10, scrollTop: 12, contentLength: 20 },
      },
      bookmarks: [{ id: "bookmark", kind: "note", path: "Ideas/New.md", createdAt: 1 }],
    });
    expect(current.noteOrder.Ideas).toEqual(["Ideas/Old.md", "Ideas/Other.md"]);
  });

  it("moves a Note between folder orders after path repair", () => {
    const current = metadata({
      noteOrder: {
        Inbox: ["Inbox/Seed.md", "Inbox/Other.md"],
        Ideas: ["Ideas/Existing.md"],
      },
      pinnedNotes: { "Inbox/Seed.md": true },
    });

    expect(moveNoteInMetadata(current, "Inbox/Seed.md", "Ideas/Seed.md", "Inbox", "Ideas")).toMatchObject({
      noteOrder: {
        Inbox: ["Inbox/Other.md"],
        Ideas: ["Ideas/Existing.md", "Ideas/Seed.md"],
      },
      pinnedNotes: { "Ideas/Seed.md": true },
    });
  });

  it("repairs every folder-scoped metadata path when a Folder path changes", () => {
    const current = metadata({
      folderOrder: {
        "": ["Projects"],
        Projects: ["Projects/App"],
        "Projects/App": ["Projects/App/Archive"],
      },
      noteOrder: { "Projects/App": ["Projects/App/Plan.md"] },
      pinnedNotes: { "Projects/App/Plan.md": true },
      folderIcons: { "Projects/App": "lucide:Folder" },
      folderColors: { "Projects/App": "#123456" },
      expandedFolders: { "Projects/App": false },
      noteIcons: { "Projects/App/Plan.md": "lucide:FileText" },
      notePositions: {
        "Projects/App/Plan.md": { path: "Projects/App/Plan.md", lastOpenedAt: 1, scrollTop: 2, contentLength: 3 },
      },
      bookmarks: [
        { id: "folder", kind: "folder", path: "Projects/App", createdAt: 1 },
        { id: "note", kind: "note", path: "Projects/App/Plan.md", createdAt: 2 },
      ],
    });

    expect(replaceFolderPathPrefix(current, "Projects/App", "Projects/Tigrana")).toMatchObject({
      folderOrder: {
        "": ["Projects"],
        Projects: ["Projects/Tigrana"],
        "Projects/Tigrana": ["Projects/Tigrana/Archive"],
      },
      noteOrder: { "Projects/Tigrana": ["Projects/Tigrana/Plan.md"] },
      pinnedNotes: { "Projects/Tigrana/Plan.md": true },
      folderIcons: { "Projects/Tigrana": "lucide:Folder" },
      folderColors: { "Projects/Tigrana": "#123456" },
      expandedFolders: { "Projects/Tigrana": false },
      noteIcons: { "Projects/Tigrana/Plan.md": "lucide:FileText" },
      notePositions: {
        "Projects/Tigrana/Plan.md": { path: "Projects/Tigrana/Plan.md", lastOpenedAt: 1, scrollTop: 2, contentLength: 3 },
      },
      bookmarks: [
        { id: "folder", kind: "folder", path: "Projects/Tigrana", createdAt: 1 },
        { id: "note", kind: "note", path: "Projects/Tigrana/Plan.md", createdAt: 2 },
      ],
    });
  });

  it("moves a Folder between parent orders after path repair", () => {
    const current = metadata({
      folderOrder: {
        "": ["Archive", "Projects"],
        Projects: ["Projects/App", "Projects/Docs"],
        Archive: ["Archive/Old"],
      },
    });

    expect(moveFolderInMetadata(current, "Projects/App", "Archive/App", "Projects", "Archive").folderOrder).toEqual({
      "": ["Archive", "Projects"],
      Projects: ["Projects/Docs"],
      Archive: ["Archive/Old", "Archive/App"],
    });
  });

  it("removes Note and Folder metadata without touching unrelated entries", () => {
    const current = metadata({
      folderOrder: {
        "": ["Projects", "Archive"],
        Projects: ["Projects/App"],
      },
      noteOrder: {
        Projects: ["Projects/App.md"],
        Archive: ["Archive/Old.md"],
      },
      pinnedNotes: { "Projects/App.md": true, "Archive/Old.md": true },
      noteIcons: { "Projects/App.md": "lucide:FileText", "Archive/Old.md": "lucide:Archive" },
      folderIcons: { Projects: "lucide:Folder", Archive: "lucide:Archive" },
      folderColors: { Projects: "#123456", Archive: "#654321" },
      expandedFolders: { Projects: true, Archive: false },
      notePositions: {
        "Projects/App.md": { path: "Projects/App.md", lastOpenedAt: 1, scrollTop: 0, contentLength: 1 },
        "Archive/Old.md": { path: "Archive/Old.md", lastOpenedAt: 2, scrollTop: 0, contentLength: 1 },
      },
      bookmarks: [
        { id: "projects", kind: "folder", path: "Projects", createdAt: 1 },
        { id: "archive", kind: "folder", path: "Archive", createdAt: 2 },
        { id: "old", kind: "note", path: "Archive/Old.md", createdAt: 3 },
      ],
    });

    expect(removeNoteFromMetadata(current, "Archive/Old.md")).toMatchObject({
      noteOrder: {
        Projects: ["Projects/App.md"],
        Archive: [],
      },
      pinnedNotes: { "Projects/App.md": true },
      noteIcons: { "Projects/App.md": "lucide:FileText" },
      bookmarks: [
        { id: "projects", kind: "folder", path: "Projects", createdAt: 1 },
        { id: "archive", kind: "folder", path: "Archive", createdAt: 2 },
      ],
    });

    expect(removeFolderFromMetadata(current, "Projects")).toMatchObject({
      folderOrder: { "": ["Archive"] },
      noteOrder: { Archive: ["Archive/Old.md"] },
      pinnedNotes: { "Archive/Old.md": true },
      folderIcons: { Archive: "lucide:Archive" },
      folderColors: { Archive: "#654321" },
      expandedFolders: { Archive: false },
      noteIcons: { "Archive/Old.md": "lucide:Archive" },
      bookmarks: [
        { id: "archive", kind: "folder", path: "Archive", createdAt: 2 },
        { id: "old", kind: "note", path: "Archive/Old.md", createdAt: 3 },
      ],
    });
  });

  it("adds ordering entries and deletes empty metadata values", () => {
    const current = metadata({
      noteOrder: { Inbox: ["Inbox/One.md"] },
      folderOrder: { "": ["Inbox"] },
      noteIcons: { "Inbox/One.md": "lucide:FileText" },
    });

    expect(addToOrder(current, "Inbox", "Inbox/Two.md").noteOrder.Inbox).toEqual(["Inbox/One.md", "Inbox/Two.md"]);
    expect(addToOrder(current, "Inbox", "Inbox/One.md").noteOrder.Inbox).toEqual(["Inbox/One.md"]);
    expect(addFolderToOrder(current, "", "Archive").folderOrder[""]).toEqual(["Inbox", "Archive"]);
    expect(setMetadataValue(current, "noteIcons", "Inbox/One.md", "").noteIcons).toEqual({});
    expect(setMetadataValue(current, "folderColors", "Inbox", "#abcdef").folderColors).toEqual({ Inbox: "#abcdef" });
  });

  it("orders folders by custom order with title fallback", () => {
    const folders = [folder("c", "Charlie"), folder("a", "Alpha"), folder("b", "Bravo")];

    expect(orderFolders(folders, "", metadata({ folderOrder: { "": ["b"] } })).map((entry) => entry.path)).toEqual(["b", "a", "c"]);
  });
});
