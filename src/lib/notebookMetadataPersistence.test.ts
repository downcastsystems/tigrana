import { describe, expect, it, vi } from "vitest";
import type { NotePositionMetadata, WorkspaceMetadata } from "../types";
import { replaceOrderedPath } from "./notebookMetadata";
import {
  type MetadataUpdater,
  NotebookMetadataPersistence,
} from "./notebookMetadataPersistence";
import { defaultWorkspaceMetadata } from "./notebookStorage";

describe("Notebook metadata persistence", () => {
  it("serializes metadata mutations and path mutations for each Notebook", async () => {
    let releaseFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    const events: string[] = [];
    const storage = {
      writeWorkspaceMetadata: vi.fn(async (_workspace: string, metadata: WorkspaceMetadata) => {
        events.push("write:start");
        await firstWrite;
        events.push("write:end");
        return { applied: true, metadata: { ...metadata, revision: metadata.revision + 1 } };
      }),
    };
    const persistence = new NotebookMetadataPersistence(storage);
    let metadata: WorkspaceMetadata = defaultWorkspaceMetadata();
    const updater: MetadataUpdater = (current) => ({
      ...current,
      pinnedNotes: { "Draft.md": true },
    });
    metadata = updater(metadata);

    const write = persistence.mutate(
      "/Notebook",
      updater,
      metadata,
      (_workspace, next) => { metadata = next; },
    );
    const mutation = persistence.runExclusive("/Notebook", async () => {
      events.push("mutation");
    });

    await Promise.resolve();
    expect(events).toEqual(["write:start"]);

    releaseFirstWrite();
    await Promise.all([write, mutation]);
    expect(events).toEqual(["write:start", "write:end", "mutation"]);
  });

  it("persists a mutation that arrives while an earlier write is in flight", async () => {
    let releaseFirstWrite!: () => void;
    let markFirstWriteStarted!: () => void;
    const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    const firstWriteStarted = new Promise<void>((resolve) => { markFirstWriteStarted = resolve; });
    const written: WorkspaceMetadata[] = [];
    const persistence = new NotebookMetadataPersistence({
      writeWorkspaceMetadata: async (_workspace, requested) => {
        written.push(requested);
        if (written.length === 1) {
          markFirstWriteStarted();
          await firstWrite;
        }
        return { applied: true, metadata: { ...requested, revision: requested.revision + 1 } };
      },
    });
    let metadata = defaultWorkspaceMetadata();
    const accept = (_workspace: string, next: WorkspaceMetadata) => { metadata = next; };
    const pin: MetadataUpdater = (current) => ({
      ...current,
      pinnedNotes: { ...current.pinnedNotes, "Draft.md": true },
    });
    const addIcon: MetadataUpdater = (current) => ({
      ...current,
      noteIcons: { ...current.noteIcons, "Draft.md": "lucide:Star" },
    });

    metadata = pin(metadata);
    const first = persistence.mutate("/Notebook", pin, metadata, accept);
    await firstWriteStarted;
    metadata = addIcon(metadata);
    const second = persistence.mutate("/Notebook", addIcon, metadata, accept);
    releaseFirstWrite();

    await Promise.all([first, second]);
    expect(written).toHaveLength(2);
    expect(written[0].pinnedNotes).toEqual({ "Draft.md": true });
    expect(written[0].noteIcons).toEqual({});
    expect(written[1].revision).toBe(1);
    expect(written[1].noteIcons).toEqual({ "Draft.md": "lucide:Star" });
    expect(metadata.revision).toBe(2);
  });

  it("retains pending mutations after an I/O failure so flush can retry", async () => {
    const storage = {
      writeWorkspaceMetadata: vi.fn()
        .mockRejectedValueOnce(new Error("disk full"))
        .mockImplementationOnce(async (_workspace: string, metadata: WorkspaceMetadata) => ({
          applied: true,
          metadata: { ...metadata, revision: metadata.revision + 1 },
        })),
    };
    const persistence = new NotebookMetadataPersistence(storage);
    let metadata = defaultWorkspaceMetadata();
    const pin: MetadataUpdater = (current) => ({
      ...current,
      pinnedNotes: { "Draft.md": true },
    });
    metadata = pin(metadata);

    await expect(persistence.mutate(
      "/Notebook",
      pin,
      metadata,
      (_workspace, next) => { metadata = next; },
    )).rejects.toThrow("disk full");
    await expect(persistence.flush("/Notebook")).resolves.toBeUndefined();

    expect(storage.writeWorkspaceMetadata).toHaveBeenCalledTimes(2);
    expect(metadata.pinnedNotes).toEqual({ "Draft.md": true });
    expect(metadata.revision).toBe(1);
  });

  it("replays rejected and newer local mutations over durable metadata", async () => {
    let releaseFirstWrite!: () => void;
    let markFirstWriteStarted!: () => void;
    const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    const firstWriteStarted = new Promise<void>((resolve) => { markFirstWriteStarted = resolve; });
    const durable: WorkspaceMetadata = {
      ...defaultWorkspaceMetadata(),
      revision: 2,
      folderColors: { Drafts: "#123456" },
    };
    const written: WorkspaceMetadata[] = [];
    const persistence = new NotebookMetadataPersistence({
      writeWorkspaceMetadata: async (_workspace, requested) => {
        written.push(requested);
        if (written.length === 1) {
          markFirstWriteStarted();
          await firstWrite;
          return { applied: false, metadata: durable };
        }
        return { applied: true, metadata: { ...requested, revision: requested.revision + 1 } };
      },
    });
    let metadata: WorkspaceMetadata = {
      ...defaultWorkspaceMetadata(),
      revision: 1,
    };
    const accept = (_workspace: string, next: WorkspaceMetadata) => { metadata = next; };
    const pin: MetadataUpdater = (current) => ({
      ...current,
      pinnedNotes: { ...current.pinnedNotes, "Draft.md": true },
    });
    const collapseBookmarks: MetadataUpdater = (current) => ({
      ...current,
      bookmarksExpanded: false,
    });

    metadata = pin(metadata);
    const first = persistence.mutate("/Notebook", pin, metadata, accept);
    await firstWriteStarted;
    metadata = collapseBookmarks(metadata);
    const second = persistence.mutate("/Notebook", collapseBookmarks, metadata, accept);
    releaseFirstWrite();

    await Promise.all([first, second]);
    expect(written).toHaveLength(3);
    expect(written[1]).toMatchObject({
      revision: 2,
      folderColors: { Drafts: "#123456" },
      pinnedNotes: { "Draft.md": true },
      bookmarksExpanded: true,
    });
    expect(written[2]).toMatchObject({
      revision: 3,
      folderColors: { Drafts: "#123456" },
      pinnedNotes: { "Draft.md": true },
      bookmarksExpanded: false,
    });
    expect(metadata).toMatchObject({
      revision: 4,
      folderColors: { Drafts: "#123456" },
      pinnedNotes: { "Draft.md": true },
      bookmarksExpanded: false,
    });
  });

  it("coalesces deferred Note positions and rebases only the newest value", async () => {
    const written: WorkspaceMetadata[] = [];
    const durable = {
      ...defaultWorkspaceMetadata(),
      revision: 1,
      folderColors: { Drafts: "#123456" },
    };
    const persistence = new NotebookMetadataPersistence({
      writeWorkspaceMetadata: async (_workspace, requested) => {
        written.push(requested);
        return written.length === 1
          ? { applied: false, metadata: durable }
          : { applied: true, metadata: { ...requested, revision: requested.revision + 1 } };
      },
    });
    let metadata = defaultWorkspaceMetadata();
    const accept = (_workspace: string, next: WorkspaceMetadata) => { metadata = next; };
    const positionUpdater = (position: NotePositionMetadata): MetadataUpdater => (current) => ({
      ...current,
      notePositions: { ...current.notePositions, [position.path]: position },
    });
    const firstPosition = { path: "Draft.md", lastOpenedAt: 1, scrollTop: 10, contentLength: 20 };
    const secondPosition = { ...firstPosition, scrollTop: 40 };
    const firstUpdater = positionUpdater(firstPosition);
    const secondUpdater = positionUpdater(secondPosition);

    metadata = firstUpdater(metadata);
    const first = persistence.mutate("/Notebook", firstUpdater, metadata, accept, {
      defer: true,
      coalesceKey: "note-position:Draft.md",
    });
    metadata = secondUpdater(metadata);
    const second = persistence.mutate("/Notebook", secondUpdater, metadata, accept, {
      defer: true,
      coalesceKey: "note-position:Draft.md",
    });
    const flush = persistence.flush("/Notebook");

    await Promise.all([first, second, flush]);
    expect(written).toHaveLength(2);
    expect(written[0].notePositions["Draft.md"].scrollTop).toBe(40);
    expect(written[1].notePositions["Draft.md"].scrollTop).toBe(40);
    expect(metadata.folderColors).toEqual({ Drafts: "#123456" });
  });

  it("keeps deferred snapshots isolated when another Notebook becomes active", async () => {
    const written = new Map<string, WorkspaceMetadata>();
    const persistence = new NotebookMetadataPersistence({
      writeWorkspaceMetadata: async (workspace, requested) => {
        written.set(workspace, requested);
        return { applied: true, metadata: { ...requested, revision: requested.revision + 1 } };
      },
    });
    let notebookA: WorkspaceMetadata = {
      ...defaultWorkspaceMetadata(),
      revision: 1,
      noteOrder: { Drafts: ["Drafts/A.md"] },
    };
    let notebookB: WorkspaceMetadata = {
      ...defaultWorkspaceMetadata(),
      revision: 1,
      noteOrder: { Stories: ["Stories/B.md"] },
    };
    const recordA: MetadataUpdater = (current) => ({
      ...current,
      notePositions: {
        "Drafts/A.md": {
          path: "Drafts/A.md",
          lastOpenedAt: 1,
          scrollTop: 20,
          contentLength: 40,
        },
      },
    });
    const collapseB: MetadataUpdater = (current) => ({ ...current, bookmarksExpanded: false });

    notebookA = recordA(notebookA);
    const deferredA = persistence.mutate(
      "/Notebook A",
      recordA,
      notebookA,
      (_workspace, next) => { notebookA = next; },
      { defer: true, coalesceKey: "note-position:Drafts/A.md" },
    );
    notebookB = collapseB(notebookB);
    await persistence.mutate(
      "/Notebook B",
      collapseB,
      notebookB,
      (_workspace, next) => { notebookB = next; },
    );
    await Promise.all([deferredA, persistence.flush("/Notebook A")]);

    expect(written.get("/Notebook A")).toMatchObject({
      revision: 1,
      noteOrder: { Drafts: ["Drafts/A.md"] },
      notePositions: { "Drafts/A.md": { scrollTop: 20 } },
    });
    expect(written.get("/Notebook A")?.noteOrder).not.toEqual(notebookB.noteOrder);
    expect(written.get("/Notebook B")).toMatchObject({
      revision: 1,
      noteOrder: { Stories: ["Stories/B.md"] },
      bookmarksExpanded: false,
    });
  });

  it("translates pending path-scoped mutations before persistence", async () => {
    const written: WorkspaceMetadata[] = [];
    const persistence = new NotebookMetadataPersistence({
      writeWorkspaceMetadata: async (_workspace, requested) => {
        written.push(requested);
        return { applied: true, metadata: { ...requested, revision: requested.revision + 1 } };
      },
    });
    let metadata: WorkspaceMetadata = {
      ...defaultWorkspaceMetadata(),
      revision: 1,
      noteIcons: { "Drafts/Old.md": "lucide:Star" },
    };
    const clearIcon: MetadataUpdater = (current) => {
      const noteIcons = { ...current.noteIcons };
      delete noteIcons["Drafts/Old.md"];
      return { ...current, noteIcons };
    };
    metadata = clearIcon(metadata);
    const mutation = persistence.mutate(
      "/Notebook",
      clearIcon,
      metadata,
      (_workspace, next) => { metadata = next; },
      { defer: true },
    );
    const forward: MetadataUpdater = (current) => replaceOrderedPath(current, "Drafts/Old.md", "Drafts/New.md");
    const reverse: MetadataUpdater = (current) => replaceOrderedPath(current, "Drafts/New.md", "Drafts/Old.md");
    metadata = {
      ...defaultWorkspaceMetadata(),
      revision: 2,
      noteIcons: { "Drafts/New.md": "lucide:Star" },
    };
    persistence.rebasePending("/Notebook", forward, reverse, metadata);

    await Promise.all([mutation, persistence.flush("/Notebook")]);
    expect(written).toHaveLength(1);
    expect(written[0].revision).toBe(2);
    expect(written[0].noteIcons).toEqual({});
    expect(metadata.noteIcons).toEqual({});
    expect(metadata.revision).toBe(3);
  });
});
