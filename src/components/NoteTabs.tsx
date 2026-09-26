import { ChevronDown, ChevronLeft, ChevronRight, FileText, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { stopChromeMouseDown } from "./PaneChrome";
import type { NoteTab } from "../lib/noteTabHistory";
import type { NoteEntry } from "../types";

export function TabHistoryControls({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  return (
    <div className="tab-history-controls chrome-interactive" role="group" aria-label="Note history">
      <button
        className="tab-history-button chrome-interactive"
        type="button"
        aria-label="Go back"
        title="Go back"
        disabled={!canGoBack}
        onMouseDown={stopChromeMouseDown}
        onClick={onBack}
      >
        <ChevronLeft size={19} />
      </button>
      <button
        className="tab-history-button chrome-interactive"
        type="button"
        aria-label="Go forward"
        title="Go forward"
        disabled={!canGoForward}
        onMouseDown={stopChromeMouseDown}
        onClick={onForward}
      >
        <ChevronRight size={19} />
      </button>
    </div>
  );
}

export function NoteTabs({
  activeTabId,
  tabs,
  onAdd,
  onClose,
  onContextMenu,
  onSelect,
}: {
  activePath: string | null;
  activeTabId: string | null;
  tabs: Array<NoteTab & { note: NoteEntry | null }>;
  onAdd: () => void;
  onClose: (tabId: string) => void;
  onContextMenu: (event: React.MouseEvent, tabId: string) => void;
  onSelect: (tabId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overflowWrapRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const tabCount = tabs.length;

  // Layout logic:
  //  - normal mode: tabs grow toward ~200px each, shrink with ellipsis as space tightens
  //  - compact mode: tabs become icon-only (34px) once each tab would otherwise be < 46px
  //  - overflow: if even at 34px not all tabs fit, push the tail into a dropdown menu
  const checkLayout = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const width = container.getBoundingClientRect().width;
    if (tabCount === 0) {
      setIsCompact(false);
      setVisibleCount(0);
      return;
    }
    // Reserve space for the add button (30px) + container padding (12px)
    const tabAreaWidth = width - 42;
    const naturalPerTab = tabAreaWidth / tabCount;

    if (naturalPerTab >= 46) {
      // Plenty of room — show every tab with ellipsis text
      setIsCompact(false);
      setVisibleCount(tabCount);
      return;
    }
    // Compact mode: icon-only tabs at 34px each
    setIsCompact(true);
    const compactFit = Math.floor(tabAreaWidth / 34);
    if (compactFit >= tabCount) {
      setVisibleCount(tabCount);
    } else {
      // Reserve 34px at the end for the overflow dropdown button
      const dropdownVisible = Math.max(0, Math.floor((tabAreaWidth - 34) / 34));
      setVisibleCount(dropdownVisible);
    }
  }, [tabCount]);

  useEffect(() => {
    checkLayout();
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(checkLayout);
    observer.observe(container);
    return () => observer.disconnect();
  }, [checkLayout]);

  // Close overflow menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (event: MouseEvent) => {
      if (overflowWrapRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // If the visible window slides past where tabs used to be, close the menu
  useEffect(() => {
    if (visibleCount >= tabCount) setMenuOpen(false);
  }, [tabCount, visibleCount]);

  const visibleTabs = tabs.slice(0, visibleCount);
  const overflowTabs = tabs.slice(visibleCount);
  const hasOverflow = overflowTabs.length > 0;
  const handleTabMouseDown = (event: React.MouseEvent, tabId: string) => {
    stopChromeMouseDown(event);
    if (event.button === 1) {
      event.preventDefault();
      onClose(tabId);
    }
    if (event.button === 2) {
      event.preventDefault();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`note-tabs${isCompact ? " is-compact" : ""}`}
      role="tablist"
      aria-label="Open notes"
    >
      {visibleTabs.map((tab) => (
        <button
          className={`note-tab chrome-interactive ${activeTabId === tab.id ? "is-active" : ""}`}
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTabId === tab.id}
          onMouseDown={(event) => handleTabMouseDown(event, tab.id)}
          onAuxClick={(event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            onClose(tab.id);
          }}
          onClick={() => onSelect(tab.id)}
          onContextMenu={(event) => onContextMenu(event, tab.id)}
        >
          <FileText size={14} className="note-tab-icon" />
          <span className="note-tab-label">{tab.note?.title || "Empty tab"}</span>
          <span
            className="tab-close chrome-interactive"
            role="button"
            tabIndex={0}
            title="Close tab"
            onMouseDown={stopChromeMouseDown}
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onClose(tab.id);
              }
            }}
          >
            <X size={13} />
          </span>
        </button>
      ))}
      {hasOverflow ? (
        <div className="tab-overflow-wrap chrome-interactive" ref={overflowWrapRef}>
          <button
            className="note-tab-more titlebar-icon-button chrome-interactive"
            type="button"
            title={`${overflowTabs.length} more tab${overflowTabs.length === 1 ? "" : "s"}`}
            onMouseDown={stopChromeMouseDown}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <ChevronDown size={15} />
          </button>
          {menuOpen ? (
            <div className="tab-overflow-menu chrome-interactive" role="menu">
              {overflowTabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`tab-overflow-item chrome-interactive ${activeTabId === tab.id ? "is-active" : ""}`}
                  type="button"
                  role="menuitem"
                  onMouseDown={(event) => handleTabMouseDown(event, tab.id)}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    onClose(tab.id);
                  }}
                  onClick={() => {
                    setMenuOpen(false);
                    onSelect(tab.id);
                  }}
                  onContextMenu={(event) => onContextMenu(event, tab.id)}
                >
                  <FileText size={14} />
                  <span>{tab.note?.title || "Empty tab"}</span>
                  <span
                    className="tab-close chrome-interactive"
                    role="button"
                    tabIndex={0}
                    title="Close tab"
                    onMouseDown={stopChromeMouseDown}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(tab.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onClose(tab.id);
                      }
                    }}
                  >
                    <X size={13} />
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <button
        className="note-tab-add titlebar-icon-button chrome-interactive"
        type="button"
        title="New empty tab"
        onMouseDown={stopChromeMouseDown}
        onClick={onAdd}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

export function TabListDropdown({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCloseAll,
}: {
  tabs: Array<NoteTab & { note: NoteEntry | null }>;
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCloseAll: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="tab-overflow-wrap chrome-interactive" ref={wrapRef}>
      <button
        className="icon-button titlebar-icon-button chrome-interactive"
        type="button"
        title="Open tabs"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={stopChromeMouseDown}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="tab-overflow-menu chrome-interactive" role="menu">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-overflow-item chrome-interactive ${activeTabId === tab.id ? "is-active" : ""}`}
              type="button"
              role="menuitem"
              data-copy-note-path={tab.path ?? undefined}
              onMouseDown={stopChromeMouseDown}
              onClick={() => {
                setOpen(false);
                onSelect(tab.id);
              }}
            >
              <FileText size={14} />
              <span>{tab.note?.title || "Empty tab"}</span>
              <span
                className="tab-close chrome-interactive"
                role="button"
                tabIndex={0}
                title="Close tab"
                onMouseDown={stopChromeMouseDown}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose(tab.id);
                  }
                }}
              >
                <X size={13} />
              </span>
            </button>
          ))}
          {tabs.length > 0 ? <div className="tab-list-separator" /> : null}
          <button
            className="tab-overflow-item chrome-interactive"
            type="button"
            role="menuitem"
            disabled={tabs.length === 0}
            onMouseDown={stopChromeMouseDown}
            onClick={() => {
              setOpen(false);
              onCloseAll();
            }}
          >
            <X size={14} />
            <span>Close all</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
