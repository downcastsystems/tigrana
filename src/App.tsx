import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  BookOpen,
  Bookmark,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  LayoutList,
  Monitor,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Pin,
  Maximize2,
  Minimize2,
  Plus,
  Save,
  Search,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NotesEditor } from "./editor/NotesEditor";
import {
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  ensureWorkspace,
  isTauri,
  listFolders,
  listNotes,
  moveFolder,
  moveNote,
  readNote,
  revealPath,
  readWorkspaceMetadata,
  renameFolder,
  renameNote,
  SAMPLE_WORKSPACE,
  saveNote,
  validateNoteTitle,
  watchWorkspace,
  writeWorkspaceMetadata,
  defaultWorkspaceMetadata,
} from "./lib/notesApi";
import { searchNotes } from "./lib/search";
import type { BookmarkEntry, FolderEntry, NoteEntry, NotePositionMetadata, SearchResult, WorkspaceMetadata } from "./types";

function stopChromeMouseDown(event: React.MouseEvent) {
  event.stopPropagation();
}

const workspaceKey = "lumen-notes-workspace";
const themeKey = "lumen-notes-theme";
const accentKey = "lumen-notes-accent";
const themePresetKey = "lumen-notes-theme-preset";
const fullWidthKey = "lumen-notes-full-width";
const folderPaneWidthKey = "lumen-notes-folder-pane-width";
const notesPaneWidthKey = "lumen-notes-notes-pane-width";
const rightPaneWidthKey = "lumen-notes-right-pane-width";
const recentNotebooksKey = "lumen-notes-recent-notebooks";
const notePositionFreshMs = 24 * 60 * 60 * 1000;
const defaultLightAccent = "#315f59";

class EditorErrorBoundary extends Component<
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
const defaultDarkAccent = "#229ff9";
const lucideIconPrefix = "lucide:";
const lucideIconMap = Object.fromEntries(
  Object.entries(LucideIcons).filter(([name, value]) => /^[A-Z]/.test(name) && !name.endsWith("Icon") && isLucideIcon(value)),
) as Record<string, LucideIcon>;
const lucideIconOptions = Object.keys(lucideIconMap).sort((a, b) => a.localeCompare(b));

type DraftNote = {
  parentPath: string;
};

type ContextMenuState =
  | { x: number; y: number; kind: "empty" }
  | { x: number; y: number; kind: "folder"; path: string }
  | { x: number; y: number; kind: "note"; path: string };

type TabContextMenuState = { x: number; y: number; tabId: string };

type ContextMenuTarget =
  | { kind: "empty" }
  | { kind: "folder"; path: string }
  | { kind: "note"; path: string };

type OpenTarget = { kind: "folder" | "note"; path: string };
type NoteChangedEvent = {
  workspace: string;
  path: string;
};
type RecentNotebook = {
  path: string;
  name: string;
  lastOpenedAt: number;
};

type PropertyDialogState =
  | { kind: "rename-folder"; path: string; value: string }
  | { kind: "folder-color"; path: string; value: string };

type IconBrowserState =
  | { kind: "folder"; path: string; value: string }
  | { kind: "note"; path: string; value: string };

type DragItem =
  | { kind: "note"; path: string }
  | { kind: "folder"; path: string }
  | null;

type NotePointerDrag = {
  dragging: boolean;
  path: string;
  startX: number;
  startY: number;
};

type NoteDragPreview = {
  path: string;
  title: string;
  x: number;
  y: number;
  overTarget: boolean;
};

type ColorScheme = "system" | "light" | "dark";
type ThemePresetId = "default" | "atom" | "solarized" | "dracula" | "nord" | "gruvbox";
type RightSidebarMode = "outline" | "frontmatter" | "properties";
type NoteTab = {
  id: string;
  path: string | null;
};

type FolderNode = FolderEntry & {
  children: FolderNode[];
};

type BookmarkView = BookmarkEntry & {
  title: string;
  icon?: string;
  missing: boolean;
};

type ThemeTokens = {
  surface: string;
  surfaceSoft: string;
  surfaceStrong: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
};

type ThemePreset = {
  id: ThemePresetId;
  name: string;
  accent: Record<"light" | "dark", string>;
  appBackground: Record<"light" | "dark", string>;
  tokens?: Partial<Record<"light" | "dark", Partial<ThemeTokens>>>;
};

type ParsedNoteMarkdown = {
  body: string;
  frontmatter: string;
  frontmatterError: string | null;
};

type FrontmatterField = {
  editable: boolean;
  key: string;
  lineIndex: number;
  value: string;
};

const themePresets: ThemePreset[] = [
  {
    id: "default",
    name: "Default",
    accent: { light: defaultLightAccent, dark: defaultDarkAccent },
    appBackground: { light: "#f7f4ef", dark: "#212225" },
  },
  {
    id: "atom",
    name: "Atom One",
    accent: { light: "#4078c0", dark: "#61afef" },
    appBackground: { light: "#fafafa", dark: "#20252b" },
  },
  {
    id: "solarized",
    name: "Solarized",
    accent: { light: "#268bd2", dark: "#2aa198" },
    appBackground: { light: "#fdf6e3", dark: "#002b36" },
  },
  {
    id: "dracula",
    name: "Dracula",
    accent: { light: "#bd93f9", dark: "#ff79c6" },
    appBackground: { light: "#f7f2fb", dark: "#282a36" },
  },
  {
    id: "nord",
    name: "Nord",
    accent: { light: "#5e81ac", dark: "#88c0d0" },
    appBackground: { light: "#eceff4", dark: "#2e3440" },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    accent: { light: "#b57614", dark: "#fabd2f" },
    appBackground: { light: "#fbf1c7", dark: "#282828" },
  },
];

