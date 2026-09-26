import type { FolderCreationTarget, NoteCreationTarget } from "../../lib/notebookNavigation";
import { FileText, Folder, Plus } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";


export function PaneCreateMenu({
  disabled = false,
  folderTargets,
  noteTargets,
  onCreateFolder,
  onCreateNote,
}: {
  disabled?: boolean;
  folderTargets: FolderCreationTarget[];
  noteTargets: NoteCreationTarget[];
  onCreateFolder?: (parentPath?: string) => void;
  onCreateNote: (parentPath?: string, afterPath?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  const focusFirstActionOnOpenRef = useRef(false);

  useLayoutEffect(() => {
    if (open && focusFirstActionOnOpenRef.current) firstActionRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Node && controlRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'),
    );
    if (!items.length) return;

    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
        break;
      case "ArrowUp":
        nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    items[nextIndex]?.focus();
  };

  return (
    <div className="pane-create-control" ref={controlRef}>
      <button
        ref={buttonRef}
        className="icon-button pane-create-button"
        type="button"
        disabled={disabled}
        title="Add Note or Folder"
        aria-label="Add Note or Folder"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          focusFirstActionOnOpenRef.current = !open && event.detail === 0;
          setOpen((value) => !value);
        }}
      >
        <Plus size={16} />
      </button>
      {open ? (
        <div className="pane-create-menu" role="menu" onKeyDown={handleMenuKeyDown}>
          {noteTargets.map((target, index) => (
            <button
              ref={index === 0 ? firstActionRef : undefined}
              key={`${target.parentPath}:${target.afterPath ?? "end"}`}
              type="button"
              role="menuitem"
              onClick={() => choose(() => onCreateNote(target.parentPath, target.afterPath))}
            >
              <FileText size={16} />
              <span>New Note in {target.parentName}</span>
            </button>
          ))}
          {noteTargets.length > 0 && onCreateFolder && folderTargets.length > 0 ? (
            <div className="pane-create-menu-separator" role="separator" />
          ) : null}
          {onCreateFolder ? folderTargets.map((target) => (
            <button
              key={target.parentPath}
              type="button"
              role="menuitem"
              onClick={() => choose(() => onCreateFolder(target.parentPath))}
            >
              <Folder size={16} />
              <span>New Folder in {target.parentName}</span>
            </button>
          )) : null}
        </div>
      ) : null}
    </div>
  );
}
