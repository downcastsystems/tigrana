import { describe, expect, it } from "vitest";
import { LatestNotebookSnapshot } from "./notebookSnapshot";

describe("Latest Notebook snapshot", () => {
  it("ignores an older Notebook result that resolves after a switch", async () => {
    let resolveA!: (value: string) => void;
    let resolveB!: (value: string) => void;
    const a = new Promise<string>((resolve) => { resolveA = resolve; });
    const b = new Promise<string>((resolve) => { resolveB = resolve; });
    const loader = new LatestNotebookSnapshot<string>();

    const loadingA = loader.load("/Notebook A", () => a);
    const loadingB = loader.load("/Notebook B", () => b);
    resolveB("B");
    await expect(loadingB).resolves.toEqual({ notebook: "/Notebook B", snapshot: "B" });
    resolveA("A");
    await expect(loadingA).resolves.toBeNull();
  });

  it("ignores an older refresh of the same Notebook", async () => {
    let resolveOlder!: (value: string) => void;
    const older = new Promise<string>((resolve) => { resolveOlder = resolve; });
    const loader = new LatestNotebookSnapshot<string>();

    const loadingOlder = loader.load("/Notebook", () => older);
    await expect(loader.load("/Notebook", async () => "newer")).resolves.toEqual({
      notebook: "/Notebook",
      snapshot: "newer",
    });
    resolveOlder("older");
    await expect(loadingOlder).resolves.toBeNull();
  });

  it("does not let an inactive Notebook invalidate the active refresh", async () => {
    let resolveActive!: (value: string) => void;
    const activeRead = new Promise<string>((resolve) => { resolveActive = resolve; });
    const loader = new LatestNotebookSnapshot<string>();
    const isActive = (notebook: string) => notebook === "/Notebook B";

    const loadingB = loader.load("/Notebook B", () => activeRead, isActive);
    await expect(loader.load("/Notebook A", async () => "stale A", isActive)).resolves.toBeNull();
    resolveActive("current B");

    await expect(loadingB).resolves.toEqual({ notebook: "/Notebook B", snapshot: "current B" });
  });

  it("ignores an older refresh error after a newer refresh succeeds", async () => {
    let rejectOlder!: (error: Error) => void;
    const older = new Promise<string>((_resolve, reject) => { rejectOlder = reject; });
    const loader = new LatestNotebookSnapshot<string>();

    const loadingOlder = loader.load("/Notebook", () => older);
    await expect(loader.load("/Notebook", async () => "newer")).resolves.toEqual({
      notebook: "/Notebook",
      snapshot: "newer",
    });
    rejectOlder(new Error("obsolete failure"));

    await expect(loadingOlder).resolves.toBeNull();
  });

  it("rethrows an error from the current active refresh", async () => {
    const loader = new LatestNotebookSnapshot<string>();

    await expect(loader.load("/Notebook", async () => {
      throw new Error("current failure");
    })).rejects.toThrow("current failure");
  });
});
