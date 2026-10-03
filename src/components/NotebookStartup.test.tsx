// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NotebookStartup } from "./NotebookStartup";
import { ManageNotebooksModal } from "./ManageNotebooksModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("requires a folder selection and offers both new and existing notebook paths", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  const choose = vi.fn(), open = vi.fn(), select = vi.fn();
  try {
    await act(async () => root.render(<NotebookStartup appError="Folder is read-only" notebooks={[]}
      onChooseFolder={choose} onOpenFolder={open} onSelectNotebook={select} />));
    expect(host.textContent).toContain("Markdown, a standard plain text format");
    expect(host.textContent).toContain("Google Drive, iCloud Drive, or OneDrive");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Folder is read-only");
    expect(host.querySelector('[aria-label="Recent notebooks"]')).toBeNull();
    const buttons = host.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    await act(async () => { buttons[0].click(); buttons[1].click(); });
    expect(choose).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

it("reopens recent notebooks and permits removing the final active notebook", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  const select = vi.fn(), forget = vi.fn();
  const notebooks = [{ path: "/Notes", name: "Notes", lastOpenedAt: 1 }];
  try {
    await act(async () => root.render(<NotebookStartup appError={null} notebooks={notebooks}
      onChooseFolder={vi.fn()} onOpenFolder={vi.fn()} onSelectNotebook={select} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".notebook-startup-recent")!.click());
    expect(select).toHaveBeenCalledWith("/Notes");
    await act(async () => root.render(<ManageNotebooksModal activeWorkspace="/Notes" notebooks={notebooks}
      onClose={vi.fn()} onForget={forget} onSelect={select} />));
    const remove = host.querySelector<HTMLButtonElement>('[title="Remove from list"]')!;
    expect(remove.disabled).toBe(false);
    await act(async () => remove.click());
    expect(forget).toHaveBeenCalledWith("/Notes");
  } finally { await act(async () => root.unmount()); }
});
