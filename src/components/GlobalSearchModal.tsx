import { ArrowDownUp, CalendarDays, Check, FileText, Folder, Search, Type, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { noteSearchPreview, recentNotes, searchNotes, type SearchDateRange, type SearchSort } from "../lib/search";
import type { FolderEntry, NoteEntry, SearchResult, WorkspaceMetadata } from "../types";

type GlobalSearchModalProps = {
  contents: Map<string, string>;
  focusRequest: number;
  folders: FolderEntry[];
  metadata: WorkspaceMetadata;
  notes: NoteEntry[];
  query: string;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (path: string) => void;
};

export function GlobalSearchModal({
  contents,
  focusRequest,
  folders,
  metadata,
  notes,
  query,
  onClose,
  onQueryChange,
  onSelect,
}: GlobalSearchModalProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [titleOnly, setTitleOnly] = useState(false);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<SearchDateRange>("any");
  const [sort, setSort] = useState<SearchSort>("relevance");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searching = Boolean(query.trim());
  const options = useMemo(
    () => ({ titleOnly, folderPath, dateRange, sort, limit: 60 }),
    [dateRange, folderPath, sort, titleOnly],
  );
  const results = useMemo(
    () => searchNotes(notes, contents, query, options),
    [contents, notes, options, query],
  );
  const recents = useMemo(
    () => recentNotes(notes, contents, metadata.notePositions, { ...options, limit: 24 }),
    [contents, metadata.notePositions, notes, options],
  );
  const displayed = searching ? results : recents.results;
  const activeIndex = Math.min(selectedIndex, Math.max(0, displayed.length - 1));
  const selected = displayed[activeIndex] ?? null;
  const preview = selected ? noteSearchPreview(contents.get(selected.path) ?? "") : "";
  const selectedFolderName = folderPath === null ? "Anywhere" : folderPath || "Notebook root";

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [focusRequest]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [dateRange, folderPath, query, sort, titleOnly]);

  const moveSelection = (delta: number) => {
    if (!displayed.length) return;
    setSelectedIndex((current) => (current + delta + displayed.length) % displayed.length);
  };

  const openSelected = () => {
    if (selected) onSelect(selected.path);
  };

  return (
    <div className="global-search-backdrop" onMouseDown={onClose}>
      <section
        className="global-search-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Search notebook"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.target instanceof HTMLSelectElement) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            moveSelection(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveSelection(-1);
          } else if (event.key === "Enter" && event.target === inputRef.current) {
            event.preventDefault();
            openSelected();
          }
        }}
      >
        <div className="global-search-input-row">
          <Search size={20} />
          <input
            ref={inputRef}
            value={query}
            aria-label="Search all notes"
            placeholder="Search this notebook…"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query ? (
            <button
              className="global-search-clear"
              type="button"
              title="Clear search"
              aria-label="Clear search"
              onClick={() => {
                onQueryChange("");
                inputRef.current?.focus();
              }}
            >
              <X size={15} />
            </button>
          ) : null}
          <span className="global-search-shortcut">⌘ K</span>
          <button className="global-search-close" type="button" title="Close search" aria-label="Close search" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="global-search-filters" aria-label="Search filters">
          <button
            className={`search-filter-button${titleOnly ? " is-active" : ""}`}
            type="button"
            aria-pressed={titleOnly}
            onClick={() => setTitleOnly((value) => !value)}
          >
            <Type size={14} />
            <span>Title only</span>
            {titleOnly ? <Check size={13} /> : null}
          </button>
          <label className={`search-filter-select${folderPath !== null ? " is-active" : ""}`}>
            <Folder size={14} />
            <span className="search-filter-label">In:</span>
            <span>{selectedFolderName}</span>
            <select
              aria-label="Search within folder"
              value={folderPath === null ? "__all__" : folderPath}
              onChange={(event) => setFolderPath(event.target.value === "__all__" ? null : event.target.value)}
            >
              <option value="__all__">Anywhere</option>
              <option value="">Notebook root</option>
              {folders.filter((folder) => folder.path).sort((a, b) => a.path.localeCompare(b.path)).map((folder) => (
                <option key={folder.path} value={folder.path}>{folder.path}</option>
              ))}
            </select>
          </label>
          <label className={`search-filter-select${dateRange !== "any" ? " is-active" : ""}`}>
            <CalendarDays size={14} />
            <span>{dateRangeLabel(dateRange)}</span>
            <select aria-label="Filter by last edited date" value={dateRange} onChange={(event) => setDateRange(event.target.value as SearchDateRange)}>
              <option value="any">Edited: Any time</option>
              <option value="today">Edited: Today</option>
              <option value="week">Edited: Past 7 days</option>
              <option value="month">Edited: Past 30 days</option>
            </select>
          </label>
          <label className="search-filter-select search-sort-select">
            <ArrowDownUp size={14} />
            <span>{sortLabel(sort)}</span>
            <select aria-label="Sort search results" value={sort} onChange={(event) => setSort(event.target.value as SearchSort)}>
              <option value="relevance">Best matches</option>
              <option value="edited-desc">Last edited: Newest</option>
              <option value="edited-asc">Last edited: Oldest</option>
              <option value="title">Title: A–Z</option>
            </select>
          </label>
        </div>

        <div className="global-search-body">
          <div className="global-search-results-pane">
            <div className="global-search-results-heading">
              <strong>{searching ? "Search results" : recents.fallback ? "Recently edited" : "Recently viewed"}</strong>
              <span>{displayed.length}{searching && results.length === 60 ? "+" : ""}</span>
            </div>
            <div className="global-search-results" role="listbox" aria-label={searching ? "Search results" : "Recent notes"}>
              {displayed.map((result, index) => (
                <SearchResultRow
                  key={result.path}
                  active={index === activeIndex}
                  lastOpenedAt={metadata.notePositions[result.path]?.lastOpenedAt}
                  query={query}
                  result={result}
                  searching={searching}
                  onHover={() => setSelectedIndex(index)}
                  onSelect={() => onSelect(result.path)}
                />
              ))}
              {!displayed.length ? (
                <div className="global-search-empty">
                  <Search size={22} />
                  <strong>{searching ? "No matching notes" : "No notes to show"}</strong>
                  <span>{searching ? "Try fewer words or clear a filter." : "Notes you open will appear here."}</span>
                </div>
              ) : null}
            </div>
          </div>

          <aside className="global-search-preview" aria-label="Selected note preview">
            {selected ? (
              <>
                <div className="search-preview-header">
                  <FileText size={18} />
                  <div>
                    <strong>{selected.title}</strong>
                    <span>{selected.parent_path || "Notebook root"}</span>
                  </div>
                </div>
                <div className="search-preview-paper">
                  <h2>{selected.title}</h2>
                  <p>{preview || "This note has no text content yet."}</p>
                </div>
                <div className="search-preview-meta">{formatEditedDate(selected.updated_at)}</div>
              </>
            ) : (
              <div className="global-search-preview-empty">
                <FileText size={24} />
                <span>Select a result to preview it.</span>
              </div>
            )}
          </aside>
        </div>

        <footer className="global-search-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
        </footer>
      </section>
    </div>
  );
}

