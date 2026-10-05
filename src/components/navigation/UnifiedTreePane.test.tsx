// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultWorkspaceMetadata } from "../../lib/notebookStorage";
import { UnifiedTreePane } from "./UnifiedTreePane";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, mount: HTMLDivElement;
const notes = Array.from({ length: 40 }, (_, i) => ({ path: `Meetings/Month/Note ${i}.md`, parent_path: "Meetings/Month", title: `Note ${i}` }));
const noop = () => undefined;
const expand = vi.fn();
const metadata = defaultWorkspaceMetadata();
async function render(section: string, activePath: string | null, expandedFolders = {}) {
  await act(async () => root.render(<UnifiedTreePane activePath={activePath} rootPath={section} title={section}
    folders={[{ path: "Meetings/Month", parent_path: "Meetings", name: "Month" }]} notes={notes}
    metadata={{ ...metadata, expandedFolders }} contents={new Map()} workspace="/Notebook" suppressFolderClickRef={{ current: false }}
    onContextMenu={noop} onFolderPointerDragStart={noop} onPin={noop} onPointerDragStart={noop}
    onSelectNote={noop} onSetFolderExpanded={expand} />));
}
beforeEach(() => {
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
  // Model an overflowing tree without relying on jsdom layout.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("unified-tree-scroll")) return new DOMRect(0, 50, 240, 200);
    if (this.classList.contains("unified-note-row")) {
      const pane = this.closest<HTMLElement>(".unified-tree-scroll")!;
      const index = [...pane.querySelectorAll(".unified-note-row")].indexOf(this);
      return new DOMRect(0, 74 + index * 24 - pane.scrollTop, 240, 24);
    }
    return new DOMRect();
  });
});
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); vi.restoreAllMocks(); expand.mockClear(); });
it("reveals the remembered note after switching sections without scrolling on unrelated renders", async () => {
  await render("Meetings", notes[35].path);
  const pane = mount.querySelector<HTMLElement>(".unified-tree-scroll")!;
  expect(pane.scrollTop).toBeGreaterThan(0);
  await render("Projects", null); pane.scrollTop = 0;
  await render("Meetings", notes[35].path);
  const row = pane.querySelector<HTMLElement>(".is-active")!.getBoundingClientRect();
  expect(row.bottom).toBeLessThanOrEqual(pane.getBoundingClientRect().bottom);
  expect(row.top).toBeGreaterThanOrEqual(pane.getBoundingClientRect().top);
  pane.scrollTop = 0;
  await render("Meetings", notes[35].path);
  expect(pane.scrollTop).toBe(0);
});
it("waits for collapsed ancestors to expand, and respects a later manual collapse", async () => {
  await render("Meetings", notes[35].path, { "Meetings/Month": false });
  expect(expand).toHaveBeenCalledWith("Meetings/Month", true);
  await render("Meetings", notes[35].path, { "Meetings/Month": true });
  expect(mount.querySelector<HTMLElement>(".unified-tree-scroll")!.scrollTop).toBeGreaterThan(0);
  expand.mockClear();
  await render("Meetings", notes[35].path, { "Meetings/Month": false });
  expect(expand).not.toHaveBeenCalled();
});
it("leaves already visible notes in place and scrolls upward only as far as needed", async () => {
  await render("Meetings", notes[0].path);
  const pane = mount.querySelector<HTMLElement>(".unified-tree-scroll")!;
  expect(pane.scrollTop).toBe(0);
  await render("Meetings", notes[35].path);
  await render("Meetings", notes[2].path);
  expect(pane.querySelector<HTMLElement>(".is-active")!.getBoundingClientRect().top).toBe(50);
});

it("collapses nested folders in this section, then expands them without reopening the active note", async () => {
  const folderEntries = [
    { path: "Meetings/Month", parent_path: "Meetings", name: "Month" },
    { path: "Meetings/Month/Week", parent_path: "Meetings/Month", name: "Week" },
    { path: "Projects/Other", parent_path: "Projects", name: "Other" },
  ];
  const bulkUpdate = vi.fn();
  function Pane() {
    const [current, setCurrent] = useState({ ...metadata, expandedFolders: { "Meetings/Month": true, "Meetings/Month/Week": false } });
    return <UnifiedTreePane activePath={notes[0].path} rootPath="Meetings" title="Meetings"
      folders={folderEntries} notes={notes} metadata={current} contents={new Map()} workspace="/Notebook"
      suppressFolderClickRef={{ current: false }} onContextMenu={noop} onFolderPointerDragStart={noop}
      onPin={noop} onPointerDragStart={noop} onSelectNote={noop} onSetFolderExpanded={expand}
      onCreateNote={noop} onSetPaneExpanded={(paths, expanded, includeBookmarks) => {
        bulkUpdate(paths, expanded, includeBookmarks);
        setCurrent(value => ({ ...value, expandedFolders: { ...value.expandedFolders,
          ...Object.fromEntries(paths.map(path => [path, expanded])) } }));
      }} />;
  }
  await act(async () => root.render(<Pane />));
  expand.mockClear();
  const click = async (label: string) => {
    const button = mount.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    expect(button.nextElementSibling?.classList.contains("pane-create-control")).toBe(true);
    await act(async () => button.click());
  };
  await click("Collapse all");
  expect(bulkUpdate).toHaveBeenLastCalledWith(["Meetings/Month", "Meetings/Month/Week"], false, false);
  expect(mount.querySelector(".unified-note-row")).toBeNull();
  expect(expand).not.toHaveBeenCalled();
  await click("Expand all");
  expect(bulkUpdate).toHaveBeenLastCalledWith(["Meetings/Month", "Meetings/Month/Week"], true, false);
  expect(mount.querySelector(".unified-note-row.is-active")).not.toBeNull();
});

it("omits the toggle when the pane hides its folders", async () => {
  await act(async () => root.render(<UnifiedTreePane activePath={null} rootPath="" title="Uncategorized"
    hiddenFolderParentPath="" folders={[{ path: "Meetings", parent_path: "", name: "Meetings" }]}
    notes={[]} metadata={metadata} contents={new Map()} workspace="/Notebook" suppressFolderClickRef={{ current: false }}
    onContextMenu={noop} onFolderPointerDragStart={noop} onPin={noop} onPointerDragStart={noop}
    onSelectNote={noop} onSetFolderExpanded={expand} onSetPaneExpanded={noop} />));
  expect(mount.querySelector('[aria-label="Collapse all"], [aria-label="Expand all"]')).toBeNull();
});
