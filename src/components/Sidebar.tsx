import { ChevronDown, ChevronRight, FileText, Folder, Plus, Search } from "lucide-react";
import { useState } from "react";
import type { TreeNode } from "../types";

type SidebarProps = {
  tree: TreeNode[];
  activePath: string | null;
  workspace: string;
  disabled?: boolean;
  onSelect: (path: string) => void;
  onCreate: (parentPath: string) => void;
  onSearchFocus: () => void;
};

export function Sidebar({ tree, activePath, workspace, disabled = false, onSelect, onCreate, onSearchFocus }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="workspace-block">
        <div>
          <span className="eyebrow">Workspace</span>
          <strong>{workspace.split("/").at(-1) || "No folder selected"}</strong>
        </div>
        <button className="icon-button" type="button" disabled={disabled} title="New note" onClick={() => onCreate("")}>
          <Plus size={17} />
        </button>
      </div>

      <button className="search-button" type="button" disabled={disabled} onClick={onSearchFocus}>
        <Search size={16} />
        <span>Search notes</span>
        <kbd>⌘K</kbd>
      </button>

      <nav className="tree">
        {tree.length ? (
          tree.map((node) => (
            <TreeItem
              activePath={activePath}
              key={node.id}
              node={node}
              onCreate={onCreate}
              onSelect={onSelect}
            />
          ))
        ) : (
          <div className="empty-tree">
            <FileText size={18} />
            <span>No notes yet</span>
          </div>
        )}
      </nav>
    </aside>
  );
}

function TreeItem({
  node,
  activePath,
  onSelect,
  onCreate,
}: {
  node: TreeNode;
  activePath: string | null;
  onSelect: (path: string) => void;
  onCreate: (parentPath: string) => void;
}) {
  const [open, setOpen] = useState(true);

  if (node.kind === "folder") {
    return (
      <div className="tree-group">
        <div className="tree-row folder-row">
          <button className="tree-toggle" type="button" onClick={() => setOpen((value) => !value)}>
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          <Folder size={15} />
          <span>{node.name}</span>
          <button className="tree-action" type="button" title="New note in folder" onClick={() => onCreate(node.path)}>
            <Plus size={14} />
          </button>
        </div>
        {open ? (
          <div className="tree-children">
            {node.children.map((child) => (
              <TreeItem
                activePath={activePath}
                key={child.id}
                node={child}
                onCreate={onCreate}
                onSelect={onSelect}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      className={activePath === node.path ? "tree-row note-row is-active" : "tree-row note-row"}
      type="button"
      onClick={() => onSelect(node.path)}
    >
      <FileText size={15} />
      <span>{node.name}</span>
    </button>
  );
}