function SearchResultRow({
  active,
  lastOpenedAt,
  query,
  result,
  searching,
  onHover,
  onSelect,
}: {
  active: boolean;
  lastOpenedAt?: number;
  query: string;
  result: SearchResult;
  searching: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      className={`global-search-result${active ? " is-active" : ""}`}
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onSelect}
    >
      <FileText size={17} />
      <span className="global-search-result-copy">
        <strong>{highlight(result.title, searching ? query : "")}</strong>
        <small>{result.parent_path || "Notebook root"} · {searching ? formatEditedDate(result.updated_at) : formatRelativeDate(lastOpenedAt || (result.updated_at ?? 0) * 1000)}</small>
        {result.snippet ? <span className="global-search-result-snippet">{highlight(result.snippet, searching ? query : "")}</span> : null}
      </span>
    </button>
  );
}

function highlight(text: string, query: string): ReactNode {
  const normalized = query.trim().replace(/^"|"$/g, "");
  if (!normalized) return text;
  const index = text.toLowerCase().indexOf(normalized.toLowerCase());
  if (index === -1) return text;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + normalized.length)}</mark>{text.slice(index + normalized.length)}</>;
}

function dateRangeLabel(range: SearchDateRange) {
  if (range === "today") return "Edited: Today";
  if (range === "week") return "Edited: 7 days";
  if (range === "month") return "Edited: 30 days";
  return "Edited: Any time";
}

function sortLabel(sort: SearchSort) {
  if (sort === "edited-desc") return "Newest edited";
  if (sort === "edited-asc") return "Oldest edited";
  if (sort === "title") return "Title A–Z";
  return "Best matches";
}

function formatEditedDate(timestamp?: number | null) {
  if (!timestamp) return "Edited date unavailable";
  return `Edited ${formatRelativeDate(timestamp * 1000)}`;
}

function formatRelativeDate(timestamp: number) {
  if (!timestamp) return "Date unavailable";
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
