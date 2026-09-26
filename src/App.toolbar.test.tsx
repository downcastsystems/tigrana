// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { EditorTopbar } = await import("./components/NoteSurface");
const { PropertiesPane } = await import("./components/NoteDetailsSidebar");
const { updateNoteEntryAfterSave } = await import("./lib/updateNoteEntryAfterSave");

describe("Editor topbar", () => {
  const containers: HTMLElement[] = [];

  it("copies the full file path from Properties", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const container = document.createElement("div"); document.body.appendChild(container); containers.push(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<PropertiesPane activeNote={{ path: "Folder/Note.md", parent_path: "Folder", title: "Note" }} pendingNote={null} workspace="/My Notebook" />));
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Copy File Path"]')!.click());
      expect(writeText).toHaveBeenCalledWith("/My Notebook/Folder/Note.md");
      expect(container.querySelector('[aria-label="Copy File Path"]')?.getAttribute("title")).toBe("Copied");
    } finally {
      await act(async () => root.unmount());
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  afterEach(() => {
    containers.splice(0).forEach((container) => container.remove());
  });

  it("keeps the note title and actions in the editor toolbar", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    const onTitleClick = vi.fn();

    await act(async () => {
      root.render(
        <EditorTopbar
          animateTitle
          title="A very long note title"
          titleVisible
          onTitleClick={onTitleClick}
        >
          <button type="button">Find</button>
          <button type="button">Width</button>
        </EditorTopbar>,
      );
    });

    const topbar = container.querySelector(".topbar");
    const actions = container.querySelector(".topbar-actions");
    const dockedTitle = container.querySelector(".topbar-note-title");
    expect(topbar?.firstElementChild).toBe(dockedTitle);
    expect(topbar?.lastElementChild).toBe(actions);
    expect(actions?.children).toHaveLength(2);
    expect(container.querySelector("[data-sidebar-peek]")).toBeNull();
    expect(dockedTitle?.classList.contains("is-visible")).toBe(true);
    expect(dockedTitle?.classList.contains("is-animated")).toBe(true);
    expect(dockedTitle?.getAttribute("aria-hidden")).toBe("false");
    expect(dockedTitle?.getAttribute("tabindex")).toBe("0");
    (dockedTitle as HTMLButtonElement | null)?.click();
    expect(onTitleClick).toHaveBeenCalledOnce();

    await act(async () => {
      root.render(
        <EditorTopbar
        />,
      );
    });

    expect(container.querySelector(".topbar-note-title")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".topbar-note-title")?.getAttribute("tabindex")).toBe("-1");

    await act(async () => root.unmount());
  });

  it("shows the Note creation and update datetimes in Properties", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    const createdAt = 1_700_000_000;
    const updatedAt = 1_710_000_000;

    await act(async () => {
      root.render(
        <PropertiesPane
          activeNote={{
            path: "Journal/Today.md",
            title: "Today",
            parent_path: "Journal",
            created_at: createdAt,
            updated_at: updatedAt,
          }}
          pendingNote={null}
          workspace="/Notes"
        />,
      );
    });

    const properties = Object.fromEntries(
      Array.from(container.querySelectorAll(".property-row")).map((row) => [
        row.querySelector("span")?.textContent,
        row.querySelector("strong, code")?.textContent,
      ]),
    );
    expect(properties.Created).toBe(new Date(createdAt * 1000).toLocaleString());
    expect(properties.Updated).toBe(new Date(updatedAt * 1000).toLocaleString());

    await act(async () => root.unmount());
  });

  it("refreshes the Note creation datetime from the content accepted after a save", () => {
    const note = {
      path: "Journal/Today.md",
      title: "Today",
      parent_path: "Journal",
      created_at: 1_700_000_000,
      updated_at: 1_710_000_000,
    };
    const written = "---\ncreated_at: 2025-03-04T05:06:07Z\n---\n\nBody\n";

    expect(updateNoteEntryAfterSave(note, note.path, written, 1_750_000_000)).toEqual({
      ...note,
      created_at: Date.parse("2025-03-04T05:06:07Z") / 1000,
      updated_at: 1_750_000_000,
    });
    expect(updateNoteEntryAfterSave(note, "Other.md", written, 1_750_000_000)).toBe(note);
  });
});
