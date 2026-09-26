import { Folder, MoveRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import { getNotebookName, type FolderNode } from "../lib/notebookMetadata";
import type { FolderEntry, NoteEntry, WorkspaceMetadata } from "../types";
import { IconMark } from "./IconBrowser";

export function MoveDialog({
  state,
  folderTree,
  folders,
  notes,
  metadata,
  workspace,
  appError,
  onClose,
  onSubmit,
}: {
  state: { kind: "note" | "folder"; path: string };
  folderTree: FolderNode[];
  folders: FolderEntry[];
  notes: NoteEntry[];
  metadata: WorkspaceMetadata;
  workspace: string;
  appError: string | null;
  onClose: () => void;
  onSubmit: (targetParentPath: string) => void;
}) {
  const sourceName =
    state.kind === "folder"
      ? folders.find((f) => f.path === state.path)?.name ?? state.path
      : notes.find((n) => n.path === state.path)?.title ?? state.path;
  const currentParent =
    state.kind === "folder"
      ? folders.find((f) => f.path === state.path)?.parent_path ?? ""
      : notes.find((n) => n.path === state.path)?.parent_path ?? "";

  const [query, setQuery] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<string>(currentParent);

  const isInvalidTarget = (path: string) => {
    if (state.kind === "folder") {
      if (path === state.path) return true;
      if (path.startsWith(`${state.path}/`)) return true;
    }
    return false;
  };

  const allFolderPaths = useMemo(() => {
    const root: { path: string; name: string }[] = [{ path: "", name: getNotebookName(workspace) }];
    folders.filter((f) => f.path !== "").forEach((f) => root.push({ path: f.path, name: f.name }));
    return root;
  }, [folders, workspace]);

  const filtered = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return allFolderPaths.filter((f) =>
      f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
    );
  }, [allFolderPaths, query]);

  const renderTree = (nodes: FolderNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const invalid = isInvalidTarget(node.path);
      const isSameLocation = node.path === currentParent;
      const label = node.path === "" ? getNotebookName(workspace) : node.name;
      const customIcon = metadata.folderIcons[node.path];
      return (
        <div key={node.path || "root"}>
          <button
            type="button"
            className={`move-target-row${selectedTarget === node.path ? " is-selected" : ""}${invalid ? " is-invalid" : ""}`}
            style={{ paddingLeft: 8 + depth * 16 }}
            disabled={invalid}
            onClick={() => setSelectedTarget(node.path)}
          >
            <IconMark value={customIcon} fallback={Folder} size={14} />
            <span>{label}</span>
            {isSameLocation ? <span className="move-current-tag">current</span> : null}
          </button>
          {node.children.length ? renderTree(node.children, depth + 1) : null}
        </div>
      );
    });

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form
        className="dialog move-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (isInvalidTarget(selectedTarget)) return;
          if (selectedTarget === currentParent) {
            onClose();
            return;
          }
          onSubmit(selectedTarget);
        }}
      >
        <div className="dialog-header">
          <span className="dialog-icon"><MoveRight size={18} /></span>
          <div>
            <h2>Move {state.kind === "folder" ? "folder" : "note"}</h2>
            <p>{sourceName}</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <label className="field-label" htmlFor="move-search">Destination</label>
        <input
          id="move-search"
          className="dialog-input"
          placeholder="Search folders…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
        />
        <div className="move-target-list" role="listbox">
          {filtered
            ? filtered.length
              ? filtered.map((entry) => {
                  const invalid = isInvalidTarget(entry.path);
                  const isSameLocation = entry.path === currentParent;
                  return (
                    <button
                      key={entry.path || "root"}
                      type="button"
                      className={`move-target-row${selectedTarget === entry.path ? " is-selected" : ""}${invalid ? " is-invalid" : ""}`}
                      disabled={invalid}
                      onClick={() => setSelectedTarget(entry.path)}
                    >
                      <Folder size={14} />
                      <span>{entry.path ? entry.path : getNotebookName(workspace)}</span>
                      {isSameLocation ? <span className="move-current-tag">current</span> : null}
                    </button>
                  );
                })
              : <div className="move-empty">No matches</div>
            : renderTree(folderTree, 0)}
        </div>
        {appError ? <p className="dialog-error">{appError}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="toolbar-button" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="primary-button"
            disabled={isInvalidTarget(selectedTarget) || selectedTarget === currentParent}
          >
            Move
          </button>
        </div>
      </form>
    </div>
  );
}
