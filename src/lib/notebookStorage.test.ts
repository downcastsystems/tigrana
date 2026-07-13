import { describe, expect, it, vi } from "vitest";
import { createDemoNotebookStorage, createNativeNotebookStorage, defaultWorkspaceMetadata } from "./notebookStorage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("Notebook storage adapters", () => {
  it("exposes demo limitations as capabilities", () => {
    expect(createDemoNotebookStorage(memoryStorage()).capabilities).toEqual({
      atomicPathMutations: false,
      durableLinkIndex: false,
      noteHistory: false,
      recentlyDeleted: false,
      workspaceWatching: false,
    });
  });

  it("supports the Note and Folder lifecycle through the demo adapter", async () => {
    const storage = createDemoNotebookStorage(memoryStorage());
    const workspace = "/demo/Test";

    const folder = await storage.createFolder(workspace, "", "Part / One");
    const note = await storage.createNote(workspace, folder.path, "Opening #1");
    await storage.saveNote(workspace, note.path, "# Opening\n\nOnce upon a time.");
    const renamed = await storage.renameNote(workspace, note.path, "A New Start");
    const moved = await storage.moveNote(workspace, renamed.path, "");

    expect(folder).toMatchObject({ path: "Part ／ One", name: "Part / One" });
    expect(await storage.readNote(workspace, moved.path)).toContain("Once upon a time.");
    expect((await storage.listNotes(workspace)).find((entry) => entry.path === moved.path)?.title).toBe("A New Start");

    await storage.trashFolder(workspace, folder.path);
    expect((await storage.listFolders(workspace)).some((entry) => entry.path === folder.path)).toBe(false);
  });

  it("persists Notebook metadata and initializes the welcome-note marker", async () => {
    const storage = createDemoNotebookStorage(memoryStorage());
    const metadata = defaultWorkspaceMetadata();
    const ensured = await storage.ensureWelcomeNote("/demo/Test", metadata);

    expect(ensured.metadata.welcomeNoteAdded).toBe(true);
    expect((await storage.readWorkspaceMetadata("/demo/Test")).welcomeNoteAdded).toBe(true);
  });

  it("routes the native adapter through the Tauri command seam", async () => {
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "list_notes") return [{ path: "Drafts／Plan.md", title: "Plan／A", parent_path: "Drafts／Plan" }];
      return undefined;
    });
    const storage = createNativeNotebookStorage(
      invokeCommand as unknown as Parameters<typeof createNativeNotebookStorage>[0],
    );

    await expect(storage.listNotes("/Notebook")).resolves.toEqual([
      { path: "Drafts／Plan.md", title: "Plan/A", parent_path: "Drafts／Plan" },
    ]);
    expect(invokeCommand).toHaveBeenCalledWith("list_notes", { workspace: "/Notebook" });
    expect(storage.capabilities.durableLinkIndex).toBe(true);
  });

  it("passes Folder sibling placement through the native command seam", async () => {
    const invokeCommand = vi.fn(async () => ({ path: "Archive/Part", name: "Part", parent_path: "Archive" }));
    const storage = createNativeNotebookStorage(
      invokeCommand as unknown as Parameters<typeof createNativeNotebookStorage>[0],
    );

    await storage.moveFolder("/Notebook", "Book/Part", "Archive", {
      targetPath: "Archive/Epilogue",
      placement: "before",
    });

    expect(invokeCommand).toHaveBeenCalledWith("move_folder", {
      payload: {
        workspace: "/Notebook",
        path: "Book/Part",
        target_parent_path: "Archive",
        sibling_target_path: "Archive/Epilogue",
        sibling_placement: "before",
      },
    });
  });
});
