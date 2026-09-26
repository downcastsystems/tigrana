import { FileText, Folder, Link2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getNotebookName } from "../../lib/notebookMetadata";
import type { FolderEntry, NoteEntry, WorkspaceMetadata } from "../../types";
import { IconMark } from "../IconBrowser";

export type LinkPickerResult = { href: string; title: string };

function looksLikeUrl(text: string) {
  const value = text.trim();
  if (!value) return false;
  if (/^(https?:|mailto:|tel:|ftps?:)/i.test(value)) return true;
  // bare domain heuristic: contains a dot, no spaces, has a letter
  return /^[^\s]+\.[^\s]+$/.test(value) && /[a-z]/i.test(value);
}

function normalizeExternalUrl(text: string) {
  const value = text.trim();
  if (/^(https?:|mailto:|tel:|ftps?:)/i.test(value)) return value;
  return `https://${value}`;
}

export function LinkPicker({
  folders,
  notes,
  workspace,
  metadata,
  onClose,
  onPick,
}: {
  folders: FolderEntry[];
  notes: NoteEntry[];
  workspace: string;
  metadata: WorkspaceMetadata;
  onClose: () => void;
  onPick: (pick: LinkPickerResult | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  type Entry = { kind: "note" | "folder"; path: string; title: string; parentDisplay: string };

  const allEntries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];
    notes.forEach((note) => {
      list.push({
        kind: "note",
        path: note.path,
        title: note.title,
        parentDisplay: note.parent_path
          ? note.parent_path
          : getNotebookName(workspace),
      });
    });
    folders
      .filter((folder) => folder.path !== "")
      .forEach((folder) => {
        list.push({
          kind: "folder",
          path: folder.path,
          title: folder.name,
          parentDisplay: folder.parent_path ? folder.parent_path : getNotebookName(workspace),
        });
      });
    return list.sort((a, b) => a.title.localeCompare(b.title));
  }, [folders, notes, workspace]);

  const trimmed = query.trim();
  const urlOption = looksLikeUrl(trimmed) ? normalizeExternalUrl(trimmed) : null;

  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase();
    if (!q) return allEntries.slice(0, 50);
    return allEntries
      .filter((entry) =>
        entry.title.toLowerCase().includes(q) || entry.path.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [allEntries, trimmed]);

  // The combined list: optional URL option first, then notebook results.
  const totalCount = (urlOption ? 1 : 0) + filtered.length;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const submitAtIndex = (index: number) => {
    if (urlOption && index === 0) {
      onPick({ href: urlOption, title: urlOption });
      return;
    }
    const entry = filtered[index - (urlOption ? 1 : 0)];
    if (entry) onPick({ href: entry.path, title: entry.title });
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog link-picker"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <span className="dialog-icon"><Link2 size={18} /></span>
          <div>
            <h2>Add link</h2>
            <p>Paste a URL or search this notebook</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <input
          className="dialog-input"
          placeholder="Paste link or search pages"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedIndex((index) => Math.min(index + 1, Math.max(totalCount - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              submitAtIndex(selectedIndex);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          autoFocus
        />
        <div className="link-picker-list" role="listbox">
          {urlOption ? (
            <button
              type="button"
              className={`link-picker-row${selectedIndex === 0 ? " is-selected" : ""}`}
              onMouseEnter={() => setSelectedIndex(0)}
              onClick={() => submitAtIndex(0)}
            >
              <Link2 size={14} />
              <span className="link-picker-title">Use as link</span>
              <span className="link-picker-parent">{urlOption}</span>
            </button>
          ) : null}
          {filtered.length || urlOption ? (
            <>
              {filtered.length ? <div className="link-picker-section-label">{trimmed ? "Pages" : "Recents"}</div> : null}
              {filtered.map((entry, index) => {
                const Icon = entry.kind === "folder" ? Folder : FileText;
                const customIcon =
                  entry.kind === "folder" ? metadata.folderIcons[entry.path] : metadata.noteIcons[entry.path];
                const totalIndex = index + (urlOption ? 1 : 0);
                return (
                  <button
                    key={`${entry.kind}-${entry.path}`}
                    type="button"
                    className={`link-picker-row${totalIndex === selectedIndex ? " is-selected" : ""}`}
                    onMouseEnter={() => setSelectedIndex(totalIndex)}
                    onClick={() => submitAtIndex(totalIndex)}
                  >
                    <IconMark value={customIcon} fallback={Icon} size={14} />
                    <span className="link-picker-title">{entry.title}</span>
                    <span className="link-picker-parent">{entry.parentDisplay}</span>
                  </button>
                );
              })}
            </>
          ) : (
            <div className="move-empty">No matches</div>
          )}
        </div>
      </div>
    </div>
  );
}
