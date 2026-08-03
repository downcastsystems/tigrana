import { describe, expect, it } from "vitest";
import {
  createNoteTab,
  getNoteTabHistoryTarget,
  moveInNoteTabHistory,
  pruneNoteTabHistory,
  replaceNoteTabPath,
  replaceNoteTabPathPrefix,
  resolveNoteTabHistory,
  visitNoteInTab,
  type NoteTab,
} from "./noteTabHistory";

describe("note tab history", () => {
  it("moves backward and forward through every visited note", () => {
    let tab: NoteTab = createNoteTab("tab-1", "One.md");
    tab = visitNoteInTab(tab, "Two.md");
    tab = visitNoteInTab(tab, "Three.md");

    expect(getNoteTabHistoryTarget(tab, -1)).toBe("Two.md");
    expect(getNoteTabHistoryTarget(tab, 1)).toBeNull();

    tab = moveInNoteTabHistory(tab, -1);
    expect(tab.path).toBe("Two.md");
    tab = moveInNoteTabHistory(tab, -1);
    expect(tab.path).toBe("One.md");
    expect(getNoteTabHistoryTarget(tab, -1)).toBeNull();

    tab = moveInNoteTabHistory(tab, 1);
    tab = moveInNoteTabHistory(tab, 1);
    expect(tab.path).toBe("Three.md");
  });

  it("drops the forward branch when another note is selected", () => {
    let tab: NoteTab = createNoteTab("tab-1", "One.md");
    tab = visitNoteInTab(tab, "Two.md");
    tab = visitNoteInTab(tab, "Three.md");
    tab = moveInNoteTabHistory(tab, -1);
    tab = visitNoteInTab(tab, "Four.md");

    expect(resolveNoteTabHistory(tab)).toEqual({
      history: ["One.md", "Two.md", "Four.md"],
      historyIndex: 2,
    });
    expect(getNoteTabHistoryTarget(tab, 1)).toBeNull();
  });

  it("keeps navigation history scoped to each tab", () => {
    const firstTab = visitNoteInTab(createNoteTab("tab-1", "One.md"), "Two.md");
    const secondTab = createNoteTab("tab-2", "Three.md");

    expect(getNoteTabHistoryTarget(firstTab, -1)).toBe("One.md");
    expect(getNoteTabHistoryTarget(secondTab, -1)).toBeNull();
  });

  it("repairs renamed and moved paths and prunes deleted history entries", () => {
    let tab: NoteTab = createNoteTab("tab-1", "Folder/One.md");
    tab = visitNoteInTab(tab, "Folder/Two.md");
    tab = visitNoteInTab(tab, "Elsewhere.md");
    tab = replaceNoteTabPath(tab, "Folder/Two.md", "Folder/Renamed.md");
    tab = replaceNoteTabPathPrefix(tab, "Folder", "Archive/Folder");
    tab = pruneNoteTabHistory(tab, (path) => path === "Archive/Folder/One.md");

    expect(resolveNoteTabHistory(tab)).toEqual({
      history: ["Archive/Folder/Renamed.md", "Elsewhere.md"],
      historyIndex: 1,
    });
  });
});