export default function App() {
  const initialOpenTargetRef = useRef(readInitialOpenTarget());
  const [workspace, setWorkspace] = useState(() => readInitialWorkspace());
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => readStoredColorScheme());
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const [themePresetId, setThemePresetId] = useState<ThemePresetId>(() => readStoredThemePreset());
  const [accentColor, setAccentColor] = useState<string | null>(() => localStorage.getItem(accentKey));
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [contents, setContents] = useState(() => new Map<string, string>());
  const [metadata, setMetadata] = useState<WorkspaceMetadata>(() => defaultWorkspaceMetadata());
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [activePath, setActivePath] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState<DraftNote | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [savedTitle, setSavedTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [savedDraft, setSavedDraft] = useState("");
  const [frontmatterDraft, setFrontmatterDraft] = useState("");
  const [savedFrontmatter, setSavedFrontmatter] = useState("");
  const [frontmatterError, setFrontmatterError] = useState<string | null>(null);
  const [selectedEditorText, setSelectedEditorText] = useState("");
  const [editorRestorePosition, setEditorRestorePosition] = useState<NotePositionMetadata | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [noteFindRequest, setNoteFindRequest] = useState(0);
  const [appError, setAppError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notebooksManageOpen, setNotebooksManageOpen] = useState(false);
  const [recentNotebooks, setRecentNotebooks] = useState<RecentNotebook[]>(() => readRecentNotebooks());
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [leftVisible, setLeftVisible] = useState(true);
  const [outlineVisible, setOutlineVisible] = useState(true);
  const [rightSidebarMode, setRightSidebarMode] = useState<RightSidebarMode>("outline");
  const [rawMarkdownVisible, setRawMarkdownVisible] = useState(false);
  const [fullWidth, setFullWidth] = useState(() => localStorage.getItem(fullWidthKey) === "true");
  const [openTabs, setOpenTabs] = useState<NoteTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [folderPaneWidth, setFolderPaneWidth] = useState(() => readStoredNumber(folderPaneWidthKey, 292));
  const [notesPaneWidth, setNotesPaneWidth] = useState(() => readStoredNumber(notesPaneWidthKey, 268));
  const [rightPaneWidth, setRightPaneWidth] = useState(() => readStoredNumber(rightPaneWidthKey, 260));
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [folderDialogParent, setFolderDialogParent] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [propertyDialog, setPropertyDialog] = useState<PropertyDialogState | null>(null);
  const [iconBrowser, setIconBrowser] = useState<IconBrowserState | null>(null);
  const [draggingItem, setDraggingItem] = useState<DragItem>(null);
  const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null);
  const [noteDragPreview, setNoteDragPreview] = useState<NoteDragPreview | null>(null);
  const [editorFocusRequest, setEditorFocusRequest] = useState(0);
  const [editorFocusAtEndRequest, setEditorFocusAtEndRequest] = useState(0);
  const noteSurfaceRef = useRef<HTMLElement | null>(null);
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const draggingItemRef = useRef<DragItem>(null);
  const notePointerDragRef = useRef<NotePointerDrag | null>(null);
  const suppressNextNoteClickRef = useRef(false);
  const autoSelectedWorkspaceRef = useRef<string | null>(null);
  const metadataRef = useRef(metadata);
  const positionWriteTimerRef = useRef<number | null>(null);
  const restoredTabsWorkspaceRef = useRef<string | null>(null);
  const externalNoteChangeRef = useRef<(path: string) => void>(() => {});
  const keyboardActionsRef = useRef<{
    addEmptyTab: () => void;
    chooseWorkspace: (intent: "open" | "new") => void;
    hasOpenNote: () => boolean;
    persistDraft: () => void;
    requestCreateNote: (parentPath?: string) => void;
    selectedFolder: string;
  }>({
    addEmptyTab: () => {},
    chooseWorkspace: () => {},
    hasOpenNote: () => false,
    persistDraft: () => {},
    requestCreateNote: () => {},
    selectedFolder: "",
  });

  const activeNote = notes.find((note) => note.path === activePath) ?? null;
  const noteOpen = pendingNote || activeNote;
  const results = useMemo(() => searchNotes(notes, contents, searchQuery), [contents, notes, searchQuery]);
  const folderTree = useMemo(() => buildFolderTree(folders, workspace, metadata), [folders, metadata, workspace]);
  const visibleNotes = useMemo(
    () => orderNotes(notes.filter((note) => note.parent_path === selectedFolder), selectedFolder, metadata),
    [metadata, notes, selectedFolder],
  );
  const outline = useMemo(() => extractOutline(titleDraft, draft), [draft, titleDraft]);
  const noteStats = useMemo(() => getTextStats(selectedEditorText || draft), [draft, selectedEditorText]);
  const rawMarkdownDraft = useMemo(
    () => composeMarkdown(frontmatterDraft, draft, Boolean(frontmatterError && !frontmatterDraft)),
    [draft, frontmatterDraft, frontmatterError],
  );
  const hasUnsavedChanges = Boolean(noteOpen) && (draft !== savedDraft || titleDraft !== savedTitle || frontmatterDraft !== savedFrontmatter);
  const resolvedTheme = colorScheme === "system" ? (prefersDark ? "dark" : "light") : colorScheme;
  const themePreset = getThemePreset(themePresetId);
  const effectiveAccentColor = accentColor || themePreset.accent[resolvedTheme];
  const selectedFolderTitle = useMemo(() => displayFolderName(selectedFolder, folders, workspace), [folders, selectedFolder, workspace]);
  const bookmarks = useMemo(() => buildBookmarkViews(metadata.bookmarks, folders, notes, metadata, workspace), [folders, metadata, notes, workspace]);
  const visibleTabs = useMemo(
    () =>
      openTabs.map((tab) => ({
        ...tab,
        note: tab.path ? notes.find((note) => note.path === tab.path) ?? null : null,
      })),
    [notes, openTabs],
  );
  const frameStyle = {
    "--folder-pane-width": `${folderPaneWidth}px`,
    "--notes-pane-width": `${notesPaneWidth}px`,
    "--right-pane-width": `${rightPaneWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (isTauri()) document.documentElement.dataset.tauri = "true";
    const platform = navigator.platform || "";
    if (/Mac|iPhone|iPad/.test(platform)) document.documentElement.dataset.platform = "mac";
  }, []);

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  useEffect(() => {
    if (!workspace) return;
    setRecentNotebooks((current) => writeRecentNotebooks(touchRecentNotebook(current, workspace)));
  }, [workspace]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreset = themePreset.id;
    const root = document.documentElement.style;
    root.setProperty("--app-bg", themePreset.appBackground[resolvedTheme]);
    const tokens = deriveThemeTokens(themePreset, resolvedTheme);
    root.setProperty("--surface", tokens.surface);
    root.setProperty("--surface-soft", tokens.surfaceSoft);
    root.setProperty("--surface-strong", tokens.surfaceStrong);
    root.setProperty("--surface-muted", tokens.surfaceMuted);
    root.setProperty("--border", tokens.border);
    root.setProperty("--text", tokens.text);
    root.setProperty("--text-muted", tokens.textMuted);
    localStorage.setItem(themeKey, colorScheme);
    localStorage.setItem(themePresetKey, themePreset.id);
  }, [colorScheme, resolvedTheme, themePreset]);

  useEffect(() => {
    const rgb = hexToRgb(effectiveAccentColor);
    document.documentElement.style.setProperty("--accent", effectiveAccentColor);
    document.documentElement.style.setProperty("--accent-strong", resolvedTheme === "dark" ? "#ecf4f1" : "#192d2b");
    document.documentElement.style.setProperty("--accent-soft", rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${resolvedTheme === "dark" ? 0.18 : 0.14})` : "rgba(75, 125, 117, 0.14)");
    document.documentElement.style.setProperty("--accent-muted", rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)` : "rgba(75, 125, 117, 0.12)");
    if (accentColor) localStorage.setItem(accentKey, accentColor);
    else localStorage.removeItem(accentKey);
  }, [accentColor, effectiveAccentColor, resolvedTheme]);

  useEffect(() => {
    localStorage.setItem(fullWidthKey, String(fullWidth));
  }, [fullWidth]);

  useEffect(() => {
    localStorage.setItem(folderPaneWidthKey, String(folderPaneWidth));
  }, [folderPaneWidth]);

  useEffect(() => {
    localStorage.setItem(notesPaneWidthKey, String(notesPaneWidth));
  }, [notesPaneWidth]);

  useEffect(() => {
    localStorage.setItem(rightPaneWidthKey, String(rightPaneWidth));
  }, [rightPaneWidth]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("open-settings", () => setSettingsOpen(true)).then((callback) => {
      unlisten = callback;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!workspace || !isTauri()) return;
    void watchWorkspace(workspace).catch((error) => {
      setAppError(error instanceof Error ? error.message : String(error));
    });

    let unlisten: (() => void) | undefined;
    void listen<NoteChangedEvent>("note-changed", (event) => {
      if (event.payload.workspace !== workspace) return;
      externalNoteChangeRef.current(event.payload.path);
    }).then((callback) => {
      unlisten = callback;
    });

    return () => unlisten?.();
  }, [workspace]);

  useEffect(() => {
    if (!workspace) return;
    setMetadataLoaded(false);
    void readWorkspaceMetadata(workspace)
      .then((nextMetadata) => {
        metadataRef.current = nextMetadata;
        setMetadata(nextMetadata);
      })
      .catch((error) => {
        setAppError(error instanceof Error ? error.message : String(error));
        const fallback = defaultWorkspaceMetadata();
        metadataRef.current = fallback;
        setMetadata(fallback);
      })
      .finally(() => setMetadataLoaded(true));
  }, [workspace]);

  useEffect(() => {
    const onClick = () => {
      setAppMenuOpen(false);
      setContextMenu(null);
      setTabContextMenu(null);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  const refreshWorkspace = useCallback(async (nextWorkspace = workspace) => {
    if (!nextWorkspace) {
      setFolders([]);
      setNotes([]);
      setContents(new Map());
      setOpenTabs([]);
      return;
    }

    await ensureWorkspace(nextWorkspace);
    const [nextFolders, nextNotes] = await Promise.all([listFolders(nextWorkspace), listNotes(nextWorkspace)]);
    setFolders(nextFolders);
    setNotes(nextNotes);

    const nextContents = new Map<string, string>();
    await Promise.all(
      nextNotes.map(async (note) => {
        nextContents.set(note.path, await readNote(nextWorkspace, note.path));
      }),
    );
    setContents(nextContents);

    setSelectedFolder((current) => (nextFolders.some((folder) => folder.path === current) ? current : ""));
  }, [workspace]);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  const recordNotePosition = useCallback((path: string, markdown: string, patch: Partial<NotePositionMetadata> = {}) => {
    if (!workspace) return;
    const current = metadataRef.current;
    const existing = current.notePositions[path];
    const nextPosition: NotePositionMetadata = {
      path,
      lastOpenedAt: existing?.lastOpenedAt ?? Date.now(),
      scrollTop: existing?.scrollTop ?? 0,
      contentLength: markdown.length,
      selectionFrom: existing?.selectionFrom,
      selectionTo: existing?.selectionTo,
      ...patch,
    };
    const next: WorkspaceMetadata = {
      ...current,
      notePositions: {
        ...current.notePositions,
        [path]: nextPosition,
      },
    };

    metadataRef.current = next;
    setMetadata(next);
    if (positionWriteTimerRef.current) window.clearTimeout(positionWriteTimerRef.current);
    positionWriteTimerRef.current = window.setTimeout(() => {
      void writeWorkspaceMetadata(workspace, metadataRef.current).catch((error) => {
        setAppError(error instanceof Error ? error.message : String(error));
      });
    }, 300);
  }, [workspace]);

  useEffect(() => {
    if (!workspace) return;
    if (!metadataLoaded) return;
    if (autoSelectedWorkspaceRef.current === workspace) return;
    if (initialOpenTargetRef.current) return;
    if (metadata.sessionOpenTabs.some((path) => notes.some((note) => note.path === path))) return;
    if (activePath || pendingNote) return;
    if (!notes.length) return;
    const firstNote = notes[0];
    if (!contents.has(firstNote.path)) return;
    autoSelectedWorkspaceRef.current = workspace;
    const tabId = createTabId();
    setSelectedFolder(firstNote.parent_path);
    setActivePath(firstNote.path);
    setOpenTabs([{ id: tabId, path: firstNote.path }]);
    setActiveTabId(tabId);
    loadContentIntoEditor(firstNote, contents.get(firstNote.path) ?? "");
  }, [activePath, contents, metadata.sessionOpenTabs, metadataLoaded, notes, pendingNote, workspace]);

  useEffect(() => {
    const target = initialOpenTargetRef.current;
    if (!workspace || !metadataLoaded || !target || !notes.length) return;
    if (target.kind === "folder") {
      setSelectedFolder(target.path);
      clearCurrentNote();
      initialOpenTargetRef.current = null;
      return;
    }
    const note = notes.find((entry) => entry.path === target.path);
    const content = contents.get(target.path);
    if (note && content === undefined) return;
    if (note && content !== undefined) {
      initialOpenTargetRef.current = null;
      const tabId = createTabId();
      setOpenTabs([{ id: tabId, path: target.path }]);
      setActiveTabId(tabId);
      setActivePath(target.path);
      setPendingNote(null);
      setSelectedFolder(note.parent_path);
      loadContentIntoEditor(note, content, getRestorableNotePosition(metadataRef.current, target.path, content));
      recordNotePosition(target.path, content, { lastOpenedAt: Date.now() });
      return;
    }
    initialOpenTargetRef.current = null;
  }, [contents, metadataLoaded, notes, recordNotePosition, workspace]);

  useEffect(() => {
    if (!workspace || !metadataLoaded || initialOpenTargetRef.current) return;
    if (restoredTabsWorkspaceRef.current === workspace) return;
    const existingPaths = metadata.sessionOpenTabs.filter((path) => notes.some((note) => note.path === path));
    if (!existingPaths.length) return;

    restoredTabsWorkspaceRef.current = workspace;
    const tabs = existingPaths.map((path) => ({ id: createTabId(), path }));
    const activeSessionPath = metadata.sessionActiveTab && existingPaths.includes(metadata.sessionActiveTab)
      ? metadata.sessionActiveTab
      : existingPaths[0];
    const activeTab = tabs.find((tab) => tab.path === activeSessionPath) ?? tabs[0];
    if (!contents.has(activeTab.path)) return;
    const note = notes.find((entry) => entry.path === activeTab.path);
    const content = contents.get(activeTab.path) ?? "";
    const restorePosition = getRestorableNotePosition(metadataRef.current, activeTab.path, content);

    setOpenTabs(tabs);
    setActiveTabId(activeTab.id);
    setActivePath(activeTab.path);
    setPendingNote(null);
    if (note) setSelectedFolder(note.parent_path);
    loadContentIntoEditor(note ?? null, content, restorePosition);
    recordNotePosition(activeTab.path, content, { lastOpenedAt: Date.now() });
  }, [contents, metadata.sessionActiveTab, metadata.sessionOpenTabs, metadataLoaded, notes, recordNotePosition, workspace]);

  useEffect(() => {
    if (!workspace || !metadataLoaded) return;
    if (initialOpenTargetRef.current) return;
    if (restoredTabsWorkspaceRef.current !== workspace && metadata.sessionOpenTabs.length > 0 && openTabs.length === 0) return;

    const sessionOpenTabs = openTabs.map((tab) => tab.path).filter((path): path is string => Boolean(path));
    const activeTab = openTabs.find((tab) => tab.id === activeTabId);
    const sessionActiveTab = activeTab?.path && sessionOpenTabs.includes(activeTab.path) ? activeTab.path : sessionOpenTabs.at(-1) ?? null;

    const current = metadataRef.current;
    if (
      arraysEqual(current.sessionOpenTabs, sessionOpenTabs) &&
      current.sessionActiveTab === sessionActiveTab
    ) {
      return;
    }

    const next: WorkspaceMetadata = {
      ...current,
      sessionOpenTabs,
      sessionActiveTab,
    };
    metadataRef.current = next;
    setMetadata(next);
    void writeWorkspaceMetadata(workspace, next).catch((error) => {
      setAppError(error instanceof Error ? error.message : String(error));
    });
  }, [activeTabId, metadata.sessionOpenTabs.length, metadataLoaded, openTabs, workspace]);

  const updateMetadata = useCallback((updater: (current: WorkspaceMetadata) => WorkspaceMetadata) => {
    const next = updater(metadata);
    metadataRef.current = next;
    setMetadata(next);
    if (workspace) {
      void writeWorkspaceMetadata(workspace, next).catch((error) => {
        setAppError(error instanceof Error ? error.message : String(error));
      });
    }
  }, [metadata, workspace]);

  useEffect(() => {
    return () => {
      if (positionWriteTimerRef.current) window.clearTimeout(positionWriteTimerRef.current);
    };
  }, []);

  function currentMarkdownSnapshot() {
    return rawMarkdownDraft;
  }

  function getRestorableNotePosition(current: WorkspaceMetadata, path: string, markdown: string) {
    const position = current.notePositions[path];
    if (!position) return null;
    if (Date.now() - position.lastOpenedAt > notePositionFreshMs) return null;
    if (position.contentLength !== markdown.length) return null;
    return position;
  }

  useEffect(() => {
    const surface = noteSurfaceRef.current;
    if (!surface || !activePath) return;
    requestAnimationFrame(() => {
      const target = editorRestorePosition?.scrollTop ?? 0;
      const maxScroll = Math.max(0, surface.scrollHeight - surface.clientHeight);
      surface.scrollTop = target >= 0 && target <= maxScroll + 16 ? target : 0;
    });
    // noteOpen intentionally excluded: refreshWorkspace (auto-save) regenerates the notes
    // array which gives noteOpen a new object reference, spuriously re-firing this effect
    // and scrolling back to the top. activePath and editorRestorePosition only change on
    // actual note switches, which is the only time scroll should be restored.
  }, [activePath, editorRestorePosition]);

  function handleNoteSurfaceScroll() {
    if (!activePath) return;
    recordNotePosition(activePath, currentMarkdownSnapshot(), {
      scrollTop: noteSurfaceRef.current?.scrollTop ?? 0,
    });
  }

  function handleEditorPositionChange(position: { selectedText: string; selectionFrom: number; selectionTo: number }) {
    setSelectedEditorText(position.selectedText);
    if (!activePath) return;
    recordNotePosition(activePath, currentMarkdownSnapshot(), {
      selectionFrom: position.selectionFrom,
      selectionTo: position.selectionTo,
    });
  }

  const placePathInActiveTab = useCallback((path: string) => {
    const tabId = activeTabId && openTabs.some((tab) => tab.id === activeTabId) ? activeTabId : createTabId();
    if (tabId !== activeTabId) setActiveTabId(tabId);
    setOpenTabs((current) => {
      const tabs = current.some((tab) => tab.id === tabId) ? current : [...current, { id: tabId, path: null }];
      return tabs.map((tab) => (tab.id === tabId ? { ...tab, path } : tab));
    });
  }, [activeTabId, openTabs]);

  function replaceOpenTabPath(oldPath: string, newPath: string) {
    setOpenTabs((current) => current.map((tab) => (tab.path === oldPath ? { ...tab, path: newPath } : tab)));
  }

  function replaceOpenTabPrefix(oldPrefix: string, newPrefix: string) {
    setOpenTabs((current) => current.map((tab) => (tab.path ? { ...tab, path: replacePathPrefix(tab.path, oldPrefix, newPrefix) } : tab)));
  }

  function clearCurrentNote() {
    setActivePath(null);
    setPendingNote(null);
    setEditorRestorePosition(null);
    setTitleDraft("");
    setSavedTitle("");
    setDraft("");
    setSavedDraft("");
    setFrontmatterDraft("");
    setSavedFrontmatter("");
    setFrontmatterError(null);
    setSelectedEditorText("");
  }

  const handleNoteLoadError = useCallback((error: unknown) => {
    const noteTitle =
      titleDraft.trim() ||
      (activePath ? notes.find((note) => note.path === activePath)?.title : null) ||
      activePath ||
      "this note";
    clearCurrentNote();
    setAppError(`Could not open "${noteTitle}". ${formatUnknownError(error)}`);
  }, [activePath, notes, titleDraft]);

  async function selectNote(path: string) {
    if (hasUnsavedChanges) {
      await persistDraft();
    }
    const content = contents.get(path) ?? (await readNote(workspace, path));
    const note = notes.find((entry) => entry.path === path);
    const restorePosition = getRestorableNotePosition(metadataRef.current, path, content);
    setActivePath(path);
    setPendingNote(null);
    if (note) setSelectedFolder(note.parent_path);
    placePathInActiveTab(path);
    loadContentIntoEditor(note ?? null, content, restorePosition);
    recordNotePosition(path, content, { lastOpenedAt: Date.now() });
    setSearchQuery("");
  }

  async function handleExternalNoteChange(path: string) {
    if (!workspace) return;
    try {
      const nextContent = await readNote(workspace, path);
      const currentContent = contents.get(path);
      if (currentContent === nextContent) return;
      if (activePath === path && nextContent === currentMarkdownSnapshot()) {
        setContents((current) => {
          const next = new Map(current);
          next.set(path, nextContent);
          return next;
        });
        return;
      }

      setContents((current) => {
        const next = new Map(current);
        next.set(path, nextContent);
        return next;
      });

      const refreshedNotes = await listNotes(workspace);
      setNotes(refreshedNotes);
      const note = refreshedNotes.find((entry) => entry.path === path) ?? notes.find((entry) => entry.path === path) ?? null;
      if (activePath !== path) return;

      if (hasUnsavedChanges) {
        setAppError("This note changed on disk, but you have unsaved edits. Save or switch notes before reloading it.");
        return;
      }

      const restorePosition: NotePositionMetadata = {
        path,
        lastOpenedAt: Date.now(),
        scrollTop: noteSurfaceRef.current?.scrollTop ?? 0,
        contentLength: nextContent.length,
        selectionFrom: metadataRef.current.notePositions[path]?.selectionFrom,
        selectionTo: metadataRef.current.notePositions[path]?.selectionTo,
      };
      loadContentIntoEditor(note, nextContent, restorePosition);
      recordNotePosition(path, nextContent, restorePosition);
    } catch {
      await refreshWorkspace(workspace);
      if (activePath === path) clearCurrentNote();
    }
  }

  externalNoteChangeRef.current = (path: string) => void handleExternalNoteChange(path);

  const persistDraft = useCallback(async () => {
    setAppError(null);
    if (!workspace || !noteOpen) return;

    try {
      validateNoteTitle(titleDraft);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
      return;
    }

    setIsSaving(true);

    try {
      let nextPath = activePath;
      const markdown = composeMarkdown(frontmatterDraft, draft, Boolean(frontmatterError && !frontmatterDraft));

      if (pendingNote) {
        const note = await createNote(workspace, pendingNote.parentPath, titleDraft.trim());
        nextPath = note.path;
        setActivePath(note.path);
        setPendingNote(null);
        setSelectedFolder(note.parent_path);
        placePathInActiveTab(note.path);
        updateMetadata((current) => addToOrder(current, note.parent_path, note.path));
      } else if (activePath && titleDraft.trim() !== savedTitle) {
        const renamed = await renameNote(workspace, activePath, titleDraft.trim());
        nextPath = renamed.path;
        setActivePath(renamed.path);
        replaceOpenTabPath(activePath, renamed.path);
        updateMetadata((current) => replaceOrderedPath(current, activePath, renamed.path));
      }

      if (!nextPath) return;

      await saveNote(workspace, nextPath, markdown);
      recordNotePosition(nextPath, markdown);
      setSavedTitle(titleDraft.trim());
      setSavedDraft(draft);
      setSavedFrontmatter(frontmatterDraft);
      setContents((current) => {
        const next = new Map(current);
        if (activePath && activePath !== nextPath) next.delete(activePath);
        next.set(nextPath, markdown);
        return next;
      });
      await refreshWorkspace(workspace);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [activePath, draft, frontmatterDraft, frontmatterError, noteOpen, pendingNote, placePathInActiveTab, recordNotePosition, refreshWorkspace, savedTitle, titleDraft, updateMetadata, workspace]);

  keyboardActionsRef.current = {
    addEmptyTab: () => void addEmptyTab(),
    chooseWorkspace: (intent: "open" | "new") => void chooseWorkspace(intent),
    hasOpenNote: () => Boolean(noteOpen),
    persistDraft: () => void persistDraft(),
    requestCreateNote,
    selectedFolder,
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const actions = keyboardActionsRef.current;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setNotebooksManageOpen(false);
        setAppMenuOpen(false);
        setContextMenu(null);
        setTabContextMenu(null);
      }
      if (command && event.shiftKey && key === "f") {
        event.preventDefault();
        setLeftVisible(true);
        setSearchOpen(true);
        setSearchFocusRequest((value) => value + 1);
        return;
      }
      if (command && key === "f") {
        event.preventDefault();
        if (keyboardActionsRef.current.hasOpenNote()) {
          setNoteFindRequest((value) => value + 1);
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        setSearchFocusRequest((value) => value + 1);
        return;
      }
      if (command && key === "n") {
        event.preventDefault();
        actions.requestCreateNote(actions.selectedFolder);
        return;
      }
      if (command && key === "t") {
        event.preventDefault();
        actions.addEmptyTab();
        return;
      }
      if (command && event.shiftKey && key === "o") {
        event.preventDefault();
        actions.chooseWorkspace("new");
        return;
      }
      if (command && key === "o") {
        event.preventDefault();
        actions.chooseWorkspace("open");
        return;
      }
      if (command && key === "\\") {
        event.preventDefault();
        setLeftVisible((value) => !value);
        return;
      }
      if (command && event.altKey && key === "r") {
        event.preventDefault();
        setRawMarkdownVisible((value) => !value);
        return;
      }
      if (command && key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (command && key === "s") {
        event.preventDefault();
        actions.persistDraft();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handle = window.setTimeout(() => {
      void persistDraft();
    }, 650);
    return () => window.clearTimeout(handle);
  }, [hasUnsavedChanges, persistDraft]);

  function requestCreateNote(parentPath = selectedFolder) {
    if (!workspace) {
      setAppError("Open a notes folder before creating a note.");
      return;
    }
    setSelectedFolder(parentPath);
    setPendingNote({ parentPath });
    setActivePath(null);
    setEditorRestorePosition(null);
    const tabId = activeTabId && openTabs.some((tab) => tab.id === activeTabId) ? activeTabId : createTabId();
    if (!activeTabId || !openTabs.some((tab) => tab.id === activeTabId)) {
      setOpenTabs((current) => [...current, { id: tabId, path: null }]);
      setActiveTabId(tabId);
    } else {
      setOpenTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, path: null } : tab)));
    }
    setTitleDraft("");
    setSavedTitle("");
    setDraft("");
    setSavedDraft("");
    setFrontmatterDraft("");
    setSavedFrontmatter("");
    setFrontmatterError(null);
    setAppError(null);
  }

  useEffect(() => {
    if (!pendingNote) return;
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [pendingNote]);

  useEffect(() => {
    const titleInput = titleInputRef.current;
    if (!titleInput || !noteOpen) return;
    titleInput.style.height = "0px";
    titleInput.style.height = `${titleInput.scrollHeight}px`;
  }, [noteOpen, titleDraft]);

  async function addEmptyTab() {
    if (hasUnsavedChanges) {
      await persistDraft();
    }
    const tabId = createTabId();
    setOpenTabs((current) => [...current, { id: tabId, path: null }]);
    setActiveTabId(tabId);
    clearCurrentNote();
  }

  async function activateTab(tabId: string) {
    const tab = openTabs.find((entry) => entry.id === tabId);
    if (!tab) return;

    if (hasUnsavedChanges) {
      await persistDraft();
    }

    setActiveTabId(tab.id);
    if (tab.path) {
      const content = contents.get(tab.path) ?? (await readNote(workspace, tab.path));
      const note = notes.find((entry) => entry.path === tab.path);
      const restorePosition = getRestorableNotePosition(metadataRef.current, tab.path, content);
      setActivePath(tab.path);
      setPendingNote(null);
      if (note) setSelectedFolder(note.parent_path);
      loadContentIntoEditor(note ?? null, content, restorePosition);
      recordNotePosition(tab.path, content, { lastOpenedAt: Date.now() });
      return;
    }

    clearCurrentNote();
  }

  async function closeTab(tabId: string) {
    const tab = openTabs.find((entry) => entry.id === tabId);
    const nextTabs = openTabs.filter((entry) => entry.id !== tabId);
    setOpenTabs(nextTabs);
    setTabContextMenu(null);
    if (activeTabId !== tabId && activePath !== tab?.path) return;

    if (hasUnsavedChanges) {
      await persistDraft();
    }

    const nextTab = nextTabs.at(-1);
    if (nextTab) {
      setActiveTabId(nextTab.id);
      if (nextTab.path) {
        const content = contents.get(nextTab.path) ?? (await readNote(workspace, nextTab.path));
        const note = notes.find((entry) => entry.path === nextTab.path);
        const restorePosition = getRestorableNotePosition(metadataRef.current, nextTab.path, content);
        setActivePath(nextTab.path);
        setPendingNote(null);
        if (note) setSelectedFolder(note.parent_path);
        loadContentIntoEditor(note ?? null, content, restorePosition);
        recordNotePosition(nextTab.path, content, { lastOpenedAt: Date.now() });
      } else {
        clearCurrentNote();
      }
      return;
    }

    setActiveTabId(null);
    clearCurrentNote();
  }

  async function closeAllTabs() {
    if (hasUnsavedChanges) {
      await persistDraft();
    }
    setOpenTabs([]);
    setActiveTabId(null);
    setTabContextMenu(null);
    clearCurrentNote();
  }

  async function requestCreateFolder(parentPath = selectedFolder) {
    setFolderDialogParent(parentPath);
    setFolderName("");
  }

  async function submitFolder() {
    if (!workspace || folderDialogParent === null) return;
    try {
      const folder = await createFolder(workspace, folderDialogParent, folderName);
      updateMetadata((current) => addFolderToOrder(current, folder.parent_path, folder.path));
      setFolderDialogParent(null);
      setFolderName("");
      setSelectedFolder(folder.path);
      await refreshWorkspace(workspace);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  function switchNotebook(path: string) {
    localStorage.setItem(workspaceKey, path);
    restoredTabsWorkspaceRef.current = null;
    autoSelectedWorkspaceRef.current = null;
    initialOpenTargetRef.current = null;
    setWorkspace(path);
    setSelectedFolder("");
    clearCurrentNote();
    setOpenTabs([]);
    setActiveTabId(null);
    setSearchOpen(false);
    setSearchQuery("");
    setAppMenuOpen(false);
    setAppError(null);
    setRecentNotebooks((current) => writeRecentNotebooks(touchRecentNotebook(current, path)));
    void refreshWorkspace(path);
  }

  function openNotebookInNewWindow(path: string) {
    setAppMenuOpen(false);
    setNotebooksManageOpen(false);
    if (path === workspace) return;
    setRecentNotebooks((current) => writeRecentNotebooks(touchRecentNotebook(current, path)));

    if (!isTauri()) {
      switchNotebook(path);
      return;
    }

    const params = new URLSearchParams({ workspace: path });
    const label = `lumen-notebook-${Date.now()}`;
    const webview = new WebviewWindow(label, {
      url: `/?${params.toString()}`,
      title: path.split("/").filter(Boolean).at(-1) || "Lumen Notes",
      width: 1280,
      height: 860,
      minWidth: 920,
      minHeight: 620,
      decorations: true,
      resizable: true,
      titleBarStyle: "overlay",
      hiddenTitle: true,
      trafficLightPosition: new LogicalPosition(20, 24),
    });
    void webview.once("tauri://error", (event) => {
      setAppError(String(event.payload));
    });
  }

  async function chooseWorkspace(intent: "open" | "new" = "open", openInNewWindow = false) {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: intent === "new" ? "Choose notebook folder" : "Open notebook",
      });
      if (typeof selected !== "string") return;
      if (openInNewWindow) openNotebookInNewWindow(selected);
      else switchNotebook(selected);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  function forgetNotebook(path: string) {
    setRecentNotebooks((current) => writeRecentNotebooks(current.filter((notebook) => notebook.path !== path)));
  }

  async function handleDeleteNote(path: string) {
    if (!workspace) return;
    await deleteNote(workspace, path);
    if (activePath === path) {
      clearCurrentNote();
    }
    setOpenTabs((current) => current.filter((tab) => tab.path !== path));
    updateMetadata((current) => removeNoteFromMetadata(current, path));
    await refreshWorkspace(workspace);
  }

  async function handleDeleteFolder(path: string) {
    if (!workspace || !path) return;
    await deleteFolder(workspace, path);
    if (selectedFolder === path || selectedFolder.startsWith(`${path}/`)) setSelectedFolder("");
    if (activePath?.startsWith(`${path}/`)) clearCurrentNote();
    setOpenTabs((current) => current.filter((tab) => !tab.path?.startsWith(`${path}/`)));
    updateMetadata((current) => removeFolderFromMetadata(current, path));
    await refreshWorkspace(workspace);
  }

  function openPropertyDialog(kind: PropertyDialogState["kind"], path: string) {
    const folder = folders.find((entry) => entry.path === path);
    const value =
      kind === "rename-folder"
        ? folder?.name ?? ""
        : metadata.folderColors[path] ?? "#4b7d75";
    setPropertyDialog({ kind, path, value } as PropertyDialogState);
    setContextMenu(null);
    setAppError(null);
  }

  function openIconBrowser(kind: IconBrowserState["kind"], path: string) {
    setIconBrowser({
      kind,
      path,
      value: kind === "folder" ? metadata.folderIcons[path] ?? "" : metadata.noteIcons[path] ?? "",
    });
    setContextMenu(null);
    setAppError(null);
  }

  function setIconValue(iconName: string) {
    if (!iconBrowser) return;
    const value = iconName ? `lucide:${iconName}` : "";
    updateMetadata((current) =>
      setMetadataValue(current, iconBrowser.kind === "folder" ? "folderIcons" : "noteIcons", iconBrowser.path, value),
    );
    setIconBrowser(null);
  }

  async function submitPropertyDialog() {
    if (!workspace || !propertyDialog) return;
    try {
      if (propertyDialog.kind === "rename-folder") {
        const renamed = await renameFolder(workspace, propertyDialog.path, propertyDialog.value);
        updateMetadata((current) => replaceFolderPathPrefix(current, propertyDialog.path, renamed.path));
        if (selectedFolder === propertyDialog.path || selectedFolder.startsWith(`${propertyDialog.path}/`)) {
          setSelectedFolder(replacePathPrefix(selectedFolder, propertyDialog.path, renamed.path));
        }
        if (activePath?.startsWith(`${propertyDialog.path}/`)) {
          setActivePath(replacePathPrefix(activePath, propertyDialog.path, renamed.path));
        }
        replaceOpenTabPrefix(propertyDialog.path, renamed.path);
        await refreshWorkspace(workspace);
      } else if (propertyDialog.kind === "folder-color") {
        updateMetadata((current) => setMetadataValue(current, "folderColors", propertyDialog.path, propertyDialog.value.trim()));
      }
      setPropertyDialog(null);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  function loadContentIntoEditor(note: NoteEntry | null, markdown: string, restorePosition: NotePositionMetadata | null = null) {
    const parsed = splitMarkdownTitle(markdown, note?.title ?? "");
    const noteMarkdown = parseNoteMarkdown(parsed.body);
    setEditorRestorePosition(restorePosition);
    setTitleDraft(parsed.title);
    setSavedTitle(parsed.title);
    setDraft(noteMarkdown.body);
    setSavedDraft(noteMarkdown.body);
    setFrontmatterDraft(noteMarkdown.frontmatter);
    setSavedFrontmatter(noteMarkdown.frontmatter);
    setFrontmatterError(noteMarkdown.frontmatterError);
    setSelectedEditorText("");
    if (noteMarkdown.frontmatterError) {
      setRawMarkdownVisible(true);
      setRightSidebarMode("frontmatter");
      setAppError(noteMarkdown.frontmatterError);
    } else {
      setRawMarkdownVisible(false);
      setAppError(null);
    }
  }

  function handleRawMarkdownChange(markdown: string) {
    const parsed = parseNoteMarkdown(markdown);
    setDraft(parsed.body);
    setFrontmatterDraft(parsed.frontmatter);
    setFrontmatterError(parsed.frontmatterError);
    if (parsed.frontmatterError) setAppError(parsed.frontmatterError);
    else setAppError(null);
  }

  function handleFrontmatterChange(frontmatter: string) {
    setFrontmatterDraft(frontmatter);
    const error = validateFrontmatter(frontmatter);
    setFrontmatterError(error ? `This note has malformed frontmatter: ${error}.` : null);
    if (error) setAppError(`This note has malformed frontmatter: ${error}.`);
    else setAppError(null);
  }

  function handleNoteDrop(targetPath: string) {
    const sourceItem = draggingItem?.kind === "note" ? draggingItem : draggingItemRef.current?.kind === "note" ? draggingItemRef.current : null;
    const source = sourceItem?.path ?? null;
    if (!source || source === targetPath) return;
    const note = notes.find((entry) => entry.path === targetPath);
    const folder = note?.parent_path ?? selectedFolder;
    if (!notes.find((entry) => entry.path === source && entry.parent_path === folder)) return;
    const ordered = orderNotes(notes.filter((entry) => entry.parent_path === folder), folder, metadata).map((entry) => entry.path);
    const nextOrder = ordered.filter((path) => path !== source);
    const targetIndex = Math.max(0, nextOrder.indexOf(targetPath));
    nextOrder.splice(targetIndex, 0, source);
    updateMetadata((current) => ({
      ...current,
      noteOrder: {
        ...current.noteOrder,
        [folder]: nextOrder,
      },
    }));
    setDraggingItem(null);
    draggingItemRef.current = null;
    setDropTargetFolder(null);
    setNoteDragPreview(null);
  }

  async function handleDropOnFolder(targetFolderPath: string, droppedItem = draggingItem ?? draggingItemRef.current) {
    if (!workspace || !droppedItem) return;
    try {
      if (droppedItem.kind === "note") {
        const sourceNote = notes.find((note) => note.path === droppedItem.path);
        if (!sourceNote || sourceNote.parent_path === targetFolderPath) return;
        const moved = await moveNote(workspace, droppedItem.path, targetFolderPath);
        updateMetadata((current) => moveNoteInMetadata(current, droppedItem.path, moved.path, sourceNote.parent_path, moved.parent_path));
        if (activePath === droppedItem.path) setActivePath(moved.path);
        replaceOpenTabPath(droppedItem.path, moved.path);
        setSelectedFolder(moved.parent_path);
      } else if (droppedItem.kind === "folder") {
        const sourceFolder = folders.find((folder) => folder.path === droppedItem.path);
        const targetFolder = folders.find((folder) => folder.path === targetFolderPath);
        if (!sourceFolder || !sourceFolder.path || !targetFolder) return;
        if (sourceFolder.parent_path === targetFolder.parent_path && targetFolder.path) {
          const siblings = orderFolders(
            folders.filter((folder) => folder.parent_path === sourceFolder.parent_path).map((folder) => ({ ...folder, children: [] })),
            sourceFolder.parent_path,
            metadata,
          ).map((folder) => folder.path);
          const nextOrder = siblings.filter((path) => path !== sourceFolder.path);
          const targetIndex = Math.max(0, nextOrder.indexOf(targetFolder.path));
          nextOrder.splice(targetIndex, 0, sourceFolder.path);
          updateMetadata((current) => ({
            ...current,
            folderOrder: { ...current.folderOrder, [sourceFolder.parent_path]: nextOrder },
          }));
          return;
        }
        if (sourceFolder.parent_path === targetFolderPath) return;
        const moved = await moveFolder(workspace, droppedItem.path, targetFolderPath);
        updateMetadata((current) => moveFolderInMetadata(current, droppedItem.path, moved.path, sourceFolder.parent_path, moved.parent_path));
        if (selectedFolder === droppedItem.path || selectedFolder.startsWith(`${droppedItem.path}/`)) {
          setSelectedFolder(replacePathPrefix(selectedFolder, droppedItem.path, moved.path));
        } else {
          setSelectedFolder(moved.path);
        }
        if (activePath?.startsWith(`${droppedItem.path}/`)) {
          setActivePath(replacePathPrefix(activePath, droppedItem.path, moved.path));
        }
        replaceOpenTabPrefix(droppedItem.path, moved.path);
      }
      await refreshWorkspace(workspace);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    } finally {
      setDraggingItem(null);
      draggingItemRef.current = null;
      setDropTargetFolder(null);
      setNoteDragPreview(null);
    }
  }

  function setCurrentDragItem(item: DragItem) {
    draggingItemRef.current = item;
    setDraggingItem(item);
    if (!item) setDropTargetFolder(null);
  }

  function folderPathAtPoint(clientX: number, clientY: number) {
    const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-folder-path]");
    return row?.dataset.folderPath ?? null;
  }

  function notePathAtPoint(clientX: number, clientY: number) {
    const card = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-note-path]");
    return card?.dataset.notePath ?? null;
  }

  function beginNotePointerDrag(path: string, event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest("[data-no-note-drag]")) return;

    notePointerDragRef.current = {
      dragging: false,
      path,
      startX: event.clientX,
      startY: event.clientY,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = notePointerDragRef.current;
      if (!drag) return;

      const distance = Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY);
      if (!drag.dragging && distance < 5) return;

      if (!drag.dragging) {
        drag.dragging = true;
        suppressNextNoteClickRef.current = true;
        document.body.classList.add("is-dragging-note");
        setCurrentDragItem({ kind: "note", path: drag.path });
      }

      moveEvent.preventDefault();
      const targetFolder = folderPathAtPoint(moveEvent.clientX, moveEvent.clientY);
      const draggedNote = notes.find((note) => note.path === drag.path);
      document.body.classList.toggle("is-over-drop-target", targetFolder !== null);
      setDropTargetFolder(targetFolder);
      setNoteDragPreview({
        path: drag.path,
        title: draggedNote?.title || drag.path.split("/").at(-1)?.replace(/\.md$/, "") || "Untitled",
        x: moveEvent.clientX,
        y: moveEvent.clientY,
        overTarget: targetFolder !== null,
      });
    };

    const cleanupPointerDrag = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      document.body.classList.remove("is-dragging-note");
      document.body.classList.remove("is-over-drop-target");
      setNoteDragPreview(null);
      notePointerDragRef.current = null;
    };

    const handlePointerCancel = () => {
      cleanupPointerDrag();
      setCurrentDragItem(null);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const drag = notePointerDragRef.current;
      cleanupPointerDrag();

      if (drag?.dragging) {
        const targetFolder = folderPathAtPoint(upEvent.clientX, upEvent.clientY);
        const targetNote = notePathAtPoint(upEvent.clientX, upEvent.clientY);
        setDropTargetFolder(null);
        if (targetFolder !== null) {
          void handleDropOnFolder(targetFolder, { kind: "note", path: drag.path });
        } else if (targetNote && targetNote !== drag.path) {
          handleNoteDrop(targetNote);
        } else {
          setCurrentDragItem(null);
        }
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerCancel, { once: true });
  }

  function handleNoteSelectFromCard(path: string) {
    if (suppressNextNoteClickRef.current) {
      suppressNextNoteClickRef.current = false;
      return;
    }
    selectNote(path);
  }

  function openContextMenu(event: React.MouseEvent, state: ContextMenuTarget) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ ...state, x: event.clientX, y: event.clientY } as ContextMenuState);
  }

  function openTargetInNewWindow(target: OpenTarget) {
    setContextMenu(null);
    if (!workspace) return;

    if (!isTauri()) {
      if (target.kind === "folder") {
        setSelectedFolder(target.path);
        clearCurrentNote();
      } else {
        void selectNote(target.path);
      }
      return;
    }

    const params = new URLSearchParams({
      workspace,
      openKind: target.kind,
      openPath: target.path,
    });
    const label = `lumen-${target.kind}-${Date.now()}`;
    const webview = new WebviewWindow(label, {
      url: `/?${params.toString()}`,
      title: "Lumen Notes",
      width: 1280,
      height: 860,
      minWidth: 920,
      minHeight: 620,
      decorations: true,
      resizable: true,
      titleBarStyle: "overlay",
      hiddenTitle: true,
      trafficLightPosition: new LogicalPosition(20, 24),
    });
    void webview.once("tauri://error", (event) => {
      setAppError(String(event.payload));
    });
  }

  async function revealTarget(target: OpenTarget) {
    if (!workspace) return;
    try {
      setContextMenu(null);
      await revealPath(workspace, target.path, target.kind);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  function isBookmarked(target: OpenTarget) {
    return metadata.bookmarks.some((bookmark) => bookmark.kind === target.kind && bookmark.path === target.path);
  }

  function toggleBookmark(target: OpenTarget) {
    updateMetadata((current) => {
      const exists = current.bookmarks.some((bookmark) => bookmark.kind === target.kind && bookmark.path === target.path);
      return {
        ...current,
        bookmarks: exists
          ? current.bookmarks.filter((bookmark) => bookmark.kind !== target.kind || bookmark.path !== target.path)
          : [...current.bookmarks, { id: createBookmarkId(), kind: target.kind, path: target.path, createdAt: Date.now() }],
      };
    });
  }

  function removeBookmark(bookmarkId: string) {
    updateMetadata((current) => ({
      ...current,
      bookmarks: current.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId),
    }));
  }

  function selectBookmark(bookmark: BookmarkEntry) {
    if (bookmark.kind === "folder") {
      setSelectedFolder(bookmark.path);
      clearCurrentNote();
      return;
    }
    void selectNote(bookmark.path);
  }

  function handleOutlineSelect(id: string) {
    const index = Number(id.replace("heading-", ""));
    if (index === 0) {
      noteSurfaceRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const heading = document.querySelectorAll<HTMLElement>(".editor-content h1, .editor-content h2, .editor-content h3, .editor-content h4, .editor-content h5, .editor-content h6")[index - 1];
    heading?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function startFolderPaneResize(event: React.PointerEvent) {
    const startX = event.clientX;
    const startFolderWidth = folderPaneWidth;
    const startNotesWidth = notesPaneWidth;

    startResize(event, (clientX) => {
      const delta = clientX - startX;
      const nextFolderWidth = clamp(startFolderWidth + delta, 220, 420);
      const appliedDelta = nextFolderWidth - startFolderWidth;
      setFolderPaneWidth(nextFolderWidth);
      setNotesPaneWidth(clamp(startNotesWidth - appliedDelta, 220, 420));
    });
  }

  function startNotesPaneResize(event: React.PointerEvent) {
    const startX = event.clientX;
    const startWidth = notesPaneWidth;

    startResize(event, (clientX) => {
      setNotesPaneWidth(clamp(startWidth + clientX - startX, 220, 520));
    });
  }

  function startRightPaneResize(event: React.PointerEvent) {
    const startX = event.clientX;
    const startWidth = rightPaneWidth;

    startResize(event, (clientX) => {
      setRightPaneWidth(clamp(startWidth - (clientX - startX), 220, 460));
    });
  }

  // Window drag handling — macOS WebKit's `-webkit-app-region: drag` is unreliable
  // when the window is focused, so we explicitly call Tauri's `startDragging()`
  // on mousedown over the titlebar. Interactive elements opt out via the
  // `.chrome-interactive` class + stopPropagation on their own mousedown.
  function isChromeInteractiveTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(".chrome-interactive"));
  }

  function handleChromeMouseDown(event: React.MouseEvent) {
    if (event.button !== 0 || event.detail > 1 || isChromeInteractiveTarget(event.target)) return;
    event.preventDefault();
    if (isTauri()) void getCurrentWindow().startDragging();
  }

  function handleChromeDoubleClick(event: React.MouseEvent) {
    if (isChromeInteractiveTarget(event.target)) return;
    if (isTauri()) void getCurrentWindow().toggleMaximize();
  }

  return (
    <div className="app-shell">
      <header
        className="app-titlebar"
        data-tauri-drag-region=""
        onMouseDown={handleChromeMouseDown}
        onDoubleClick={handleChromeDoubleClick}
      >
        <span className="titlebar-traffic-padding" data-tauri-drag-region="" />
        <button
          className="icon-button chrome-interactive"
          type="button"
          title={leftVisible ? "Hide sidebars" : "Show sidebars"}
          onMouseDown={stopChromeMouseDown}
          onClick={() => setLeftVisible((value) => !value)}
        >
          {leftVisible ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </button>
        <NoteTabs
          activePath={activePath}
          activeTabId={activeTabId}
          tabs={visibleTabs}
          onAdd={() => void addEmptyTab()}
          onClose={(tabId) => void closeTab(tabId)}
          onContextMenu={(event, tabId) => {
            event.preventDefault();
            event.stopPropagation();
            setTabContextMenu({ x: event.clientX, y: event.clientY, tabId });
          }}
          onSelect={(tabId) => void activateTab(tabId)}
        />
        <TabListDropdown
          tabs={visibleTabs}
          activeTabId={activeTabId}
          onSelect={(tabId) => void activateTab(tabId)}
          onClose={(tabId) => void closeTab(tabId)}
          onCloseAll={() => void closeAllTabs()}
        />
        <button
          className="icon-button outline-toggle chrome-interactive"
          type="button"
          title={outlineVisible ? "Hide outline" : "Show outline"}
          onMouseDown={stopChromeMouseDown}
          onClick={() => setOutlineVisible((value) => !value)}
        >
          {outlineVisible ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
        </button>
      </header>

      <div className={`app-frame ${leftVisible ? "" : "is-left-hidden"} ${outlineVisible ? "" : "is-outline-hidden"}`} style={frameStyle}>
      {leftVisible ? (
        <aside className="left-panes" onContextMenu={(event) => openContextMenu(event, { kind: "empty" })}>
          <FolderPane
            bookmarks={bookmarks}
            bookmarksExpanded={metadata.bookmarksExpanded}
            disabled={!workspace}
            draggingItem={draggingItem}
            dropTargetFolder={dropTargetFolder}
            folders={folderTree}
            metadata={metadata}
            menuOpen={appMenuOpen}
            recentNotebooks={recentNotebooks}
            searchOpen={searchOpen}
            searchFocusRequest={searchFocusRequest}
            searchQuery={searchQuery}
            searchResults={results}
            selectedFolder={selectedFolder}
            workspace={workspace}
            onCreateFolder={requestCreateFolder}
            onCreateNote={requestCreateNote}
            onContextMenu={openContextMenu}
            onDragStart={setCurrentDragItem}
            onDropTargetChange={setDropTargetFolder}
            onDropOnFolderFallback={(path, item) => void handleDropOnFolder(path, item)}
            onDropOnFolder={(path, item) => void handleDropOnFolder(path, item)}
            onOpenIcon={(path) => openIconBrowser("folder", path)}
            onManageNotebooks={() => {
              setNotebooksManageOpen(true);
              setAppMenuOpen(false);
            }}
            onNewNotebook={() => void chooseWorkspace("new", true)}
            onOpenWorkspace={() => void chooseWorkspace("open", true)}
            onRemoveBookmark={removeBookmark}
            onSearchQueryChange={setSearchQuery}
            onSelectBookmark={selectBookmark}
            onSelectNotebook={openNotebookInNewWindow}
            onSelectSearchResult={selectNote}
            onSelectFolder={(path) => setSelectedFolder(path)}
            onToggleBookmarksExpanded={() =>
              updateMetadata((current) => ({
                ...current,
                bookmarksExpanded: !current.bookmarksExpanded,
              }))
            }
            onToggleSearch={() => setSearchOpen((value) => !value)}
            onToggleMenu={(event) => {
              event.stopPropagation();
              setAppMenuOpen((value) => !value);
            }}
          />
          <PaneResizer label="Resize folder pane" onPointerDown={startFolderPaneResize} />
          <NotesPane
            activePath={activePath}
            draggingPath={draggingItem?.kind === "note" ? draggingItem.path : null}
            folderTitle={selectedFolderTitle}
            metadata={metadata}
            contents={contents}
            notes={visibleNotes}
            selectedFolder={selectedFolder}
            onCreateNote={requestCreateNote}
            onContextMenu={openContextMenu}
            onOpenIcon={(path) => openIconBrowser("note", path)}
            onPin={(path) =>
              updateMetadata((current) => ({
                ...current,
                pinnedNotes: { ...current.pinnedNotes, [path]: !current.pinnedNotes[path] },
              }))
            }
            onPointerDragStart={beginNotePointerDrag}
            onSelect={handleNoteSelectFromCard}
          />
        </aside>
      ) : null}
      {leftVisible ? <PaneResizer label="Resize notes pane" onPointerDown={startNotesPaneResize} /> : null}

      <main className="main-pane">
        {noteOpen ? (
          <header className="topbar">
            <div className="save-state">
              {isSaving ? <Save size={15} /> : <Check size={15} />}
              <span>{isSaving ? "Saving" : hasUnsavedChanges ? "Unsaved" : "Saved"}</span>
            </div>
            <button
              className={`icon-button ${rawMarkdownVisible || frontmatterError ? "is-active" : ""}`}
              type="button"
              title={rawMarkdownVisible ? "Show rich editor" : "Show raw Markdown"}
              onClick={() => {
                if (frontmatterError && rawMarkdownVisible) {
                  setAppError(frontmatterError);
                  return;
                }
                setRawMarkdownVisible((value) => !value);
              }}
            >
              <FileCode2 size={17} />
            </button>
            <button
              className={`icon-button ${fullWidth ? "is-active" : ""}`}
              type="button"
              title={fullWidth ? "Restore reading width" : "Expand to full width"}
              onClick={() => setFullWidth((value) => !value)}
            >
              {fullWidth ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
          </header>
        ) : null}

        {noteOpen ? (
          <section
            className={`note-surface${fullWidth ? " is-full-width" : ""}`}
            ref={noteSurfaceRef}
            onScroll={handleNoteSurfaceScroll}
            onMouseDown={(event) => {
              if (event.target === noteSurfaceRef.current) {
                event.preventDefault();
                setEditorFocusAtEndRequest((v) => v + 1);
              }
            }}
          >
            <div className="title-shell">
              <textarea
                ref={titleInputRef}
                className="note-title-input"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    setEditorFocusRequest((value) => value + 1);
                  }
                }}
                placeholder="Untitled"
                aria-label="Note title"
                rows={1}
              />
              {appError ? <p className="app-error note-error">{appError}</p> : null}
            </div>
            {rawMarkdownVisible || frontmatterError ? (
              <div className="raw-markdown-shell">
                <textarea
                  aria-label="Raw Markdown"
                  className="raw-markdown-input"
                  value={rawMarkdownDraft}
                  onChange={(event) => handleRawMarkdownChange(event.target.value)}
                  onSelect={(event) => {
                    const input = event.currentTarget;
                    setSelectedEditorText(input.value.slice(input.selectionStart, input.selectionEnd));
                  }}
                  spellCheck
                />
              </div>
            ) : (
              <EditorErrorBoundary resetKey={activePath ?? "pending-note"} onError={handleNoteLoadError}>
                <NotesEditor
                  content={draft}
                  focusRequest={editorFocusRequest}
                  focusAtEndRequest={editorFocusAtEndRequest}
                  findRequest={noteFindRequest}
                  notePath={activePath}
                  restorePosition={editorRestorePosition}
                  workspace={workspace}
                  onChange={(markdown) => setDraft(markdown)}
                  onLoadError={handleNoteLoadError}
                  onPositionChange={handleEditorPositionChange}
                />
              </EditorErrorBoundary>
            )}
          </section>
        ) : (
          <EmptyNoteSurface
            hasWorkspace={Boolean(workspace)}
            onCreateNote={() => requestCreateNote(selectedFolder)}
            onOpenWorkspace={() => void chooseWorkspace("open")}
            appError={appError}
          />
        )}
        {noteOpen ? (
          <div className="note-status-bar">
            <span>{noteStats.words} {noteStats.words === 1 ? "word" : "words"}</span>
            <span>{noteStats.characters} {noteStats.characters === 1 ? "character" : "characters"}</span>
          </div>
        ) : null}
      </main>

      {outlineVisible ? <PaneResizer label="Resize right sidebar" onPointerDown={startRightPaneResize} /> : null}
      {outlineVisible ? (
        <RightSidebar
          activeNote={activeNote}
          frontmatter={frontmatterDraft}
          frontmatterError={frontmatterError}
          mode={rightSidebarMode}
          outline={noteOpen ? outline : []}
          pendingNote={pendingNote}
          workspace={workspace}
          onFrontmatterChange={handleFrontmatterChange}
          onModeChange={setRightSidebarMode}
          onSelectOutline={handleOutlineSelect}
        />
      ) : null}

      {noteDragPreview ? <NoteDragPreviewLayer preview={noteDragPreview} /> : null}

      {contextMenu ? (
        <ContextMenu
          state={contextMenu}
          onCreateFolder={() => requestCreateFolder(contextMenu.kind === "folder" ? contextMenu.path : selectedFolder)}
          onCreateNote={() => requestCreateNote(contextMenu.kind === "folder" ? contextMenu.path : selectedFolder)}
          onDelete={() => {
            if (contextMenu.kind === "note") void handleDeleteNote(contextMenu.path);
            if (contextMenu.kind === "folder") void handleDeleteFolder(contextMenu.path);
          }}
          onOpenInNewWindow={() => {
            if (contextMenu.kind !== "empty") openTargetInNewWindow({ kind: contextMenu.kind, path: contextMenu.path });
          }}
          onReveal={() => {
            if (contextMenu.kind !== "empty") void revealTarget({ kind: contextMenu.kind, path: contextMenu.path });
          }}
          isBookmarked={contextMenu.kind !== "empty" ? isBookmarked({ kind: contextMenu.kind, path: contextMenu.path }) : false}
          onRenameFolder={() => contextMenu.kind === "folder" && openPropertyDialog("rename-folder", contextMenu.path)}
          onResetFolderColor={() =>
            contextMenu.kind === "folder" &&
            updateMetadata((current) => setMetadataValue(current, "folderColors", contextMenu.path, ""))
          }
          onResetFolderIcon={() =>
            contextMenu.kind === "folder" &&
            updateMetadata((current) => setMetadataValue(current, "folderIcons", contextMenu.path, ""))
          }
          onSetFolderColor={() => contextMenu.kind === "folder" && openPropertyDialog("folder-color", contextMenu.path)}
          onSetFolderIcon={() => contextMenu.kind === "folder" && openIconBrowser("folder", contextMenu.path)}
          onSetNoteIcon={() => contextMenu.kind === "note" && openIconBrowser("note", contextMenu.path)}
          onToggleBookmark={() => {
            if (contextMenu.kind !== "empty") toggleBookmark({ kind: contextMenu.kind, path: contextMenu.path });
          }}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {tabContextMenu ? (
        <TabContextMenu
          state={tabContextMenu}
          onCloseTab={() => void closeTab(tabContextMenu.tabId)}
          onCloseAll={() => void closeAllTabs()}
          onClose={() => setTabContextMenu(null)}
        />
      ) : null}

      {folderDialogParent !== null ? (
        <div className="dialog-backdrop" onMouseDown={() => setFolderDialogParent(null)}>
          <form
            className="dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void submitFolder();
            }}
          >
            <div className="dialog-header">
              <span className="dialog-icon">
                <Folder size={18} />
              </span>
              <div>
                <h2>New folder</h2>
                <p>{folderDialogParent ? `Create in ${folderDialogParent}` : "Create at the notebook root"}</p>
              </div>
              <button className="icon-button" type="button" title="Close" onClick={() => setFolderDialogParent(null)}>
                <X size={17} />
              </button>
            </div>
            <label className="field-label" htmlFor="folder-name">
              Name
            </label>
            <input
              className="dialog-input"
              id="folder-name"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="Folder name"
              autoFocus
            />
            {appError ? <p className="dialog-error">{appError}</p> : null}
            <div className="dialog-actions">
              <button className="toolbar-button" type="button" onClick={() => setFolderDialogParent(null)}>
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Create
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {settingsOpen ? (
          <SettingsModal
            accentColor={accentColor}
            colorScheme={colorScheme}
            effectiveAccentColor={effectiveAccentColor}
            resolvedTheme={resolvedTheme}
            themePresetId={themePreset.id}
            onAccentChange={setAccentColor}
            onAccentReset={() => setAccentColor(null)}
            onClose={() => setSettingsOpen(false)}
            onColorSchemeChange={setColorScheme}
            onThemePresetChange={setThemePresetId}
          />
      ) : null}

      {notebooksManageOpen ? (
        <ManageNotebooksModal
          activeWorkspace={workspace}
          notebooks={recentNotebooks}
          onClose={() => setNotebooksManageOpen(false)}
          onForget={forgetNotebook}
          onSelect={(path) => {
            if (path === workspace) {
              setNotebooksManageOpen(false);
              return;
            }
            switchNotebook(path);
            setNotebooksManageOpen(false);
          }}
        />
      ) : null}

      {propertyDialog ? (
        <PropertyDialog
          state={propertyDialog}
          appError={appError}
          onChange={(value) => setPropertyDialog({ ...propertyDialog, value } as PropertyDialogState)}
          onClose={() => setPropertyDialog(null)}
          onSubmit={() => void submitPropertyDialog()}
        />
      ) : null}

      {iconBrowser ? (
        <IconBrowserModal
          state={iconBrowser}
          onClose={() => setIconBrowser(null)}
          onSelect={setIconValue}
        />
      ) : null}

      </div>
    </div>
  );
}

function FolderPane({
  bookmarks,
  bookmarksExpanded,
  disabled,
  draggingItem,
  dropTargetFolder,
  folders,
  menuOpen,
  metadata,
  searchOpen,
  recentNotebooks,
  searchFocusRequest,
  searchQuery,
  searchResults,
  selectedFolder,
  workspace,
  onCreateFolder,
  onCreateNote,
  onContextMenu,
  onDragStart,
  onDropTargetChange,
  onDropOnFolder,
  onDropOnFolderFallback,
  onOpenIcon,
  onManageNotebooks,
  onNewNotebook,
  onOpenWorkspace,
  onRemoveBookmark,
  onSearchQueryChange,
  onSelectBookmark,
  onSelectNotebook,
  onSelectSearchResult,
  onSelectFolder,
  onToggleBookmarksExpanded,
  onToggleSearch,
  onToggleMenu,
}: {
  bookmarks: BookmarkView[];
  bookmarksExpanded: boolean;
  disabled: boolean;
  draggingItem: DragItem;
  dropTargetFolder: string | null;
  folders: FolderNode[];
  menuOpen: boolean;
  metadata: WorkspaceMetadata;
  recentNotebooks: RecentNotebook[];
  searchOpen: boolean;
  searchFocusRequest: number;
  searchQuery: string;
  searchResults: SearchResult[];
  selectedFolder: string;
  workspace: string;
  onCreateFolder: (parentPath?: string) => void;
  onCreateNote: (parentPath?: string) => void;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onDragStart: (item: DragItem) => void;
  onDropTargetChange: (path: string | null) => void;
  onDropOnFolder: (path: string, item?: Exclude<DragItem, null>) => void;
  onDropOnFolderFallback: (path: string, item?: Exclude<DragItem, null>) => void;
  onOpenIcon: (path: string) => void;
  onManageNotebooks: () => void;
  onNewNotebook: () => void;
  onOpenWorkspace: () => void;
  onRemoveBookmark: (id: string) => void;
  onSearchQueryChange: (query: string) => void;
  onSelectBookmark: (bookmark: BookmarkEntry) => void;
  onSelectNotebook: (path: string) => void;
  onSelectSearchResult: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onToggleBookmarksExpanded: () => void;
  onToggleSearch: () => void;
  onToggleMenu: (event: React.MouseEvent) => void;
}) {
  const getDropItem = (event: React.DragEvent): Exclude<DragItem, null> | undefined => {
    const notePath = event.dataTransfer.getData("application/lumen-note-path") || event.dataTransfer.getData("text/plain");
    if (notePath) return { kind: "note", path: notePath };
    const folderPath = event.dataTransfer.getData("application/lumen-folder-path");
    if (folderPath) return { kind: "folder", path: folderPath };
    return draggingItem ?? undefined;
  };

  return (
    <section className="folder-pane">
      <div className="pane-header">
        <strong>Folders</strong>
        <div className="pane-actions">
          <button className="icon-button" type="button" disabled={disabled} title="Search" onClick={onToggleSearch}>
            <Search size={16} />
          </button>
          <button className="icon-button" type="button" disabled={disabled} title="Add" onClick={() => onCreateFolder(selectedFolder)}>
            <Plus size={16} />
          </button>
        </div>
      </div>
      {searchOpen ? (
        <FolderSearch
          query={searchQuery}
          focusRequest={searchFocusRequest}
          results={searchResults}
          onQueryChange={onSearchQueryChange}
          onSelect={onSelectSearchResult}
        />
      ) : null}
      <BookmarksSection
        bookmarks={bookmarks}
        expanded={bookmarksExpanded}
        onRemove={onRemoveBookmark}
        onSelect={onSelectBookmark}
        onToggle={onToggleBookmarksExpanded}
      />
      <div
        className="folder-tree"
        onDragOver={(event) => {
          const folderRow = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-folder-path]");
          if (!folderRow) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onDropTargetChange(folderRow.dataset.folderPath ?? "");
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          onDropTargetChange(null);
        }}
        onDrop={(event) => {
          const folderRow = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-folder-path]");
          if (!folderRow) return;
          event.preventDefault();
          const path = folderRow.dataset.folderPath ?? "";
          const item = getDropItem(event);
          onDropTargetChange(null);
          onDropOnFolderFallback(path, item);
        }}
      >
        {folders.map((folder) => (
          <FolderRow
            key={folder.path || "root"}
            draggingItem={draggingItem}
            dropTargetFolder={dropTargetFolder}
            folder={folder}
            metadata={metadata}
            selectedFolder={selectedFolder}
            onContextMenu={onContextMenu}
            onCreateFolder={onCreateFolder}
            onCreateNote={onCreateNote}
            onDragStart={onDragStart}
            onDropTargetChange={onDropTargetChange}
            onDropOnFolder={onDropOnFolder}
            onOpenIcon={onOpenIcon}
            onSelectFolder={onSelectFolder}
          />
        ))}
      </div>
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
    </section>
  );
}

function BookmarksSection({
  bookmarks,
  expanded,
  onRemove,
  onSelect,
  onToggle,
}: {
  bookmarks: BookmarkView[];
  expanded: boolean;
  onRemove: (id: string) => void;
  onSelect: (bookmark: BookmarkEntry) => void;
  onToggle: () => void;
}) {
  return (
    <section className="bookmarks-section">
      <button className="section-header-button" type="button" onClick={onToggle}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Bookmarks</span>
      </button>
      {expanded ? (
        <div className="bookmarks-list">
          {bookmarks.map((bookmark) => (
            <button
              className={`bookmark-item ${bookmark.missing ? "is-missing" : ""}`}
              key={bookmark.id}
              type="button"
              aria-disabled={bookmark.missing}
              onClick={() => {
                if (!bookmark.missing) onSelect(bookmark);
              }}
            >
              <IconMark value={bookmark.icon} fallback={bookmark.kind === "folder" ? Folder : FileText} size={15} />
              <span>{bookmark.title}</span>
              <span
                className="bookmark-remove"
                role="button"
                tabIndex={0}
                title="Remove bookmark"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(bookmark.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onRemove(bookmark.id);
                  }
                }}
              >
                <X size={13} />
              </span>
            </button>
          ))}
          {!bookmarks.length ? <p className="empty-bookmarks">No bookmarks</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function FolderSearch({
  focusRequest,
  query,
  results,
  onQueryChange,
  onSelect,
}: {
  focusRequest: number;
  query: string;
  results: SearchResult[];
  onQueryChange: (query: string) => void;
  onSelect: (path: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!focusRequest) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [focusRequest]);

  return (
    <div className="folder-search">
      <div className="folder-search-input">
        <Search size={15} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search notes"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
        />
      </div>
      {query.trim() ? (
        <div className="folder-search-results">
          {results.map((result) => (
            <button key={result.path} type="button" onClick={() => onSelect(result.path)}>
              <FileText size={15} />
              <span>
                <strong>{result.title}</strong>
                <small>{result.snippet || result.path}</small>
              </span>
            </button>
          ))}
          {!results.length ? <p>No matching notes</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function FolderRow({
  draggingItem,
  dropTargetFolder,
  folder,
  metadata,
  selectedFolder,
  onContextMenu,
  onCreateFolder,
  onCreateNote,
  onDragStart,
  onDropTargetChange,
  onDropOnFolder,
  onOpenIcon,
  onSelectFolder,
}: {
  draggingItem: DragItem;
  dropTargetFolder: string | null;
  folder: FolderNode;
  metadata: WorkspaceMetadata;
  selectedFolder: string;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onCreateFolder: (parentPath?: string) => void;
  onCreateNote: (parentPath?: string) => void;
  onDragStart: (item: DragItem) => void;
  onDropTargetChange: (path: string | null) => void;
  onDropOnFolder: (path: string, item?: Exclude<DragItem, null>) => void;
  onOpenIcon: (path: string) => void;
  onSelectFolder: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const isRoot = folder.path === "";
  const folderColor = metadata.folderColors[folder.path];
  const customIcon = metadata.folderIcons[folder.path];
  const canDrop =
    Boolean(draggingItem) &&
    (draggingItem?.kind === "note" || (draggingItem?.kind === "folder" && draggingItem.path !== folder.path && !folder.path.startsWith(`${draggingItem.path}/`)));

  const getDraggedItem = (event: React.DragEvent): Exclude<DragItem, null> | null => {
    const notePath = event.dataTransfer.getData("application/lumen-note-path") || event.dataTransfer.getData("text/plain");
    if (notePath) return { kind: "note", path: notePath };
    const folderPath = event.dataTransfer.getData("application/lumen-folder-path");
    if (folderPath) return { kind: "folder", path: folderPath };
    return draggingItem;
  };

  const canDropItem = (item: Exclude<DragItem, null> | null) => {
    if (!item) return false;
    return item.kind === "note" || (item.kind === "folder" && item.path !== folder.path && !folder.path.startsWith(`${item.path}/`));
  };

  const isDropEventAllowed = (event: React.DragEvent) => canDrop || hasDropPayload(event) || canDropItem(getDraggedItem(event));

  const hasDropPayload = (event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer.types);
    return types.includes("application/lumen-note-path") || types.includes("application/lumen-folder-path") || types.includes("text/plain");
  };

  return (
    <div className="folder-node">
      <div
        className={`${selectedFolder === folder.path ? "folder-row is-active" : "folder-row"} ${dropTargetFolder === folder.path ? "is-drop-target" : ""}`}
        data-folder-path={folder.path}
        draggable={!isRoot}
        onContextMenu={(event) => onContextMenu(event, { kind: "folder", path: folder.path })}
        onDragStart={(event) => {
          if (isRoot) return;
          event.dataTransfer.setData("application/lumen-folder-path", folder.path);
          event.dataTransfer.effectAllowed = "move";
          onDragStart({ kind: "folder", path: folder.path });
        }}
        onDragEnd={() => onDragStart(null)}
        onDragOver={(event) => {
          if (isDropEventAllowed(event)) {
            event.stopPropagation();
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            onDropTargetChange(folder.path);
          }
        }}
        onDragEnter={(event) => {
          if (isDropEventAllowed(event)) {
            event.stopPropagation();
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            onDropTargetChange(folder.path);
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          onDropTargetChange(null);
        }}
        onDrop={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onDropTargetChange(null);
          const item = getDraggedItem(event);
          if (item && canDropItem(item)) onDropOnFolder(folder.path, item);
        }}
      >
        <button className="tree-toggle" type="button" onClick={() => setOpen((value) => !value)}>
          {folder.children.length ? open ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : <span />}
        </button>
        <button className="folder-select" style={folderColor ? { color: folderColor } : undefined} type="button" onClick={() => onSelectFolder(folder.path)}>
          <span
            className="inline-icon-button"
            role="button"
            tabIndex={0}
            title="Set folder icon"
            onClick={(event) => {
              event.stopPropagation();
              onOpenIcon(folder.path);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onOpenIcon(folder.path);
              }
            }}
          >
            <IconMark value={customIcon} fallback={Folder} size={15} />
          </span>
          <span>{folder.name}</span>
        </button>
        <button className="tree-action" type="button" title="New note" onClick={() => onCreateNote(folder.path)}>
          <FileText size={14} />
        </button>
        <button className="tree-action" type="button" title="New folder" onClick={() => onCreateFolder(folder.path)}>
          <Plus size={14} />
        </button>
      </div>
      {open && folder.children.length ? (
        <div className="tree-children">
          {folder.children.map((child) => (
            <FolderRow
              key={child.path}
              draggingItem={draggingItem}
              dropTargetFolder={dropTargetFolder}
              folder={child}
              metadata={metadata}
              selectedFolder={selectedFolder}
              onContextMenu={onContextMenu}
              onCreateFolder={onCreateFolder}
              onCreateNote={onCreateNote}
              onDragStart={onDragStart}
              onDropTargetChange={onDropTargetChange}
              onDropOnFolder={onDropOnFolder}
              onOpenIcon={onOpenIcon}
              onSelectFolder={onSelectFolder}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NotesPane({
  activePath,
  contents,
  draggingPath,
  folderTitle,
  metadata,
  notes,
  selectedFolder,
  onCreateNote,
  onContextMenu,
  onOpenIcon,
  onPin,
  onPointerDragStart,
  onSelect,
}: {
  activePath: string | null;
  contents: Map<string, string>;
  draggingPath: string | null;
  folderTitle: string;
  metadata: WorkspaceMetadata;
  notes: NoteEntry[];
  selectedFolder: string;
  onCreateNote: (parentPath?: string) => void;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onOpenIcon: (path: string) => void;
  onPin: (path: string) => void;
  onPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onSelect: (path: string) => void;
}) {
  const pinned = notes.filter((note) => metadata.pinnedNotes[note.path]);
  const regular = notes.filter((note) => !metadata.pinnedNotes[note.path]);

  return (
    <section className="notes-pane" onContextMenu={(event) => onContextMenu(event, { kind: "empty" })}>
      <div className="pane-header">
        <strong>{folderTitle}</strong>
        <div className="pane-actions">
          <button className="icon-button" type="button" title="New note" onClick={() => onCreateNote(selectedFolder)}>
            <Plus size={16} />
          </button>
        </div>
      </div>
      <div className="notes-list">
        {pinned.length ? <span className="list-label">Pinned</span> : null}
        {pinned.map((note) => (
          <NoteCard
            active={activePath === note.path}
            dragging={draggingPath === note.path}
            key={note.path}
            metadata={metadata}
            note={note}
            pinned
            preview={previewNote(contents.get(note.path) ?? "")}
            onContextMenu={onContextMenu}
            onOpenIcon={onOpenIcon}
            onPin={onPin}
            onPointerDragStart={onPointerDragStart}
            onSelect={onSelect}
          />
        ))}
        {regular.length && pinned.length ? <span className="list-label">Notes</span> : null}
        {regular.map((note) => (
          <NoteCard
            active={activePath === note.path}
            dragging={draggingPath === note.path}
            key={note.path}
            metadata={metadata}
            note={note}
            pinned={false}
            preview={previewNote(contents.get(note.path) ?? "")}
            onContextMenu={onContextMenu}
            onOpenIcon={onOpenIcon}
            onPin={onPin}
            onPointerDragStart={onPointerDragStart}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function NoteTabs({
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
            className="note-tab-more chrome-interactive"
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
        className="note-tab-add chrome-interactive"
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

function TabListDropdown({
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
        className="icon-button chrome-interactive"
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

function EmptyNoteSurface({
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
      <h1>{hasWorkspace ? "No note selected" : "Lumen Notes"}</h1>
      <p>{hasWorkspace ? "Pick a note from the sidebar or create a new one." : "Choose a folder to use as your notebook storage."}</p>
      <button className="primary-button" type="button" onClick={hasWorkspace ? onCreateNote : onOpenWorkspace}>
        {hasWorkspace ? null : <FolderOpen size={17} />}
        <span>{hasWorkspace ? "Create Note" : "Open Folder"}</span>
      </button>
      {appError ? <p className="app-error">{appError}</p> : null}
    </section>
  );
}

function NoteCard({
  active,
  dragging,
  metadata,
  note,
  pinned,
  preview,
  onContextMenu,
  onOpenIcon,
  onPin,
  onPointerDragStart,
  onSelect,
}: {
  active: boolean;
  dragging: boolean;
  metadata: WorkspaceMetadata;
  note: NoteEntry;
  pinned: boolean;
  preview: string;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onOpenIcon: (path: string) => void;
  onPin: (path: string) => void;
  onPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onSelect: (path: string) => void;
}) {
  const customIcon = metadata.noteIcons[note.path];
  return (
    <button
      className={`note-card ${active ? "is-active" : ""} ${dragging ? "is-dragging" : ""}`}
      data-note-path={note.path}
      draggable={false}
      type="button"
      onClick={() => onSelect(note.path)}
      onContextMenu={(event) => onContextMenu(event, { kind: "note", path: note.path })}
      onPointerDown={(event) => onPointerDragStart(note.path, event)}
    >
      <span className="note-card-main">
        <span
          className="note-card-icon inline-icon-button"
          data-no-note-drag
          role="button"
          tabIndex={0}
          title="Set note icon"
          onClick={(event) => {
            event.stopPropagation();
            onOpenIcon(note.path);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onOpenIcon(note.path);
            }
          }}
        >
          <IconMark value={customIcon} fallback={FileText} size={16} />
        </span>
        <span className="note-card-text">
          <strong>{note.title}</strong>
          <small>{preview || "No preview"}</small>
        </span>
      </span>
      <span className="pin-button" data-no-note-drag role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); onPin(note.path); }}>
        <Pin size={14} fill={pinned ? "currentColor" : "none"} />
      </span>
    </button>
  );
}

function NoteDragPreviewLayer({ preview }: { preview: NoteDragPreview }) {
  return (
    <div
      className={`note-drag-preview ${preview.overTarget ? "is-over-target" : ""}`}
      style={{ transform: `translate3d(${preview.x + 14}px, ${preview.y + 12}px, 0)` }}
    >
      <FileText size={16} />
      <span>
        <strong>{preview.title}</strong>
        <small>{preview.overTarget ? "Drop to move here" : preview.path}</small>
      </span>
    </div>
  );
}

function PaneResizer({ label, onPointerDown }: { label: string; onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void }) {
  return <div aria-label={label} className="pane-resizer" role="separator" tabIndex={0} onPointerDown={onPointerDown} />;
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

function RightSidebar({
  activeNote,
  frontmatter,
  frontmatterError,
  mode,
  outline,
  pendingNote,
  workspace,
  onFrontmatterChange,
  onModeChange,
  onSelectOutline,
}: {
  activeNote: NoteEntry | null;
  frontmatter: string;
  frontmatterError: string | null;
  mode: RightSidebarMode;
  outline: Array<{ id: string; text: string; level: number }>;
  pendingNote: DraftNote | null;
  workspace: string;
  onFrontmatterChange: (frontmatter: string) => void;
  onModeChange: (mode: RightSidebarMode) => void;
  onSelectOutline: (id: string) => void;
}) {
  const title = mode === "outline" ? "Outline" : mode === "frontmatter" ? "Frontmatter" : "Properties";
  return (
    <aside className="right-sidebar">
      <div className="pane-header">
        <strong>{title}</strong>
        <div className="sidebar-tabs">
          <button className={`icon-button ${mode === "outline" ? "is-active" : ""}`} type="button" title="Outline" onClick={() => onModeChange("outline")}>
            <LayoutList size={16} />
          </button>
          <button className={`icon-button ${mode === "frontmatter" ? "is-active" : ""}`} type="button" title="Frontmatter" onClick={() => onModeChange("frontmatter")}>
            <Braces size={16} />
          </button>
          <button className={`icon-button ${mode === "properties" ? "is-active" : ""}`} type="button" title="Properties" onClick={() => onModeChange("properties")}>
            <FileText size={16} />
          </button>
        </div>
      </div>
      {mode === "outline" ? (
        <div className="outline-list">
          {outline.map((item) => (
            <button className={`outline-item level-${item.level}`} key={item.id} type="button" onClick={() => onSelectOutline(item.id)}>
              {item.text}
            </button>
          ))}
          {!outline.length ? <p className="empty-sidebar-note">No headings yet</p> : null}
        </div>
      ) : mode === "frontmatter" ? (
        <FrontmatterPane
          activeNote={activeNote}
          frontmatter={frontmatter}
          frontmatterError={frontmatterError}
          onChange={onFrontmatterChange}
        />
      ) : (
        <PropertiesPane activeNote={activeNote} pendingNote={pendingNote} workspace={workspace} />
      )}
    </aside>
  );
}

function FrontmatterPane({
  activeNote,
  frontmatter,
  frontmatterError,
  onChange,
}: {
  activeNote: NoteEntry | null;
  frontmatter: string;
  frontmatterError: string | null;
  onChange: (frontmatter: string) => void;
}) {
  const fields = getFrontmatterFields(frontmatter).filter((field) => field.value.trim() !== "");
  const hasFrontmatter = frontmatter.trim().length > 0;
  const [showRaw, setShowRaw] = useState(hasFrontmatter);
  const rawRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (hasFrontmatter) setShowRaw(true);
  }, [hasFrontmatter]);

  function updateField(field: FrontmatterField, value: string) {
    onChange(updateFrontmatterField(frontmatter, field, value));
  }

  if (!activeNote && !frontmatter) {
    return <p className="empty-sidebar-note">No saved note open.</p>;
  }

  return (
    <div className="frontmatter-pane">
      {frontmatterError ? <p className="app-error">{frontmatterError}</p> : null}
      {fields.length ? (
        <div className="frontmatter-fields">
          {fields.map((field) => (
            <label className="frontmatter-field" key={`${field.key}-${field.lineIndex}`}>
              <span>{field.key}</span>
              <input
                type="text"
                value={field.value}
                disabled={!field.editable}
                title={field.editable ? field.key : "Nested values can be edited in raw YAML below"}
                onChange={(event) => updateField(field, event.target.value)}
              />
            </label>
          ))}
        </div>
      ) : (
        <p className="empty-sidebar-note">No frontmatter fields yet.</p>
      )}
      {showRaw ? (
        <label className="frontmatter-raw">
          <span>Raw YAML</span>
          <textarea
            ref={rawRef}
            value={frontmatter}
            onChange={(event) => onChange(event.target.value)}
            placeholder="field: value"
            spellCheck={false}
          />
        </label>
      ) : (
        <button
          type="button"
          className="frontmatter-add"
          onClick={() => {
            setShowRaw(true);
            requestAnimationFrame(() => rawRef.current?.focus());
          }}
        >
          Add frontmatter
        </button>
      )}
    </div>
  );
}

function PropertiesPane({ activeNote, pendingNote, workspace }: { activeNote: NoteEntry | null; pendingNote: DraftNote | null; workspace: string }) {
  const notebookName = getNotebookName(workspace);
  const filePath = activeNote ? activeNote.path : pendingNote ? "Unsaved note" : "No note open";
  const folderPath = activeNote ? activeNote.parent_path || notebookName : pendingNote ? pendingNote.parentPath || notebookName : "None";
  const updatedAt = activeNote?.updated_at ? new Date(activeNote.updated_at * 1000).toLocaleString() : "Not saved yet";

  return (
    <div className="properties-list">
      <PropertyRow label="File path" value={filePath} code />
      <PropertyRow label="Folder" value={folderPath} code />
      <PropertyRow label="Notebook" value={workspace || "No notebook open"} code />
      <PropertyRow label="Updated" value={updatedAt} />
    </div>
  );
}

function PropertyRow({ code, label, value }: { code?: boolean; label: string; value: string }) {
  return (
    <div className="property-row">
      <span>{label}</span>
      {code ? <code>{value}</code> : <strong>{value}</strong>}
    </div>
  );
}

function IconMark({ fallback: Fallback, size, value }: { fallback: LucideIcon; size: number; value?: string }) {
  const iconName = value?.startsWith(lucideIconPrefix) ? value.slice(lucideIconPrefix.length) : "";
  const Icon = iconName ? lucideIconMap[iconName] : null;

  if (Icon) {
    return <Icon size={size} />;
  }

  if (value && !value.startsWith(lucideIconPrefix)) {
    return <span className="custom-icon">{value}</span>;
  }

  return <Fallback size={size} />;
}

function SettingsModal({
  accentColor,
  colorScheme,
  effectiveAccentColor,
  resolvedTheme,
  themePresetId,
  onAccentChange,
  onAccentReset,
  onColorSchemeChange,
  onClose,
  onThemePresetChange,
}: {
  accentColor: string | null;
  colorScheme: ColorScheme;
  effectiveAccentColor: string;
  resolvedTheme: "light" | "dark";
  themePresetId: ThemePresetId;
  onAccentChange: (color: string) => void;
  onAccentReset: () => void;
  onColorSchemeChange: (scheme: ColorScheme) => void;
  onClose: () => void;
  onThemePresetChange: (theme: ThemePresetId) => void;
}) {
  const sections = [
    {
      id: "appearance",
      label: "Appearance",
      icon: resolvedTheme === "dark" ? Moon : Sun,
      content: (
        <div className="settings-card">
          <div className="setting-row">
            <span>
              <strong>Base color scheme</strong>
              <small>Use a fixed scheme or follow this computer.</small>
            </span>
            <div className="theme-toggle" role="group" aria-label="Base color scheme">
              <button className={colorScheme === "system" ? "theme-option is-active" : "theme-option"} type="button" onClick={() => onColorSchemeChange("system")}>
                <Monitor size={16} />
                <span>System</span>
              </button>
              <button className={colorScheme === "light" ? "theme-option is-active" : "theme-option"} type="button" onClick={() => onColorSchemeChange("light")}>
                <Sun size={16} />
                <span>Light</span>
              </button>
              <button className={colorScheme === "dark" ? "theme-option is-active" : "theme-option"} type="button" onClick={() => onColorSchemeChange("dark")}>
                <Moon size={16} />
                <span>Dark</span>
              </button>
            </div>
          </div>
          <div className="setting-row">
            <span>
              <strong>Theme</strong>
              <small>Choose a popular color palette for accents and surfaces.</small>
            </span>
            <select className="settings-select" value={themePresetId} onChange={(event) => onThemePresetChange(event.target.value as ThemePresetId)}>
              {themePresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </div>
          <div className="setting-row">
            <span>
              <strong>Accent color</strong>
              <small>Controls selected folders, notes, and active controls.</small>
            </span>
            <div className="accent-control">
              <input aria-label="Accent color" type="color" value={effectiveAccentColor} onChange={(event) => onAccentChange(event.target.value)} />
              <button className="toolbar-button" type="button" disabled={!accentColor} onClick={onAccentReset}>
                Reset
              </button>
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <aside className="settings-sidebar">
          <div className="settings-title">
            <span className="dialog-icon">
              <Settings size={18} />
            </span>
            <div>
              <h2>Settings</h2>
              <p>App preferences</p>
            </div>
          </div>
          <nav className="settings-nav" aria-label="Settings sections">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <button className="settings-nav-item is-active" key={section.id} type="button">
                  <Icon size={15} />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>
        <div className="settings-content">
          <div className="settings-content-header">
            <div>
              <h2>Appearance</h2>
              <p>Make the editor comfortable for the way you like to work.</p>
            </div>
            <button className="icon-button" type="button" title="Close" onClick={onClose}>
              <X size={17} />
            </button>
          </div>
          {sections[0].content}
        </div>
      </section>
    </div>
  );
}

function ManageNotebooksModal({
  activeWorkspace,
  notebooks,
  onClose,
  onForget,
  onSelect,
}: {
  activeWorkspace: string;
  notebooks: RecentNotebook[];
  onClose: () => void;
  onForget: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="dialog manage-notebooks-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-icon">
            <BookOpen size={18} />
          </span>
          <div>
            <h2>Manage Notebooks</h2>
            <p>Remove notebooks from the quick list without touching files on disk.</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="manage-notebooks-list">
          {notebooks.map((notebook) => (
            <div className="manage-notebook-row" key={notebook.path}>
              <button className={activeWorkspace === notebook.path ? "is-active" : ""} type="button" onClick={() => onSelect(notebook.path)}>
                <BookOpen size={15} />
                <span>
                  <strong>{notebook.name}</strong>
                  <small>{notebook.path}</small>
                </span>
              </button>
              <button
                className="icon-button"
                type="button"
                title={activeWorkspace === notebook.path ? "The open notebook cannot be removed" : "Remove from list"}
                disabled={activeWorkspace === notebook.path}
                onClick={() => onForget(notebook.path)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {!notebooks.length ? <p className="empty-sidebar-note">No recent notebooks</p> : null}
        </div>
      </section>
    </div>
  );
}

function IconBrowserModal({
  state,
  onClose,
  onSelect,
}: {
  state: IconBrowserState;
  onClose: () => void;
  onSelect: (iconName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const activeIconName = state.value.startsWith(lucideIconPrefix) ? state.value.slice(lucideIconPrefix.length) : "";
  const filteredIcons = useMemo(() => {
    const normalizedQuery = normalizeIconName(query);
    if (!normalizedQuery) return lucideIconOptions.slice(0, 120);
    return lucideIconOptions.filter((name) => normalizeIconName(name).includes(normalizedQuery)).slice(0, 160);
  }, [query]);

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="dialog icon-browser" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-icon">
            <SearchIconPreview value={state.value} />
          </span>
          <div>
            <h2>{state.kind === "folder" ? "Folder icon" : "Note icon"}</h2>
            <p>Search Lucide icons</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="icon-search">
          <input
            className="dialog-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search icons"
            autoFocus
          />
          <button className="toolbar-button" type="button" onClick={() => onSelect("")}>
            Clear
          </button>
        </div>
        <div className="icon-grid">
          {filteredIcons.map((name) => {
            const Icon = lucideIconMap[name];
            return (
              <button
                className={name === activeIconName ? "icon-choice is-selected" : "icon-choice"}
                key={name}
                type="button"
                title={splitIconName(name)}
                onClick={() => onSelect(name)}
              >
                <Icon size={20} />
                <span>{splitIconName(name)}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SearchIconPreview({ value }: { value: string }) {
  return <IconMark value={value} fallback={Search} size={18} />;
}

function TabContextMenu({
  state,
  onClose,
  onCloseAll,
  onCloseTab,
}: {
  state: TabContextMenuState;
  onClose: () => void;
  onCloseAll: () => void;
  onCloseTab: () => void;
}) {
  return (
    <div className="context-menu" style={{ left: state.x, top: state.y }} onClick={onClose}>
      <button type="button" onClick={onCloseTab}>
        <X size={14} />
        <span>Close Tab</span>
      </button>
      <button type="button" onClick={onCloseAll}>
        <Trash2 size={14} />
        <span>Close All Tabs</span>
      </button>
    </div>
  );
}

function ContextMenu({
  isBookmarked,
  state,
  onCreateFolder,
  onCreateNote,
  onDelete,
  onOpenInNewWindow,
  onReveal,
  onRenameFolder,
  onResetFolderColor,
  onResetFolderIcon,
  onSetFolderColor,
  onSetFolderIcon,
  onSetNoteIcon,
  onToggleBookmark,
  onClose,
}: {
  isBookmarked: boolean;
  state: ContextMenuState;
  onCreateFolder: () => void;
  onCreateNote: () => void;
  onDelete: () => void;
  onOpenInNewWindow: () => void;
  onReveal: () => void;
  onRenameFolder: () => void;
  onResetFolderColor: () => void;
  onResetFolderIcon: () => void;
  onSetFolderColor: () => void;
  onSetFolderIcon: () => void;
  onSetNoteIcon: () => void;
  onToggleBookmark: () => void;
  onClose: () => void;
}) {
  return (
    <div className="context-menu" style={{ left: state.x, top: state.y }} onClick={onClose}>
      <button type="button" onClick={onCreateNote}>
        <FileText size={14} />
        <span>New Note</span>
      </button>
      <button type="button" onClick={onCreateFolder}>
        <Folder size={14} />
        <span>New Folder</span>
      </button>
      {state.kind === "folder" && state.path ? (
        <>
          <button type="button" onClick={onOpenInNewWindow}>
            <PanelRightOpen size={14} />
            <span>Open in New Window</span>
          </button>
          <button type="button" onClick={onReveal}>
            <FolderOpen size={14} />
            <span>Reveal in Finder</span>
          </button>
          <button type="button" onClick={onToggleBookmark}>
            <Bookmark size={14} />
            <span>{isBookmarked ? "Remove Bookmark" : "Add Bookmark"}</span>
          </button>
          <button type="button" onClick={onRenameFolder}>
            <Pencil size={14} />
            <span>Rename Folder</span>
          </button>
          <button type="button" onClick={onSetFolderIcon}>
            <FileText size={14} />
            <span>Set Folder Icon</span>
          </button>
          <button type="button" onClick={onResetFolderIcon}>
            <X size={14} />
            <span>Reset Folder Icon</span>
          </button>
          <button type="button" onClick={onSetFolderColor}>
            <Palette size={14} />
            <span>Set Folder Color</span>
          </button>
          <button type="button" onClick={onResetFolderColor}>
            <X size={14} />
            <span>Reset Folder Color</span>
          </button>
        </>
      ) : null}
      {state.kind === "note" ? (
        <>
          <button type="button" onClick={onOpenInNewWindow}>
            <PanelRightOpen size={14} />
            <span>Open in New Window</span>
          </button>
          <button type="button" onClick={onReveal}>
            <FolderOpen size={14} />
            <span>Reveal in Finder</span>
          </button>
          <button type="button" onClick={onToggleBookmark}>
            <Bookmark size={14} />
            <span>{isBookmarked ? "Remove Bookmark" : "Add Bookmark"}</span>
          </button>
          <button type="button" onClick={onSetNoteIcon}>
            <FileText size={14} />
            <span>Set Note Icon</span>
          </button>
        </>
      ) : null}
      {state.kind !== "empty" && state.path ? (
        <button className="danger-item" type="button" onClick={onDelete}>
          <Trash2 size={14} />
          <span>{state.kind === "note" ? "Delete Note" : "Delete Folder"}</span>
        </button>
      ) : null}
    </div>
  );
}

function PropertyDialog({
  appError,
  state,
  onChange,
  onClose,
  onSubmit,
}: {
  appError: string | null;
  state: PropertyDialogState;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const config = {
    "rename-folder": {
      title: "Rename folder",
      description: "Change the folder name on disk.",
      label: "Folder name",
      placeholder: "Folder name",
      icon: <Pencil size={18} />,
      type: "text",
      action: "Rename",
    },
    "folder-icon": {
      title: "Folder icon",
      description: "Shown to the left of this folder.",
      label: "Icon",
      placeholder: "Emoji or short mark",
      icon: <Folder size={18} />,
      type: "text",
      action: "Save",
    },
    "folder-color": {
      title: "Folder color",
      description: "Colors the folder icon and title.",
      label: "Color",
      placeholder: "#4b7d75",
      icon: <Palette size={18} />,
      type: "color",
      action: "Save",
    },
    "note-icon": {
      title: "Note icon",
      description: "Shown in the notes pane.",
      label: "Icon",
      placeholder: "Emoji or short mark",
      icon: <FileText size={18} />,
      type: "text",
      action: "Save",
    },
  }[state.kind];

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form
        className="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="dialog-header">
          <span className="dialog-icon">{config.icon}</span>
          <div>
            <h2>{config.title}</h2>
            <p>{config.description}</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <label className="field-label" htmlFor="property-value">
          {config.label}
        </label>
        <div className={config.type === "color" ? "color-field" : ""}>
          <input
            className="dialog-input"
            id="property-value"
            type={config.type}
            value={state.value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={config.placeholder}
            autoFocus
          />
          {config.type === "color" ? (
            <input
              className="dialog-input color-text"
              value={state.value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="#4b7d75"
            />
          ) : null}
        </div>
        {appError ? <p className="dialog-error">{appError}</p> : null}
        <div className="dialog-actions">
          <button className="toolbar-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            {config.action}
          </button>
        </div>
      </form>
    </div>
  );
}

function buildFolderTree(folders: FolderEntry[], workspace: string, metadata: WorkspaceMetadata): FolderNode[] {
  const notebookName = getNotebookName(workspace);
  const entries = folders.length
    ? folders
    : [{ path: "", name: notebookName, parent_path: "" }];
  const map = new Map<string, FolderNode>();
  entries.forEach((folder) => map.set(folder.path, { ...folder, children: [] }));
  if (!map.has("")) {
    map.set("", { path: "", name: notebookName, parent_path: "", children: [] });
  }
  map.forEach((node) => {
    if (node.path === "") return;
    map.get(node.parent_path)?.children.push(node);
  });
  const sortChildren = (node: FolderNode) => {
    node.children = orderFolders(node.children, node.path, metadata);
    node.children.forEach(sortChildren);
  };
  const root = map.get("")!;
  sortChildren(root);
  return [root];
}

function buildBookmarkViews(
  bookmarks: BookmarkEntry[],
  folders: FolderEntry[],
  notes: NoteEntry[],
  metadata: WorkspaceMetadata,
  workspace: string,
): BookmarkView[] {
  const notebookName = getNotebookName(workspace);
  return bookmarks.map((bookmark) => {
    if (bookmark.kind === "folder") {
      const folder = folders.find((entry) => entry.path === bookmark.path);
      return {
        ...bookmark,
        title: folder ? folder.name : `${bookmark.path || notebookName} (missing)`,
        icon: metadata.folderIcons[bookmark.path],
        missing: !folder,
      };
    }
    const note = notes.find((entry) => entry.path === bookmark.path);
    return {
      ...bookmark,
      title: note?.title ?? `${bookmark.path} (missing)`,
      icon: metadata.noteIcons[bookmark.path],
      missing: !note,
    };
  });
}

function orderFolders(folders: FolderNode[], parentPath: string, metadata: WorkspaceMetadata) {
  const order = metadata.folderOrder[parentPath] ?? [];
  return [...folders].sort((a, b) => {
    const aIndex = order.indexOf(a.path);
    const bIndex = order.indexOf(b.path);
    if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
    return a.name.localeCompare(b.name);
  });
}

function orderNotes(notes: NoteEntry[], folderPath: string, metadata: WorkspaceMetadata) {
  const order = metadata.noteOrder[folderPath] ?? [];
  return [...notes].sort((a, b) => {
    const pinDelta = Number(Boolean(metadata.pinnedNotes[b.path])) - Number(Boolean(metadata.pinnedNotes[a.path]));
    if (pinDelta) return pinDelta;
    const aIndex = order.indexOf(a.path);
    const bIndex = order.indexOf(b.path);
    if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
    return a.title.localeCompare(b.title);
  });
}

function splitMarkdownTitle(markdown: string, fallbackTitle: string) {
  return {
    title: fallbackTitle,
    body: markdown,
  };
}

function parseNoteMarkdown(markdown: string): ParsedNoteMarkdown {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0].trim() !== "---") {
    return { body: markdown, frontmatter: "", frontmatterError: null };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) {
    return {
      body: markdown,
      frontmatter: "",
      frontmatterError: "This note starts with frontmatter, but the closing --- line is missing. Opened as raw Markdown.",
    };
  }

  const frontmatter = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n").replace(/^\n/, "");
  const validationError = validateFrontmatter(frontmatter);

  if (validationError) {
    return {
      body: markdown,
      frontmatter: "",
      frontmatterError: `This note has malformed frontmatter: ${validationError}. Opened as raw Markdown.`,
    };
  }

  return { body, frontmatter, frontmatterError: null };
}

function composeMarkdown(frontmatter: string, body: string, preserveRawBody = false) {
  if (preserveRawBody) return body;
  const trimmedFrontmatter = frontmatter.trim();
  if (!trimmedFrontmatter) return body;
  return `---\n${trimmedFrontmatter}\n---\n\n${body.replace(/^\n+/, "")}`;
}

function validateFrontmatter(frontmatter: string) {
  const lines = frontmatter.replace(/\r\n/g, "\n").split("\n");
  let currentAllowsNested = false;

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    if (/^\s/.test(line)) {
      if (!currentAllowsNested) return `unexpected indentation near "${line.trim()}"`;
      continue;
    }

    const match = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) return `expected "key: value" near "${line.trim()}"`;
    currentAllowsNested = match[2].trim() === "" || /^[>|][+-]?$/.test(match[2].trim());
  }

  return null;
}

function getFrontmatterFields(frontmatter: string): FrontmatterField[] {
  const lines = frontmatter.replace(/\r\n/g, "\n").split("\n");
  return lines.flatMap((line, index) => {
    const match = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) return [];
    const nextTopLevelIndex = lines.findIndex((nextLine, nextIndex) => nextIndex > index && /^\S/.test(nextLine));
    const blockEnd = nextTopLevelIndex === -1 ? lines.length : nextTopLevelIndex;
    const hasNestedContent = lines.slice(index + 1, blockEnd).some((nextLine) => {
      if (!nextLine.trim()) return false;
      return /^\s/.test(nextLine);
    });
    return [{
      editable: !hasNestedContent,
      key: match[1],
      lineIndex: index,
      value: match[2],
    }];
  });
}

function updateFrontmatterField(frontmatter: string, field: FrontmatterField, value: string) {
  const lines = frontmatter.replace(/\r\n/g, "\n").split("\n");
  lines[field.lineIndex] = `${field.key}: ${value}`;
  return lines.join("\n");
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function previewNote(markdown: string) {
  return parseNoteMarkdown(markdown).body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^#\s+/.test(line.trim()))
    .join(" ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
}

function getTextStats(text: string) {
  const plain = text
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    words: plain ? plain.split(/\s+/).length : 0,
    characters: plain.length,
  };
}

function extractOutline(title: string, body: string) {
  const headings = title.trim() ? [{ level: 1, text: title.trim() }] : [];
  body.split("\n").forEach((line) => {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) headings.push({ level: match[1].length, text: match[2].trim() });
  });
  return headings.map((heading, index) => ({
    ...heading,
    id: `heading-${index}`,
  }));
}

function addToOrder(metadata: WorkspaceMetadata, folder: string, notePath: string): WorkspaceMetadata {
  return {
    ...metadata,
    noteOrder: {
      ...metadata.noteOrder,
      [folder]: [...(metadata.noteOrder[folder] ?? []).filter((path) => path !== notePath), notePath],
    },
  };
}

function addFolderToOrder(metadata: WorkspaceMetadata, parent: string, folderPath: string): WorkspaceMetadata {
  return {
    ...metadata,
    folderOrder: {
      ...metadata.folderOrder,
      [parent]: [...(metadata.folderOrder[parent] ?? []).filter((path) => path !== folderPath), folderPath],
    },
  };
}

function replaceOrderedPath(metadata: WorkspaceMetadata, oldPath: string, newPath: string): WorkspaceMetadata {
  const noteOrder = Object.fromEntries(
    Object.entries(metadata.noteOrder).map(([folder, paths]) => [folder, paths.map((path) => (path === oldPath ? newPath : path))]),
  );
  const pinnedNotes = { ...metadata.pinnedNotes };
  if (pinnedNotes[oldPath]) {
    delete pinnedNotes[oldPath];
    pinnedNotes[newPath] = true;
  }
  const noteIcons = { ...metadata.noteIcons };
  if (noteIcons[oldPath]) {
    noteIcons[newPath] = noteIcons[oldPath];
    delete noteIcons[oldPath];
  }
  const notePositions = { ...metadata.notePositions };
  if (notePositions[oldPath]) {
    notePositions[newPath] = { ...notePositions[oldPath], path: newPath };
    delete notePositions[oldPath];
  }
  const bookmarks = metadata.bookmarks.map((bookmark) =>
    bookmark.kind === "note" && bookmark.path === oldPath ? { ...bookmark, path: newPath } : bookmark,
  );
  const sessionOpenTabs = metadata.sessionOpenTabs.map((path) => (path === oldPath ? newPath : path));
  const sessionActiveTab = metadata.sessionActiveTab === oldPath ? newPath : metadata.sessionActiveTab;
  return { ...metadata, noteOrder, pinnedNotes, noteIcons, notePositions, bookmarks, sessionOpenTabs, sessionActiveTab };
}

function removeNoteFromMetadata(metadata: WorkspaceMetadata, notePath: string): WorkspaceMetadata {
  return {
    ...metadata,
    noteOrder: Object.fromEntries(
      Object.entries(metadata.noteOrder).map(([folder, paths]) => [folder, paths.filter((path) => path !== notePath)]),
    ),
    pinnedNotes: Object.fromEntries(Object.entries(metadata.pinnedNotes).filter(([path]) => path !== notePath)),
    noteIcons: Object.fromEntries(Object.entries(metadata.noteIcons).filter(([path]) => path !== notePath)),
    notePositions: Object.fromEntries(Object.entries(metadata.notePositions).filter(([path]) => path !== notePath)),
    bookmarks: metadata.bookmarks.filter((bookmark) => bookmark.kind !== "note" || bookmark.path !== notePath),
    sessionOpenTabs: metadata.sessionOpenTabs.filter((path) => path !== notePath),
    sessionActiveTab: metadata.sessionActiveTab === notePath ? null : metadata.sessionActiveTab,
  };
}

function moveNoteInMetadata(metadata: WorkspaceMetadata, oldPath: string, newPath: string, oldFolder: string, newFolder: string): WorkspaceMetadata {
  const afterPathReplace = replaceOrderedPath(metadata, oldPath, newPath);
  const oldOrder = (afterPathReplace.noteOrder[oldFolder] ?? []).filter((path) => path !== newPath);
  const newOrder = [...(afterPathReplace.noteOrder[newFolder] ?? []).filter((path) => path !== newPath), newPath];
  return {
    ...afterPathReplace,
    noteOrder: {
      ...afterPathReplace.noteOrder,
      [oldFolder]: oldOrder,
      [newFolder]: newOrder,
    },
  };
}

function moveFolderInMetadata(metadata: WorkspaceMetadata, oldPath: string, newPath: string, oldParent: string, newParent: string): WorkspaceMetadata {
  const replaced = replaceFolderPathPrefix(metadata, oldPath, newPath);
  const oldOrder = (replaced.folderOrder[oldParent] ?? []).filter((path) => path !== newPath);
  const newOrder = [...(replaced.folderOrder[newParent] ?? []).filter((path) => path !== newPath), newPath];
  return {
    ...replaced,
    folderOrder: {
      ...replaced.folderOrder,
      [oldParent]: oldOrder,
      [newParent]: newOrder,
    },
  };
}

function replaceFolderPathPrefix(metadata: WorkspaceMetadata, oldPrefix: string, newPrefix: string): WorkspaceMetadata {
  const folderOrder = Object.fromEntries(
    Object.entries(metadata.folderOrder).map(([folder, paths]) => [
      replacePathPrefix(folder, oldPrefix, newPrefix),
      paths.map((path) => replacePathPrefix(path, oldPrefix, newPrefix)),
    ]),
  );
  const noteOrder = Object.fromEntries(
    Object.entries(metadata.noteOrder).map(([folder, paths]) => [
      replacePathPrefix(folder, oldPrefix, newPrefix),
      paths.map((path) => replacePathPrefix(path, oldPrefix, newPrefix)),
    ]),
  );
  const pinnedNotes = Object.fromEntries(Object.entries(metadata.pinnedNotes).map(([path, pinned]) => [replacePathPrefix(path, oldPrefix, newPrefix), pinned]));
  const folderIcons = Object.fromEntries(Object.entries(metadata.folderIcons).map(([path, icon]) => [replacePathPrefix(path, oldPrefix, newPrefix), icon]));
  const folderColors = Object.fromEntries(Object.entries(metadata.folderColors).map(([path, color]) => [replacePathPrefix(path, oldPrefix, newPrefix), color]));
  const noteIcons = Object.fromEntries(Object.entries(metadata.noteIcons).map(([path, icon]) => [replacePathPrefix(path, oldPrefix, newPrefix), icon]));
  const notePositions = Object.fromEntries(
    Object.entries(metadata.notePositions).map(([path, position]) => {
      const nextPath = replacePathPrefix(path, oldPrefix, newPrefix);
      return [nextPath, { ...position, path: nextPath }];
    }),
  );
  const bookmarks = metadata.bookmarks.map((bookmark) => ({
    ...bookmark,
    path: replacePathPrefix(bookmark.path, oldPrefix, newPrefix),
  }));
  const sessionOpenTabs = metadata.sessionOpenTabs.map((path) => replacePathPrefix(path, oldPrefix, newPrefix));
  const sessionActiveTab = metadata.sessionActiveTab ? replacePathPrefix(metadata.sessionActiveTab, oldPrefix, newPrefix) : null;
  return { ...metadata, folderOrder, noteOrder, pinnedNotes, folderIcons, folderColors, noteIcons, notePositions, bookmarks, sessionOpenTabs, sessionActiveTab };
}

function removeFolderFromMetadata(metadata: WorkspaceMetadata, folderPath: string): WorkspaceMetadata {
  const isInFolder = (path: string) => path === folderPath || path.startsWith(`${folderPath}/`);
  return {
    ...metadata,
    folderOrder: Object.fromEntries(
      Object.entries(metadata.folderOrder)
        .filter(([folder]) => !isInFolder(folder))
        .map(([folder, paths]) => [folder, paths.filter((path) => !isInFolder(path))]),
    ),
    noteOrder: Object.fromEntries(Object.entries(metadata.noteOrder).filter(([folder]) => !isInFolder(folder))),
    pinnedNotes: Object.fromEntries(Object.entries(metadata.pinnedNotes).filter(([path]) => !isInFolder(path))),
    folderIcons: Object.fromEntries(Object.entries(metadata.folderIcons).filter(([path]) => !isInFolder(path))),
    folderColors: Object.fromEntries(Object.entries(metadata.folderColors).filter(([path]) => !isInFolder(path))),
    noteIcons: Object.fromEntries(Object.entries(metadata.noteIcons).filter(([path]) => !isInFolder(path))),
    notePositions: Object.fromEntries(Object.entries(metadata.notePositions).filter(([path]) => !isInFolder(path))),
    bookmarks: metadata.bookmarks.filter((bookmark) => !isInFolder(bookmark.path)),
    sessionOpenTabs: metadata.sessionOpenTabs.filter((path) => !isInFolder(path)),
    sessionActiveTab: metadata.sessionActiveTab && isInFolder(metadata.sessionActiveTab) ? null : metadata.sessionActiveTab,
  };
}

function setMetadataValue(metadata: WorkspaceMetadata, key: "folderIcons" | "folderColors" | "noteIcons", path: string, value: string): WorkspaceMetadata {
  const values: Record<string, string> = { ...metadata[key] };
  if (value) {
    values[path] = value;
  } else {
    delete values[path];
  }
  return { ...metadata, [key]: values };
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string) {
  if (path === oldPrefix) return newPrefix;
  if (path.startsWith(`${oldPrefix}/`)) return `${newPrefix}${path.slice(oldPrefix.length)}`;
  return path;
}

function isLucideIcon(value: unknown): value is LucideIcon {
  return Boolean(value && typeof value === "object" && "$$typeof" in value);
}

function normalizeIconName(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function splitIconName(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function createBookmarkId() {
  return `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function arraysEqual(first: string[], second: string[]) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function readStoredNumber(key: string, fallback: number) {
  const rawValue = localStorage.getItem(key);
  if (rawValue === null) return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readInitialWorkspace() {
  const params = new URLSearchParams(window.location.search);
  const workspaceParam = params.get("workspace");
  if (workspaceParam) {
    localStorage.setItem(workspaceKey, workspaceParam);
    return workspaceParam;
  }
  return localStorage.getItem(workspaceKey) || (isTauri() ? "" : SAMPLE_WORKSPACE);
}

function readRecentNotebooks(): RecentNotebook[] {
  const raw = localStorage.getItem(recentNotebooksKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<RecentNotebook>[];
    return parsed
      .filter((entry): entry is RecentNotebook => Boolean(entry.path && entry.name && entry.lastOpenedAt))
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } catch {
    return [];
  }
}

function writeRecentNotebooks(notebooks: RecentNotebook[]) {
  const next = notebooks.slice(0, 24);
  localStorage.setItem(recentNotebooksKey, JSON.stringify(next));
  return next;
}

function touchRecentNotebook(notebooks: RecentNotebook[], path: string) {
  const next = [
    {
      path,
      name: path.split("/").filter(Boolean).at(-1) || "Notebook",
      lastOpenedAt: Date.now(),
    },
    ...notebooks.filter((notebook) => notebook.path !== path),
  ];
  return next.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

function readInitialOpenTarget(): OpenTarget | null {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get("openKind");
  const path = params.get("openPath");
  if ((kind === "folder" || kind === "note") && path !== null) {
    return { kind, path };
  }
  return null;
}

function readStoredColorScheme(): ColorScheme {
  const value = localStorage.getItem(themeKey);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function readStoredThemePreset(): ThemePresetId {
  const value = localStorage.getItem(themePresetKey);
  return themePresets.some((preset) => preset.id === value) ? (value as ThemePresetId) : "default";
}

function getThemePreset(id: ThemePresetId) {
  return themePresets.find((preset) => preset.id === id) ?? themePresets[0];
}

function createTabId() {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function displayFolderName(path: string, folders: FolderEntry[], workspace: string) {
  if (!path) return getNotebookName(workspace);
  return folders.find((folder) => folder.path === path)?.name || path.split("/").at(-1) || path;
}

function getNotebookName(workspace: string) {
  return workspace.split("/").filter(Boolean).at(-1) || "Notebook";
}

function startResize(event: React.PointerEvent, onMove: (clientX: number) => void) {
  event.preventDefault();
  const handleMove = (moveEvent: PointerEvent) => onMove(moveEvent.clientX);
  const handleUp = () => {
    document.body.classList.remove("is-resizing-pane");
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
  };

  document.body.classList.add("is-resizing-pane");
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp, { once: true });
}

function hexToRgb(value: string) {
  const normalized = normalizeColorForInput(value).replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number) {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case rN: h = (gN - bN) / d + (gN < bN ? 6 : 0); break;
    case gN: h = (bN - rN) / d + 2; break;
    case bN: h = (rN - gN) / d + 4; break;
  }
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }: { h: number; s: number; l: number }) {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function shiftLightness(hex: string, deltaL: number) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return hslToHex({ ...hsl, l: clamp(hsl.l + deltaL, 0, 100) });
}

function deriveThemeTokens(preset: ThemePreset, mode: "light" | "dark"): ThemeTokens {
  const bg = preset.appBackground[mode];
  const overrides = preset.tokens?.[mode] ?? {};
  if (mode === "dark") {
    return {
      surface: shiftLightness(bg, -2),
      surfaceSoft: bg,
      surfaceStrong: shiftLightness(bg, 4),
      surfaceMuted: shiftLightness(bg, 2),
      border: "rgba(238, 232, 223, 0.1)",
      text: "#eee8df",
      textMuted: "rgba(238, 232, 223, 0.62)",
      ...overrides,
    };
  }
  return {
    surface: shiftLightness(bg, 3),
    surfaceSoft: bg,
    surfaceStrong: shiftLightness(bg, 6),
    surfaceMuted: shiftLightness(bg, 1),
    border: "rgba(52, 48, 43, 0.1)",
    text: "#22211f",
    textMuted: "rgba(34, 33, 31, 0.62)",
    ...overrides,
  };
}

function normalizeColorForInput(value: string) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const rgb = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgb) return "#075f83";
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((part) => clamp(Number(part), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}
