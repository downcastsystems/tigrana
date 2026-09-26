import { describe, expect, it, vi } from "vitest";
import { closeAfterSaving } from "./closeAfterSaving";

describe("Closing after persistence", () => {
  it("waits for the final Note save before flushing metadata and closing", async () => {
    let finishSave!: () => void;
    const order: string[] = [];
    const pending = closeAfterSaving({
      saveNotes: async () => { await new Promise<void>(resolve => { finishSave = resolve; }); order.push("note"); },
      saveMetadata: async () => { order.push("metadata"); },
      close: async () => { order.push("close"); },
    });
    expect(order).toEqual([]);
    finishSave();
    await pending;
    expect(order).toEqual(["note", "metadata", "close"]);
  });

  it.each(["note", "metadata"])("keeps the window open after a %s save failure and permits retry", async failure => {
    const close = vi.fn(async () => undefined);
    const options = {
      saveNotes: vi.fn(async () => undefined),
      saveMetadata: vi.fn(async () => undefined),
      close,
    };
    (failure === "note" ? options.saveNotes : options.saveMetadata).mockRejectedValueOnce(new Error("Disk write failed"));
    await expect(closeAfterSaving(options)).rejects.toThrow("Disk write failed");
    expect(close).not.toHaveBeenCalled();
    await closeAfterSaving(options);
    expect(close).toHaveBeenCalledOnce();
  });
});
