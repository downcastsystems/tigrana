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
    const snapshot = await storage.readNotebookSnapshot(workspace);
    expect(snapshot.notes.map((entry) => entry.path).sort()).toEqual(Object.keys(snapshot.contents).sort());
    expect(snapshot.linkIndex).toBeNull();

    await storage.trashFolder(workspace, folder.path);
    expect((await storage.listFolders(workspace)).some((entry) => entry.path === folder.path)).toBe(false);
    await expect(storage.saveNote(workspace, "Missing.md", "stale")).rejects.toThrow("no longer exists");
  });

  it("keeps demo creation time stable while saves advance update time", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-01-02T03:04:05Z"));
      const storage = createDemoNotebookStorage(memoryStorage());
      const created = await storage.createNote("/demo/Test", "", "Dated");

      vi.setSystemTime(new Date("2025-02-03T04:05:06Z"));
      await storage.saveNote("/demo/Test", created.path, "Changed");
      const saved = (await storage.listNotes("/demo/Test")).find((note) => note.path === created.path);
      const renamed = await storage.renameNote("/demo/Test", created.path, "Still Dated");

      expect(created.created_at).toBe(new Date("2025-01-02T03:04:05Z").getTime() / 1000);
      expect(saved?.created_at).toBe(created.created_at);
      expect(saved?.updated_at).toBe(new Date("2025-02-03T04:05:06Z").getTime() / 1000);
      expect(renamed.created_at).toBe(created.created_at);
      expect(renamed.updated_at).toBe(saved?.updated_at);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists Notebook metadata and initializes the welcome-note marker", async () => {
    const storage = createDemoNotebookStorage(memoryStorage());
    const metadata = defaultWorkspaceMetadata();
    const ensured = await storage.ensureWelcomeNote("/demo/Test", metadata);

    expect(ensured.metadata.welcomeNoteAdded).toBe(true);
    expect((await storage.readWorkspaceMetadata("/demo/Test")).welcomeNoteAdded).toBe(true);
  });

  it("does not mark the Welcome Note complete when atomic creation fails", async () => {
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "list_notes") return [];
      if (command === "create_note") throw new Error("disk full");
      if (command === "write_workspace_metadata") {
        throw new Error("metadata must not be marked after a failed Welcome create");
      }
      return undefined;
    });
    const storage = createNativeNotebookStorage(
      invokeCommand as unknown as Parameters<typeof createNativeNotebookStorage>[0],
    );

    await expect(storage.ensureWelcomeNote("/Notebook", defaultWorkspaceMetadata()))
      .rejects.toThrow("disk full");
    expect(invokeCommand).not.toHaveBeenCalledWith("write_workspace_metadata", expect.anything());
  });

  it("creates the Welcome Note with its body in the same Native command", async () => {
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "list_notes") return [];
      if (command === "create_note") return { path: "Welcome.md", title: "Welcome", parent_path: "" };
      if (command === "write_workspace_metadata") {
        return { applied: true, metadata: { ...defaultWorkspaceMetadata(), revision: 1, welcomeNoteAdded: true } };
      }
      return undefined;
    });
    const storage = createNativeNotebookStorage(
      invokeCommand as unknown as Parameters<typeof createNativeNotebookStorage>[0],
    );

    await expect(storage.ensureWelcomeNote("/Notebook", defaultWorkspaceMetadata())).resolves.toMatchObject({
      created: true,
      metadata: { welcomeNoteAdded: true },
    });
    expect(invokeCommand).toHaveBeenCalledWith("create_note", {
      payload: expect.objectContaining({
        workspace: "/Notebook",
        title: "Welcome",
        content: expect.stringContaining("Tigrana"),
      }),
    });
    expect(invokeCommand).not.toHaveBeenCalledWith("save_note", expect.anything());
  });

  it("routes the native adapter through the Tauri command seam", async () => {
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "list_notes") {
        return [{
          path: "Drafts／Plan.md",
          title: "Plan／A",
          parent_path: "Drafts／Plan",
          created_at: 1_700_000_000,
          updated_at: 1_710_000_000,
        }];
      }
      return undefined;
    });
    const storage = createNativeNotebookStorage(
      invokeCommand as unknown as Parameters<typeof createNativeNotebookStorage>[0],
    );

    await expect(storage.listNotes("/Notebook")).resolves.toEqual([
      {
        path: "Drafts／Plan.md",
        title: "Plan/A",
        parent_path: "Drafts／Plan",
        created_at: 1_700_000_000,
        updated_at: 1_710_000_000,
      },
    ]);
    expect(invokeCommand).toHaveBeenCalledWith("list_notes", { workspace: "/Notebook" });
    expect(storage.capabilities.durableLinkIndex).toBe(true);
  });

  it("reads a Native Notebook refresh as one decoded snapshot", async () => {
    const invokeCommand = vi.fn(async (command: string) => {
      if (command !== "read_notebook_snapshot") return undefined;
      return {
        folders: [{ path: "Drafts／Plan", name: "Drafts／Plan", parent_path: "" }],
        notes: [{ path: "Drafts／Plan/Scene.md", title: "Scene／One", parent_path: "Drafts／Plan" }],
        contents: { "Drafts／Plan/Scene.md": "# Scene" },
        linkIndex: {
          schemaVersion: 1,
          notesById: {},
          foldersById: {},
          pathToId: {},
          outbound: {},
          inbound: {},
        },
      };
    });
    const storage = createNativeNotebookStorage(
      invokeCommand as unknown as Parameters<typeof createNativeNotebookStorage>[0],
    );
    await expect(storage.readNotebookSnapshot("/Notebook")).resolves.toMatchObject({
      folders: [{ path: "Drafts／Plan", name: "Drafts/Plan", parent_path: "" }],
      notes: [{ path: "Drafts／Plan/Scene.md", title: "Scene/One", parent_path: "Drafts／Plan" }],
      contents: { "Drafts／Plan/Scene.md": "# Scene" },
    });
    expect(invokeCommand).toHaveBeenCalledTimes(1);
    expect(invokeCommand).toHaveBeenCalledWith("read_notebook_snapshot", { workspace: "/Notebook" });
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
