import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceMetadata } from "../types";
import { createNotebookPathMutations } from "./notebookPathMutations";
import { defaultWorkspaceMetadata, type NotebookStorage } from "./notebookStorage";

type Tab = { id: string; path: string | null };

function setter<T>(read: () => T, write: (value: T) => void): Dispatch<SetStateAction<T>> {
  return (value) => write(typeof value === "function" ? (value as (current: T) => T)(read()) : value);
}

function storageSeam(overrides: Partial<NotebookStorage>): NotebookStorage {
  return {
    capabilities: {
      atomicPathMutations: true,
      durableLinkIndex: true,
      noteHistory: true,
      recentlyDeleted: true,
      workspaceWatching: true,
    },
    ...overrides,
  } as NotebookStorage;
}

describe("Notebook path mutations", () => {
  it("repairs active paths, tabs, locks, and in-memory metadata after a Native Note rename", async () => {
    let activePath: string | null = "Drafts/Old.md";
    let selectedFolder = "Drafts";
    let tabs: Tab[] = [{ id: "active", path: "Drafts/Old.md" }];
    let metadata: WorkspaceMetadata = {
      ...defaultWorkspaceMetadata(),
      noteOrder: { Drafts: ["Drafts/Old.md"] },
      pinnedNotes: { "Drafts/Old.md": true },
    };
    let persistence: boolean | undefined;
    const lock = {
      current: { workspace: "/Notebook", path: "Drafts/Old.md", windowLabel: "main" },
    } as MutableRefObject<{ workspace: string; path: string; windowLabel: string } | null>;
    const storage = storageSeam({
      renameNote: vi.fn(async () => ({ path: "Drafts/New.md", title: "New", parent_path: "Drafts" })),
    });

    const mutations = createNotebookPathMutations({
      activePath,
      activeNoteLockRef: lock,
      folders: [{ path: "", name: "Notebook", parent_path: "" }],
      navigationStyle: "dual-pane",
      notes: [{ path: "Drafts/Old.md", title: "Old", parent_path: "Drafts" }],
      refreshWorkspace: vi.fn(async () => {}),
      selectedFolder,
      setActivePath: setter(() => activePath, (value) => { activePath = value; }),
      setOpenTabs: setter(() => tabs, (value) => { tabs = value; }),
      setSelectedFolder: setter(() => selectedFolder, (value) => { selectedFolder = value; }),
      updateMetadata: (updater, options) => {
        metadata = updater(metadata);
        persistence = options?.persist;
      },
      workspace: "/Notebook",
      storage,
    });

    await mutations.renameNote("Drafts/Old.md", "New");

    expect(activePath).toBe("Drafts/New.md");
    expect(lock.current?.path).toBe("Drafts/New.md");
    expect(tabs[0].path).toBe("Drafts/New.md");
    expect(metadata.noteOrder.Drafts).toEqual(["Drafts/New.md"]);
    expect(metadata.pinnedNotes).toEqual({ "Drafts/New.md": true });
    expect(persistence).toBe(false);
  });

  it("repairs every session path under a moved Folder", async () => {
    let activePath: string | null = "Book/Part/Scene.md";
    let selectedFolder = "Book/Part";
    let tabs: Tab[] = [{ id: "scene", path: "Book/Part/Scene.md" }];
    let metadata: WorkspaceMetadata = {
      ...defaultWorkspaceMetadata(),
      noteOrder: { "Book/Part": ["Book/Part/Scene.md"] },
    };
    const lock = {
      current: { workspace: "/Notebook", path: "Book/Part/Scene.md", windowLabel: "main" },
    } as MutableRefObject<{ workspace: string; path: string; windowLabel: string } | null>;
    const storage = storageSeam({
      moveFolder: vi.fn(async () => ({ path: "Archive/Part", name: "Part", parent_path: "Archive" })),
    });

    const mutations = createNotebookPathMutations({
      activePath,
      activeNoteLockRef: lock,
      folders: [
        { path: "Book/Part", name: "Part", parent_path: "Book" },
        { path: "Archive", name: "Archive", parent_path: "" },
      ],
      navigationStyle: "dual-pane",
      notes: [{ path: "Book/Part/Scene.md", title: "Scene", parent_path: "Book/Part" }],
      refreshWorkspace: vi.fn(async () => {}),
      selectedFolder,
      setActivePath: setter(() => activePath, (value) => { activePath = value; }),
      setOpenTabs: setter(() => tabs, (value) => { tabs = value; }),
      setSelectedFolder: setter(() => selectedFolder, (value) => { selectedFolder = value; }),
      updateMetadata: (updater) => { metadata = updater(metadata); },
      workspace: "/Notebook",
      storage,
    });

    await mutations.moveFolder("Book/Part", "Archive");

    expect(activePath).toBe("Archive/Part/Scene.md");
    expect(lock.current?.path).toBe("Archive/Part/Scene.md");
    expect(tabs[0].path).toBe("Archive/Part/Scene.md");
    expect(selectedFolder).toBe("Archive/Part");
    expect(metadata.noteOrder["Archive/Part"]).toEqual(["Archive/Part/Scene.md"]);
  });

  it("passes requested sibling placement to the durable Folder move", async () => {
    const storage = storageSeam({
      moveFolder: vi.fn(async () => ({ path: "Archive/Part", name: "Part", parent_path: "Archive" })),
    });
    const runDurableMutationSpy = vi.fn();
    const runDurableMutation = async <T,>(operation: () => Promise<T>) => {
      runDurableMutationSpy();
      return operation();
    };
    const placement = { targetPath: "Archive/Epilogue", placement: "before" as const };

    const mutations = createNotebookPathMutations({
      activePath: null,
      activeNoteLockRef: { current: null },
      folders: [
        { path: "Book/Part", name: "Part", parent_path: "Book" },
        { path: "Archive/Epilogue", name: "Epilogue", parent_path: "Archive" },
      ],
      navigationStyle: "dual-pane",
      notes: [],
      refreshWorkspace: vi.fn(async () => {}),
      selectedFolder: "Book",
      setActivePath: vi.fn(),
      setOpenTabs: vi.fn(),
      setSelectedFolder: vi.fn(),
      updateMetadata: vi.fn(),
      workspace: "/Notebook",
      storage,
      runDurableMutation,
    });

    await mutations.moveFolder("Book/Part", "Archive", { siblingPlacement: placement });

    expect(storage.moveFolder).toHaveBeenCalledWith("/Notebook", "Book/Part", "Archive", placement);
    expect(runDurableMutationSpy).toHaveBeenCalledOnce();
  });
});
