// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RightSidebarMode } from "./NoteDetailsSidebar";
import { defaultWorkspaceMetadata } from "../lib/notebookStorage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
const { RightSidebar } = await import("./NoteDetailsSidebar");
const { useNoteOutline } = await import("../lib/useNoteOutline");
const body = (pages: number) => Array.from({ length: pages }, (_, i) => `## Page ${i + 1}`).join("\n\n");

describe("Outline scroll positions", () => {
  let root: Root;
  let container: HTMLDivElement;
  let positions: Map<string, number>;
  const noop = () => undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    positions = new Map();
    // jsdom has no layout. Model the browser's scroll clamping, including
    // the short/empty outline briefly returned before useNoteOutline catches up.
    const offsets = new WeakMap<HTMLElement, number>();
    vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (this: HTMLElement) {
      return Math.min(offsets.get(this) ?? 0, Math.max(0, this.querySelectorAll(".outline-item").length * 24 - 240));
    });
    vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (this: HTMLElement, value: number) {
      offsets.set(this, Math.max(0, Math.min(value, this.querySelectorAll(".outline-item").length * 24 - 240)));
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function Harness({ path, pages, workspace = "/Notebook", visible = true, mode = "outline", identity = path }: {
    path: string; pages: number; workspace?: string; visible?: boolean; mode?: RightSidebarMode; identity?: string;
  }) {
    const outline = useNoteOutline(path, body(pages), `${workspace}/${path}`, visible && mode === "outline");
    return visible ? <StrictMode><RightSidebar activeNote={{ path, title: path, parent_path: "" }} activePath={path}
      noteIdentity={identity} outlineScrollPositions={positions} outline={outline} mode={mode}
      workspace={workspace} frontmatter="" frontmatterError={null} pendingNote={null} linkIndex={null}
      selectedFolder="" folders={[]} notes={[]} metadata={defaultWorkspaceMetadata()}
      onFrontmatterChange={noop} onModeChange={noop} onSelectOutline={noop} onSelectBacklink={noop} /></StrictMode> : null;
  }
  const list = () => container.querySelector<HTMLElement>(".outline-list")!;
  function scroll(top: number) {
    act(() => {
      list().scrollTop = top;
      list().dispatchEvent(new Event("scroll"));
    });
  }

  it("starts unseen notes at the top and restores each note after switching through shorter outlines", () => {
    act(() => root.render(<Harness path="Large.md" pages={1000} />));
    scroll(1824);
    act(() => root.render(<Harness path="Small.md" pages={100} />));
    expect(list().scrollTop).toBe(0);
    scroll(480);
    act(() => root.render(<Harness path="Tiny.md" pages={1} />));
    act(() => root.render(<Harness path="Large.md" pages={1000} />));
    expect(list().scrollTop).toBe(1824);
    act(() => root.render(<Harness path="Small.md" pages={100} />));
    expect(list().scrollTop).toBe(480);
  });

  it("remembers positions while the sidebar is hidden or another sidebar tab is selected", () => {
    act(() => root.render(<Harness path="Large.md" pages={1000} />));
    scroll(1824);
    act(() => root.render(<Harness path="Large.md" pages={1000} visible={false} />));
    act(() => root.render(<Harness path="Large.md" pages={1000} />));
    expect(list().scrollTop).toBe(1824);
    act(() => root.render(<Harness path="Large.md" pages={1000} mode="properties" />));
    act(() => root.render(<Harness path="Large.md" pages={1000} />));
    expect(list().scrollTop).toBe(1824);
  });

  it("uses stable note identity and keeps notebooks separate", () => {
    act(() => root.render(<Harness path="Large.md" identity="note-id" pages={1000} />));
    scroll(1824);
    act(() => root.render(<Harness path="Renamed.md" identity="note-id" pages={1000} />));
    expect(list().scrollTop).toBe(1824);
    act(() => root.render(<Harness path="Renamed.md" identity="note-id" pages={1000} workspace="/Other" />));
    expect(list().scrollTop).toBe(0);
    act(() => root.render(<Harness path="Renamed.md" identity="note-id" pages={1000} />));
    expect(list().scrollTop).toBe(1824);
  });
});
