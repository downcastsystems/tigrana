import { BookOpen, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import { Component } from "react";

export class EditorErrorBoundary extends Component<
  { children: ReactNode; onError: (error: unknown) => void; resetKey: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  componentDidUpdate(previousProps: { resetKey: string }) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return <div className="note-load-fallback">This note could not be loaded.</div>;
    }
    return this.props.children;
  }
}

export function EmptyNoteSurface({
  appError,
  hasWorkspace,
  onCreateNote,
  onOpenWorkspace,
}: {
  appError: string | null;
  hasWorkspace: boolean;
  onCreateNote: () => void;
  onOpenWorkspace: () => void;
}) {
  return (
    <section className="welcome-surface">
      <BookOpen size={32} />
      <h1>{hasWorkspace ? "No note selected" : "Tigrana"}</h1>
      <p>{hasWorkspace ? "Pick a note from the sidebar or create a new one." : "Choose a folder to use as your notebook storage."}</p>
      <button className="primary-button" type="button" onClick={hasWorkspace ? onCreateNote : onOpenWorkspace}>
        {hasWorkspace ? null : <FolderOpen size={17} />}
        <span>{hasWorkspace ? "Create Note" : "Open Folder"}</span>
      </button>
      {appError ? <p className="app-error">{appError}</p> : null}
    </section>
  );
}

export function EditorTopbar({
  animateTitle = false,
  children,
  title = "",
  titleVisible = false,
  onTitleClick,
}: {
  animateTitle?: boolean;
  children?: ReactNode;
  title?: string;
  titleVisible?: boolean;
  onTitleClick?: () => void;
}) {
  return (
    <header className="topbar">
      <button
        type="button"
        className={`topbar-note-title${titleVisible ? " is-visible" : ""}${animateTitle ? " is-animated" : ""}`}
        title={titleVisible ? title : undefined}
        aria-hidden={!titleVisible}
        tabIndex={titleVisible ? 0 : -1}
        onClick={onTitleClick}
      >
        <span>{title}</span>
      </button>
      <div className="topbar-actions">
        {children}
      </div>
    </header>
  );
}
