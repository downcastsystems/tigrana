import { describe, expect, it } from "vitest";
import { defaultWorkspaceMetadata } from "./notebookStorage";
import { NotebookMetadataSession } from "./notebookMetadataSession";

describe("Notebook metadata session", () => {
  it("does not update a newly active Notebook before its metadata is adopted", () => {
    const session = new NotebookMetadataSession("/Notebook A");
    const notebookA = {
      ...defaultWorkspaceMetadata(),
      bookmarksExpanded: false,
    };
    session.adopt("/Notebook A", notebookA);

    session.activate("/Notebook B");

    expect(session.isActive("/Notebook A")).toBe(false);
    expect(session.isActive("/Notebook B")).toBe(true);
    expect(session.updateActive("/Notebook B", (current) => ({
      ...current,
      appearance: { colorScheme: "dark" },
    }))).toBeNull();
    expect(session.read("/Notebook A")).toEqual(notebookA);
    expect(session.read("/Notebook B")).toBeNull();
  });

  it("keeps a delayed adoption scoped to its original Notebook", () => {
    const session = new NotebookMetadataSession("/Notebook A");
    const notebookA = defaultWorkspaceMetadata();
    const notebookB = {
      ...defaultWorkspaceMetadata(),
      appearance: { colorScheme: "light" as const },
    };
    session.adopt("/Notebook A", notebookA);
    session.activate("/Notebook B");
    session.adopt("/Notebook B", notebookB);

    const delayedA = {
      ...notebookA,
      revision: 2,
      appearance: { colorScheme: "dark" as const },
    };

    expect(session.adopt("/Notebook A", delayedA)).toBe(false);
    expect(session.read("/Notebook A")).toEqual(delayedA);
    expect(session.read("/Notebook B")).toEqual(notebookB);
  });

  it("requires fresh adoption when a cached Notebook is reactivated", () => {
    const session = new NotebookMetadataSession("/Notebook A");
    const notebookA = defaultWorkspaceMetadata();
    session.adopt("/Notebook A", notebookA);
    session.activate("/Notebook B");
    session.adopt("/Notebook B", defaultWorkspaceMetadata());
    session.activate("/Notebook A");

    expect(session.read("/Notebook A")).toEqual(notebookA);
    expect(session.readActive("/Notebook A")).toBeNull();
    expect(session.updateActive("/Notebook A", (current) => ({
      ...current,
      appearance: { colorScheme: "dark" },
    }))).toBeNull();

    session.adopt("/Notebook A", notebookA);
    expect(session.readActive("/Notebook A")).toEqual(notebookA);
  });
});
