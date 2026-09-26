import { BookOpen, ChevronDown, ChevronUp, FolderOpen, Plus, Settings } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { getNotebookName } from "../../lib/notebookMetadata";
import type { RecentNotebook } from "../../lib/notebookSession";

export function NotebookFooter({
  menuOpen,
  recentNotebooks,
  workspace,
  onManageNotebooks,
  onNewNotebook,
  onOpenWorkspace,
  onSelectNotebook,
  onToggleMenu,
}: {
  menuOpen: boolean;
  recentNotebooks: RecentNotebook[];
  workspace: string;
  onManageNotebooks: () => void;
  onNewNotebook: () => void;
  onOpenWorkspace: () => void;
  onSelectNotebook: (path: string) => void;
  onToggleMenu: (event: React.MouseEvent) => void;
}) {
  return (
    <div className="notebook-footer">
      <div className="app-menu-wrap">
        <NotebookMenuButton workspace={workspace} menuOpen={menuOpen} onToggleMenu={onToggleMenu} />
        {menuOpen ? (
          <div className="app-menu" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={onNewNotebook}>
              <Plus size={14} />
              <span>New Notebook</span>
            </button>
            <button type="button" onClick={onOpenWorkspace}>
              <FolderOpen size={14} />
              <span>Open Notebook</span>
            </button>
            <div className="app-menu-separator" />
            <div className="recent-notebooks-list" role="menu" aria-label="Recent notebooks">
              {recentNotebooks.map((notebook) => (
                <button
                  className={workspace === notebook.path ? "is-active" : ""}
                  key={notebook.path}
                  type="button"
                  role="menuitem"
                  onClick={() => onSelectNotebook(notebook.path)}
                  title={notebook.path}
                >
                  <BookOpen size={14} />
                  <span>
                    <strong>{notebook.name}</strong>
                    <small>{notebook.path}</small>
                  </span>
                </button>
              ))}
              {!recentNotebooks.length ? <p className="recent-notebooks-empty">No recent notebooks</p> : null}
            </div>
            <div className="app-menu-separator" />
            <button type="button" onClick={onManageNotebooks}>
              <Settings size={14} />
              <span>Manage Notebooks</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NotebookMenuButton({
  menuOpen,
  workspace,
  onToggleMenu,
}: {
  menuOpen: boolean;
  workspace: string;
  onToggleMenu: (event: React.MouseEvent) => void;
}) {
  const titleRef = useRef<HTMLElement | null>(null);
  const [titleOverflows, setTitleOverflows] = useState(false);
  const notebookName = getNotebookName(workspace);

  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;

    const updateOverflow = () => {
      setTitleOverflows(title.scrollWidth > title.clientWidth + 1);
    };

    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(title);
    window.addEventListener("resize", updateOverflow);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [notebookName]);

  return (
    <button className="app-menu-button" type="button" aria-expanded={menuOpen} onClick={onToggleMenu}>
      {menuOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      <strong ref={titleRef} className={titleOverflows ? "is-overflowing" : ""}>{notebookName}</strong>
    </button>
  );
}
