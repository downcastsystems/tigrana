import { describe, expect, it, vi } from "vitest";
import type { WorkspaceMetadata } from "../types";
import { NotebookMetadataPersistence } from "./notebookMetadataPersistence";
import { defaultWorkspaceMetadata } from "./notebookStorage";

describe("Notebook metadata persistence", () => {
  it("serializes metadata writes and path mutations for each Notebook", async () => {
    let releaseFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    const events: string[] = [];
    const storage = {
      writeWorkspaceMetadata: vi.fn(async () => {
        events.push("write:start");
        await firstWrite;
        events.push("write:end");
      }),
    };
    const persistence = new NotebookMetadataPersistence(storage);
    let metadata: WorkspaceMetadata = defaultWorkspaceMetadata();

    const write = persistence.write("/Notebook", () => metadata);
    const mutation = persistence.runExclusive("/Notebook", async () => {
      events.push("mutation");
      metadata = { ...metadata, pinnedNotes: { "Renamed.md": true } };
    });

    await Promise.resolve();
    expect(events).toEqual(["write:start"]);

    releaseFirstWrite();
    await Promise.all([write, mutation]);
    expect(events).toEqual(["write:start", "write:end", "mutation"]);
  });

  it("reads the newest metadata when a queued write begins", async () => {
    let releaseMutation!: () => void;
    const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const written: WorkspaceMetadata[] = [];
    const persistence = new NotebookMetadataPersistence({
      writeWorkspaceMetadata: async (_workspace, metadata) => { written.push(metadata); },
    });
    let metadata = defaultWorkspaceMetadata();

    const mutation = persistence.runExclusive("/Notebook", async () => { await mutationGate; });
    const write = persistence.write("/Notebook", () => metadata);
    metadata = { ...metadata, pinnedNotes: { "Renamed.md": true } };
    releaseMutation();

    await Promise.all([mutation, write]);
    expect(written[0].pinnedNotes).toEqual({ "Renamed.md": true });
  });

  it("continues the queue after a failed write", async () => {
    const storage = {
      writeWorkspaceMetadata: vi.fn()
        .mockRejectedValueOnce(new Error("disk full"))
        .mockResolvedValueOnce(undefined),
    };
    const persistence = new NotebookMetadataPersistence(storage);
    const metadata = defaultWorkspaceMetadata();

    await expect(persistence.write("/Notebook", () => metadata)).rejects.toThrow("disk full");
    await expect(persistence.write("/Notebook", () => metadata)).resolves.toBeUndefined();
    expect(storage.writeWorkspaceMetadata).toHaveBeenCalledTimes(2);
  });
});
