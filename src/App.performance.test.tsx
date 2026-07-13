// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultWorkspaceMetadata } from "./lib/notebookStorage";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./lib/noteDocument", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/noteDocument")>();
  return {
    ...actual,
    readNotePreview: vi.fn(actual.readNotePreview),
  };
});

const { NoteCard } = await import("./App");
const { readNotePreview } = await import("./lib/noteDocument");

describe("Note card preview rendering", () => {
  const containers: HTMLElement[] = [];

  afterEach(() => {
    vi.mocked(readNotePreview).mockClear();
    containers.splice(0).forEach((container) => container.remove());
  });

  it("does not rebuild a preview when unrelated card state changes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    const metadata = defaultWorkspaceMetadata();
    const note = { path: "Draft.md", title: "Draft", parent_path: "" };
    const callbacks = {
      onContextMenu: vi.fn(),
      onPin: vi.fn(),
      onPointerDragStart: vi.fn(),
      onSelect: vi.fn(),
    };

    await act(async () => {
      root.render(
        <NoteCard active={false} content="A quiet opening." dragging={false} metadata={metadata} note={note} pinned={false} {...callbacks} />,
      );
    });
    await act(async () => {
      root.render(
        <NoteCard active content="A quiet opening." dragging={false} metadata={metadata} note={note} pinned={false} {...callbacks} />,
      );
    });

    expect(readNotePreview).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <NoteCard active content="A revised opening." dragging={false} metadata={metadata} note={note} pinned={false} {...callbacks} />,
      );
    });
    expect(readNotePreview).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
  });
});
