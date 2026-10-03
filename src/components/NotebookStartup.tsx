import { BookOpen, FolderOpen, FolderPlus, Moon, Sun } from "lucide-react";
import { stopChromeMouseDown } from "./PaneChrome";
import type { RecentNotebook } from "../lib/notebookSession";

export function NotebookStartup({ appError, notebooks, onChooseFolder, onOpenFolder, onSelectNotebook }: {
  appError: string | null;
  notebooks: RecentNotebook[];
  onChooseFolder: () => void;
  onOpenFolder: () => void;
  onSelectNotebook: (path: string) => void;
}) {
  return (
    <main className="notebook-startup">
      <section className="notebook-startup-content" aria-labelledby="notebook-startup-title">
        <BookOpen className="notebook-startup-mark" size={36} strokeWidth={1.5} aria-hidden="true" />
        <p className="notebook-startup-eyebrow">Welcome to Tigrana</p>
        <h1 id="notebook-startup-title">A home for your thoughts.</h1>
        <p className="notebook-startup-intro">Simple notes. Your files. A space that feels like you.</p>
        <p>Create your first notebook or open an existing one. Your notes are saved as Markdown, a standard plain text format, and organized in folders.</p>
        <div className="notebook-startup-actions">
          <button className="primary-button" type="button" onClick={onChooseFolder}><FolderPlus size={17} aria-hidden="true" />Create new notebook</button>
          <button className="toolbar-button" type="button" onClick={onOpenFolder}><FolderOpen size={17} aria-hidden="true" />Open existing notebook</button>
        </div>
        <p className="notebook-startup-hint">Name your notebook, choose where to store it, and review the folder before creating.</p>
        <aside className="notebook-startup-tip" aria-label="Sync tip">
          <h2>Your notes, wherever you need them</h2>
          <p>Choose a folder inside Google Drive, iCloud Drive, or OneDrive to let that service sync your notebook across computers.</p>
        </aside>
        {notebooks.length ? <nav className="notebook-startup-recents" aria-label="Recent notebooks">
          <h2>Or return to a notebook</h2>
          {notebooks.map(notebook => <button className="notebook-startup-recent" type="button" key={notebook.path} onClick={() => onSelectNotebook(notebook.path)}>
            <BookOpen size={16} aria-hidden="true" /><span><strong>{notebook.name}</strong><small>{notebook.path}</small></span>
          </button>)}
        </nav> : null}
        {appError ? <p className="app-error" role="alert">{appError}</p> : null}
      </section>
    </main>
  );
}

export function StartupThemeToggle({ mode, onToggle }: { mode: "light" | "dark"; onToggle: () => void }) {
  const label = mode === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return <button className="startup-theme-toggle chrome-interactive" type="button" title={label} aria-label={label}
    onMouseDown={stopChromeMouseDown} onClick={onToggle}>
    {mode === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
  </button>;
}
