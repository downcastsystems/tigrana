// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./NotebookContextMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("document actions in context menus", () => {
  it.each(["note", "folder", "section"] as const)("offers exports below Reveal in Finder for a %s", async kind => {
    const noop = () => {};
    const props: ComponentProps<typeof ContextMenu> = {
      state: { kind: kind === "note" ? "note" : "folder", path: "Target", x: 0, y: 0 },
      createFolderParentName: "Notebook", createNoteParentName: "Notebook", folderColorSubject: kind === "section" ? "section" : "folder",
      isBookmarked: false, showCreateSection: false, onCopyFilePath: noop, onCreateFolder: noop, onCreateNote: noop,
      onCreateSection: noop, onDelete: noop, onDuplicate: noop, onMoveTo: noop, onOpenInNewTab: noop, onOpenInNewWindow: noop,
      onReveal: noop, onPrint: vi.fn(), onExport: vi.fn(), onRenameFolder: noop, onSetFolderColor: noop,
      onSetFolderIcon: noop, onSetNoteIcon: noop, onVersionHistory: noop, onToggleBookmark: noop, onClose: vi.fn(),
    };
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<ContextMenu {...props} />));
      const button = (text: string) => Array.from(host.querySelectorAll("button")).find(node => node.textContent === text)!;
      expect(button("Import")).toBeUndefined();
      const reveal = button("Reveal in Finder");
      expect(reveal.nextElementSibling?.getAttribute("role")).toBe("separator");
      expect(reveal.nextElementSibling?.nextElementSibling).toBe(button("Export").parentElement);
      expect(button("PDF…")).toBeUndefined();
      await act(async () => button("Export").click());
      expect(props.onClose).not.toHaveBeenCalled();
      expect(button("Export").getAttribute("aria-expanded")).toBe("true");
      await act(async () => button("PDF…").click());
      expect(props.onExport).toHaveBeenCalledWith("pdf");
      await act(async () => button("Word document…").click());
      expect(props.onExport).toHaveBeenCalledWith("docx");
      await act(async () => button("Markdown…").click());
      expect(props.onExport).toHaveBeenCalledWith("markdown");
      await act(async () => button("HTML…").click());
      expect(props.onExport).toHaveBeenCalledWith("html");
      await act(async () => button("Word document…").dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles:true})));
      expect(button("Export").getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(button("Export"));
      if (kind !== "note") {
        await act(async () => button("Print…").click());
        expect(props.onPrint).toHaveBeenCalledOnce();

      }
    } finally {
      await act(async () => root.unmount()); host.remove();
    }
  });
});
