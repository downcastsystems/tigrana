import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { availableMonitors, getCurrentWindow, LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize, type Monitor } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { gitHubEmojis, type EmojiItem } from "@tiptap/extension-emoji";
import {
  AlignCenter,
  AlignLeft,
  BookOpen,
  Bookmark,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  History,
  LayoutList,
  Link2,
  Mic,
  Moon,
  MoveRight,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Square,
  StretchHorizontal,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Component, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NotesEditor, type PendingEditorChange } from "./editor/NotesEditor";
import {
  exportTextFile,
  focusNotebookWindow,
  isTauri,
  readAppPreferences,
  registerNotebookWindow,
  printCurrentWebview,
  unregisterNotebookWindow,
  writeAppPreferences,
  updateAppMenuState,
} from "./lib/desktop";
import type { AppMenuState } from "./lib/desktop";
import { decodeTitleFromFilename, validateNoteTitle } from "./lib/notebookNames";
import { defaultWorkspaceMetadata, notebookStorage, SAMPLE_WORKSPACE } from "./lib/notebookStorage";
import type { NoteVersionEntry, TrashEntry } from "./lib/notebookStorage";
import { normalizeMarkdownImageLines } from "./lib/markdown";
import { ActiveNoteLifecycle, type ActiveNoteAccess } from "./lib/activeNoteLifecycle";
import { buildNoteExportHtml, noteExportFileStem } from "./lib/exportNote";
import { shouldApplyEditorUpdate } from "./lib/noteEditorUpdates";
import {
  createNoteDocument,
  measureNoteText,
  normalizeNoteMarkdown,
  readNoteDocument,
  readNotePreview,
  reviseNoteDocument,
  updateNoteDocumentFrontmatterField,
  type FrontmatterField,
} from "./lib/noteDocument";
import {
  addFolderToOrder,
  addToOrder,
  removeFolderFromMetadata,
  removeNoteFromMetadata,
  buildBookmarkViews,
  buildFolderTree,
  getNotebookName,
  orderFolders,
  orderNotes,
  setMetadataValue,
  type BookmarkView,
  type FolderNode,
} from "./lib/notebookMetadata";
import { createNotebookPathMutations } from "./lib/notebookPathMutations";
import { NotebookMetadataPersistence } from "./lib/notebookMetadataPersistence";
import { PendingNoteContents } from "./lib/pendingNoteContents";
import { useNoteTextStats } from "./lib/useNoteTextStats";
import { useNoteOutline } from "./lib/useNoteOutline";
import { searchNotes } from "./lib/search";
import type { BookmarkEntry, FolderEntry, LinkIndex, NavigationStyle, NotebookThemeColors, NoteEntry, NotePositionMetadata, SearchResult, WorkspaceMetadata } from "./types";

const {
  cleanupTrash,
  createFolder,
  createNote,
  deleteNote,
  duplicateNote,
  ensureWelcomeNote,
  ensureWorkspace,
  listFolders,
  listNotes,
  listNoteVersions,
  listTrash,
  purgeTrash,
  purgeTrashAll,
  readAssetDataUrl,
  readLinkIndex,
  readNote,
  readNoteVersion,
  readWorkspaceMetadata,
  restoreNoteVersion,
  restoreTrash,
  revealPath,
  saveAsset,
  saveNote,
  trashFolder,
  trashNote,
  watchWorkspace,
} = notebookStorage;

const notebookMetadataPersistence = new NotebookMetadataPersistence(notebookStorage);

function stopChromeMouseDown(event: React.MouseEvent) {
  event.stopPropagation();
}

function isEditableNoteTextCursorTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (document.body.classList.contains("is-resizing-pane")) return false;
  if (document.body.classList.contains("is-dragging-note")) return false;
  if (document.body.classList.contains("is-dragging-folder")) return false;

  if (target.closest(".note-title-input:not(:disabled), .raw-markdown-input:not(:disabled)")) return true;

  const editorShell = target.closest('.editor-shell[data-editable="true"]');
  if (!editorShell) return false;
  if (
    target.closest(
      [
        "a",
        "button",
        "input",
        "select",
        "textarea",
        "[role='button']",
        "[contenteditable='false']",
        ".format-bubble",
        ".slash-menu",
        ".note-find-bar",
        ".image-resizable",
        ".image-resize-handle",
        ".code-block-controls",
        ".code-block-side-tools",
        ".table-axis-button",
        ".table-context-menu",
        ".table-column-handle",
        ".table-row-handle",
      ].join(", "),
    )
  ) {
    return false;
  }

  return target === editorShell || Boolean(target.closest(".editor-content, .ProseMirror"));
}

const workspaceKey = "tigrana-workspace";
const themeKey = "tigrana-theme";
const accentKey = "tigrana-accent";
const themePresetKey = "tigrana-theme-preset";
const widthModeKey = "tigrana-width-mode";
const alignmentKey = "tigrana-note-alignment";
const legacyFullWidthKey = "tigrana-full-width";
const folderPaneWidthKey = "tigrana-folder-pane-width";
const notesPaneWidthKey = "tigrana-notes-pane-width";
const rightPaneWidthKey = "tigrana-right-pane-width";
const recentNotebooksKey = "tigrana-recent-notebooks";
const lastPathKey = "tigrana-last-path";
const accentTitlebarKey = "tigrana-accent-titlebar";
const spellcheckKey = "tigrana-spellcheck";
const windowSizeKey = "tigrana-window-size";
const windowPositionKey = "tigrana-window-position";
const sessionKeyPrefix = "tigrana-session:";
const notePositionFreshMs = 24 * 60 * 60 * 1000;
const defaultLightAccent = "#666666";
const defaultAppFontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const defaultEditorFontFamily = defaultAppFontFamily;
const defaultAppFontSize = 14;
const defaultEditorFontSize = 17;
type EditorWidthMode = "comfortable" | "narrow" | "full";
type NoteAlignment = "left" | "center";
const editorWidthOptions: { value: EditorWidthMode; label: string; hint?: string }[] = [
  { value: "comfortable", label: "Comfortable Width", hint: "Default" },
  { value: "narrow", label: "Narrow Width", hint: "Best for writing stories" },
  { value: "full", label: "Full Width" },
];

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
const defaultDarkAccent = "#333333";
const lucideIconPrefix = "lucide:";
const lucideIconMap = Object.fromEntries(
  Object.entries(LucideIcons).filter(([name, value]) => /^[A-Z]/.test(name) && !name.endsWith("Icon") && isLucideIcon(value)),
) as Record<string, LucideIcon>;
const lucideIconOptions = Object.keys(lucideIconMap).sort((a, b) => a.localeCompare(b));

type DraftNote = {
  parentPath: string;
};

type ContextMenuState =
  | { x: number; y: number; kind: "empty"; parentPath?: string; source?: "sections-pane" }
  | { x: number; y: number; kind: "folder"; path: string; source?: "sections-pane" }
  | { x: number; y: number; kind: "note"; path: string; source?: "sections-pane" };

type TabContextMenuState = { x: number; y: number; tabId: string };

type ContextMenuTarget =
  | { kind: "empty"; parentPath?: string; source?: "sections-pane" }
  | { kind: "folder"; path: string; source?: "sections-pane" }
  | { kind: "note"; path: string; source?: "sections-pane" };

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
  | { kind: "rename-folder"; path: string; value: string; name: string }
  | { kind: "folder-color"; path: string; value: string; name: string; subject?: "folder" | "section" };

type IconBrowserState =
  | { kind: "folder"; path: string; value: string; name: string; onReset?: () => void }
  | { kind: "note"; path: string; value: string; name: string };

type VersionHistoryState = {
  path: string;
  title: string;
};

type DragItem =
  | { kind: "note"; path: string }
  | { kind: "folder"; path: string }
  | null;

type DropPlacement = "before" | "after";
type FolderOrderingMode = "alphabetical" | "custom";
type FolderDropIntent =
  | { kind: "before"; path: string }
  | { kind: "after"; path: string }
  | { kind: "into"; path: string };

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
type RightSidebarMode = "outline" | "frontmatter" | "properties" | "backlinks";
type NoteTab = {
  id: string;
  path: string | null;
};

type EditorCommand =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "highlight"
  | "link"
  | "clear"
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "quote"
  | "codeBlock"
  | "divider"
  | "table"
  | "image"
  | "findNext"
  | "findPrevious"
  | "replace"
  | "insertText";

type EditorCommandRequest = {
  id: number;
  command: EditorCommand;
  src?: string;
  alt?: string;
  selectionFrom?: number;
  selectionTo?: number;
};

type ImageInsertResult = { src: string; alt?: string };
type DictationTarget = "rich" | "raw";

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  item(index: number): SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    item(index: number): SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
  message?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

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

type NotebookThemeColorSettings = Record<"light" | "dark", NotebookThemeColors>;

const defaultNotebookThemeColors = (): NotebookThemeColorSettings => ({
  light: { accentColor: null, titlebarColor: null, titlebarUseAccent: true },
  dark: { accentColor: null, titlebarColor: null, titlebarUseAccent: true },
});

type PersistDraftSnapshot = {
  workspace: string;
  path: string | null;
  pendingNote: DraftNote | null;
  title: string;
  savedTitle: string;
  body: string;
  frontmatter: string;
  rawMode: boolean;
  markdown: string;
};

const themePresets: ThemePreset[] = [
  {
    id: "default",
    name: "Default",
    accent: { light: defaultLightAccent, dark: defaultDarkAccent },
    appBackground: { light: "#ffffff", dark: "#212225" },
    tokens: {
      light: {
        surface: "#f5f5f5",
        surfaceSoft: "#f5f5f5",
        surfaceMuted: "#ececec",
      },
    },
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
  const [themeColors, setThemeColors] = useState<NotebookThemeColorSettings>(() => readStoredNotebookThemeColors());
  const [accentTitlebar, setAccentTitlebar] = useState<boolean>(() => localStorage.getItem(accentTitlebarKey) === "true");
  const [navigationStyle, setNavigationStyle] = useState<NavigationStyle>("section-view");
  const [appFontFamily, setAppFontFamily] = useState(defaultAppFontFamily);
  const [appFontSize, setAppFontSize] = useState(defaultAppFontSize);
  const [editorFontFamily, setEditorFontFamily] = useState(defaultEditorFontFamily);
  const [editorFontSize, setEditorFontSize] = useState(defaultEditorFontSize);
  const [spellcheckEnabled, setSpellcheckEnabled] = useState(() => readStoredSpellcheckEnabled());
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
  const [frontmatterDraft, setFrontmatterDraft] = useState("");
  const [rawMarkdownText, setRawMarkdownText] = useState("");
  const [savedRawMarkdownText, setSavedRawMarkdownText] = useState("");
  const [frontmatterError, setFrontmatterError] = useState<string | null>(null);
  const [activeNoteAccess, setActiveNoteAccess] = useState<ActiveNoteAccess>("editable");
  const [noteLockMessage, setNoteLockMessage] = useState<string | null>(null);
  const [selectedEditorText, setSelectedEditorText] = useState("");
  const [editorRestorePosition, setEditorRestorePosition] = useState<NotePositionMetadata | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [noteFindRequest, setNoteFindRequest] = useState(0);
  const [appError, setAppError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notebooksManageOpen, setNotebooksManageOpen] = useState(false);
  const [recentlyDeletedOpen, setRecentlyDeletedOpen] = useState(false);
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [versionHistory, setVersionHistory] = useState<VersionHistoryState | null>(null);
  const [recentNotebooks, setRecentNotebooks] = useState<RecentNotebook[]>(() => readRecentNotebooks());
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [leftVisible, setLeftVisible] = useState(true);
  const [outlineVisible, setOutlineVisible] = useState(true);
  const [rightSidebarMode, setRightSidebarMode] = useState<RightSidebarMode>("outline");
  const [linkIndex, setLinkIndex] = useState<LinkIndex | null>(null);
  const [rawMarkdownVisible, setRawMarkdownVisible] = useState(false);
  const [editorWidthMode, setEditorWidthMode] = useState<EditorWidthMode>(() => readStoredEditorWidthMode());
  const [noteAlignment, setNoteAlignment] = useState<NoteAlignment>(() => readStoredNoteAlignment());
  const [widthMenuOpen, setWidthMenuOpen] = useState(false);
  const [openTabs, setOpenTabs] = useState<NoteTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [folderPaneWidth, setFolderPaneWidth] = useState(() => readStoredNumber(folderPaneWidthKey, 292));
  const [notesPaneWidth, setNotesPaneWidth] = useState(() => readStoredNumber(notesPaneWidthKey, 268));
  const [rightPaneWidth, setRightPaneWidth] = useState(() => readStoredNumber(rightPaneWidthKey, 300));
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [folderDialogParent, setFolderDialogParent] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [propertyDialog, setPropertyDialog] = useState<PropertyDialogState | null>(null);
  const [iconBrowser, setIconBrowser] = useState<IconBrowserState | null>(null);
  const [moveDialog, setMoveDialog] = useState<{ kind: "note" | "folder"; path: string } | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const emojiPickerResolverRef = useRef<((result: string | null) => void) | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const linkPickerResolverRef = useRef<((result: LinkPickerResult | null) => void) | null>(null);
  const imagePickerResolverRef = useRef<((result: ImageInsertResult | null) => void) | null>(null);
  const [draggingItem, setDraggingItem] = useState<DragItem>(null);
  const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null);
  const [noteDragPreview, setNoteDragPreview] = useState<NoteDragPreview | null>(null);
  const [sectionReorderHover, setSectionReorderHover] = useState<{ path: string; placement: DropPlacement } | null>(null);
  const [folderDropIntent, setFolderDropIntent] = useState<FolderDropIntent | null>(null);
  const [noteDropIndicator, setNoteDropIndicator] = useState<{ path: string; placement: DropPlacement } | null>(null);
  const [editorFocusRequest, setEditorFocusRequest] = useState(0);
  const [editorFocusAtEndRequest, setEditorFocusAtEndRequest] = useState(0);
  const [editorReloadRequest, setEditorReloadRequest] = useState(0);
  const [editorCommandRequest, setEditorCommandRequest] = useState<EditorCommandRequest | null>(null);
  const [rawFindOpen, setRawFindOpen] = useState(false);
  const [rawReplaceOpen, setRawReplaceOpen] = useState(false);
  const [rawFindQuery, setRawFindQuery] = useState("");
  const [rawReplaceText, setRawReplaceText] = useState("");
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [dictationTarget, setDictationTarget] = useState<DictationTarget | null>(null);
  const [titleFocusRequest, setTitleFocusRequest] = useState(0);
  const noteSurfaceRef = useRef<HTMLElement | null>(null);
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const handledTitleFocusRequestRef = useRef(0);
  const armedTitleFocusRequestRef = useRef(0);
  const draggingItemRef = useRef<DragItem>(null);
  const notePointerDragRef = useRef<NotePointerDrag | null>(null);
  const folderPointerDragRef = useRef<NotePointerDrag | null>(null);
  const sectionPointerDragRef = useRef<NotePointerDrag | null>(null);
  const suppressNextNoteClickRef = useRef(false);
  const suppressNextFolderClickRef = useRef(false);
  const suppressNextSectionClickRef = useRef(false);
  const autoSelectedWorkspaceRef = useRef<string | null>(null);
  const workspaceRef = useRef<string | null>(null);
  const metadataRef = useRef(metadata);
  const acceptPersistedMetadata = useCallback((persistedWorkspace: string, next: WorkspaceMetadata) => {
    if (workspaceRef.current !== persistedWorkspace) return;
    metadataRef.current = next;
    setMetadata(next);
  }, []);
  const positionWriteTimerRef = useRef<number | null>(null);
  const pendingEditorChangeRef = useRef<PendingEditorChange | null>(null);
  const pendingNoteContentsRef = useRef(new PendingNoteContents());
  const windowResizeTimerRef = useRef<number | null>(null);
  const restoredTabsWorkspaceRef = useRef<string | null>(null);
  const openTabsRef = useRef<NoteTab[]>([]);
  const activeTabIdRef = useRef<string | null>(null);
  const chooseWorkspaceRef = useRef<(intent: "open" | "new", openInNewWindow?: boolean) => void>(() => {});
  const externalNoteChangeRef = useRef<(path: string) => void>(() => {});
  const undoableNewNoteRef = useRef<{ workspace: string; path: string } | null>(null);
  const titleEscapeUndoInFlightRef = useRef(false);
  const activeDraftStateRef = useRef({
    activePath: null as string | null,
    draft: "",
    frontmatterDraft: "",
    pendingNote: null as DraftNote | null,
    rawMarkdownText: "",
    savedRawMarkdownText: "",
    savedTitle: "",
    titleDraft: "",
  });
  const persistDraftAttemptRef = useRef<() => Promise<string | undefined>>(async () => undefined);
  const flushPendingSavesRef = useRef<() => Promise<void>>(async () => {});
  const rawMarkdownInputRef = useRef<HTMLTextAreaElement | null>(null);
  const dictationTargetRef = useRef<DictationTarget | null>(null);
  const dictationInsertHandlerRef = useRef<(text: string) => void>(() => {});
  const editorSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const selectedEditorTextRef = useRef("");
  const dictationRichSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const backlinkPaneVisibleRef = useRef(false);
  const rawMarkdownSelectionRef = useRef<{
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
    scrollTop: number;
    scrollLeft: number;
  } | null>(null);
  const titleCommitInFlightRef = useRef(false);
  const keyboardActionsRef = useRef<{
    addEmptyTab: () => void;
    chooseWorkspace: (intent: "open" | "new") => void;
    hasOpenNote: () => boolean;
    persistDraft: () => void;
    requestCreateNote: (parentPath?: string) => void;
    selectedFolder: string;
    toggleRawMarkdown: () => void;
  }>({
    addEmptyTab: () => {},
    chooseWorkspace: () => {},
    hasOpenNote: () => false,
    persistDraft: () => {},
    requestCreateNote: () => {},
    selectedFolder: "",
    toggleRawMarkdown: () => {},
  });

  const activeNote = notes.find((note) => note.path === activePath) ?? null;
  const activeNoteLifecycleRef = useRef<ActiveNoteLifecycle | null>(null);
  if (!activeNoteLifecycleRef.current) {
    activeNoteLifecycleRef.current = new ActiveNoteLifecycle({
      storage: notebookStorage,
      getWorkspace: () => workspaceRef.current,
      getWindowLabel: () => (isTauri() ? getCurrentWindow().label : "browser"),
      onError: (error) => setAppError(error instanceof Error ? error.message : String(error)),
    });
  }
  const activeNoteLifecycle = activeNoteLifecycleRef.current;
  const activeNoteLockRef = activeNoteLifecycle.activeLockRef;
  const pathChangeSaveInFlight = activeNoteLifecycle.hasPathChange;
  const transientActiveDraftOpen = Boolean(activePath && titleDraft.trim() && pathChangeSaveInFlight);
  const noteOpen = pendingNote || activeNote || transientActiveDraftOpen;
  const hasOpenNote = Boolean(noteOpen);
  const results = useMemo(() => searchNotes(notes, contents, searchQuery), [contents, notes, searchQuery]);
  const folderTree = useMemo(() => buildFolderTree(folders, workspace, metadata), [folders, metadata, workspace]);
  const visibleNotes = useMemo(
    () => orderNotes(notes.filter((note) => note.parent_path === selectedFolder), selectedFolder, metadata),
    [metadata, notes, selectedFolder],
  );
  const noteDocument = useMemo(
    () => createNoteDocument({ title: titleDraft, body: draft, frontmatter: frontmatterDraft }),
    [draft, frontmatterDraft, titleDraft],
  );
  const outline = useNoteOutline(
    titleDraft,
    draft,
    activePath ?? (pendingNote ? `pending:${pendingNote.parentPath}` : null),
    Boolean(noteOpen && outlineVisible && rightSidebarMode === "outline"),
  );
  const backgroundNoteStats = useNoteTextStats(draft, activePath ?? (pendingNote ? "pending-note" : null));
  const noteStats = selectedEditorText ? measureNoteText(selectedEditorText) : backgroundNoteStats;
  const rawMarkdownDraft = useMemo(
    () => (rawMarkdownVisible || frontmatterError ? rawMarkdownText : noteDocument.markdown),
    [frontmatterError, noteDocument.markdown, rawMarkdownText, rawMarkdownVisible],
  );
  const rawFindMatchCount = useMemo(
    () => countPlainTextMatches(rawMarkdownDraft, rawFindQuery),
    [rawFindQuery, rawMarkdownDraft],
  );
  dictationTargetRef.current = dictationTarget;
  useLayoutEffect(() => {
    if (!rawMarkdownVisible && !frontmatterError) return;
    const input = rawMarkdownInputRef.current;
    const selection = rawMarkdownSelectionRef.current;
    if (!input || !selection || document.activeElement !== input) return;
    rawMarkdownSelectionRef.current = null;
    const start = Math.min(selection.start, input.value.length);
    const end = Math.min(selection.end, input.value.length);
    input.setSelectionRange(start, end, selection.direction);
    input.scrollTop = selection.scrollTop;
    input.scrollLeft = selection.scrollLeft;
  }, [frontmatterError, rawMarkdownDraft, rawMarkdownVisible]);
  const hasUnsavedBody = Boolean(noteOpen) && rawMarkdownDraft !== savedRawMarkdownText;
  const hasUnsavedChanges = Boolean(noteOpen) && (hasUnsavedBody || titleDraft !== savedTitle);
  const activeNoteEditable = activeNoteAccess === "editable";
  backlinkPaneVisibleRef.current = outlineVisible && rightSidebarMode === "backlinks";
  const resolvedTheme = colorScheme === "system" ? (prefersDark ? "dark" : "light") : colorScheme;
  const themePreset = getThemePreset(themePresetId);
  const activeThemeColors = themeColors[resolvedTheme];
  const accentColor = activeThemeColors.accentColor ?? null;
  const effectiveAccentColor = accentColor || themePreset.accent[resolvedTheme];
  const titlebarUseAccent = activeThemeColors.titlebarUseAccent ?? true;
  const titlebarColor = activeThemeColors.titlebarColor ?? null;
  const effectiveTitlebarColor = titlebarUseAccent ? effectiveAccentColor : (titlebarColor || effectiveAccentColor);
  const selectedFolderTitle = useMemo(() => displayFolderName(selectedFolder, folders, workspace), [folders, selectedFolder, workspace]);
  const selectedSection = useMemo(() => getTopLevelFolderPath(selectedFolder), [selectedFolder]);
  const selectedSectionTitle = useMemo(
    () => (selectedSection ? displayFolderName(selectedSection, folders, workspace) : "Uncategorized"),
    [folders, selectedSection, workspace],
  );
  const activeNoteFolderPath = useMemo(() => {
    if (!activePath) return null;
    return notes.find((note) => note.path === activePath)?.parent_path ?? null;
  }, [activePath, notes]);
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
    "--app-font-family": appFontFamily,
    "--app-font-size": `${appFontSize}px`,
    "--editor-font-family": editorFontFamily,
    "--editor-font-size": `${editorFontSize}px`,
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
    let forcedTextCursor = false;
    const clearCursor = () => {
      if (!forcedTextCursor) return;
      document.documentElement.style.cursor = "";
      document.body.style.cursor = "";
      forcedTextCursor = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (isEditableNoteTextCursorTarget(event.target)) {
        document.documentElement.style.cursor = "text";
        document.body.style.cursor = "text";
        forcedTextCursor = true;
      } else {
        clearCursor();
      }
    };

    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerleave", clearCursor, true);
    window.addEventListener("blur", clearCursor);
    return () => {
      clearCursor();
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerleave", clearCursor, true);
      window.removeEventListener("blur", clearCursor);
    };
  }, []);

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  useLayoutEffect(() => {
    activeDraftStateRef.current = {
      activePath,
      draft,
      frontmatterDraft,
      pendingNote,
      rawMarkdownText,
      savedRawMarkdownText,
      savedTitle,
      titleDraft,
    };
  }, [activePath, draft, frontmatterDraft, pendingNote, rawMarkdownText, savedRawMarkdownText, savedTitle, titleDraft]);

  useEffect(() => {
    if (!workspace) return;
    setRecentNotebooks((current) => writeRecentNotebooks(touchRecentNotebook(current, workspace)));
    void writeAppPreferences({ lastWorkspace: workspace, spellcheckEnabled }).catch((error) => {
      console.warn("write_app_preferences failed", error);
    });
  }, [spellcheckEnabled, workspace]);

  useEffect(() => {
    localStorage.setItem(spellcheckKey, String(spellcheckEnabled));
    if (!isTauri()) return;
    void readAppPreferences()
      .then((preferences) => writeAppPreferences({
        ...preferences,
        spellcheckEnabled,
      }))
      .catch((error) => {
        console.warn("write_app_preferences failed", error);
      });
  }, [spellcheckEnabled]);

  useEffect(() => {
    if (workspace || !isTauri()) return;
    let disposed = false;
    void readAppPreferences()
      .then((preferences) => {
        if (!disposed && typeof preferences.spellcheckEnabled === "boolean") {
          setSpellcheckEnabled(preferences.spellcheckEnabled);
          localStorage.setItem(spellcheckKey, String(preferences.spellcheckEnabled));
        }
        const lastWorkspace = preferences.lastWorkspace;
        if (disposed || !lastWorkspace) return;
        localStorage.setItem(workspaceKey, lastWorkspace);
        setWorkspace(lastWorkspace);
      })
      .catch((error) => {
        console.warn("read_app_preferences failed", error);
      });
    return () => {
      disposed = true;
    };
  }, [workspace]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    void readAppPreferences()
      .then((preferences) => {
        if (disposed || typeof preferences.spellcheckEnabled !== "boolean") return;
        setSpellcheckEnabled(preferences.spellcheckEnabled);
        localStorage.setItem(spellcheckKey, String(preferences.spellcheckEnabled));
      })
      .catch((error) => {
        console.warn("read_app_preferences failed", error);
      });
    return () => {
      disposed = true;
    };
  }, []);

  // Keep a per-workspace "last opened note" in localStorage so the location can
  // be restored even if the notebook's metadata.json is reset (e.g. by cloud sync).
  useEffect(() => {
    if (activePath && workspace) {
      localStorage.setItem(lastPathKey, JSON.stringify({ workspace, path: activePath }));
    }
  }, [activePath, workspace]);

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
    const root = document.documentElement.style;
    root.setProperty("--app-font-family", appFontFamily || defaultAppFontFamily);
    root.setProperty("--app-font-size", `${appFontSize || defaultAppFontSize}px`);
    root.setProperty("--editor-font-family", editorFontFamily || defaultEditorFontFamily);
    root.setProperty("--editor-font-size", `${editorFontSize || defaultEditorFontSize}px`);
  }, [appFontFamily, appFontSize, editorFontFamily, editorFontSize]);

  useEffect(() => {
    document.documentElement.dataset.accentTitlebar = accentTitlebar ? "true" : "false";
    document.documentElement.style.setProperty("--titlebar-bg", effectiveTitlebarColor);
    document.documentElement.style.setProperty("--titlebar-contrast", readableTextColor(effectiveTitlebarColor));
    localStorage.setItem(accentTitlebarKey, String(accentTitlebar));
  }, [accentTitlebar, effectiveTitlebarColor]);

  useEffect(() => {
    const rgb = hexToRgb(effectiveAccentColor);
    document.documentElement.style.setProperty("--accent", effectiveAccentColor);
    document.documentElement.style.setProperty("--accent-strong", resolvedTheme === "dark" ? "#ecf4f1" : "#192d2b");
    document.documentElement.style.setProperty("--accent-contrast", readableTextColor(effectiveAccentColor));
    document.documentElement.style.setProperty("--accent-soft", rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${resolvedTheme === "dark" ? 0.32 : 0.26})` : "rgba(75, 125, 117, 0.26)");
    document.documentElement.style.setProperty("--accent-active", rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${resolvedTheme === "dark" ? 0.48 : 0.36})` : "rgba(75, 125, 117, 0.36)");
    document.documentElement.style.setProperty("--accent-muted", rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${resolvedTheme === "dark" ? 0.22 : 0.18})` : "rgba(75, 125, 117, 0.18)");
    if (accentColor) localStorage.setItem(accentKey, accentColor);
    else localStorage.removeItem(accentKey);
  }, [accentColor, effectiveAccentColor, resolvedTheme]);

  // Persist appearance to notebook metadata when settings change (after metadata loads)
  const appearanceSavedRef = useRef<WorkspaceMetadata["appearance"]>(undefined);
  useEffect(() => {
    if (!metadataLoaded || !workspace) return;
    const next: NonNullable<WorkspaceMetadata["appearance"]> = {
      colorScheme,
      themePresetId: themePreset.id,
      colors: themeColors,
      accentTitlebar,
      navigationStyle,
      appFontFamily,
      appFontSize,
      editorFontFamily,
      editorFontSize,
    };
    // Skip if unchanged
    const prev = appearanceSavedRef.current;
    if (
      prev &&
      prev.colorScheme === next.colorScheme &&
      prev.themePresetId === next.themePresetId &&
      appearanceColorsMatch(prev.colors, next.colors) &&
      prev.accentTitlebar === next.accentTitlebar &&
      prev.navigationStyle === next.navigationStyle &&
      prev.appFontFamily === next.appFontFamily &&
      prev.appFontSize === next.appFontSize &&
      prev.editorFontFamily === next.editorFontFamily &&
      prev.editorFontSize === next.editorFontSize
    ) return;
    appearanceSavedRef.current = next;
    saveAppearancePatch(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorScheme, themePreset.id, themeColors, accentTitlebar, navigationStyle, appFontFamily, appFontSize, editorFontFamily, editorFontSize, metadataLoaded, workspace]);

  useEffect(() => {
    localStorage.setItem(widthModeKey, editorWidthMode);
  }, [editorWidthMode]);

  useEffect(() => {
    localStorage.setItem(alignmentKey, noteAlignment);
  }, [noteAlignment]);

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
    let unlistenOpen: (() => void) | undefined;
    let unlistenManage: (() => void) | undefined;
    const currentWindow = getCurrentWindow();
    void currentWindow.listen("open-notebook", () => {
      chooseWorkspaceRef.current("open");
    }).then((callback) => {
      unlistenOpen = callback;
    });
    void currentWindow.listen("manage-notebooks", () => {
      setNotebooksManageOpen(true);
    }).then((callback) => {
      unlistenManage = callback;
    });
    return () => {
      unlistenOpen?.();
      unlistenManage?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const openNotebook = (event: Event) => {
      const path = (event as CustomEvent<unknown>).detail;
      if (typeof path === "string" && path) switchNotebook(path);
    };
    const manageNotebooks = () => setNotebooksManageOpen(true);
    window.addEventListener("tigrana-open-notebook", openNotebook);
    window.addEventListener("tigrana-manage-notebooks", manageNotebooks);
    return () => {
      window.removeEventListener("tigrana-open-notebook", openNotebook);
      window.removeEventListener("tigrana-manage-notebooks", manageNotebooks);
    };
  });

  const refreshTrash = useCallback(async () => {
    if (!workspace) {
      setTrashEntries([]);
      return;
    }
    setTrashLoading(true);
    try {
      const entries = await listTrash(workspace);
      setTrashEntries(entries.sort((a, b) => b.deletedAt - a.deletedAt));
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    } finally {
      setTrashLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    if (!isTauri()) return;
    const handleCommand = (event: Event) => {
      const command = (event as CustomEvent<unknown>).detail;
      if (typeof command === "string") void handleMenuCommand(command);
    };
    window.addEventListener("tigrana-menu-command", handleCommand);
    return () => window.removeEventListener("tigrana-menu-command", handleCommand);
  });

  useEffect(() => {
    if (!isTauri()) return;
    const label = getCurrentWindow().label;
    const state: AppMenuState = {
      hasWorkspace: Boolean(workspace),
      hasOpenNote,
      activeNoteEditable,
      hasUnsavedChanges,
      rawMarkdownVisible: rawMarkdownVisible || Boolean(frontmatterError),
      leftVisible,
      outlineVisible,
      spellcheckEnabled,
      editorWidthMode,
      noteAlignment,
    };
    const handle = window.setTimeout(() => {
      void updateAppMenuState(label, state).catch((error) => {
        console.warn("update_app_menu_state failed", error);
      });
    }, 50);
    return () => window.clearTimeout(handle);
  }, [
    activeNoteEditable,
    editorWidthMode,
    frontmatterError,
    hasOpenNote,
    hasUnsavedChanges,
    leftVisible,
    noteAlignment,
    outlineVisible,
    rawMarkdownVisible,
    spellcheckEnabled,
    workspace,
  ]);

  useEffect(() => {
    if (!workspace) return;
    void cleanupTrash(workspace).catch(() => {});
  }, [workspace]);

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
    let disposed = false;
    void readWorkspaceMetadata(workspace)
      .then(async (nextMetadata) => {
        const ensured = await ensureWelcomeNote(workspace, nextMetadata);
        if (disposed) return;
        metadataRef.current = ensured.metadata;
        setMetadata(ensured.metadata);
        if (ensured.created) void refreshWorkspace(workspace);
        const a = ensured.metadata.appearance;
        if (a) {
          if (a.colorScheme) setColorScheme(a.colorScheme);
          if (a.themePresetId && themePresets.some((p) => p.id === a.themePresetId)) setThemePresetId(a.themePresetId as ThemePresetId);
          setThemeColors(readAppearanceThemeColors(a));
          if (typeof a.accentTitlebar === "boolean") setAccentTitlebar(a.accentTitlebar);
          if (a.navigationStyle) setNavigationStyle(a.navigationStyle === ("onenote" as NavigationStyle) ? "section-view" : a.navigationStyle);
          setAppFontFamily(a.appFontFamily || defaultAppFontFamily);
          setAppFontSize(readAppearanceFontSize(a.appFontSize, defaultAppFontSize));
          setEditorFontFamily(a.editorFontFamily || defaultEditorFontFamily);
          setEditorFontSize(readAppearanceFontSize(a.editorFontSize, defaultEditorFontSize));
        } else {
          setColorScheme(readStoredColorScheme());
          setThemePresetId(readStoredThemePreset());
          setThemeColors(readStoredNotebookThemeColors());
          setAccentTitlebar(localStorage.getItem(accentTitlebarKey) === "true");
          setNavigationStyle("section-view");
          setAppFontFamily(defaultAppFontFamily);
          setAppFontSize(defaultAppFontSize);
          setEditorFontFamily(defaultEditorFontFamily);
          setEditorFontSize(defaultEditorFontSize);
        }
      })
      .catch((error) => {
        if (disposed) return;
        setAppError(error instanceof Error ? error.message : String(error));
        const fallback = defaultWorkspaceMetadata();
        metadataRef.current = fallback;
        setMetadata(fallback);
      })
      .finally(() => {
        if (!disposed) setMetadataLoaded(true);
      });
    return () => {
      disposed = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  useEffect(() => {
    if (!workspace || !isTauri()) return;
    const label = getCurrentWindow().label;
    void registerNotebookWindow(label, workspace).catch((error) => {
      console.warn("register_notebook_window failed", error);
    });
    return () => {
      void unregisterNotebookWindow(label).catch(() => {});
    };
  }, [workspace]);

  // Place the hidden native window before first show so restore does not visibly
  // jump from the config default to the user's last screen position.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const win = getCurrentWindow();

    const restoreWindowGeometry = async () => {
      try {
        const savedSize = readStoredWindowSize();
        if (savedSize) {
          const clampedW = Math.max(600, Math.min(Math.round(savedSize.width), window.screen.availWidth - 40));
          const clampedH = Math.max(400, Math.min(Math.round(savedSize.height), window.screen.availHeight - 60));
          await win.setSize(new LogicalSize(clampedW, clampedH));
        }

        const savedPosition = readStoredWindowPosition();
        const monitors = await availableMonitors();
        if (savedPosition && monitors.length) {
          let outerSize = await win.outerSize();
          const fitted = fitWindowToMonitors(savedPosition, outerSize, monitors);
          if (fitted.size.width !== outerSize.width || fitted.size.height !== outerSize.height) {
            await win.setSize(fitted.size);
            outerSize = await win.outerSize();
          }
          const finalPosition = fitWindowToMonitors(savedPosition, outerSize, monitors).position;
          await win.setPosition(finalPosition);
        }
      } catch (error) {
        console.warn("Failed to restore window geometry", error);
      } finally {
        if (!disposed) {
          await win.show().catch((error) => console.warn("Failed to show app window", error));
        }
      }
    };

    void restoreWindowGeometry();
    return () => {
      disposed = true;
    };
  }, []);

  // Persist window geometry to localStorage as the user resizes or moves it. localStorage is
  // synchronous, so the latest value is on disk immediately — no flush needed
  // on close, and no race with concurrent workspace-metadata writes.
  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    let unlistenMoved: (() => void) | undefined;
    const handleResize = () => {
      if (windowResizeTimerRef.current) window.clearTimeout(windowResizeTimerRef.current);
      windowResizeTimerRef.current = window.setTimeout(() => {
        writeStoredWindowSize({ width: window.innerWidth, height: window.innerHeight });
      }, 200);
    };
    void win.onMoved(({ payload }) => writeStoredWindowPosition(payload)).then((unlisten) => {
      unlistenMoved = unlisten;
    });
    window.addEventListener("resize", handleResize);
    return () => {
      unlistenMoved?.();
      window.removeEventListener("resize", handleResize);
      if (windowResizeTimerRef.current) {
        window.clearTimeout(windowResizeTimerRef.current);
        // Flush the final size immediately on unmount.
        writeStoredWindowSize({ width: window.innerWidth, height: window.innerHeight });
      }
    };
  }, []);

  useEffect(() => { openTabsRef.current = openTabs; }, [openTabs]);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);
  useLayoutEffect(() => {
    const previousWorkspace = workspaceRef.current;
    if (previousWorkspace && previousWorkspace !== workspace) {
      if (positionWriteTimerRef.current !== null) {
        window.clearTimeout(positionWriteTimerRef.current);
        positionWriteTimerRef.current = null;
      }
      void notebookMetadataPersistence.flush(previousWorkspace).catch((error) => {
        setAppError(error instanceof Error ? error.message : String(error));
      });
    }
    workspaceRef.current = workspace;
    activeNoteLifecycle.resetWorkspace();
  }, [activeNoteLifecycle, workspace]);
  useEffect(() => {
    chooseWorkspaceRef.current = (intent, openInNewWindow) => void chooseWorkspace(intent, openInNewWindow);
  });

  // Window size and session tabs live in localStorage (sync writes), so the
  // only debounced write left is recordNotePosition. Flush it on close so the
  // last scroll/selection position survives a quick quit.
  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void win
      .onCloseRequested(async (event) => {
        const workspacePath = workspaceRef.current;
        event.preventDefault();
        const flushMetadata = async () => {
          if (!workspacePath) return;
          if (positionWriteTimerRef.current !== null) {
            window.clearTimeout(positionWriteTimerRef.current);
            positionWriteTimerRef.current = null;
          }
          await notebookMetadataPersistence.flush(workspacePath);
        };
        await Promise.allSettled([
          flushPendingSavesRef.current(),
          flushMetadata(),
        ]);
        if (!disposed) void win.destroy();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [acceptPersistedMetadata]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      // Don't dismiss when clicking inside a context menu, app menu, or any
      // dialog — those popovers handle their own lifecycle.
      if (target?.closest(".context-menu, .app-menu, .note-view-menu, .dialog, .dialog-backdrop")) return;
      setAppMenuOpen(false);
      setWidthMenuOpen(false);
      setContextMenu(null);
      setTabContextMenu(null);
    };
    // Capture phase so descendants that call stopPropagation (e.g. section
    // rows) still trigger menu dismissal.
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  const refreshWorkspace = useCallback(async (nextWorkspace = workspace) => {
    if (!nextWorkspace) {
      pendingNoteContentsRef.current.clear();
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

    const nextIndex = await readLinkIndex(nextWorkspace);
    setLinkIndex(nextIndex);
  }, [workspace]);

  useEffect(() => {
    pendingNoteContentsRef.current.clear();
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
    const updater = (value: WorkspaceMetadata): WorkspaceMetadata => ({
      ...value,
      notePositions: {
        ...value.notePositions,
        [path]: nextPosition,
      },
    });

    metadataRef.current = updater(current);
    void notebookMetadataPersistence.mutate(
      workspace,
      updater,
      metadataRef.current,
      acceptPersistedMetadata,
      { defer: true, coalesceKey: `note-position:${path}` },
    ).catch((error) => {
      setAppError(error instanceof Error ? error.message : String(error));
    });
    if (positionWriteTimerRef.current) window.clearTimeout(positionWriteTimerRef.current);
    positionWriteTimerRef.current = window.setTimeout(() => {
      positionWriteTimerRef.current = null;
      void notebookMetadataPersistence.flush(workspace).catch((error) => {
        setAppError(error instanceof Error ? error.message : String(error));
      });
    }, 300);
  }, [acceptPersistedMetadata, workspace]);

  const releaseActiveNoteLock = useCallback(async () => {
    await activeNoteLifecycle.releaseLock();
  }, [activeNoteLifecycle]);

  const acquireActiveNoteLock = useCallback(async (path: string): Promise<ActiveNoteAccess> => {
    return activeNoteLifecycle.acquireLock(path);
  }, [activeNoteLifecycle]);

  const applyNoteAccess = useCallback((access: ActiveNoteAccess) => {
    setActiveNoteAccess(access);
    setNoteLockMessage(access === "readOnlyLocked" ? "Read-only: this note is open for editing in another Tigrana window." : null);
  }, []);

  const beginNoteLoad = useCallback(() => {
    return activeNoteLifecycle.beginLoad();
  }, [activeNoteLifecycle]);

  const isCurrentNoteLoad = useCallback((token: number) => activeNoteLifecycle.isCurrentLoad(token), [activeNoteLifecycle]);

  const cancelPendingNoteLoads = useCallback(() => {
    activeNoteLifecycle.cancelLoads();
  }, [activeNoteLifecycle]);

  const disarmUndoableNewNote = useCallback((path?: string | null) => {
    if (!path || undoableNewNoteRef.current?.path === path) {
      undoableNewNoteRef.current = null;
    }
  }, []);

  const finishNoteLoad = useCallback((token: number) => {
    activeNoteLifecycle.finishLoad(token);
  }, [activeNoteLifecycle]);

  const enqueueNoteSave = useCallback((path: string, work: () => Promise<void>) => {
    return activeNoteLifecycle.enqueueSave(path, work);
  }, [activeNoteLifecycle]);

  const waitForPendingNoteSaves = useCallback(async () => {
    await activeNoteLifecycle.waitForPendingSaves();
  }, [activeNoteLifecycle]);

  const loadExistingNoteIntoEditor = useCallback(async (path: string, options: { preserveSelectedFolder?: boolean } = {}) => {
    const token = beginNoteLoad();
    try {
      const content = pendingNoteContentsRef.current.read(path, contents.get(path) ?? (await readNote(workspace, path)));
      if (!isCurrentNoteLoad(token)) return { access: "editable" as ActiveNoteAccess, content, note: null };
      const note = notes.find((entry) => entry.path === path);
      const restorePosition = getRestorableNotePosition(metadataRef.current, path, content);
      const access = await acquireActiveNoteLock(path);
      if (!isCurrentNoteLoad(token)) {
        if (access === "editable") await releaseActiveNoteLock();
        return { access, content, note };
      }
      activeNoteLifecycle.acceptDiskContent(path, content);
      disarmUndoableNewNote(path);
      setActivePath(path);
      setPendingNote(null);
      if (note && !options.preserveSelectedFolder) {
        setSelectedFolder(navigationStyle === "section-view" ? getTopLevelFolderPath(note.parent_path) : note.parent_path);
      }
      loadContentIntoEditor(note ?? null, content, restorePosition);
      applyNoteAccess(access);
      recordNotePosition(path, content, { lastOpenedAt: Date.now() });
      return { access, content, note };
    } finally {
      finishNoteLoad(token);
    }
  }, [acquireActiveNoteLock, activeNoteLifecycle, applyNoteAccess, beginNoteLoad, contents, disarmUndoableNewNote, finishNoteLoad, isCurrentNoteLoad, navigationStyle, notes, recordNotePosition, releaseActiveNoteLock, workspace]);

  useEffect(() => {
    return () => {
      void releaseActiveNoteLock();
    };
  }, [releaseActiveNoteLock]);

  const clearCurrentNote = useCallback(() => {
    cancelPendingNoteLoads();
    disarmUndoableNewNote(activePath);
    void releaseActiveNoteLock();
    applyNoteAccess("editable");
    setActivePath(null);
    setPendingNote(null);
    setEditorRestorePosition(null);
    setTitleDraft("");
    setSavedTitle("");
    setDraft("");
    setFrontmatterDraft("");
    setRawMarkdownText("");
    setSavedRawMarkdownText("");
    setFrontmatterError(null);
    selectedEditorTextRef.current = "";
    setSelectedEditorText("");
  }, [activePath, applyNoteAccess, cancelPendingNoteLoads, disarmUndoableNewNote, releaseActiveNoteLock]);

  useEffect(() => {
    if (!workspace) return;
    if (!metadataLoaded) return;
    if (autoSelectedWorkspaceRef.current === workspace) return;
    if (initialOpenTargetRef.current) return;
    const storedSession = readStoredSession(workspace);
    if (storedSession.openTabs.some((path) => notes.some((note) => note.path === path))) return;
    if (activePath || pendingNote) return;
    if (!notes.length) return;
    // Prefer the last note opened in this workspace (localStorage) over the first note in the list.
    const storedLast = readStoredLastPath(workspace);
    const targetNote = (storedLast ? notes.find((n) => n.path === storedLast) : null) ?? notes[0];
    if (!contents.has(targetNote.path)) return;
    autoSelectedWorkspaceRef.current = workspace;
    const tabId = createTabId();
    setSelectedFolder(targetNote.parent_path);
    setOpenTabs([{ id: tabId, path: targetNote.path }]);
    setActiveTabId(tabId);
    void loadExistingNoteIntoEditor(targetNote.path, { preserveSelectedFolder: true });
  }, [activePath, contents, loadExistingNoteIntoEditor, metadataLoaded, notes, pendingNote, workspace]);

  useEffect(() => {
    const target = initialOpenTargetRef.current;
    if (!workspace || !metadataLoaded || !target || !notes.length) return;
    if (target.kind === "folder") {
      setSelectedFolder(target.path);
      clearCurrentNote();
      initialOpenTargetRef.current = null;
      // Mark tabs/auto-select restored so they don't repopulate the previous window's note.
      restoredTabsWorkspaceRef.current = workspace;
      autoSelectedWorkspaceRef.current = workspace;
      return;
    }
    const note = notes.find((entry) => entry.path === target.path);
    const content = contents.get(target.path);
    if (note && content === undefined) return;
    if (note && content !== undefined) {
      initialOpenTargetRef.current = null;
      // Mark tabs/auto-select restored so the restore-tabs effect doesn't run
      // afterward and overwrite this tab with the previous window's session.
      restoredTabsWorkspaceRef.current = workspace;
      autoSelectedWorkspaceRef.current = workspace;
      const tabId = createTabId();
      setOpenTabs([{ id: tabId, path: target.path }]);
      setActiveTabId(tabId);
      void loadExistingNoteIntoEditor(target.path);
      return;
    }
    initialOpenTargetRef.current = null;
  }, [clearCurrentNote, contents, loadExistingNoteIntoEditor, metadataLoaded, notes, workspace]);

  useEffect(() => {
    if (!workspace || !metadataLoaded || initialOpenTargetRef.current) return;
    if (restoredTabsWorkspaceRef.current === workspace) return;
    const storedSession = readStoredSession(workspace);
    const existingPaths = storedSession.openTabs.filter((path) => notes.some((note) => note.path === path));
    if (!existingPaths.length) return;

    const tabs = existingPaths.map((path) => ({ id: createTabId(), path }));
    const activeSessionPath = storedSession.activeTab && existingPaths.includes(storedSession.activeTab)
      ? storedSession.activeTab
      : existingPaths[0];
    const activeTab = tabs.find((tab) => tab.path === activeSessionPath) ?? tabs[0];
    if (!contents.has(activeTab.path)) return;
    // Mark restored only after we commit the new state — otherwise an early
    // bail (e.g. contents not loaded yet) would block re-entry on the next
    // run and the persist-tabs effect would then overwrite localStorage with
    // an empty session.
    restoredTabsWorkspaceRef.current = workspace;
    setOpenTabs(tabs);
    setActiveTabId(activeTab.id);
    void loadExistingNoteIntoEditor(activeTab.path);
  }, [contents, loadExistingNoteIntoEditor, metadataLoaded, notes, workspace]);

  useEffect(() => {
    if (!workspace || !metadataLoaded) return;
    if (initialOpenTargetRef.current) return;
    // Don't overwrite a stored session with an empty React state before the
    // restore-tabs effect has had a chance to hydrate from localStorage.
    if (restoredTabsWorkspaceRef.current !== workspace && openTabs.length === 0) {
      if (readStoredSession(workspace).openTabs.length > 0) return;
    }

    const sessionOpenTabs = openTabs.map((tab) => tab.path).filter((path): path is string => Boolean(path));
    const activeTab = openTabs.find((tab) => tab.id === activeTabId);
    const sessionActiveTab = activeTab?.path && sessionOpenTabs.includes(activeTab.path)
      ? activeTab.path
      : sessionOpenTabs.at(-1) ?? null;
    writeStoredSession(workspace, { openTabs: sessionOpenTabs, activeTab: sessionActiveTab });
  }, [activeTabId, metadataLoaded, openTabs, workspace]);

  const updateMetadata = useCallback((
    updater: (current: WorkspaceMetadata) => WorkspaceMetadata,
    options: { persist?: boolean } = {},
  ) => {
    const next = updater(metadataRef.current);
    metadataRef.current = next;
    setMetadata(next);
    if (workspace && options.persist !== false) {
      void notebookMetadataPersistence
        .mutate(workspace, updater, metadataRef.current, acceptPersistedMetadata)
        .catch((error) => {
          setAppError(error instanceof Error ? error.message : String(error));
        });
    }
  }, [acceptPersistedMetadata, workspace]);

  const notebookPathMutations = useMemo(() => createNotebookPathMutations({
    activePath,
    activeNoteLockRef,
    folders,
    getMetadata: () => metadataRef.current,
    navigationStyle,
    notes,
    refreshWorkspace,
    selectedFolder,
    setActivePath,
    setOpenTabs,
    setSelectedFolder,
    updateMetadata,
    workspace,
    rebasePendingMetadata: (forward, reverse) => {
      notebookMetadataPersistence.rebasePending(workspace, forward, reverse, metadataRef.current);
    },
    runDurableMutation: (operation) => notebookMetadataPersistence.runExclusive(workspace, operation),
  }), [activeNoteLockRef, activePath, folders, navigationStyle, notes, refreshWorkspace, selectedFolder, updateMetadata, workspace]);

  const setFolderExpanded = useCallback((path: string, expanded: boolean) => {
    updateMetadata((current) => ({
      ...current,
      expandedFolders: {
        ...current.expandedFolders,
        [path]: expanded,
      },
    }));
  }, [updateMetadata]);

  const saveAppearancePatch = useCallback((patch: Partial<NonNullable<WorkspaceMetadata["appearance"]>>) => {
    updateMetadata((current) => ({
      ...current,
      appearance: { ...current.appearance, ...patch },
    }));
  }, [updateMetadata]);

  function updateThemeColor(mode: "light" | "dark", patch: Partial<NotebookThemeColors>) {
    setThemeColors((current) => ({
      ...current,
      [mode]: { ...current[mode], ...patch },
    }));
  }

  function requestEditorCommand(command: EditorCommand, payload: Partial<EditorCommandRequest> = {}) {
    setEditorCommandRequest({ id: Date.now() + Math.random(), command, ...payload });
  }

  function insertEditorImage(src: string, alt = "Image") {
    setEditorCommandRequest({ id: Date.now() + Math.random(), command: "image", src, alt });
  }

  function insertEditorText(text: string) {
    const selection = dictationRichSelectionRef.current;
    requestEditorCommand("insertText", {
      src: text,
      selectionFrom: selection?.from,
      selectionTo: selection?.to,
    });
    if (selection) {
      const next = selection.from + text.length;
      dictationRichSelectionRef.current = { from: next, to: next };
      editorSelectionRef.current = { from: next, to: next };
    }
  }

  async function exportCurrentNote(format: "markdown" | "html") {
    if (!noteOpen) return;
    try {
      const markdown = (await persistDraft()) ?? currentMarkdownSnapshot();
      const stem = noteExportFileStem(titleDraft);
      if (format === "markdown") {
        await exportTextFile(`${stem}.md`, markdown, [{ name: "Markdown", extensions: ["md"] }]);
        return;
      }
      const html = await buildNoteExportHtml(titleDraft, readNoteDocument(markdown, titleDraft).body, {
        resolveImageSrc: async (src) => {
          if (!workspace) return src;
          if (/^(https?:|data:|blob:)/i.test(src)) return src;
          return readAssetDataUrl(workspace, src);
        },
      });
      await exportTextFile(`${stem}.html`, html, [{ name: "HTML", extensions: ["html", "htm"] }]);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  async function printCurrentNote() {
    if (!noteOpen) return;
    try {
      const markdown = (await persistDraft()) ?? currentMarkdownSnapshot();
      const html = await buildNoteExportHtml(titleDraft, readNoteDocument(markdown, titleDraft).body, {
        resolveImageSrc: async (src) => {
          if (!workspace) return src;
          if (/^(https?:|data:|blob:)/i.test(src)) return src;
          return readAssetDataUrl(workspace, src);
        },
      });
      const printWindow = window.open("", "_blank", "noopener,noreferrer,width=820,height=920");
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.setTimeout(() => printWindow.print(), 100);
      } else {
        await printCurrentWebview();
      }
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleMenuCommand(command: string) {
    switch (command) {
      case "open_settings":
        setSettingsOpen(true);
        break;
      case "open_recently_deleted":
        setRecentlyDeletedOpen(true);
        void refreshTrash();
        break;
      case "new_notebook":
        await chooseWorkspace("new", true);
        break;
      case "new_note":
        await requestCreateNote(selectedFolder);
        break;
      case "new_folder":
        requestCreateFolder(selectedFolder);
        break;
      case "new_tab":
        await addEmptyTab();
        break;
      case "save_note":
        await persistDraft();
        break;
      case "export_markdown":
        await exportCurrentNote("markdown");
        break;
      case "export_html":
        await exportCurrentNote("html");
        break;
      case "print_note":
        await printCurrentNote();
        break;
      case "find_note":
        if (rawMarkdownVisible || frontmatterError) setRawFindOpen((value) => !value);
        else setNoteFindRequest((value) => value + 1);
        break;
      case "find_next":
        if (rawMarkdownVisible || frontmatterError) selectRawFindMatch(1);
        else requestEditorCommand("findNext");
        break;
      case "find_previous":
        if (rawMarkdownVisible || frontmatterError) selectRawFindMatch(-1);
        else requestEditorCommand("findPrevious");
        break;
      case "replace_note":
        if (rawMarkdownVisible || frontmatterError) {
          setRawFindOpen(true);
          setRawReplaceOpen(true);
        } else {
          requestEditorCommand("replace");
        }
        break;
      case "start_dictation":
        if (rawMarkdownVisible || frontmatterError) {
          rawMarkdownInputRef.current?.focus();
          setDictationTarget("raw");
        } else {
          dictationRichSelectionRef.current = editorSelectionRef.current
            ? { ...editorSelectionRef.current }
            : null;
          setEditorFocusRequest((value) => value + 1);
          setDictationTarget("rich");
        }
        break;
      case "search_notebook":
        setLeftVisible(true);
        setSearchOpen(true);
        setSearchFocusRequest((value) => value + 1);
        break;
      case "toggle_spellcheck":
        setSpellcheckEnabled((value) => !value);
        break;
      case "toggle_sidebar":
        setLeftVisible((value) => !value);
        break;
      case "toggle_outline":
        setOutlineVisible((value) => !value);
        break;
      case "toggle_raw_markdown":
        toggleRawMarkdownMode();
        break;
      case "width_comfortable":
        setEditorWidthMode("comfortable");
        break;
      case "width_narrow":
        setEditorWidthMode("narrow");
        break;
      case "width_full":
        setEditorWidthMode("full");
        break;
      case "align_left":
        setNoteAlignment("left");
        break;
      case "align_center":
        setNoteAlignment("center");
        break;
      case "format_image":
        void requestImage().then((pick) => {
          if (pick) insertEditorImage(pick.src, pick.alt);
        });
        break;
      default:
        if (command.startsWith("format_")) {
          const editorCommand = menuFormatCommandToEditorCommand(command);
          if (editorCommand) requestEditorCommand(editorCommand);
        }
        break;
    }
  }

  function selectRawFindMatch(direction: 1 | -1) {
    const input = rawMarkdownInputRef.current;
    if (!input || !rawFindQuery) return;
    const haystack = rawMarkdownDraft.toLowerCase();
    const needle = rawFindQuery.toLowerCase();
    const start = direction > 0 ? input.selectionEnd : Math.max(0, input.selectionStart - 1);
    let index = direction > 0
      ? haystack.indexOf(needle, start)
      : haystack.lastIndexOf(needle, start);
    if (index === -1) {
      index = direction > 0 ? haystack.indexOf(needle) : haystack.lastIndexOf(needle);
    }
    if (index === -1) return;
    input.focus();
    input.setSelectionRange(index, index + rawFindQuery.length);
  }

  function replaceRawCurrent() {
    const input = rawMarkdownInputRef.current;
    if (!input || !activeNoteEditable || !rawFindQuery) return;
    const selected = rawMarkdownDraft.slice(input.selectionStart, input.selectionEnd);
    if (selected.toLowerCase() !== rawFindQuery.toLowerCase()) {
      selectRawFindMatch(1);
      return;
    }
    const next = `${rawMarkdownDraft.slice(0, input.selectionStart)}${rawReplaceText}${rawMarkdownDraft.slice(input.selectionEnd)}`;
    const nextSelection = input.selectionStart + rawReplaceText.length;
    handleRawMarkdownChange(next);
    requestAnimationFrame(() => {
      rawMarkdownInputRef.current?.focus();
      rawMarkdownInputRef.current?.setSelectionRange(nextSelection, nextSelection);
    });
  }

  function replaceRawAll() {
    if (!activeNoteEditable || !rawFindQuery) return;
    const escaped = rawFindQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    handleRawMarkdownChange(rawMarkdownDraft.replace(new RegExp(escaped, "gi"), rawReplaceText));
  }

  function insertRawDictationText(text: string) {
    if (!activeNoteEditable) return;
    const input = rawMarkdownInputRef.current;
    const selection = rawMarkdownSelectionRef.current;
    const start = input?.selectionStart ?? selection?.start ?? rawMarkdownDraft.length;
    const end = input?.selectionEnd ?? selection?.end ?? start;
    const next = `${rawMarkdownDraft.slice(0, start)}${text}${rawMarkdownDraft.slice(end)}`;
    const nextSelection = start + text.length;
    rawMarkdownSelectionRef.current = {
      start: nextSelection,
      end: nextSelection,
      direction: "none",
      scrollTop: input?.scrollTop ?? selection?.scrollTop ?? 0,
      scrollLeft: input?.scrollLeft ?? selection?.scrollLeft ?? 0,
    };
    handleRawMarkdownChange(next);
  }

  dictationInsertHandlerRef.current = (text: string) => {
    if (!activeNoteEditable) return;
    const insertion = formatDictationInsertion(text);
    if (!insertion) return;
    if (dictationTargetRef.current === "raw") {
      insertRawDictationText(insertion);
      return;
    }
    insertEditorText(insertion);
  };

  const handleDictationInsert = useCallback((text: string) => {
    dictationInsertHandlerRef.current(text);
  }, []);

  useEffect(() => {
    return () => {
      if (positionWriteTimerRef.current) window.clearTimeout(positionWriteTimerRef.current);
    };
  }, []);

  const flushPendingEditorBody = useCallback(() => {
    const snapshot = pendingEditorChangeRef.current?.flush() ?? null;
    if (!snapshot) return null;
    if (!shouldApplyEditorUpdate(activePath, snapshot.sourceNotePath, activeNoteEditable)) return null;
    return snapshot.markdown;
  }, [activeNoteEditable, activePath]);

  function currentMarkdownSnapshot() {
    const pendingBody = flushPendingEditorBody();
    if (pendingBody === null) return rawMarkdownDraft;
    return createNoteDocument({ title: titleDraft, body: pendingBody, frontmatter: frontmatterDraft }).markdown;
  }

  function toggleRawMarkdownMode() {
    if (frontmatterError && rawMarkdownVisible) {
      setAppError(frontmatterError);
      return;
    }
    if (!rawMarkdownVisible) {
      const pendingBody = flushPendingEditorBody();
      const markdown = pendingBody === null
        ? noteDocument.markdown
        : createNoteDocument({ title: titleDraft, body: pendingBody, frontmatter: frontmatterDraft }).markdown;
      setRawMarkdownText(markdown);
    }
    setRawMarkdownVisible((value) => !value);
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
    const scrollTop = noteSurfaceRef.current?.scrollTop ?? 0;
    if (metadataRef.current.notePositions[activePath]?.scrollTop === scrollTop) return;
    recordNotePosition(activePath, rawMarkdownDraft, {
      scrollTop,
    });
  }

  function handleEditorPositionChange(position: { selectedText: string; selectionFrom: number; selectionTo: number }) {
    const previousSelection = editorSelectionRef.current;
    const selectionChanged = previousSelection?.from !== position.selectionFrom || previousSelection.to !== position.selectionTo;
    editorSelectionRef.current = { from: position.selectionFrom, to: position.selectionTo };
    if (selectedEditorTextRef.current !== position.selectedText) {
      selectedEditorTextRef.current = position.selectedText;
      setSelectedEditorText(position.selectedText);
    }
    if (!selectionChanged) return;
    if (!activePath) return;
    recordNotePosition(activePath, rawMarkdownDraft, {
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

  const handleNoteLoadError = useCallback((error: unknown) => {
    const noteTitle =
      titleDraft.trim() ||
      (activePath ? notes.find((note) => note.path === activePath)?.title : null) ||
      activePath ||
      "this note";
    clearCurrentNote();
    setAppError(`Could not open "${noteTitle}". ${formatUnknownError(error)}`);
  }, [activePath, clearCurrentNote, notes, titleDraft]);

  async function retryActiveNoteEditLock() {
    if (!activePath) return;
    const access = await acquireActiveNoteLock(activePath);
    applyNoteAccess(access);
  }

  function canMutateNotePath(path: string) {
    return activePath !== path || activeNoteEditable;
  }

  function showReadOnlyNoteWarning() {
    setNoteLockMessage("Read-only: this note is open for editing in another Tigrana window.");
  }

  function toggleNotePin(path: string) {
    if (!canMutateNotePath(path)) {
      showReadOnlyNoteWarning();
      return;
    }
    const shouldPin = !metadataRef.current.pinnedNotes[path];
    updateMetadata((current) => {
      const pinnedNotes = { ...current.pinnedNotes };
      if (shouldPin) pinnedNotes[path] = true;
      else delete pinnedNotes[path];
      return { ...current, pinnedNotes };
    });
  }

  const disarmPendingTitleFocus = useCallback(() => {
    armedTitleFocusRequestRef.current = 0;
  }, []);

  async function selectNote(path: string, options: { preserveSelectedFolder?: boolean; skipPersist?: boolean } = {}) {
    if (!options.skipPersist && !await persistDraftForNavigation()) return;
    placePathInActiveTab(path);
    await loadExistingNoteIntoEditor(path, options);
    setSearchQuery("");
  }

  function findLastOpenedNoteInSection(sectionPath: string) {
    const sectionNotes = notes.filter((note) =>
      sectionPath
        ? note.parent_path === sectionPath || note.parent_path.startsWith(`${sectionPath}/`)
        : note.parent_path === "",
    );

    return sectionNotes
      .map((note) => ({
        note,
        lastOpenedAt: metadataRef.current.notePositions[note.path]?.lastOpenedAt ?? 0,
      }))
      .filter(({ lastOpenedAt }) => lastOpenedAt > 0)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]?.note ?? null;
  }

  async function selectSection(sectionPath: string) {
    if (!await persistDraftForNavigation()) return;

    setSelectedFolder(sectionPath);
    const lastOpenedNote = findLastOpenedNoteInSection(sectionPath);
    if (lastOpenedNote) {
      await selectNote(lastOpenedNote.path, { preserveSelectedFolder: true, skipPersist: true });
      return;
    }

    clearCurrentNote();
  }

  async function selectFolderForNewNote(folderPath: string) {
    if (!await persistDraftForNavigation()) return;
    setSelectedFolder(folderPath);
    clearCurrentNote();
  }

  async function handleExternalNoteChange(path: string) {
    if (!workspace) return;
    try {
      const nextContent = await readNote(workspace, path);
      const cacheObservedContent = () => {
        startTransition(() => {
          setContents((current) => {
            if (current.get(path) === nextContent) return current;
            const next = new Map(current);
            next.set(path, nextContent);
            return next;
          });
        });
      };

      const nextNormalized = normalizeNoteMarkdown(nextContent);
      const hadPendingEditorChange = activePath === path && Boolean(pendingEditorChangeRef.current);

      // The filesystem watcher fires for Tigrana's own writes too, sometimes
      // after the editor has already moved on. Compare against the latest disk
      // content the app accepted instead of using a fragile time window.
      const diskChange = activeNoteLifecycle.observeDiskContent(
        path,
        nextContent,
        activePath === path ? currentMarkdownSnapshot() : undefined,
      );
      if (diskChange === "acceptedWrite") {
        cacheObservedContent();
        return;
      }

      // For the active note, the editor's snapshot — not the contents cache — is the
      // source of truth. A move that rewrote inbound links on disk also calls
      // refreshWorkspace, which has already updated the contents map; without this
      // check we'd short-circuit and the editor would keep showing the stale link.
      const sameAsEditor = diskChange === "matchesEditor";
      const currentContent = contents.get(path);
      if (activePath !== path && currentContent !== undefined && normalizeNoteMarkdown(currentContent) === nextNormalized) return;
      if (sameAsEditor) {
        cacheObservedContent();
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

      if (hasUnsavedChanges || hadPendingEditorChange || pendingEditorChangeRef.current) {
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
      activeNoteLifecycle.acceptDiskContent(path, nextContent);
      loadContentIntoEditor(note, nextContent, restorePosition);
      // Force the editor to actually reload, since notePath is unchanged.
      setEditorReloadRequest((value) => value + 1);
      recordNotePosition(path, nextContent, restorePosition);
    } catch {
      await refreshWorkspace(workspace);
      if (activePath === path) clearCurrentNote();
    }
  }

  externalNoteChangeRef.current = (path: string) => void handleExternalNoteChange(path);

  const acceptSavedMarkdown = useCallback((savedPath: string, written: string, snapshot: PersistDraftSnapshot) => {
    const savedDocument = readNoteDocument(written, snapshot.title);
    const nextBody = savedDocument.frontmatterError ? snapshot.body : savedDocument.body;
    const nextFrontmatter = savedDocument.frontmatterError ? snapshot.frontmatter : savedDocument.frontmatter;
    const currentDraft = activeDraftStateRef.current;
    const sameDraft =
      currentDraft.draft === snapshot.body &&
      currentDraft.frontmatterDraft === snapshot.frontmatter &&
      (!snapshot.rawMode || currentDraft.rawMarkdownText === snapshot.markdown) &&
      currentDraft.titleDraft.trim() === snapshot.title;
    const sameNote =
      currentDraft.activePath === savedPath ||
      (snapshot.path !== null && currentDraft.activePath === snapshot.path) ||
      (snapshot.pendingNote !== null && currentDraft.activePath === null);

    if (!sameNote) return;
    currentDraft.savedRawMarkdownText = written;
    currentDraft.savedTitle = snapshot.title;
    setSavedRawMarkdownText(written);
    setSavedTitle(snapshot.title);
    if (!sameDraft) return;

    setDraft(nextBody);
    setFrontmatterDraft(nextFrontmatter);
    setRawMarkdownText(written);
    if (!savedDocument.frontmatterError) setFrontmatterError(null);
  }, []);

  const persistDraftAttempt = useCallback(async () => {
    setAppError(null);
    if (!workspace || !noteOpen) return;
    if (activeNoteLifecycle.isLoading) return;
    if (!activeNoteEditable) return;

    const pendingBody = flushPendingEditorBody();
    const body = pendingBody ?? draft;
    const rawMode = rawMarkdownVisible || Boolean(frontmatterError);
    const markdown = rawMode
      ? rawMarkdownDraft
      : createNoteDocument({ title: titleDraft, body, frontmatter: frontmatterDraft }).markdown;
    const currentLifecycleState = activeDraftStateRef.current;
    const bodyHasUnsavedChanges = markdown !== currentLifecycleState.savedRawMarkdownText;

    const title = titleDraft.trim();
    try {
      validateNoteTitle(titleDraft);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
      return;
    }

    const snapshot = {
      workspace,
      path: currentLifecycleState.activePath,
      pendingNote: currentLifecycleState.activePath ? null : currentLifecycleState.pendingNote,
      title,
      savedTitle: currentLifecycleState.savedTitle,
      body,
      frontmatter: frontmatterDraft,
      rawMode,
      markdown,
    };

    const pathWillChange = Boolean(snapshot.pendingNote || (snapshot.path && snapshot.title !== snapshot.savedTitle));

    if (pathWillChange) {
      const savingKey = snapshot.path ?? `pending:${snapshot.pendingNote?.parentPath ?? ""}:${snapshot.title}`;
      await activeNoteLifecycle.runPathChange(savingKey, snapshot.path, async () => {
        let nextPath = snapshot.path;
        if (snapshot.pendingNote) {
          const note = await createNote(snapshot.workspace, snapshot.pendingNote.parentPath, snapshot.title);
          nextPath = note.path;
          // createNote writes initial scaffolding to disk (frontmatter id +
          // blank body) which produces a file-watcher echo. Pre-seed the
          // accepted disk baseline so that echo doesn't fire the "changed on
          // disk" warning before our own saveNote runs.
          try {
            const initial = await readNote(snapshot.workspace, note.path);
            activeNoteLifecycle.acceptDiskContent(note.path, initial);
          } catch {
            // Best-effort; the saveNote below will overwrite the entry anyway.
          }
          activeDraftStateRef.current.activePath = note.path;
          activeDraftStateRef.current.pendingNote = null;
          setNotes((current) => current.some((entry) => entry.path === note.path) ? current : [...current, note]);
          setActivePath(note.path);
          setPendingNote(null);
          const createdAccess = await acquireActiveNoteLock(note.path);
          applyNoteAccess(createdAccess);
          if (createdAccess !== "editable") return;
          setSelectedFolder(navigationStyle === "section-view" ? getTopLevelFolderPath(note.parent_path) : note.parent_path);
          placePathInActiveTab(note.path);
          updateMetadata((current) => addToOrder(current, note.parent_path, note.path));
        } else if (snapshot.path && snapshot.title !== snapshot.savedTitle) {
          const renamed = await notebookPathMutations.renameActiveNote(snapshot.path, snapshot.title);
          nextPath = renamed.path;
          activeDraftStateRef.current.activePath = renamed.path;
        }

        if (!nextPath) return;

        const savedPath = nextPath;
        const written = await saveNote(snapshot.workspace, savedPath, snapshot.markdown);
        if (snapshot.path && snapshot.path !== savedPath) activeNoteLifecycle.forgetDiskContent(snapshot.path);
        activeNoteLifecycle.acceptDiskContent(savedPath, written);
        recordNotePosition(savedPath, written);
        acceptSavedMarkdown(savedPath, written, snapshot);
        setContents((current) => {
          const next = new Map(current);
          if (snapshot.path && snapshot.path !== savedPath) next.delete(snapshot.path);
          next.set(savedPath, written);
          return next;
        });
        await refreshWorkspace(snapshot.workspace);
      });
      return snapshot.markdown;
    }

    if (!snapshot.path || !bodyHasUnsavedChanges) return snapshot.markdown;

    // Keep navigation ahead of disk without publishing a new content Map
    // through the whole React tree when autosave starts.
    pendingNoteContentsRef.current.stage(snapshot.path, snapshot.markdown);

    enqueueNoteSave(snapshot.path, async () => {
      const savedPath = snapshot.path as string;
      const written = await saveNote(snapshot.workspace, savedPath, snapshot.markdown);
      activeNoteLifecycle.acceptDiskContent(savedPath, written);
      recordNotePosition(savedPath, written);
      pendingNoteContentsRef.current.accept(savedPath, snapshot.markdown);
      startTransition(() => {
        acceptSavedMarkdown(savedPath, written, snapshot);
        setContents((current) => {
          if (current.get(savedPath) === written) return current;
          const next = new Map(current);
          next.set(savedPath, written);
          return next;
        });
        setNotes((current) =>
          current.map((note) =>
            note.path === savedPath
              ? { ...note, updated_at: Date.now() / 1000 }
              : note,
          ),
        );
      });
      if (backlinkPaneVisibleRef.current) {
        const nextIndex = await readLinkIndex(snapshot.workspace);
        startTransition(() => setLinkIndex(nextIndex));
      }
    });
    return snapshot.markdown;
  }, [acceptSavedMarkdown, acquireActiveNoteLock, activeNoteEditable, activeNoteLifecycle, applyNoteAccess, draft, enqueueNoteSave, flushPendingEditorBody, frontmatterDraft, frontmatterError, navigationStyle, noteOpen, notebookPathMutations, placePathInActiveTab, rawMarkdownDraft, rawMarkdownVisible, recordNotePosition, refreshWorkspace, titleDraft, updateMetadata, workspace]);

  persistDraftAttemptRef.current = persistDraftAttempt;
  const persistDraft = useCallback(
    () => activeNoteLifecycle.requestPersistence(() => persistDraftAttemptRef.current()),
    [activeNoteLifecycle],
  );
  const persistDraftInBackground = useCallback(() => {
    void persistDraft().catch(() => undefined);
  }, [persistDraft]);

  const commitTitleAndFocusEditor = useCallback(async () => {
    if (!activeNoteEditable) return;
    disarmPendingTitleFocus();
    if ((!hasUnsavedChanges && !pendingEditorChangeRef.current) || !titleDraft.trim()) {
      setEditorFocusRequest((value) => value + 1);
      return;
    }

    try {
      validateNoteTitle(titleDraft);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
      return;
    }

    titleCommitInFlightRef.current = true;
    let clearInFinally = true;
    try {
      await persistDraft();
      requestAnimationFrame(() => {
        setEditorFocusRequest((value) => value + 1);
        window.setTimeout(() => {
          titleCommitInFlightRef.current = false;
        }, 150);
      });
      clearInFinally = false;
    } catch {
      // The lifecycle already surfaced the storage error. Keep focus in the
      // title so the unsaved change remains obvious and retryable.
    } finally {
      if (clearInFinally) titleCommitInFlightRef.current = false;
    }
  }, [activeNoteEditable, disarmPendingTitleFocus, hasUnsavedChanges, persistDraft, titleDraft]);

  async function persistDraftForNavigation() {
    if (!hasUnsavedChanges && !pendingEditorChangeRef.current) return true;
    try {
      await persistDraft();
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    flushPendingSavesRef.current = async () => {
      if (hasUnsavedChanges || pendingEditorChangeRef.current) await persistDraft();
      await activeNoteLifecycle.flushPendingSaves();
    };
  }, [activeNoteLifecycle, hasUnsavedChanges, persistDraft]);

  keyboardActionsRef.current = {
    addEmptyTab: () => void addEmptyTab(),
    chooseWorkspace: (intent: "open" | "new") => void chooseWorkspace(intent),
    hasOpenNote: () => Boolean(noteOpen),
    persistDraft: persistDraftInBackground,
    requestCreateNote,
    selectedFolder,
    toggleRawMarkdown: toggleRawMarkdownMode,
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
        setWidthMenuOpen(false);
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
        actions.toggleRawMarkdown();
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
    if (activeNoteLifecycle.isLoading) return;
    if (!activeNoteEditable) return;
    if (!hasUnsavedBody) return;
    if (pendingNote && !titleDraft.trim()) return;
    const handle = window.setTimeout(() => {
      persistDraftInBackground();
    }, 650);
    return () => window.clearTimeout(handle);
  }, [activeNoteEditable, activeNoteLifecycle, hasUnsavedBody, pendingNote, persistDraftInBackground, titleDraft]);


  async function requestCreateNote(parentPath = selectedFolder) {
    if (!workspace) {
      setAppError("Open a notes folder before creating a note.");
      return;
    }
    try {
      if (!await persistDraftForNavigation()) return;

      cancelPendingNoteLoads();
      await releaseActiveNoteLock();
      applyNoteAccess("editable");
      setSelectedFolder(parentPath);
      setPendingNote(null);
      setEditorRestorePosition(null);
      setAppError(null);

      const usedTitles = new Set(notes.filter((note) => note.parent_path === parentPath).map((note) => note.title));
      let note: NoteEntry | null = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const title = nextUntitledNoteTitle(usedTitles);
        usedTitles.add(title);
        try {
          note = await createNote(workspace, parentPath, title);
          break;
        } catch (error) {
          if (!isDuplicateNoteTitleError(error)) throw error;
        }
      }
      if (!note) throw new Error("Could not create an untitled note.");
      const createdNote = note;

      const content = await readNote(workspace, createdNote.path);
      const access = await acquireActiveNoteLock(createdNote.path);
      activeNoteLifecycle.acceptDiskContent(createdNote.path, content);
      undoableNewNoteRef.current = access === "editable" ? { workspace, path: createdNote.path } : null;
      setNotes((current) => current.some((entry) => entry.path === createdNote.path) ? current : [...current, createdNote]);
      setContents((current) => {
        const next = new Map(current);
        next.set(createdNote.path, content);
        return next;
      });
      setActivePath(createdNote.path);
      loadContentIntoEditor(createdNote, content);
      applyNoteAccess(access);
      recordNotePosition(createdNote.path, content, { lastOpenedAt: Date.now() });
      setSelectedFolder(navigationStyle === "section-view" ? getTopLevelFolderPath(createdNote.parent_path) : createdNote.parent_path);
      placePathInActiveTab(createdNote.path);
      updateMetadata((current) => addToOrder(current, createdNote.parent_path, createdNote.path));
      setTitleFocusRequest((value) => value + 1);
      await refreshWorkspace(workspace);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  useLayoutEffect(() => {
    if (!hasOpenNote || !titleFocusRequest) return;
    if (handledTitleFocusRequestRef.current === titleFocusRequest) return;
    handledTitleFocusRequestRef.current = titleFocusRequest;
    armedTitleFocusRequestRef.current = titleFocusRequest;

    const focusTitle = () => {
      if (armedTitleFocusRequestRef.current !== titleFocusRequest) return;
      const titleInput = titleInputRef.current;
      if (!titleInput) return;
      titleInput.focus({ preventScroll: true });
      titleInput.select();
    };

    focusTitle();
    const frame = requestAnimationFrame(focusTitle);
    const timeout = window.setTimeout(focusTitle, 50);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      if (armedTitleFocusRequestRef.current === titleFocusRequest) {
        armedTitleFocusRequestRef.current = 0;
      }
    };
  }, [hasOpenNote, titleFocusRequest]);

  function canUndoNewNoteCreationFromTitle() {
    const undoable = undoableNewNoteRef.current;
    return Boolean(
      workspace &&
      activePath &&
      undoable?.workspace === workspace &&
      undoable.path === activePath &&
      document.activeElement === titleInputRef.current &&
      !draft.trim(),
    );
  }

  async function undoNewNoteCreationFromTitle() {
    if (!workspace || !activePath || !canUndoNewNoteCreationFromTitle()) return;
    const path = activePath;
    titleEscapeUndoInFlightRef.current = true;
    undoableNewNoteRef.current = null;
    try {
      await releaseActiveNoteLock();
      await deleteNote(workspace, path);
      activeNoteLifecycle.forgetDiskContent(path);
      setNotes((current) => current.filter((note) => note.path !== path));
      setContents((current) => {
        const next = new Map(current);
        next.delete(path);
        return next;
      });
      setOpenTabs((current) => current.filter((tab) => tab.path !== path));
      updateMetadata((current) => removeNoteFromMetadata(current, path));
      clearCurrentNote();
      await refreshWorkspace(workspace);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    } finally {
      window.setTimeout(() => {
        titleEscapeUndoInFlightRef.current = false;
      }, 0);
    }
  }

  useEffect(() => {
    const titleInput = titleInputRef.current;
    if (!titleInput || !noteOpen) return;
    titleInput.style.height = "0px";
    titleInput.style.height = `${titleInput.scrollHeight}px`;
  }, [noteOpen, titleDraft]);

  async function addEmptyTab() {
    if (!await persistDraftForNavigation()) return;
    const tabId = createTabId();
    setOpenTabs((current) => [...current, { id: tabId, path: null }]);
    setActiveTabId(tabId);
    clearCurrentNote();
  }

  async function activateTab(tabId: string) {
    const tab = openTabs.find((entry) => entry.id === tabId);
    if (!tab) return;

    if (!await persistDraftForNavigation()) return;

    setActiveTabId(tab.id);
    if (tab.path) {
      await loadExistingNoteIntoEditor(tab.path);
      return;
    }

    clearCurrentNote();
  }

  async function openNoteInNewTab(path: string) {
    if (!await persistDraftForNavigation()) return;
    const tabId = createTabId();
    setOpenTabs((current) => [...current, { id: tabId, path }]);
    setActiveTabId(tabId);

    await loadExistingNoteIntoEditor(path);
  }

  async function closeTab(tabId: string) {
    const tab = openTabs.find((entry) => entry.id === tabId);
    const nextTabs = openTabs.filter((entry) => entry.id !== tabId);
    const closesActiveNote = activeTabId === tabId || activePath === tab?.path;
    if (closesActiveNote && !await persistDraftForNavigation()) return;
    setOpenTabs(nextTabs);
    setTabContextMenu(null);
    if (!closesActiveNote) return;

    const nextTab = nextTabs.at(-1);
    if (nextTab) {
      setActiveTabId(nextTab.id);
      if (nextTab.path) {
        await loadExistingNoteIntoEditor(nextTab.path);
      } else {
        clearCurrentNote();
      }
      return;
    }

    setActiveTabId(null);
    clearCurrentNote();
  }

  async function closeAllTabs() {
    if (!await persistDraftForNavigation()) return;
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
    if (!await persistDraftForNavigation()) return;
    try {
      const folder = await createFolder(workspace, folderDialogParent, folderName);
      updateMetadata((current) => addFolderToOrder(current, folder.parent_path, folder.path));
      setFolderDialogParent(null);
      setFolderName("");
      setSelectedFolder(folder.path);
      clearCurrentNote();
      await refreshWorkspace(workspace);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  function switchNotebook(path: string) {
    void releaseActiveNoteLock();
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

  async function openNotebookInNewWindow(path: string) {
    setAppMenuOpen(false);
    setNotebooksManageOpen(false);
    if (path === workspace) return;
    setRecentNotebooks((current) => writeRecentNotebooks(touchRecentNotebook(current, path)));

    if (!isTauri()) {
      switchNotebook(path);
      return;
    }

    try {
      if (await focusNotebookWindow(path)) return;
    } catch (error) {
      console.warn("focus_notebook_window failed", error);
    }

    const params = new URLSearchParams({ workspace: path });
    const label = `tigrana-notebook-${Date.now()}`;
    const webview = new WebviewWindow(label, {
      url: `/?${params.toString()}`,
      title: path.split("/").filter(Boolean).at(-1) || "Tigrana",
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
      if (openInNewWindow) await openNotebookInNewWindow(selected);
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
    if (!canMutateNotePath(path)) {
      showReadOnlyNoteWarning();
      return;
    }
    if (activePath === path) {
      await releaseActiveNoteLock();
    }
    await trashNote(workspace, path);
    if (activePath === path) {
      clearCurrentNote();
    }
    setOpenTabs((current) => current.filter((tab) => tab.path !== path));
    updateMetadata((current) => removeNoteFromMetadata(current, path));
    await refreshWorkspace(workspace);
  }

  async function handleDuplicateNote(path: string) {
    if (!workspace) return;
    try {
      if (!await persistDraftForNavigation()) return;
      const duplicated = await duplicateNote(workspace, path);
      const content = await readNote(workspace, duplicated.path);
      const access = await acquireActiveNoteLock(duplicated.path);
      activeNoteLifecycle.acceptDiskContent(duplicated.path, content);
      setNotes((current) => current.some((entry) => entry.path === duplicated.path) ? current : [...current, duplicated]);
      setContents((current) => {
        const next = new Map(current);
        next.set(duplicated.path, content);
        return next;
      });
      setActivePath(duplicated.path);
      setPendingNote(null);
      setSelectedFolder(navigationStyle === "section-view" ? getTopLevelFolderPath(duplicated.parent_path) : duplicated.parent_path);
      placePathInActiveTab(duplicated.path);
      loadContentIntoEditor(duplicated, content, {
        path: duplicated.path,
        lastOpenedAt: Date.now(),
        scrollTop: 0,
        contentLength: content.length,
      });
      applyNoteAccess(access);
      recordNotePosition(duplicated.path, content, { lastOpenedAt: Date.now(), scrollTop: 0 });
      updateMetadata((current) => addToOrder(current, duplicated.parent_path, duplicated.path));
      await refreshWorkspace(workspace);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDeleteFolder(path: string) {
    if (!workspace || !path) return;
    if (activePath?.startsWith(`${path}/`)) {
      await releaseActiveNoteLock();
    }
    await trashFolder(workspace, path);
    if (selectedFolder === path || selectedFolder.startsWith(`${path}/`)) setSelectedFolder("");
    if (activePath?.startsWith(`${path}/`)) clearCurrentNote();
    setOpenTabs((current) => current.filter((tab) => !tab.path?.startsWith(`${path}/`)));
    updateMetadata((current) => removeFolderFromMetadata(current, path));
    await refreshWorkspace(workspace);
  }

  async function handleRestoreTrash(id: string) {
    if (!workspace) return;
    try {
      await restoreTrash(workspace, id);
      await refreshTrash();
      await refreshWorkspace(workspace);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  function openVersionHistory(path: string) {
    const note = notes.find((entry) => entry.path === path);
    setVersionHistory({ path, title: note?.title ?? decodeTitleFromFilename(path.split("/").at(-1)?.replace(/\.md$/, "") ?? path) });
    setContextMenu(null);
  }

  async function handleRestoreNoteVersion(path: string, id: string) {
    if (!workspace) return;
    if (!canMutateNotePath(path)) {
      showReadOnlyNoteWarning();
      return;
    }
    try {
      if (activePath === path && (hasUnsavedChanges || pendingEditorChangeRef.current)) {
        await persistDraft();
        await waitForPendingNoteSaves();
      }
      const restored = await restoreNoteVersion(workspace, path, id);
      activeNoteLifecycle.acceptDiskContent(path, restored);
      setContents((current) => {
        const next = new Map(current);
        next.set(path, restored);
        return next;
      });
      if (activePath === path) {
        const note = notes.find((entry) => entry.path === path) ?? null;
        loadContentIntoEditor(note, restored, {
          path,
          lastOpenedAt: Date.now(),
          scrollTop: 0,
          contentLength: restored.length,
        });
        setEditorReloadRequest((value) => value + 1);
      }
      await refreshWorkspace(workspace);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handlePurgeTrash(id: string) {
    if (!workspace) return;
    try {
      await purgeTrash(workspace, id);
      await refreshTrash();
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handlePurgeTrashAll() {
    if (!workspace) return;
    try {
      await purgeTrashAll(workspace);
      await refreshTrash();
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleInternalLinkClick(href: string) {
    if (!workspace) return;
    const normalized = href.replace(/^\.\//, "");
    if (notes.find((entry) => entry.path === normalized)) {
      void selectNote(normalized);
      return;
    }
    if (folders.find((entry) => entry.path === normalized)) {
      setSelectedFolder(normalized);
      clearCurrentNote();
      return;
    }
    // Best-effort match by title alone for back-compat with hand-written links.
    const byTitle = notes.find((entry) => entry.title === normalized || `${entry.title}.md` === normalized);
    if (byTitle) {
      void selectNote(byTitle.path);
      return;
    }
    setAppError(`No note or folder found at "${href}".`);
  }

  function requestLink(): Promise<LinkPickerResult | null> {
    return new Promise((resolve) => {
      linkPickerResolverRef.current = resolve;
      setLinkPickerOpen(true);
    });
  }

  function requestEmoji(): Promise<string | null> {
    return new Promise((resolve) => {
      emojiPickerResolverRef.current = resolve;
      setEmojiPickerOpen(true);
    });
  }

  function requestImage(): Promise<ImageInsertResult | null> {
    return new Promise((resolve) => {
      imagePickerResolverRef.current = resolve;
      setImageDialogOpen(true);
    });
  }

  function openMoveDialog(kind: "note" | "folder", path: string) {
    setMoveDialog({ kind, path });
    setContextMenu(null);
    setAppError(null);
  }

  async function handleMoveSubmit(targetParentPath: string) {
    const target = moveDialog;
    if (!workspace || !target) return;
    try {
      if (target.kind === "note") {
        if (!canMutateNotePath(target.path)) {
          showReadOnlyNoteWarning();
          return;
        }
        const sourceNote = notes.find((entry) => entry.path === target.path);
        if (!sourceNote || sourceNote.parent_path === targetParentPath) {
          setMoveDialog(null);
          return;
        }
        await notebookPathMutations.moveNote(target.path, targetParentPath);
      } else {
        if (target.path === targetParentPath || targetParentPath.startsWith(`${target.path}/`)) {
          setAppError("A folder cannot be moved inside itself.");
          return;
        }
        const sourceFolder = folders.find((entry) => entry.path === target.path);
        if (!sourceFolder || sourceFolder.parent_path === targetParentPath) {
          setMoveDialog(null);
          return;
        }
        await notebookPathMutations.moveFolder(target.path, targetParentPath);
      }
      setMoveDialog(null);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  function openPropertyDialog(kind: PropertyDialogState["kind"], path: string, subject: "folder" | "section" = "folder") {
    const folder = folders.find((entry) => entry.path === path);
    const name = folder?.name ?? (path ? decodeTitleFromFilename(path.split("/").at(-1) ?? path) : "Notebook");
    const value =
      kind === "rename-folder"
        ? folder?.name ?? ""
        : metadata.folderColors[path] ?? effectiveAccentColor;
    setPropertyDialog({ kind, path, value, name, ...(kind === "folder-color" ? { subject } : {}) } as PropertyDialogState);
    setContextMenu(null);
    setAppError(null);
  }

  function resetFolderIcon(path: string) {
    updateMetadata((current) => setMetadataValue(current, "folderIcons", path, ""));
    setIconBrowser(null);
    setContextMenu(null);
  }

  function resetFolderColor(path: string) {
    updateMetadata((current) => setMetadataValue(current, "folderColors", path, ""));
    setPropertyDialog(null);
    setContextMenu(null);
  }

  function openIconBrowser(kind: IconBrowserState["kind"], path: string) {
    if (kind === "note" && !canMutateNotePath(path)) {
      showReadOnlyNoteWarning();
      setContextMenu(null);
      return;
    }
    const name =
      kind === "folder"
        ? (folders.find((entry) => entry.path === path)?.name ?? (path ? decodeTitleFromFilename(path.split("/").at(-1) ?? path) : "Notebook"))
        : (notes.find((entry) => entry.path === path)?.title ?? decodeTitleFromFilename((path.split("/").at(-1) ?? path).replace(/\.md$/, "")));
    setIconBrowser({
      kind,
      path,
      name,
      value: kind === "folder" ? metadata.folderIcons[path] ?? "" : metadata.noteIcons[path] ?? "",
      ...(kind === "folder" ? { onReset: () => resetFolderIcon(path) } : {}),
    });
    setContextMenu(null);
    setAppError(null);
  }

  function setIconValue(iconName: string) {
    if (!iconBrowser) return;
    if (iconBrowser.kind === "note" && !canMutateNotePath(iconBrowser.path)) {
      showReadOnlyNoteWarning();
      setIconBrowser(null);
      return;
    }
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
        await notebookPathMutations.renameFolder(propertyDialog.path, propertyDialog.value);
      } else if (propertyDialog.kind === "folder-color") {
        updateMetadata((current) => setMetadataValue(current, "folderColors", propertyDialog.path, propertyDialog.value.trim()));
      }
      setPropertyDialog(null);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  function loadContentIntoEditor(note: NoteEntry | null, markdown: string, restorePosition: NotePositionMetadata | null = null) {
    const loadedDocument = readNoteDocument(markdown, note?.title ?? "");
    setEditorRestorePosition(restorePosition);
    setTitleDraft(loadedDocument.title);
    setSavedTitle(loadedDocument.title);
    setDraft(loadedDocument.body);
    setFrontmatterDraft(loadedDocument.frontmatter);
    setRawMarkdownText(loadedDocument.markdown);
    setSavedRawMarkdownText(loadedDocument.markdown);
    setFrontmatterError(loadedDocument.frontmatterError);
    selectedEditorTextRef.current = "";
    setSelectedEditorText("");
    if (loadedDocument.frontmatterError) {
      setRawMarkdownVisible(true);
      setRightSidebarMode("frontmatter");
      setAppError(loadedDocument.frontmatterError);
    } else {
      setRawMarkdownVisible(false);
      setAppError(null);
    }
  }

  function handleRawMarkdownChange(markdown: string) {
    const revisedDocument = readNoteDocument(markdown, titleDraft);
    setRawMarkdownText(markdown);
    setDraft(normalizeMarkdownImageLines(revisedDocument.body));
    setFrontmatterDraft(revisedDocument.frontmatter);
    setFrontmatterError(revisedDocument.frontmatterError);
    if (revisedDocument.frontmatterError) setAppError(revisedDocument.frontmatterError);
    else setAppError(null);
  }

  function handleFrontmatterChange(frontmatter: string) {
    const revisedDocument = reviseNoteDocument(noteDocument, { frontmatter });
    setFrontmatterDraft(revisedDocument.frontmatter);
    setRawMarkdownText(revisedDocument.markdown);
    setFrontmatterError(revisedDocument.frontmatterError);
    if (revisedDocument.frontmatterError) setAppError(revisedDocument.frontmatterError);
    else setAppError(null);
  }

  function handleNoteDrop(targetPath: string, placement: DropPlacement = "before") {
    const sourceItem = draggingItem?.kind === "note" ? draggingItem : draggingItemRef.current?.kind === "note" ? draggingItemRef.current : null;
    const source = sourceItem?.path ?? null;
    if (!source || source === targetPath) return;
    if (!canMutateNotePath(source)) {
      showReadOnlyNoteWarning();
      return;
    }
    const note = notes.find((entry) => entry.path === targetPath);
    const folder = note?.parent_path ?? selectedFolder;
    if (!notes.find((entry) => entry.path === source && entry.parent_path === folder)) return;
    const ordered = orderNotes(notes.filter((entry) => entry.parent_path === folder), folder, metadata).map((entry) => entry.path);
    const nextOrder = ordered.filter((path) => path !== source);
    const targetIndex = Math.max(0, nextOrder.indexOf(targetPath));
    nextOrder.splice(targetIndex + (placement === "after" ? 1 : 0), 0, source);
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
        if (!canMutateNotePath(droppedItem.path)) {
          showReadOnlyNoteWarning();
          return;
        }
        const sourceNote = notes.find((note) => note.path === droppedItem.path);
        if (!sourceNote || sourceNote.parent_path === targetFolderPath) return;
        await notebookPathMutations.moveNote(droppedItem.path, targetFolderPath);
      } else if (droppedItem.kind === "folder") {
        const sourceFolder = folders.find((folder) => folder.path === droppedItem.path);
        const targetFolder = folders.find((folder) => folder.path === targetFolderPath);
        if (!sourceFolder || !sourceFolder.path || !targetFolder) return;
        if (sourceFolder.parent_path === targetFolderPath) return;
        await notebookPathMutations.moveFolder(droppedItem.path, targetFolderPath, { selectMovedFolder: true });
      }
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    } finally {
      setDraggingItem(null);
      draggingItemRef.current = null;
      setDropTargetFolder(null);
      setFolderDropIntent(null);
      setNoteDragPreview(null);
    }
  }

  function handleFolderReorder(targetPath: string, item: Exclude<DragItem, null> | null, placement: DropPlacement = "before") {
    if (item?.kind !== "folder" || item.path === targetPath) return;
    const sourceFolder = folders.find((folder) => folder.path === item.path);
    const targetFolder = folders.find((folder) => folder.path === targetPath);
    if (!sourceFolder || !targetFolder || sourceFolder.parent_path !== targetFolder.parent_path) return;

    const siblings = orderFolders(
      folders.filter((folder) => folder.parent_path === sourceFolder.parent_path).map((folder) => ({ ...folder, children: [] })),
      sourceFolder.parent_path,
      metadata,
    ).map((folder) => folder.path);
    const nextOrder = siblings.filter((path) => path !== sourceFolder.path);
    const targetIndex = Math.max(0, nextOrder.indexOf(targetFolder.path));
    nextOrder.splice(targetIndex + (placement === "after" ? 1 : 0), 0, sourceFolder.path);
    updateMetadata((current) => ({
      ...current,
      folderOrder: { ...current.folderOrder, [sourceFolder.parent_path]: nextOrder },
    }));
    setFolderDropIntent(null);
    setCurrentDragItem(null);
  }

  async function handleFolderDropIntent(sourcePath: string, intent: FolderDropIntent) {
    if (intent.kind === "into") {
      await handleDropOnFolder(intent.path, { kind: "folder", path: sourcePath });
      return;
    }
    if (!workspace || sourcePath === intent.path) return;
    const sourceFolder = folders.find((folder) => folder.path === sourcePath);
    const targetFolder = folders.find((folder) => folder.path === intent.path);
    if (!sourceFolder || !targetFolder || !sourceFolder.path || targetFolder.path.startsWith(`${sourceFolder.path}/`)) return;

    const placement = intent.kind === "after" ? "after" : "before";
    if (sourceFolder.parent_path === targetFolder.parent_path) {
      handleFolderReorder(targetFolder.path, { kind: "folder", path: sourceFolder.path }, placement);
      return;
    }

    try {
      await notebookPathMutations.moveFolder(sourceFolder.path, targetFolder.parent_path, {
        siblingPlacement: { targetPath: targetFolder.path, placement },
      });
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    } finally {
      setFolderDropIntent(null);
      setDropTargetFolder(null);
      setCurrentDragItem(null);
    }
  }

  function setCurrentDragItem(item: DragItem) {
    if (item?.kind === "note" && !canMutateNotePath(item.path)) {
      showReadOnlyNoteWarning();
      return;
    }
    draggingItemRef.current = item;
    setDraggingItem(item);
    if (!item) setDropTargetFolder(null);
  }

  function folderPathAtPoint(clientX: number, clientY: number) {
    const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-folder-path]");
    return row?.dataset.folderPath ?? null;
  }

  function noteDropTargetAtPoint(clientX: number, clientY: number) {
    const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-note-path]");
    const path = row?.dataset.notePath ?? null;
    if (!row || !path) return null;
    const bounds = row.getBoundingClientRect();
    return {
      path,
      placement: (clientY > bounds.top + bounds.height / 2 ? "after" : "before") as DropPlacement,
    };
  }

  function folderDropTargetAtPoint(clientX: number, clientY: number, sourcePath: string, orderingMode: FolderOrderingMode): FolderDropIntent | null {
    const sourceFolder = folders.find((folder) => folder.path === sourcePath);
    if (!sourceFolder) return null;

    const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(".unified-tree-pane [data-folder-path]");
    const path = row?.dataset.folderPath ?? null;
    if (!row || path === null) {
      const paneRoot = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(".unified-tree-pane [data-pane-root-path]");
      const paneRootPath = paneRoot?.dataset.paneRootPath;
      if (paneRootPath === undefined || sourceFolder.parent_path === paneRootPath || paneRootPath.startsWith(`${sourcePath}/`)) return null;
      return { kind: "into", path: paneRootPath };
    }
    if (path === sourcePath || path.startsWith(`${sourcePath}/`)) return null;

    if (orderingMode === "alphabetical") {
      return sourceFolder.parent_path === path ? null : { kind: "into", path };
    }

    const bounds = row.getBoundingClientRect();
    const offsetY = clientY - bounds.top;
    const edgeZone = bounds.height / 3;
    if (offsetY <= edgeZone) return { kind: "before", path };
    if (offsetY >= bounds.height - edgeZone) return { kind: "after", path };
    return sourceFolder.parent_path === path ? null : { kind: "into", path };
  }

  function beginFolderPointerDrag(path: string, event: React.PointerEvent<HTMLElement>, orderingMode: FolderOrderingMode) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest("[data-no-folder-drag]")) return;
    const folder = folders.find((entry) => entry.path === path);
    if (!folder || !folder.path) return;

    folderPointerDragRef.current = {
      dragging: false,
      path,
      startX: event.clientX,
      startY: event.clientY,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = folderPointerDragRef.current;
      if (!drag) return;

      const distance = Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY);
      if (!drag.dragging && distance < 5) return;

      if (!drag.dragging) {
        drag.dragging = true;
        suppressNextFolderClickRef.current = true;
        document.body.classList.add("is-dragging-folder");
        setCurrentDragItem({ kind: "folder", path: drag.path });
      }

      moveEvent.preventDefault();
      const intent = folderDropTargetAtPoint(moveEvent.clientX, moveEvent.clientY, drag.path, orderingMode);
      setFolderDropIntent(intent);
      setDropTargetFolder(intent?.kind === "into" ? intent.path : null);
      document.body.classList.toggle("is-over-drop-target", Boolean(intent));
    };

    const cleanupPointerDrag = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      document.body.classList.remove("is-dragging-folder");
      document.body.classList.remove("is-over-drop-target");
      setFolderDropIntent(null);
      setDropTargetFolder(null);
      folderPointerDragRef.current = null;
    };

    const handlePointerCancel = () => {
      cleanupPointerDrag();
      setCurrentDragItem(null);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const drag = folderPointerDragRef.current;
      const intent = drag?.dragging ? folderDropTargetAtPoint(upEvent.clientX, upEvent.clientY, drag.path, orderingMode) : null;
      cleanupPointerDrag();

      if (drag?.dragging && intent) {
        void handleFolderDropIntent(drag.path, intent);
      } else if (drag?.dragging) {
        setCurrentDragItem(null);
      }
      setTimeout(() => { suppressNextFolderClickRef.current = false; }, 0);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerCancel, { once: true });
  }

  function beginNotePointerDrag(path: string, event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest("[data-no-note-drag]")) return;
    if (!canMutateNotePath(path)) return;

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
      const sourceParent = draggedNote?.parent_path;

      let overTarget = targetFolder !== null;
      if (targetFolder !== null) {
        setDropTargetFolder(targetFolder);
        setNoteDropIndicator(null);
      } else {
        // No folder under cursor — check for a sibling note (reorder).
        const candidate = noteDropTargetAtPoint(moveEvent.clientX, moveEvent.clientY);
        const targetParent = candidate ? notes.find((entry) => entry.path === candidate.path)?.parent_path : undefined;
        if (candidate && candidate.path !== drag.path && sourceParent !== undefined && sourceParent === targetParent) {
          setNoteDropIndicator(candidate);
          setDropTargetFolder(null);
          overTarget = true;
        } else if (!candidate) {
          // Empty pane area — fall back to the pane's root folder so notes can be lifted
          // out of a subfolder by dropping into blank space.
          const paneRoot = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest<HTMLElement>("[data-pane-root-path]");
          const paneRootPath = paneRoot?.dataset.paneRootPath;
          setNoteDropIndicator(null);
          if (paneRootPath !== undefined && paneRootPath !== sourceParent) {
            setDropTargetFolder(paneRootPath);
            overTarget = true;
          } else {
            setDropTargetFolder(null);
          }
        } else {
          // Cursor is over a cross-folder note row — no visual feedback.
          setNoteDropIndicator(null);
          setDropTargetFolder(null);
        }
      }
      document.body.classList.toggle("is-over-drop-target", overTarget);

      setNoteDragPreview({
        path: drag.path,
        title: draggedNote?.title || decodeTitleFromFilename(drag.path.split("/").at(-1)?.replace(/\.md$/, "") || "") || "Untitled",
        x: moveEvent.clientX,
        y: moveEvent.clientY,
        overTarget,
      });
    };

    const cleanupPointerDrag = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      document.body.classList.remove("is-dragging-note");
      document.body.classList.remove("is-over-drop-target");
      setNoteDragPreview(null);
      setNoteDropIndicator(null);
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
        const targetNote = noteDropTargetAtPoint(upEvent.clientX, upEvent.clientY);
        setDropTargetFolder(null);
        if (targetFolder !== null) {
          void handleDropOnFolder(targetFolder, { kind: "note", path: drag.path });
        } else if (targetNote && targetNote.path !== drag.path) {
          handleNoteDrop(targetNote.path, targetNote.placement);
        } else {
          const paneRoot = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest<HTMLElement>("[data-pane-root-path]");
          const paneRootPath = paneRoot?.dataset.paneRootPath;
          const sourceNote = notes.find((entry) => entry.path === drag.path);
          if (paneRootPath !== undefined && paneRootPath !== sourceNote?.parent_path) {
            void handleDropOnFolder(paneRootPath, { kind: "note", path: drag.path });
          } else {
            setCurrentDragItem(null);
          }
        }
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerCancel, { once: true });
  }

  function sectionDropTargetAtPoint(clientX: number, clientY: number): { path: string; placement: DropPlacement } | null {
    const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(".section-view-folder-pane [data-folder-path]");
    if (!row) return null;
    const path = row.dataset.folderPath ?? "";
    if (!path) return null; // skip Uncategorized
    const bounds = row.getBoundingClientRect();
    return {
      path,
      placement: clientY > bounds.top + bounds.height / 2 ? "after" : "before",
    };
  }

  function beginSectionPointerDrag(path: string, event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const folder = folders.find((entry) => entry.path === path);
    if (!folder || folder.parent_path !== "") return;

    sectionPointerDragRef.current = {
      dragging: false,
      path,
      startX: event.clientX,
      startY: event.clientY,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = sectionPointerDragRef.current;
      if (!drag) return;

      const distance = Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY);
      if (!drag.dragging && distance < 5) return;

      if (!drag.dragging) {
        drag.dragging = true;
        suppressNextSectionClickRef.current = true;
        document.body.classList.add("is-dragging-section");
        setCurrentDragItem({ kind: "folder", path: drag.path });
      }

      moveEvent.preventDefault();
      const target = sectionDropTargetAtPoint(moveEvent.clientX, moveEvent.clientY);
      setSectionReorderHover(target && target.path !== drag.path ? target : null);
    };

    const cleanupPointerDrag = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      document.body.classList.remove("is-dragging-section");
      setSectionReorderHover(null);
      sectionPointerDragRef.current = null;
    };

    const handlePointerCancel = () => {
      cleanupPointerDrag();
      setCurrentDragItem(null);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const drag = sectionPointerDragRef.current;
      cleanupPointerDrag();

      if (drag?.dragging) {
        const target = sectionDropTargetAtPoint(upEvent.clientX, upEvent.clientY);
        if (target && target.path !== drag.path) {
          handleFolderReorder(target.path, { kind: "folder", path: drag.path }, target.placement);
        } else {
          setCurrentDragItem(null);
        }
      }
      // The browser doesn't fire `click` after a real drag, so any synthetic-click suppression
      // from this gesture would linger and block the next unrelated click. Clear on next tick —
      // after the immediate post-mouseup click (if any) has had a chance to run.
      setTimeout(() => { suppressNextSectionClickRef.current = false; }, 0);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerCancel, { once: true });
  }

  function handleNoteSelectFromCard(path: string, options: { preserveSelectedFolder?: boolean } = {}) {
    if (suppressNextNoteClickRef.current) {
      suppressNextNoteClickRef.current = false;
      return;
    }
    selectNote(path, options);
  }

  function openContextMenu(event: React.MouseEvent, state: ContextMenuTarget) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ ...state, x: event.clientX, y: event.clientY } as ContextMenuState);
  }

  useEffect(() => {
    if (!contextMenu || contextMenu.kind === "empty") return;
    const attr = contextMenu.kind === "folder" ? "data-folder-path" : "data-note-path";
    const escaped = (window.CSS && CSS.escape) ? CSS.escape(contextMenu.path) : contextMenu.path.replace(/"/g, '\\"');
    const matches = document.querySelectorAll(`[${attr}="${escaped}"]`);
    matches.forEach((el) => el.classList.add("is-context-target"));
    return () => {
      matches.forEach((el) => el.classList.remove("is-context-target"));
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!noteDropIndicator) return;
    const escaped = (window.CSS && CSS.escape) ? CSS.escape(noteDropIndicator.path) : noteDropIndicator.path.replace(/"/g, '\\"');
    const matches = document.querySelectorAll(`[data-note-path="${escaped}"]`);
    const cls = noteDropIndicator.placement === "before" ? "is-reorder-before" : "is-reorder-after";
    matches.forEach((el) => el.classList.add(cls));
    return () => {
      matches.forEach((el) => el.classList.remove(cls));
    };
  }, [noteDropIndicator]);

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
    const label = `tigrana-${target.kind}-${Date.now()}`;
    const webview = new WebviewWindow(label, {
      url: `/?${params.toString()}`,
      title: "Tigrana",
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
    if (target.kind === "note" && !canMutateNotePath(target.path)) {
      showReadOnlyNoteWarning();
      return;
    }
    const shouldRemove = metadataRef.current.bookmarks.some(
      (bookmark) => bookmark.kind === target.kind && bookmark.path === target.path,
    );
    const bookmark = shouldRemove
      ? null
      : { id: createBookmarkId(), kind: target.kind, path: target.path, createdAt: Date.now() };
    updateMetadata((current) => {
      return {
        ...current,
        bookmarks: shouldRemove
          ? current.bookmarks.filter((bookmark) => bookmark.kind !== target.kind || bookmark.path !== target.path)
          : current.bookmarks.some((entry) => entry.kind === target.kind && entry.path === target.path)
            ? current.bookmarks
            : [...current.bookmarks, bookmark!],
      };
    });
  }

  function toggleBookmarksExpanded() {
    const expanded = !metadataRef.current.bookmarksExpanded;
    updateMetadata((current) => ({ ...current, bookmarksExpanded: expanded }));
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
    const minWidth = navigationStyle === "single-pane" ? 160 : 220;

    startResize(event, (clientX) => {
      setNotesPaneWidth(clamp(startWidth + clientX - startX, minWidth, 520));
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

  const selectedWidthOption = editorWidthOptions.find((option) => option.value === editorWidthMode) ?? editorWidthOptions[0];
  const AlignmentIcon = noteAlignment === "left" ? AlignLeft : AlignCenter;

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

      <div className={`app-frame ${leftVisible ? "" : "is-left-hidden"} ${outlineVisible ? "" : "is-outline-hidden"} ${navigationStyle === "single-pane" ? "is-single-col" : ""}`} style={frameStyle}>
      {leftVisible ? (
        <aside
          className={`left-panes${navigationStyle === "single-pane" ? " is-single-col" : ""}`}
          onContextMenu={(event) => openContextMenu(event, { kind: "empty" })}
        >
          {navigationStyle === "single-pane" ? (
            <UnifiedTreePane
              activePath={activePath}
              bookmarks={bookmarks}
              bookmarksExpanded={metadata.bookmarksExpanded}
              createParentPath={selectedFolder}
              contents={contents}
              folderDropIntent={folderDropIntent}
              folderOrderingMode="alphabetical"
              folders={folders}
              menuOpen={appMenuOpen}
              metadata={metadata}
              notes={notes}
              recentNotebooks={recentNotebooks}
              rootPath=""
              searchFocusRequest={searchFocusRequest}
              searchOpen={searchOpen}
              searchQuery={searchQuery}
              searchResults={results}
              selectedFolderPath={activePath ? undefined : selectedFolder}
              showBookmarks
              showNotebookFooter
              showPins={false}
              showSearch
              suppressFolderClickRef={suppressNextFolderClickRef}
              title={getNotebookName(workspace)}
              workspace={workspace}
              dropTargetFolder={dropTargetFolder}
              onContextMenu={openContextMenu}
              onCreateFolder={requestCreateFolder}
              onCreateNote={requestCreateNote}
              onFolderPointerDragStart={(path, event) => beginFolderPointerDrag(path, event, "alphabetical")}
              onManageNotebooks={() => {
                setNotebooksManageOpen(true);
                setAppMenuOpen(false);
              }}
              onNewNotebook={() => void chooseWorkspace("new", true)}
              onOpenWorkspace={() => void chooseWorkspace("open", true)}
              onPin={toggleNotePin}
              onPointerDragStart={beginNotePointerDrag}
              onRemoveBookmark={removeBookmark}
              onSearchQueryChange={setSearchQuery}
              onSelectBookmark={selectBookmark}
              onSelectFolder={(path) => void selectFolderForNewNote(path)}
              onSelectNotebook={openNotebookInNewWindow}
              onSelectNote={handleNoteSelectFromCard}
              onSetFolderExpanded={setFolderExpanded}
              onSelectSearchResult={selectNote}
              onToggleBookmarksExpanded={toggleBookmarksExpanded}
              onToggleMenu={(event) => {
                event.stopPropagation();
                setAppMenuOpen((value) => !value);
              }}
              onToggleSearch={() => setSearchOpen((value) => !value)}
            />
          ) : navigationStyle === "section-view" ? (
            <>
              <SectionViewFolderPane
                activePath={activePath}
                bookmarks={bookmarks}
                bookmarksExpanded={metadata.bookmarksExpanded}
                draggingItem={draggingItem}
                dropTargetFolder={dropTargetFolder}
                folders={folderTree[0]?.children ?? []}
                metadata={metadata}
                selectedFolder={selectedSection}
                workspace={workspace}
                menuOpen={appMenuOpen}
                recentNotebooks={recentNotebooks}
                reorderHover={sectionReorderHover}
                searchOpen={searchOpen}
                searchFocusRequest={searchFocusRequest}
                searchQuery={searchQuery}
                searchResults={results}
                onContextMenu={openContextMenu}
                onCreateFolder={requestCreateFolder}
                onDropOnFolder={(path, item) => void handleDropOnFolder(path, item)}
                onDropTargetChange={setDropTargetFolder}
                onSectionPointerDragStart={beginSectionPointerDrag}
                suppressClickRef={suppressNextSectionClickRef}
                onManageNotebooks={() => { setNotebooksManageOpen(true); setAppMenuOpen(false); }}
                onNewNotebook={() => void chooseWorkspace("new", true)}
                onOpenWorkspace={() => void chooseWorkspace("open", true)}
                onRemoveBookmark={removeBookmark}
                onSearchQueryChange={setSearchQuery}
                onSelectBookmark={selectBookmark}
                onSelectFolder={(path) => void selectSection(path)}
                onSelectNotebook={openNotebookInNewWindow}
                onSelectSearchResult={selectNote}
                onToggleBookmarksExpanded={toggleBookmarksExpanded}
                onToggleMenu={(event) => { event.stopPropagation(); setAppMenuOpen((v) => !v); }}
                onToggleSearch={() => setSearchOpen((value) => !value)}
              />
              <PaneResizer label="Resize folder pane" variant="inner" onPointerDown={startFolderPaneResize} />
              <UnifiedTreePane
                activePath={activePath}
                createParentPath={selectedFolder}
                contents={contents}
                folderDropIntent={folderDropIntent}
                folderOrderingMode="custom"
                folders={folders}
                metadata={metadata}
                notes={notes}
                rootPath={selectedSection}
                hiddenFolderParentPath={selectedSection === "" ? "" : undefined}
                selectedFolderPath={activePath ? undefined : selectedFolder}
                showPins
                suppressFolderClickRef={suppressNextFolderClickRef}
                title={selectedSectionTitle}
                workspace={workspace}
                dropTargetFolder={dropTargetFolder}
                onContextMenu={openContextMenu}
                onCreateFolder={requestCreateFolder}
                onCreateNote={requestCreateNote}
                onFolderPointerDragStart={(path, event) => beginFolderPointerDrag(path, event, "custom")}
                onPin={toggleNotePin}
                onPointerDragStart={beginNotePointerDrag}
                onSelectFolder={(path) => void selectFolderForNewNote(path)}
                onSelectNote={(path) => {
                  setSelectedFolder(selectedSection);
                  handleNoteSelectFromCard(path, { preserveSelectedFolder: true });
                }}
                onSetFolderExpanded={setFolderExpanded}
              />
            </>
          ) : (
            <>
              <FolderPane
                activePath={activePath}
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
                onContextMenu={openContextMenu}
                onDragStart={setCurrentDragItem}
                onDropTargetChange={setDropTargetFolder}
                onDropOnFolderFallback={(path, item) => void handleDropOnFolder(path, item)}
                onDropOnFolder={(path, item) => void handleDropOnFolder(path, item)}
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
                onSetFolderExpanded={setFolderExpanded}
                onToggleBookmarksExpanded={toggleBookmarksExpanded}
                onToggleSearch={() => setSearchOpen((value) => !value)}
                onToggleMenu={(event) => {
                  event.stopPropagation();
                  setAppMenuOpen((value) => !value);
                }}
              />
              <PaneResizer label="Resize folder pane" variant="inner" onPointerDown={startFolderPaneResize} />
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
                onPin={toggleNotePin}
                onPointerDragStart={beginNotePointerDrag}
                onSelect={handleNoteSelectFromCard}
              />
            </>
          )}
        </aside>
      ) : null}
      {leftVisible ? <PaneResizer label="Resize notes pane" variant="left-of-main" onPointerDown={startNotesPaneResize} /> : null}

      <main className="main-pane">
        {noteOpen ? (
          <header className="topbar">
            <div className="save-state">
              <Check size={15} />
              <span>{!activeNoteEditable ? "Read-only" : hasUnsavedChanges ? "Unsaved" : "Saved"}</span>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Find in note"
              onClick={() => setNoteFindRequest((v) => v + 1)}
            >
              <Search size={17} />
            </button>
            <button
              className={`icon-button ${rawMarkdownVisible || frontmatterError ? "is-active" : ""}`}
              type="button"
              title={rawMarkdownVisible ? "Show rich editor" : "Show raw Markdown"}
              onClick={toggleRawMarkdownMode}
            >
              <FileCode2 size={17} />
            </button>
            <div className="note-view-control note-view-menu">
              <button
                className={`icon-button ${widthMenuOpen ? "is-active" : ""}`}
                type="button"
                title={`Width: ${selectedWidthOption.label}`}
                aria-label="Editor width"
                aria-haspopup="menu"
                aria-expanded={widthMenuOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  setWidthMenuOpen((value) => !value);
                }}
              >
                <StretchHorizontal size={17} />
              </button>
              {widthMenuOpen ? (
                <div className="note-view-dropdown" role="menu" aria-label="Editor width">
                  {editorWidthOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={option.value === editorWidthMode ? "is-active" : ""}
                      role="menuitemradio"
                      aria-checked={option.value === editorWidthMode}
                      onClick={() => {
                        setEditorWidthMode(option.value);
                        setWidthMenuOpen(false);
                      }}
                    >
                      <span>
                        <strong>{option.label}</strong>
                        {option.hint ? <small>{option.hint}</small> : null}
                      </span>
                      {option.value === editorWidthMode ? <Check size={15} /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              className="icon-button"
              type="button"
              title={noteAlignment === "left" ? "Align center" : "Align left"}
              aria-label={noteAlignment === "left" ? "Align center" : "Align left"}
              onClick={() => setNoteAlignment((value) => (value === "left" ? "center" : "left"))}
            >
              <AlignmentIcon size={17} />
            </button>
          </header>
        ) : null}

        {noteOpen ? (
          <section
            className={`note-surface is-${editorWidthMode}-width is-${noteAlignment}-aligned`}
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
                disabled={!activeNoteEditable}
                onChange={(event) => {
                  if (!activeNoteEditable) return;
                  disarmPendingTitleFocus();
                  setTitleDraft(event.target.value);
                }}
                onBlur={() => {
                  disarmUndoableNewNote(activePath);
                  if (titleEscapeUndoInFlightRef.current) return;
                  if (titleCommitInFlightRef.current) return;
                  if (activeNoteEditable && (hasUnsavedChanges || pendingEditorChangeRef.current) && titleDraft.trim()) {
                    persistDraftInBackground();
                  }
                }}
                onKeyDown={(event) => {
                  if (!activeNoteEditable) return;
                  if (event.key === "Escape" && canUndoNewNoteCreationFromTitle()) {
                    event.preventDefault();
                    event.stopPropagation();
                    void undoNewNoteCreationFromTitle();
                    return;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    disarmPendingTitleFocus();
                    void commitTitleAndFocusEditor();
                  }
                }}
                placeholder="Untitled"
                aria-label="Note title"
                rows={1}
              />
              {noteLockMessage ? (
                <p className="note-lock-warning">
                  <span>{noteLockMessage}</span>
                  <button type="button" onClick={() => void retryActiveNoteEditLock()}>
                    Try editing
                  </button>
                </p>
              ) : null}
              {appError ? <p className="app-error note-error">{appError}</p> : null}
            </div>
            {rawMarkdownVisible || frontmatterError ? (
              <div className="raw-markdown-shell">
                {rawFindOpen ? (
                  <div className={rawReplaceOpen ? "note-find-bar raw-find-bar has-replace" : "note-find-bar raw-find-bar"}>
                    <div className="note-find-row">
                      <Search size={15} />
                      <input
                        value={rawFindQuery}
                        onChange={(event) => setRawFindQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            selectRawFindMatch(event.shiftKey ? -1 : 1);
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setRawFindOpen(false);
                            setRawReplaceOpen(false);
                          }
                        }}
                        placeholder="Find in note"
                        aria-label="Find in raw Markdown"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                      <span className="find-count">{rawFindQuery.trim() ? `${rawFindMatchCount}` : ""}</span>
                    </div>
                    {rawReplaceOpen ? (
                      <div className="note-replace-row">
                        <span className="note-find-row-spacer" aria-hidden="true" />
                        <input
                          value={rawReplaceText}
                          onChange={(event) => setRawReplaceText(event.target.value)}
                          placeholder="Replace"
                          aria-label="Replace in raw Markdown"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                        <button type="button" disabled={!rawFindMatchCount || !activeNoteEditable} onClick={replaceRawCurrent}>
                          Replace
                        </button>
                        <button type="button" disabled={!rawFindMatchCount || !activeNoteEditable} onClick={replaceRawAll}>
                          All
                        </button>
                      </div>
                    ) : null}
                    <div className="note-find-controls">
                      <button type="button" title="Previous match" disabled={!rawFindMatchCount} onClick={() => selectRawFindMatch(-1)}>
                        <ChevronUp size={14} />
                      </button>
                      <button type="button" title="Next match" disabled={!rawFindMatchCount} onClick={() => selectRawFindMatch(1)}>
                        <ChevronDown size={14} />
                      </button>
                      <button type="button" title="Close find" onClick={() => { setRawFindOpen(false); setRawReplaceOpen(false); }}>
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ) : null}
                <textarea
                  ref={rawMarkdownInputRef}
                  aria-label="Raw Markdown"
                  className="raw-markdown-input"
                  value={rawMarkdownDraft}
                  disabled={!activeNoteEditable}
                  autoCapitalize="none"
                  autoCorrect="off"
                  onChange={(event) => {
                    if (!activeNoteEditable) return;
                    rawMarkdownSelectionRef.current = {
                      start: event.currentTarget.selectionStart,
                      end: event.currentTarget.selectionEnd,
                      direction: event.currentTarget.selectionDirection,
                      scrollTop: event.currentTarget.scrollTop,
                      scrollLeft: event.currentTarget.scrollLeft,
                    };
                    handleRawMarkdownChange(event.target.value);
                  }}
                  onSelect={(event) => {
                    const input = event.currentTarget;
                    const selectedText = input.value.slice(input.selectionStart, input.selectionEnd);
                    selectedEditorTextRef.current = selectedText;
                    setSelectedEditorText(selectedText);
                  }}
                  spellCheck={spellcheckEnabled}
                />
              </div>
            ) : (
              <EditorErrorBoundary resetKey={activePath ?? "pending-note"} onError={handleNoteLoadError}>
                <NotesEditor
                  content={draft}
                  focusRequest={editorFocusRequest}
                  focusAtEndRequest={editorFocusAtEndRequest}
                  findRequest={noteFindRequest}
                  reloadRequest={editorReloadRequest}
                  commandRequest={editorCommandRequest}
                  notePath={activePath}
                  restorePosition={editorRestorePosition}
                  editable={activeNoteEditable}
                  spellcheckEnabled={spellcheckEnabled}
                  workspace={workspace}
                  onChange={(markdown, sourceNotePath) => {
                    if (activeNoteLifecycle.isLoading) return;
                    if (!shouldApplyEditorUpdate(activePath, sourceNotePath, activeNoteEditable)) return;
                    setDraft(markdown);
                  }}
                  onPendingChange={(change) => {
                    pendingEditorChangeRef.current = change;
                  }}
                  onLoadError={handleNoteLoadError}
                  onPositionChange={handleEditorPositionChange}
                  onInternalLinkClick={handleInternalLinkClick}
                  onRequestEmoji={requestEmoji}
                  onRequestLink={requestLink}
                  onRequestImage={requestImage}
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

      {outlineVisible ? <PaneResizer label="Resize right sidebar" variant="right-of-main" onPointerDown={startRightPaneResize} /> : null}
      {outlineVisible ? (
        <RightSidebar
          activeNote={activeNote}
          frontmatter={frontmatterDraft}
          frontmatterError={frontmatterError}
          mode={rightSidebarMode}
          outline={noteOpen ? outline : []}
          pendingNote={pendingNote}
          workspace={workspace}
          linkIndex={linkIndex}
          activePath={activePath}
          selectedFolder={selectedFolder}
          folders={folders}
          notes={notes}
          metadata={metadata}
          onFrontmatterChange={handleFrontmatterChange}
          onModeChange={setRightSidebarMode}
          onSelectOutline={handleOutlineSelect}
          onSelectBacklink={(path) => { void selectNote(path); }}
        />
      ) : null}

      {noteDragPreview ? <NoteDragPreviewLayer preview={noteDragPreview} /> : null}

      {contextMenu ? (
        (() => {
          const createParent =
            contextMenu.kind === "folder" ? contextMenu.path
              : contextMenu.kind === "empty" && contextMenu.parentPath !== undefined ? contextMenu.parentPath
              : selectedFolder;
          const activeCreateNoteFolderPath =
            contextMenu.kind === "empty"
              ? activeNoteFolderPath ?? (selectedFolder ? selectedFolder : null)
              : null;
          const showActiveCreateNoteFolder =
            activeCreateNoteFolderPath !== null &&
            activeCreateNoteFolderPath !== "" &&
            activeCreateNoteFolderPath !== createParent &&
            folders.some((folder) => folder.path === activeCreateNoteFolderPath);
          return (
        <ContextMenu
          state={contextMenu}
          folderColorSubject={isSectionContextTarget(contextMenu, navigationStyle, folders) ? "section" : "folder"}
          activeCreateNoteParentName={
            showActiveCreateNoteFolder ? displayFolderName(activeCreateNoteFolderPath, folders, workspace) : undefined
          }
          createFolderLabel={contextMenu.source === "sections-pane" ? "New Section" : undefined}
          createFolderParentName={displayFolderName(createParent, folders, workspace)}
          createNoteParentName={displayFolderName(createParent, folders, workspace)}
          showCreateSection={contextMenu.source === "sections-pane"}
          onCreateFolder={() => requestCreateFolder(createParent)}
          onCreateNoteInActiveFolder={
            showActiveCreateNoteFolder ? () => requestCreateNote(activeCreateNoteFolderPath) : undefined
          }
          onCreateNote={() => requestCreateNote(createParent)}
          onCreateSection={() => requestCreateFolder("")}
          onDelete={() => {
            if (contextMenu.kind === "note") void handleDeleteNote(contextMenu.path);
            if (contextMenu.kind === "folder") void handleDeleteFolder(contextMenu.path);
          }}
          onDuplicate={() => {
            if (contextMenu.kind === "note") void handleDuplicateNote(contextMenu.path);
          }}
          onMoveTo={() => {
            if (contextMenu.kind !== "empty" && contextMenu.path) openMoveDialog(contextMenu.kind, contextMenu.path);
          }}
          onOpenInNewWindow={() => {
            if (contextMenu.kind !== "empty") openTargetInNewWindow({ kind: contextMenu.kind, path: contextMenu.path });
          }}
          onOpenInNewTab={() => {
            if (contextMenu.kind === "note") void openNoteInNewTab(contextMenu.path);
          }}
          onReveal={() => {
            if (contextMenu.kind !== "empty") void revealTarget({ kind: contextMenu.kind, path: contextMenu.path });
          }}
          isBookmarked={contextMenu.kind !== "empty" ? isBookmarked({ kind: contextMenu.kind, path: contextMenu.path }) : false}
          onRenameFolder={() => contextMenu.kind === "folder" && openPropertyDialog("rename-folder", contextMenu.path)}
          onSetFolderColor={() =>
            contextMenu.kind === "folder" &&
            openPropertyDialog("folder-color", contextMenu.path, isSectionContextTarget(contextMenu, navigationStyle, folders) ? "section" : "folder")
          }
          onSetFolderIcon={() => contextMenu.kind === "folder" && openIconBrowser("folder", contextMenu.path)}
          onSetNoteIcon={() => contextMenu.kind === "note" && openIconBrowser("note", contextMenu.path)}
          onVersionHistory={() => {
            if (contextMenu.kind === "note") openVersionHistory(contextMenu.path);
          }}
          onToggleBookmark={() => {
            if (contextMenu.kind !== "empty") toggleBookmark({ kind: contextMenu.kind, path: contextMenu.path });
          }}
          onClose={() => setContextMenu(null)}
        />
          );
        })()
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
                <h2>{navigationStyle === "section-view" ? "New section" : "New folder"}</h2>
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
              placeholder={navigationStyle === "section-view" ? "Section name" : "Folder name"}
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

      {moveDialog ? (
        <MoveDialog
          state={moveDialog}
          folderTree={folderTree}
          folders={folders}
          notes={notes}
          metadata={metadata}
          workspace={workspace}
          appError={appError}
          onClose={() => { setMoveDialog(null); setAppError(null); }}
          onSubmit={handleMoveSubmit}
        />
      ) : null}

      {linkPickerOpen ? (
        <LinkPicker
          folders={folders}
          notes={notes}
          workspace={workspace}
          metadata={metadata}
          onClose={() => {
            linkPickerResolverRef.current?.(null);
            linkPickerResolverRef.current = null;
            setLinkPickerOpen(false);
          }}
          onPick={(pick) => {
            linkPickerResolverRef.current?.(pick);
            linkPickerResolverRef.current = null;
            setLinkPickerOpen(false);
          }}
        />
      ) : null}

      {emojiPickerOpen ? (
        <EmojiPicker
          onClose={() => {
            emojiPickerResolverRef.current?.(null);
            emojiPickerResolverRef.current = null;
            setEmojiPickerOpen(false);
          }}
          onPick={(shortcode) => {
            emojiPickerResolverRef.current?.(shortcode);
            emojiPickerResolverRef.current = null;
            setEmojiPickerOpen(false);
          }}
        />
      ) : null}

      {imageDialogOpen ? (
        <ImageInsertDialog
          workspace={workspace}
          onClose={() => {
            imagePickerResolverRef.current?.(null);
            imagePickerResolverRef.current = null;
            setImageDialogOpen(false);
          }}
          onInsert={(src, alt) => {
            if (imagePickerResolverRef.current) {
              imagePickerResolverRef.current({ src, alt });
              imagePickerResolverRef.current = null;
            } else {
              insertEditorImage(src, alt);
            }
            setImageDialogOpen(false);
          }}
          onError={(message) => setAppError(message)}
        />
      ) : null}

      {dictationTarget ? (
        <DictationPanel
          onClose={() => setDictationTarget(null)}
          onInsert={handleDictationInsert}
        />
      ) : null}

      {settingsOpen ? (
          <SettingsModal
            accentColor={accentColor}
            accentTitlebar={accentTitlebar}
            effectiveTitlebarColor={effectiveTitlebarColor}
            titlebarColor={titlebarColor}
            titlebarUseAccent={titlebarUseAccent}
            colorScheme={colorScheme}
            effectiveAccentColor={effectiveAccentColor}
            appFontFamily={appFontFamily}
            appFontSize={appFontSize}
            editorFontFamily={editorFontFamily}
            editorFontSize={editorFontSize}
            navigationStyle={navigationStyle}
            resolvedTheme={resolvedTheme}
            spellcheckEnabled={spellcheckEnabled}
            themePresetId={themePreset.id}
            onAccentChange={(color) => updateThemeColor(resolvedTheme, { accentColor: color })}
            onAccentReset={() => updateThemeColor(resolvedTheme, { accentColor: null })}
            onAccentTitlebarChange={setAccentTitlebar}
            onAppFontFamilyChange={setAppFontFamily}
            onAppFontSizeChange={setAppFontSize}
            onClose={() => setSettingsOpen(false)}
            onColorSchemeChange={setColorScheme}
            onEditorFontFamilyChange={setEditorFontFamily}
            onEditorFontSizeChange={setEditorFontSize}
            onNavigationStyleChange={setNavigationStyle}
            onSpellcheckEnabledChange={setSpellcheckEnabled}
            onThemePresetChange={setThemePresetId}
            onTitlebarColorChange={(color) => updateThemeColor(resolvedTheme, { titlebarColor: color })}
            onTitlebarUseAccentChange={(value) => updateThemeColor(resolvedTheme, { titlebarUseAccent: value })}
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

      {recentlyDeletedOpen ? (
        <RecentlyDeletedDialog
          entries={trashEntries}
          loading={trashLoading}
          onClose={() => setRecentlyDeletedOpen(false)}
          onRestore={handleRestoreTrash}
          onPurge={handlePurgeTrash}
          onPurgeAll={handlePurgeTrashAll}
        />
      ) : null}

      {versionHistory ? (
        <VersionHistoryDialog
          activeNoteEditable={versionHistory.path !== activePath || activeNoteEditable}
          note={versionHistory}
          workspace={workspace}
          onClose={() => setVersionHistory(null)}
          onRestore={handleRestoreNoteVersion}
        />
      ) : null}

      {propertyDialog ? (
        <PropertyDialog
          state={propertyDialog}
          appError={appError}
          onChange={(value) => setPropertyDialog({ ...propertyDialog, value } as PropertyDialogState)}
          onClose={() => setPropertyDialog(null)}
          onReset={propertyDialog.kind === "folder-color" ? () => resetFolderColor(propertyDialog.path) : undefined}
          onSubmit={() => void submitPropertyDialog()}
        />
      ) : null}

      {iconBrowser ? (
        <IconBrowserModal
          state={iconBrowser}
          onClose={() => setIconBrowser(null)}
          onReset={iconBrowser.kind === "folder" ? iconBrowser.onReset : undefined}
          onSelect={setIconValue}
        />
      ) : null}

      </div>
    </div>
  );
}

function FolderPane({
  activePath,
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
  onContextMenu,
  onDragStart,
  onDropTargetChange,
  onDropOnFolder,
  onDropOnFolderFallback,
  onManageNotebooks,
  onNewNotebook,
  onOpenWorkspace,
  onRemoveBookmark,
  onSearchQueryChange,
  onSelectBookmark,
  onSelectNotebook,
  onSelectSearchResult,
  onSelectFolder,
  onSetFolderExpanded,
  onToggleBookmarksExpanded,
  onToggleSearch,
  onToggleMenu,
}: {
  activePath: string | null;
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
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onDragStart: (item: DragItem) => void;
  onDropTargetChange: (path: string | null) => void;
  onDropOnFolder: (path: string, item?: Exclude<DragItem, null>) => void;
  onDropOnFolderFallback: (path: string, item?: Exclude<DragItem, null>) => void;
  onManageNotebooks: () => void;
  onNewNotebook: () => void;
  onOpenWorkspace: () => void;
  onRemoveBookmark: (id: string) => void;
  onSearchQueryChange: (query: string) => void;
  onSelectBookmark: (bookmark: BookmarkEntry) => void;
  onSelectNotebook: (path: string) => void;
  onSelectSearchResult: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onSetFolderExpanded: (path: string, expanded: boolean) => void;
  onToggleBookmarksExpanded: () => void;
  onToggleSearch: () => void;
  onToggleMenu: (event: React.MouseEvent) => void;
}) {
  const getDropItem = (event: React.DragEvent): Exclude<DragItem, null> | undefined => {
    const notePath = event.dataTransfer.getData("application/tigrana-note-path") || event.dataTransfer.getData("text/plain");
    if (notePath) return { kind: "note", path: notePath };
    const folderPath = event.dataTransfer.getData("application/tigrana-folder-path");
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
        activeFolderPath={selectedFolder}
        activeNotePath={activePath}
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
            onDragStart={onDragStart}
            onDropTargetChange={onDropTargetChange}
            onDropOnFolder={onDropOnFolder}
            onSelectFolder={onSelectFolder}
            onSetFolderExpanded={onSetFolderExpanded}
          />
        ))}
      </div>
      <NotebookFooter
        menuOpen={menuOpen}
        recentNotebooks={recentNotebooks}
        workspace={workspace}
        onManageNotebooks={onManageNotebooks}
        onNewNotebook={onNewNotebook}
        onOpenWorkspace={onOpenWorkspace}
        onSelectNotebook={onSelectNotebook}
        onToggleMenu={onToggleMenu}
      />
    </section>
  );
}

function NotebookFooter({
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

function BookmarksSection({
  activeFolderPath,
  activeNotePath,
  bookmarks,
  expanded,
  onRemove,
  onSelect,
  onToggle,
}: {
  activeFolderPath?: string | null;
  activeNotePath?: string | null;
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
          {bookmarks.map((bookmark) => {
            const isActive =
              !bookmark.missing &&
              ((bookmark.kind === "note" && bookmark.path === activeNotePath) ||
                (bookmark.kind === "folder" && bookmark.path === activeFolderPath));

            return (
              <button
                className={`bookmark-item${bookmark.missing ? " is-missing" : ""}${isActive ? " is-active" : ""}`}
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
            );
          })}
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
        {query ? (
          <button
            type="button"
            className="folder-search-clear"
            aria-label="Clear search"
            title="Clear search"
            onClick={() => {
              onQueryChange("");
              inputRef.current?.focus();
            }}
          >
            <X size={13} />
          </button>
        ) : null}
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
  depth = 0,
  draggingItem,
  dropTargetFolder,
  folder,
  metadata,
  selectedFolder,
  onContextMenu,
  onDragStart,
  onDropTargetChange,
  onDropOnFolder,
  onSelectFolder,
  onSetFolderExpanded,
}: {
  depth?: number;
  draggingItem: DragItem;
  dropTargetFolder: string | null;
  folder: FolderNode;
  metadata: WorkspaceMetadata;
  selectedFolder: string;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onDragStart: (item: DragItem) => void;
  onDropTargetChange: (path: string | null) => void;
  onDropOnFolder: (path: string, item?: Exclude<DragItem, null>) => void;
  onSelectFolder: (path: string) => void;
  onSetFolderExpanded: (path: string, expanded: boolean) => void;
}) {
  const isRoot = folder.path === "";
  const open = metadata.expandedFolders[folder.path] ?? true;
  const folderColor = metadata.folderColors[folder.path];
  const customIcon = metadata.folderIcons[folder.path];
  const canDrop =
    Boolean(draggingItem) &&
    (draggingItem?.kind === "note" || (draggingItem?.kind === "folder" && draggingItem.path !== folder.path && !folder.path.startsWith(`${draggingItem.path}/`)));

  const getDraggedItem = (event: React.DragEvent): Exclude<DragItem, null> | null => {
    const notePath = event.dataTransfer.getData("application/tigrana-note-path") || event.dataTransfer.getData("text/plain");
    if (notePath) return { kind: "note", path: notePath };
    const folderPath = event.dataTransfer.getData("application/tigrana-folder-path");
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
    return types.includes("application/tigrana-note-path") || types.includes("application/tigrana-folder-path") || types.includes("text/plain");
  };

  return (
    <div className="folder-node">
      <div
        className={`${selectedFolder === folder.path ? "folder-row is-active" : "folder-row"} ${dropTargetFolder === folder.path ? "is-drop-target" : ""}`}
        style={{ "--row-indent": `${depth * 16}px` } as React.CSSProperties}
        data-folder-path={folder.path}
        draggable={!isRoot}
        onClick={() => onSelectFolder(folder.path)}
        onContextMenu={(event) => onContextMenu(event, { kind: "folder", path: folder.path })}
        onDragStart={(event) => {
          if (isRoot) return;
          event.dataTransfer.setData("application/tigrana-folder-path", folder.path);
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
        <button className="tree-toggle" type="button" onClick={(event) => { event.stopPropagation(); onSetFolderExpanded(folder.path, !open); }}>
          {folder.children.length ? open ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : <span />}
        </button>
        <button className="folder-select" style={folderColor ? { color: folderColor } : undefined} type="button" onClick={(event) => { event.stopPropagation(); onSelectFolder(folder.path); }}>
          <span>
            <IconMark value={customIcon} fallback={Folder} size={15} />
          </span>
          <span>{folder.name}</span>
        </button>
      </div>
      {open && folder.children.length ? (
        <div className="tree-children">
          {folder.children.map((child) => (
            <FolderRow
              key={child.path}
              depth={depth + 1}
              draggingItem={draggingItem}
              dropTargetFolder={dropTargetFolder}
              folder={child}
              metadata={metadata}
              selectedFolder={selectedFolder}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDropTargetChange={onDropTargetChange}
              onDropOnFolder={onDropOnFolder}
              onSelectFolder={onSelectFolder}
              onSetFolderExpanded={onSetFolderExpanded}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------- Section View first pane (root folders only) ----------

function SectionViewFolderPane({
  activePath,
  bookmarks,
  bookmarksExpanded,
  draggingItem,
  dropTargetFolder,
  folders,
  menuOpen,
  metadata,
  recentNotebooks,
  reorderHover,
  searchOpen,
  searchFocusRequest,
  searchQuery,
  searchResults,
  selectedFolder,
  suppressClickRef,
  workspace,
  onContextMenu,
  onCreateFolder,
  onDropOnFolder,
  onDropTargetChange,
  onManageNotebooks,
  onNewNotebook,
  onOpenWorkspace,
  onRemoveBookmark,
  onSearchQueryChange,
  onSectionPointerDragStart,
  onSelectBookmark,
  onSelectFolder,
  onSelectNotebook,
  onSelectSearchResult,
  onToggleBookmarksExpanded,
  onToggleMenu,
  onToggleSearch,
}: {
  activePath: string | null;
  bookmarks: BookmarkView[];
  bookmarksExpanded: boolean;
  draggingItem: DragItem;
  dropTargetFolder: string | null;
  folders: FolderNode[];
  menuOpen: boolean;
  metadata: WorkspaceMetadata;
  recentNotebooks: RecentNotebook[];
  reorderHover: { path: string; placement: DropPlacement } | null;
  searchOpen: boolean;
  searchFocusRequest: number;
  searchQuery: string;
  searchResults: SearchResult[];
  selectedFolder: string;
  suppressClickRef: React.MutableRefObject<boolean>;
  workspace: string;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onCreateFolder: (parentPath?: string) => void;
  onDropOnFolder?: (path: string, item?: Exclude<DragItem, null>) => void;
  onDropTargetChange?: (path: string | null) => void;
  onManageNotebooks: () => void;
  onNewNotebook: () => void;
  onOpenWorkspace: () => void;
  onRemoveBookmark: (id: string) => void;
  onSearchQueryChange: (query: string) => void;
  onSectionPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onSelectBookmark: (bookmark: BookmarkEntry) => void;
  onSelectFolder: (path: string) => void;
  onSelectNotebook: (path: string) => void;
  onSelectSearchResult: (path: string) => void;
  onToggleBookmarksExpanded: () => void;
  onToggleMenu: (event: React.MouseEvent) => void;
  onToggleSearch: () => void;
}) {
  const rootSectionColor = metadata.folderColors[""];
  // Note-into-section and nested-folder-into-section drops still use HTML5 drag (the source notes/folders fire native drag).
  const folderDragItemFromEvent = (event: React.DragEvent): Exclude<DragItem, null> | null => {
    const folderPath = event.dataTransfer.getData("application/tigrana-folder-path");
    if (folderPath) return { kind: "folder", path: folderPath };
    const notePath = event.dataTransfer.getData("application/tigrana-note-path") || event.dataTransfer.getData("text/plain");
    if (notePath) return { kind: "note", path: notePath };
    return draggingItem ?? null;
  };

  return (
    <section
      className="folder-pane section-view-folder-pane"
      onContextMenu={(event) => {
        if ((event.target as HTMLElement | null)?.closest("[data-folder-path]")) return;
        onContextMenu(event, { kind: "empty", parentPath: "", source: "sections-pane" });
      }}
    >
      <div className="pane-header">
        <strong>Sections</strong>
        <div className="pane-actions">
          <button className="icon-button" type="button" disabled={!workspace} title="Search" onClick={onToggleSearch}>
            <Search size={16} />
          </button>
          <button className="icon-button" type="button" disabled={!workspace} title="New Section" onClick={() => onCreateFolder("")}>
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
        activeFolderPath={selectedFolder}
        activeNotePath={activePath}
        bookmarks={bookmarks}
        expanded={bookmarksExpanded}
        onRemove={onRemoveBookmark}
        onSelect={onSelectBookmark}
        onToggle={onToggleBookmarksExpanded}
      />
      <div className="folder-tree">
        <div
          className={`folder-row${selectedFolder === "" ? " is-active" : ""}${dropTargetFolder === "" ? " is-drop-target" : ""}`}
          style={rootSectionColor ? { "--section-color": rootSectionColor } as React.CSSProperties : undefined}
          data-has-section-color={rootSectionColor ? "true" : "false"}
          data-folder-path=""
          onClick={() => onSelectFolder("")}
          onContextMenu={(event) => onContextMenu(event, { kind: "folder", path: "", source: "sections-pane" })}
          onDragOver={(event) => {
            const item = folderDragItemFromEvent(event);
            if (!item) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            onDropTargetChange?.("");
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            onDropTargetChange?.(null);
          }}
          onDrop={(event) => {
            const item = folderDragItemFromEvent(event);
            if (!item) return;
            event.preventDefault();
            onDropTargetChange?.(null);
            onDropOnFolder?.("", item);
          }}
        >
          <span className="section-color-chip" aria-hidden="true" />
          <span className="tree-toggle"><span /></span>
          <button
            className="folder-select"
            type="button"
            onClick={(event) => { event.stopPropagation(); onSelectFolder(""); }}
          >
            <span>
              <IconMark value={metadata.folderIcons[""]} fallback={Folder} size={15} />
            </span>
            <span>Uncategorized</span>
          </button>
        </div>
        {folders.map((folder) => {
          const folderColor = metadata.folderColors[folder.path];
          const customIcon = metadata.folderIcons[folder.path];
          const indicatorPlacement = reorderHover?.path === folder.path ? reorderHover.placement : null;
          const rowClass = [
            "folder-row",
            selectedFolder === folder.path ? "is-active" : "",
            dropTargetFolder === folder.path && !indicatorPlacement ? "is-drop-target" : "",
            indicatorPlacement === "before" ? "is-reorder-before" : "",
            indicatorPlacement === "after" ? "is-reorder-after" : "",
          ].filter(Boolean).join(" ");
          const handleSelectClick = () => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            onSelectFolder(folder.path);
          };
          return (
            <div
              key={folder.path}
              className={rowClass}
              style={folderColor ? { "--section-color": folderColor } as React.CSSProperties : undefined}
              data-has-section-color={folderColor ? "true" : "false"}
              data-folder-path={folder.path}
              onClick={handleSelectClick}
              onContextMenu={(event) => onContextMenu(event, { kind: "folder", path: folder.path, source: "sections-pane" })}
              onPointerDown={(event) => onSectionPointerDragStart(folder.path, event)}
              // Still accept HTML5 drops from notes / nested folders (those sources use HTML5 drag).
              onDragOver={(event) => {
                const item = folderDragItemFromEvent(event);
                if (!item) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                onDropTargetChange?.(folder.path);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                onDropTargetChange?.(null);
              }}
              onDrop={(event) => {
                const item = folderDragItemFromEvent(event);
                if (!item) return;
                event.preventDefault();
                onDropTargetChange?.(null);
                onDropOnFolder?.(folder.path, item);
              }}
            >
              <span className="section-color-chip" aria-hidden="true" />
              <span className="tree-toggle"><span /></span>
              <button
                className="folder-select"
                type="button"
                onClick={(event) => { event.stopPropagation(); handleSelectClick(); }}
              >
                <span>
                  <IconMark value={customIcon} fallback={Folder} size={15} />
                </span>
                <span>{folder.name}</span>
              </button>
            </div>
          );
        })}
      </div>
      <NotebookFooter
        menuOpen={menuOpen}
        recentNotebooks={recentNotebooks}
        workspace={workspace}
        onManageNotebooks={onManageNotebooks}
        onNewNotebook={onNewNotebook}
        onOpenWorkspace={onOpenWorkspace}
        onSelectNotebook={onSelectNotebook}
        onToggleMenu={onToggleMenu}
      />
    </section>
  );
}

// ---------- Unified Tree (Single Pane / Section View second pane) ----------

function UnifiedNode({
  activePath,
  contents,
  depth,
  dropTargetFolder,
  folderDropIntent,
  folderOrderingMode,
  folders,
  hiddenFolderParentPath,
  metadata,
  notes,
  parentPath,
  selectedFolderPath,
  showPins,
  suppressFolderClickRef,
  workspace,
  onContextMenu,
  onFolderPointerDragStart,
  onPin,
  onPointerDragStart,
  onSelectFolder,
  onSelectNote,
  onSetFolderExpanded,
}: {
  activePath: string | null;
  contents: Map<string, string>;
  depth: number;
  dropTargetFolder?: string | null;
  folderDropIntent?: FolderDropIntent | null;
  folderOrderingMode: FolderOrderingMode;
  folders: FolderEntry[];
  hiddenFolderParentPath?: string;
  metadata: WorkspaceMetadata;
  notes: NoteEntry[];
  parentPath: string;
  selectedFolderPath?: string;
  showPins: boolean;
  suppressFolderClickRef: React.MutableRefObject<boolean>;
  workspace: string;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onFolderPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onPin: (path: string) => void;
  onPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onSelectFolder?: (path: string) => void;
  onSelectNote: (path: string) => void;
  onSetFolderExpanded: (path: string, expanded: boolean) => void;
}) {
  const childFolders = useMemo(
    () =>
      hiddenFolderParentPath === parentPath
        ? []
        : folderOrderingMode === "custom"
          ? orderFolders(
              folders.filter((f) => f.parent_path === parentPath && f.path !== "").map((folder) => ({ ...folder, children: [] })),
              parentPath,
              metadata,
            )
          : folders
              .filter((f) => f.parent_path === parentPath && f.path !== "")
              .map((folder) => ({ ...folder, children: [] }))
              .sort((a, b) => a.name.localeCompare(b.name)),
    [folderOrderingMode, folders, hiddenFolderParentPath, metadata, parentPath],
  );
  const childNotes = useMemo(
    () =>
      showPins
        ? orderNotes(notes.filter((n) => n.parent_path === parentPath), parentPath, metadata)
        : notes.filter((n) => n.parent_path === parentPath).slice().sort((a, b) => a.title.localeCompare(b.title)),
    [metadata, notes, parentPath, showPins],
  );

  return (
    <>
      {childFolders.map((folder) => (
        <UnifiedFolderRow
          key={folder.path}
          activePath={activePath}
          contents={contents}
          depth={depth}
          dropTargetFolder={dropTargetFolder}
          folderDropIntent={folderDropIntent}
          folderOrderingMode={folderOrderingMode}
          folder={folder}
          folders={folders}
          hiddenFolderParentPath={hiddenFolderParentPath}
          metadata={metadata}
          notes={notes}
          selectedFolderPath={selectedFolderPath}
          showPins={showPins}
          suppressFolderClickRef={suppressFolderClickRef}
          workspace={workspace}
          onContextMenu={onContextMenu}
          onFolderPointerDragStart={onFolderPointerDragStart}
          onPin={onPin}
          onPointerDragStart={onPointerDragStart}
          onSelectFolder={onSelectFolder}
          onSelectNote={onSelectNote}
          onSetFolderExpanded={onSetFolderExpanded}
        />
      ))}
      {childNotes.map((note) => {
        const customIcon = metadata.noteIcons[note.path];
        const pinned = Boolean(metadata.pinnedNotes[note.path]);
        return (
          <button
            key={note.path}
            className={`unified-note-row${activePath === note.path ? " is-active" : ""}`}
            style={{ "--row-indent": `${depth * 16}px` } as React.CSSProperties}
            data-note-path={note.path}
            type="button"
            onClick={() => onSelectNote(note.path)}
            onContextMenu={(event) => onContextMenu(event, { kind: "note", path: note.path })}
            onPointerDown={(event) => onPointerDragStart(note.path, event)}
          >
            <span data-no-note-drag>
              <IconMark value={customIcon} fallback={FileText} size={14} />
            </span>
            <span className="unified-note-title">{note.title}</span>
            {showPins && pinned ? <Pin size={12} fill="currentColor" style={{ flexShrink: 0, opacity: 0.5 }} /> : null}
          </button>
        );
      })}
    </>
  );
}

function UnifiedFolderRow({
  activePath,
  contents,
  depth,
  dropTargetFolder,
  folderDropIntent,
  folderOrderingMode,
  folder,
  folders,
  hiddenFolderParentPath,
  metadata,
  notes,
  selectedFolderPath,
  showPins,
  suppressFolderClickRef,
  workspace,
  onContextMenu,
  onFolderPointerDragStart,
  onPin,
  onPointerDragStart,
  onSelectFolder,
  onSelectNote,
  onSetFolderExpanded,
}: {
  activePath: string | null;
  contents: Map<string, string>;
  depth: number;
  dropTargetFolder?: string | null;
  folderDropIntent?: FolderDropIntent | null;
  folderOrderingMode: FolderOrderingMode;
  folder: FolderEntry;
  folders: FolderEntry[];
  hiddenFolderParentPath?: string;
  metadata: WorkspaceMetadata;
  notes: NoteEntry[];
  selectedFolderPath?: string;
  showPins: boolean;
  suppressFolderClickRef: React.MutableRefObject<boolean>;
  workspace: string;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onFolderPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onPin: (path: string) => void;
  onPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onSelectFolder?: (path: string) => void;
  onSelectNote: (path: string) => void;
  onSetFolderExpanded: (path: string, expanded: boolean) => void;
}) {
  const open = metadata.expandedFolders[folder.path] ?? true;
  const folderColor = metadata.folderColors[folder.path];
  const customIcon = metadata.folderIcons[folder.path];
  const dropIntent = folderDropIntent?.path === folder.path ? folderDropIntent : null;
  const hasChildren =
    folders.some((f) => f.parent_path === folder.path) ||
    notes.some((n) => n.parent_path === folder.path);

  return (
    <div className="unified-folder-node">
      <div
        className={`unified-folder-row${selectedFolderPath === folder.path ? " is-active" : ""}${(dropTargetFolder === folder.path || dropIntent?.kind === "into") ? " is-drop-target" : ""}${dropIntent?.kind === "before" ? " is-reorder-before" : ""}${dropIntent?.kind === "after" ? " is-reorder-after" : ""}`}
        style={{ "--row-indent": `${depth * 16}px` } as React.CSSProperties}
        data-folder-path={folder.path}
        onClick={() => {
          if (suppressFolderClickRef.current) {
            suppressFolderClickRef.current = false;
            return;
          }
          onSelectFolder?.(folder.path);
        }}
        onContextMenu={(event) => onContextMenu(event, { kind: "folder", path: folder.path })}
        onPointerDown={(event) => onFolderPointerDragStart(folder.path, event)}
      >
        <button
          className="tree-toggle"
          type="button"
          data-no-folder-drag
          onClick={(event) => {
            event.stopPropagation();
            onSetFolderExpanded(folder.path, !open);
          }}
        >
          {hasChildren && open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span style={folderColor ? { color: folderColor } : undefined} className="unified-folder-name">
          <IconMark value={customIcon} fallback={Folder} size={14} />
          <span>{folder.name}</span>
        </span>
      </div>
      {open && (
        <UnifiedNode
          activePath={activePath}
          contents={contents}
          depth={depth + 1}
          dropTargetFolder={dropTargetFolder}
          folderDropIntent={folderDropIntent}
          folderOrderingMode={folderOrderingMode}
          folders={folders}
          hiddenFolderParentPath={hiddenFolderParentPath}
          metadata={metadata}
          notes={notes}
          parentPath={folder.path}
          selectedFolderPath={selectedFolderPath}
          showPins={showPins}
          suppressFolderClickRef={suppressFolderClickRef}
          workspace={workspace}
          onContextMenu={onContextMenu}
          onFolderPointerDragStart={onFolderPointerDragStart}
          onPin={onPin}
          onPointerDragStart={onPointerDragStart}
          onSelectFolder={onSelectFolder}
          onSelectNote={onSelectNote}
          onSetFolderExpanded={onSetFolderExpanded}
        />
      )}
    </div>
  );
}

function UnifiedTreePane({
  activePath,
  bookmarks = [],
  bookmarksExpanded = true,
  createParentPath,
  contents,
  folderDropIntent,
  folderOrderingMode = "custom",
  folders,
  hiddenFolderParentPath,
  menuOpen = false,
  metadata,
  notes,
  recentNotebooks = [],
  rootPath,
  searchFocusRequest = 0,
  searchOpen = false,
  searchQuery = "",
  searchResults = [],
  selectedFolderPath,
  showBookmarks = false,
  showNotebookFooter = false,
  showPins = true,
  showSearch = false,
  suppressFolderClickRef,
  title,
  workspace,
  dropTargetFolder,
  onContextMenu,
  onCreateFolder,
  onCreateNote,
  onFolderPointerDragStart,
  onManageNotebooks,
  onNewNotebook,
  onOpenWorkspace,
  onPin,
  onPointerDragStart,
  onRemoveBookmark,
  onSearchQueryChange,
  onSelectBookmark,
  onSelectNotebook,
  onSelectFolder,
  onSelectNote,
  onSelectSearchResult,
  onSetFolderExpanded,
  onToggleBookmarksExpanded,
  onToggleMenu,
  onToggleSearch,
}: {
  activePath: string | null;
  bookmarks?: BookmarkView[];
  bookmarksExpanded?: boolean;
  createParentPath?: string;
  contents: Map<string, string>;
  folderDropIntent?: FolderDropIntent | null;
  folderOrderingMode?: FolderOrderingMode;
  dropTargetFolder?: string | null;
  folders: FolderEntry[];
  hiddenFolderParentPath?: string;
  menuOpen?: boolean;
  metadata: WorkspaceMetadata;
  notes: NoteEntry[];
  recentNotebooks?: RecentNotebook[];
  rootPath: string;
  searchFocusRequest?: number;
  searchOpen?: boolean;
  searchQuery?: string;
  searchResults?: SearchResult[];
  selectedFolderPath?: string;
  showBookmarks?: boolean;
  showNotebookFooter?: boolean;
  showPins?: boolean;
  showSearch?: boolean;
  suppressFolderClickRef: React.MutableRefObject<boolean>;
  title: string;
  workspace: string;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onCreateFolder?: (parentPath?: string) => void;
  onCreateNote?: (parentPath?: string) => void;
  onFolderPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onManageNotebooks?: () => void;
  onNewNotebook?: () => void;
  onOpenWorkspace?: () => void;
  onPin: (path: string) => void;
  onPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onRemoveBookmark?: (id: string) => void;
  onSearchQueryChange?: (query: string) => void;
  onSelectBookmark?: (bookmark: BookmarkEntry) => void;
  onSelectNotebook?: (path: string) => void;
  onSelectFolder?: (path: string) => void;
  onSelectNote: (path: string) => void;
  onSelectSearchResult?: (path: string) => void;
  onSetFolderExpanded: (path: string, expanded: boolean) => void;
  onToggleBookmarksExpanded?: () => void;
  onToggleMenu?: (event: React.MouseEvent) => void;
  onToggleSearch?: () => void;
}) {
  const parentForCreate = createParentPath ?? rootPath;

  return (
    <section className="unified-tree-pane">
      <div className="pane-header">
        <strong>{title}</strong>
        <div className="pane-actions">
          {showSearch && onToggleSearch ? (
            <button className="icon-button" type="button" disabled={!workspace} title="Search" onClick={onToggleSearch}>
              <Search size={16} />
            </button>
          ) : null}
          {onCreateFolder ? (
            <button className="icon-button" type="button" disabled={!workspace} title="New folder" onClick={() => onCreateFolder(parentForCreate)}>
              <Folder size={16} />
            </button>
          ) : null}
          {onCreateNote ? (
            <button className="icon-button" type="button" disabled={!workspace} title="New note" onClick={() => onCreateNote(parentForCreate)}>
              <Plus size={16} />
            </button>
          ) : null}
        </div>
      </div>
      {showSearch && searchOpen && onSearchQueryChange && onSelectSearchResult ? (
        <FolderSearch
          query={searchQuery}
          focusRequest={searchFocusRequest}
          results={searchResults}
          onQueryChange={onSearchQueryChange}
          onSelect={onSelectSearchResult}
        />
      ) : null}
      {showBookmarks && onRemoveBookmark && onSelectBookmark && onToggleBookmarksExpanded ? (
        <BookmarksSection
          activeFolderPath={selectedFolderPath}
          activeNotePath={activePath}
          bookmarks={bookmarks}
          expanded={bookmarksExpanded}
          onRemove={onRemoveBookmark}
          onSelect={onSelectBookmark}
          onToggle={onToggleBookmarksExpanded}
        />
      ) : null}
      <div
        className="unified-tree-scroll"
        data-pane-root-path={rootPath}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement | null)?.closest("[data-note-path], [data-folder-path]")) return;
          onContextMenu(event, { kind: "empty", parentPath: rootPath });
        }}
      >
        <UnifiedNode
          activePath={activePath}
          contents={contents}
          depth={0}
          dropTargetFolder={dropTargetFolder}
          folderDropIntent={folderDropIntent}
          folderOrderingMode={folderOrderingMode}
          folders={folders}
          hiddenFolderParentPath={hiddenFolderParentPath}
          metadata={metadata}
          notes={notes}
          parentPath={rootPath}
          selectedFolderPath={selectedFolderPath}
          showPins={showPins}
          suppressFolderClickRef={suppressFolderClickRef}
          workspace={workspace}
          onContextMenu={onContextMenu}
          onFolderPointerDragStart={onFolderPointerDragStart}
          onPin={onPin}
          onPointerDragStart={onPointerDragStart}
          onSelectFolder={onSelectFolder}
          onSelectNote={onSelectNote}
          onSetFolderExpanded={onSetFolderExpanded}
        />
      </div>
      {showNotebookFooter && onManageNotebooks && onNewNotebook && onOpenWorkspace && onSelectNotebook && onToggleMenu ? (
        <NotebookFooter
          menuOpen={menuOpen}
          recentNotebooks={recentNotebooks}
          workspace={workspace}
          onManageNotebooks={onManageNotebooks}
          onNewNotebook={onNewNotebook}
          onOpenWorkspace={onOpenWorkspace}
          onSelectNotebook={onSelectNotebook}
          onToggleMenu={onToggleMenu}
        />
      ) : null}
    </section>
  );
}

// ---------- End Unified Tree ----------

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
            content={contents.get(note.path) ?? ""}
            onContextMenu={onContextMenu}
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
            content={contents.get(note.path) ?? ""}
            onContextMenu={onContextMenu}
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

export function NoteCard({
  active,
  content,
  dragging,
  metadata,
  note,
  pinned,
  onContextMenu,
  onPin,
  onPointerDragStart,
  onSelect,
}: {
  active: boolean;
  content: string;
  dragging: boolean;
  metadata: WorkspaceMetadata;
  note: NoteEntry;
  pinned: boolean;
  onContextMenu: (event: React.MouseEvent, state: ContextMenuTarget) => void;
  onPin: (path: string) => void;
  onPointerDragStart: (path: string, event: React.PointerEvent<HTMLElement>) => void;
  onSelect: (path: string) => void;
}) {
  const customIcon = metadata.noteIcons[note.path];
  const preview = useMemo(() => readNotePreview(content), [content]);
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
        <span className="note-card-icon" data-no-note-drag>
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

function PaneResizer({
  label,
  variant = "inner",
  onPointerDown,
}: {
  label: string;
  variant?: "inner" | "left-of-main" | "right-of-main";
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      aria-label={label}
      className={`pane-resizer pane-resizer--${variant}`}
      role="separator"
      tabIndex={0}
      onPointerDown={onPointerDown}
    />
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

function RightSidebar({
  activeNote,
  frontmatter,
  frontmatterError,
  mode,
  outline,
  pendingNote,
  workspace,
  linkIndex,
  activePath,
  selectedFolder,
  folders,
  notes,
  metadata,
  onFrontmatterChange,
  onModeChange,
  onSelectOutline,
  onSelectBacklink,
}: {
  activeNote: NoteEntry | null;
  frontmatter: string;
  frontmatterError: string | null;
  mode: RightSidebarMode;
  outline: Array<{ id: string; text: string; level: number }>;
  pendingNote: DraftNote | null;
  workspace: string;
  linkIndex: LinkIndex | null;
  activePath: string | null;
  selectedFolder: string;
  folders: FolderEntry[];
  notes: NoteEntry[];
  metadata: WorkspaceMetadata;
  onFrontmatterChange: (frontmatter: string) => void;
  onModeChange: (mode: RightSidebarMode) => void;
  onSelectOutline: (id: string) => void;
  onSelectBacklink: (path: string) => void;
}) {
  const title =
    mode === "outline"
      ? "Outline"
      : mode === "frontmatter"
      ? "Frontmatter"
      : mode === "backlinks"
      ? "Backlinks"
      : "Properties";
  return (
    <aside className="right-sidebar">
      <div className="pane-header">
        <strong>{title}</strong>
        <div className="sidebar-tabs">
          <button className={`icon-button ${mode === "outline" ? "is-active" : ""}`} type="button" title="Outline" onClick={() => onModeChange("outline")}>
            <LayoutList size={16} />
          </button>
          <button className={`icon-button ${mode === "backlinks" ? "is-active" : ""}`} type="button" title="Backlinks" onClick={() => onModeChange("backlinks")}>
            <Link2 size={16} />
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
      ) : mode === "backlinks" ? (
        <BacklinksPane
          linkIndex={linkIndex}
          activePath={activePath}
          selectedFolder={selectedFolder}
          folders={folders}
          notes={notes}
          metadata={metadata}
          onSelectBacklink={onSelectBacklink}
        />
      ) : (
        <PropertiesPane activeNote={activeNote} pendingNote={pendingNote} workspace={workspace} />
      )}
    </aside>
  );
}

function BacklinksPane({
  linkIndex,
  activePath,
  selectedFolder,
  folders,
  notes,
  metadata,
  onSelectBacklink,
}: {
  linkIndex: LinkIndex | null;
  activePath: string | null;
  selectedFolder: string;
  folders: FolderEntry[];
  notes: NoteEntry[];
  metadata: WorkspaceMetadata;
  onSelectBacklink: (path: string) => void;
}) {
  if (!linkIndex) {
    return <p className="empty-sidebar-note">Indexing links…</p>;
  }
  // Prefer the open note; fall back to the selected folder (single-pane / section view).
  const targetPath = activePath ?? (selectedFolder || null);
  if (!targetPath) {
    return <p className="empty-sidebar-note">Select a note or folder to see what links to it.</p>;
  }
  const targetIsFolder = !activePath;
  const targetName = targetIsFolder
    ? folders.find((f) => f.path === targetPath)?.name ?? targetPath
    : notes.find((n) => n.path === targetPath)?.title ?? targetPath;
  const id = linkIndex.pathToId[targetPath];
  if (!id) {
    return (
      <p className="empty-sidebar-note">
        No incoming links to <strong>{targetName}</strong> yet.
      </p>
    );
  }
  const inbound = linkIndex.inbound[id] ?? [];
  const seen = new Set<string>();
  const rows = inbound.flatMap((ref) => {
    if (seen.has(ref.sourceId)) return [];
    seen.add(ref.sourceId);
    const source = linkIndex.notesById[ref.sourceId];
    if (!source) return [];
    const title = notes.find((n) => n.path === source.path)?.title ?? source.title;
    const icon = metadata.noteIcons[source.path];
    return [{ sourceId: ref.sourceId, path: source.path, title, icon }];
  });
  if (!rows.length) {
    return (
      <p className="empty-sidebar-note">
        No incoming links to <strong>{targetName}</strong> yet.
      </p>
    );
  }
  return (
    <div className="backlinks-list">
      {rows.map((row) => (
        <button
          className="backlinks-item"
          key={row.sourceId}
          type="button"
          title={row.path}
          onClick={() => onSelectBacklink(row.path)}
        >
          <IconMark value={row.icon} fallback={FileText} size={14} />
          <span className="backlinks-item-title">{row.title}</span>
        </button>
      ))}
    </div>
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
  const document = useMemo(
    () => createNoteDocument({ title: activeNote?.title ?? "", frontmatter, body: "" }),
    [activeNote?.title, frontmatter],
  );
  const fields = document.frontmatterFields.filter((field) => field.value.trim() !== "");
  const hasFrontmatter = frontmatter.trim().length > 0;
  const [showRaw, setShowRaw] = useState(hasFrontmatter);
  const rawRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (hasFrontmatter) setShowRaw(true);
  }, [hasFrontmatter]);

  function updateField(field: FrontmatterField, value: string) {
    onChange(updateNoteDocumentFrontmatterField(document, field, value).frontmatter);
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
  appFontFamily,
  appFontSize,
  colorScheme,
  editorFontFamily,
  editorFontSize,
  effectiveAccentColor,
  effectiveTitlebarColor,
  navigationStyle,
  resolvedTheme,
  spellcheckEnabled,
  themePresetId,
  accentTitlebar,
  titlebarColor,
  titlebarUseAccent,
  onAccentChange,
  onAccentReset,
  onAccentTitlebarChange,
  onAppFontFamilyChange,
  onAppFontSizeChange,
  onColorSchemeChange,
  onClose,
  onEditorFontFamilyChange,
  onEditorFontSizeChange,
  onNavigationStyleChange,
  onSpellcheckEnabledChange,
  onThemePresetChange,
  onTitlebarColorChange,
  onTitlebarUseAccentChange,
}: {
  accentColor: string | null;
  accentTitlebar: boolean;
  appFontFamily: string;
  appFontSize: number;
  colorScheme: ColorScheme;
  editorFontFamily: string;
  editorFontSize: number;
  effectiveAccentColor: string;
  effectiveTitlebarColor: string;
  navigationStyle: NavigationStyle;
  resolvedTheme: "light" | "dark";
  spellcheckEnabled: boolean;
  themePresetId: ThemePresetId;
  titlebarColor: string | null;
  titlebarUseAccent: boolean;
  onAccentChange: (color: string) => void;
  onAccentReset: () => void;
  onAccentTitlebarChange: (value: boolean) => void;
  onAppFontFamilyChange: (family: string) => void;
  onAppFontSizeChange: (size: number) => void;
  onColorSchemeChange: (scheme: ColorScheme) => void;
  onClose: () => void;
  onEditorFontFamilyChange: (family: string) => void;
  onEditorFontSizeChange: (size: number) => void;
  onNavigationStyleChange: (style: NavigationStyle) => void;
  onSpellcheckEnabledChange: (value: boolean) => void;
  onThemePresetChange: (theme: ThemePresetId) => void;
  onTitlebarColorChange: (color: string) => void;
  onTitlebarUseAccentChange: (value: boolean) => void;
}) {
  const [appFontSizeDraft, setAppFontSizeDraft] = useState(String(appFontSize));
  const [editorFontSizeDraft, setEditorFontSizeDraft] = useState(String(editorFontSize));

  useEffect(() => {
    setAppFontSizeDraft(String(appFontSize));
  }, [appFontSize]);

  useEffect(() => {
    setEditorFontSizeDraft(String(editorFontSize));
  }, [editorFontSize]);

  const commitAppFontSize = (value: string) => {
    const next = readAppearanceFontSize(Number(value), appFontSize);
    onAppFontSizeChange(next);
    setAppFontSizeDraft(String(next));
  };

  const commitEditorFontSize = (value: string) => {
    const next = readAppearanceFontSize(Number(value), editorFontSize);
    onEditorFontSizeChange(next);
    setEditorFontSizeDraft(String(next));
  };

  const sections = [
    {
      id: "appearance",
      label: "Appearance",
      icon: resolvedTheme === "dark" ? Moon : Sun,
      content: (
        <div className="settings-card">
          <div className="setting-row">
            <span>
              <strong>Navigation style</strong>
              <small>How folders and notes are displayed in the sidebar. Settings are saved per notebook.</small>
            </span>
            <select
              className="settings-select"
              value={navigationStyle}
              aria-label="Navigation style"
              onChange={(event) => onNavigationStyleChange(event.target.value as NavigationStyle)}
            >
              <option value="dual-pane">Dual Pane</option>
              <option value="single-pane">Single Pane</option>
              <option value="section-view">Dual Pane (Sections)</option>
            </select>
          </div>
          <div className="setting-row">
            <span>
              <strong>Base color scheme</strong>
              <small>Use a fixed scheme or follow this computer.</small>
            </span>
            <select className="settings-select" value={colorScheme} aria-label="Base color scheme" onChange={(event) => onColorSchemeChange(event.target.value as ColorScheme)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
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
          <div className="setting-row">
            <span>
              <strong>Accent title bar</strong>
              <small>Color the window title bar for this notebook.</small>
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={accentTitlebar}
                onChange={(event) => onAccentTitlebarChange(event.target.checked)}
              />
              <span className="switch-track" />
            </label>
          </div>
          {accentTitlebar ? (
            <>
              <div className="setting-row setting-row-sub">
                <span>
                  <strong>Use accent color for titlebar background</strong>
                  <small>Keep the title bar in step with the {resolvedTheme} accent color.</small>
                </span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={titlebarUseAccent}
                    onChange={(event) => onTitlebarUseAccentChange(event.target.checked)}
                  />
                  <span className="switch-track" />
                </label>
              </div>
              {!titlebarUseAccent ? (
                <div className="setting-row setting-row-sub">
                  <span>
                    <strong>Titlebar background</strong>
                    <small>Choose a custom {resolvedTheme} mode title bar color.</small>
                  </span>
                  <div className="accent-control">
                    <input
                      aria-label="Titlebar background"
                      type="color"
                      value={titlebarColor || effectiveTitlebarColor}
                      onChange={(event) => onTitlebarColorChange(event.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          <div className="setting-row">
            <span>
              <strong>App font</strong>
              <small>Controls panes, settings, buttons, and other interface text.</small>
            </span>
            <div className="font-controls">
              <input
                className="settings-text-input"
                value={appFontFamily}
                aria-label="App font family"
                onChange={(event) => onAppFontFamilyChange(event.target.value)}
              />
              <input
                className="settings-number-input"
                type="number"
                min={11}
                max={28}
                value={appFontSizeDraft}
                aria-label="App font size"
                onChange={(event) => {
                  const value = event.target.value;
                  setAppFontSizeDraft(value);
                  const numericValue = Number(value);
                  if (value !== "" && Number.isFinite(numericValue) && numericValue >= 11 && numericValue <= 28) {
                    onAppFontSizeChange(numericValue);
                  }
                }}
                onBlur={(event) => commitAppFontSize(event.target.value)}
              />
            </div>
          </div>
          <div className="setting-row">
            <span>
              <strong>Editor font</strong>
              <small>Controls the note title, rich editor, and raw Markdown text.</small>
            </span>
            <div className="font-controls">
              <input
                className="settings-text-input"
                value={editorFontFamily}
                aria-label="Editor font family"
                onChange={(event) => onEditorFontFamilyChange(event.target.value)}
              />
              <input
                className="settings-number-input"
                type="number"
                min={11}
                max={28}
                value={editorFontSizeDraft}
                aria-label="Editor font size"
                onChange={(event) => {
                  const value = event.target.value;
                  setEditorFontSizeDraft(value);
                  const numericValue = Number(value);
                  if (value !== "" && Number.isFinite(numericValue) && numericValue >= 11 && numericValue <= 28) {
                    onEditorFontSizeChange(numericValue);
                  }
                }}
                onBlur={(event) => commitEditorFontSize(event.target.value)}
              />
            </div>
          </div>
          <div className="setting-row">
            <span>
              <strong>Check spelling while typing</strong>
              <small>Only applies inside note body editors.</small>
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={spellcheckEnabled}
                onChange={(event) => onSpellcheckEnabledChange(event.target.checked)}
              />
              <span className="switch-track" />
            </label>
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

function RecentlyDeletedDialog({
  entries,
  loading,
  onClose,
  onRestore,
  onPurge,
  onPurgeAll,
}: {
  entries: TrashEntry[];
  loading: boolean;
  onClose: () => void;
  onRestore: (id: string) => void | Promise<void>;
  onPurge: (id: string) => void | Promise<void>;
  onPurgeAll: () => void | Promise<void>;
}) {
  const formatDate = (millis: number) => {
    const date = new Date(millis);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="dialog recently-deleted-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-icon">
            <Trash2 size={18} />
          </span>
          <div>
            <h2>Recently Deleted</h2>
            <p>Items are kept here for 30 days, then removed automatically.</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="recently-deleted-list">
          {loading && !entries.length ? <p className="empty-sidebar-note">Loading…</p> : null}
          {!loading && !entries.length ? <p className="empty-sidebar-note">Nothing here yet.</p> : null}
          {entries.map((entry) => (
            <div className="recently-deleted-row" key={entry.id}>
              {entry.kind === "folder" ? <Folder size={15} /> : <FileText size={15} />}
              <div className="recently-deleted-info">
                <strong>{entry.displayName}</strong>
                <small>
                  {entry.originalPath || "(root)"} · deleted {formatDate(entry.deletedAt)}
                </small>
              </div>
              <button
                type="button"
                className="recently-deleted-action"
                title="Restore to its original location"
                onClick={() => void onRestore(entry.id)}
              >
                Restore
              </button>
              <button
                type="button"
                className="icon-button"
                title="Delete permanently"
                onClick={() => {
                  if (window.confirm(`Permanently delete "${entry.displayName}"?`)) {
                    void onPurge(entry.id);
                  }
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <div className="dialog-footer">
          <button
            type="button"
            className="danger-button"
            disabled={!entries.length}
            onClick={() => {
              if (window.confirm("Permanently delete all items in Recently Deleted?")) {
                void onPurgeAll();
              }
            }}
          >
            Empty Recently Deleted
          </button>
        </div>
      </section>
    </div>
  );
}

function VersionHistoryDialog({
  activeNoteEditable,
  note,
  workspace,
  onClose,
  onRestore,
}: {
  activeNoteEditable: boolean;
  note: VersionHistoryState;
  workspace: string | null;
  onClose: () => void;
  onRestore: (path: string, id: string) => void | Promise<void>;
}) {
  const [versions, setVersions] = useState<NoteVersionEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listNoteVersions(workspace, note.path)
      .then((entries) => {
        if (cancelled) return;
        setVersions(entries);
        setSelectedId(entries[0]?.id ?? null);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [note.path, workspace]);

  useEffect(() => {
    if (!workspace || !selectedId) {
      setPreview("");
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setError(null);
    void readNoteVersion(workspace, note.path, selectedId)
      .then((content) => {
        if (!cancelled) setPreview(content);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [note.path, selectedId, workspace]);

  const selected = versions.find((entry) => entry.id === selectedId) ?? null;
  const formatDate = (millis: number) => {
    const date = new Date(millis);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const formatReason = (reason: string) => reason.replace(/-/g, " ");

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="dialog version-history-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-icon">
            <History size={18} />
          </span>
          <div>
            <h2>Version History</h2>
            <p>{note.title}</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="version-history-body">
          <aside className="version-history-list">
            {loading && !versions.length ? <p className="empty-sidebar-note">Loading…</p> : null}
            {!loading && !versions.length ? <p className="empty-sidebar-note">No saved versions yet.</p> : null}
            {versions.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === selectedId ? "version-row is-selected" : "version-row"}
                onClick={() => setSelectedId(entry.id)}
              >
                <strong>{formatDate(entry.createdAt)}</strong>
                <span>{formatReason(entry.reason)} · {formatBytes(entry.contentLength)}</span>
                {entry.path !== note.path ? <small>{entry.path}</small> : null}
              </button>
            ))}
          </aside>
          <div className="version-preview">
            {error ? <p className="app-error">{error}</p> : null}
            {!selected ? (
              <p className="empty-sidebar-note">Select a version to preview it.</p>
            ) : previewLoading ? (
              <p className="empty-sidebar-note">Loading preview…</p>
            ) : (
              <pre>{preview}</pre>
            )}
          </div>
        </div>
        {!activeNoteEditable ? (
          <p className="note-lock-warning version-history-warning">This note is read-only in this window. You can preview versions, but restore is disabled until editing is available.</p>
        ) : null}
        <div className="dialog-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!selected || !activeNoteEditable}
            onClick={() => {
              if (!selected) return;
              if (window.confirm("Restore this version? The current note will be saved as a version first.")) {
                void Promise.resolve(onRestore(note.path, selected.id)).then(onClose);
              }
            }}
          >
            <RotateCcw size={15} />
            Restore
          </button>
        </div>
      </section>
    </div>
  );
}

function IconBrowserModal({
  state,
  onClose,
  onReset,
  onSelect,
}: {
  state: IconBrowserState;
  onClose: () => void;
  onReset?: () => void;
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
            <p>{state.name}</p>
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
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
          <button className="toolbar-button" type="button" onClick={() => onSelect("")}>
            Clear
          </button>
          {onReset ? (
            <button className="toolbar-button" type="button" onClick={onReset}>
              Reset
            </button>
          ) : null}
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

function useClampedContextMenuPosition(x: number, y: number) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ left: x, top: y });

  const updateMenuPosition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const padding = 8;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(padding, window.innerWidth - rect.width - padding);
    const maxTop = Math.max(padding, window.innerHeight - rect.height - padding);
    const left = Math.min(Math.max(x, padding), maxLeft);
    const top = Math.min(Math.max(y, padding), maxTop);

    setMenuStyle((current) => (current.left === left && current.top === top ? current : { left, top }));
  }, [x, y]);

  useLayoutEffect(() => {
    updateMenuPosition();
  });

  useEffect(() => {
    window.addEventListener("resize", updateMenuPosition);
    return () => window.removeEventListener("resize", updateMenuPosition);
  }, [updateMenuPosition]);

  return { menuRef, menuStyle };
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
  const { menuRef, menuStyle } = useClampedContextMenuPosition(state.x, state.y);

  return (
    <div className="context-menu" ref={menuRef} style={menuStyle} onClick={onClose}>
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
  activeCreateNoteParentName,
  createFolderParentName,
  createFolderLabel,
  createNoteParentName,
  folderColorSubject,
  isBookmarked,
  showCreateSection,
  state,
  onCreateFolder,
  onCreateNote,
  onCreateNoteInActiveFolder,
  onCreateSection,
  onDelete,
  onDuplicate,
  onMoveTo,
  onOpenInNewTab,
  onOpenInNewWindow,
  onReveal,
  onRenameFolder,
  onSetFolderColor,
  onSetFolderIcon,
  onSetNoteIcon,
  onVersionHistory,
  onToggleBookmark,
  onClose,
}: {
  activeCreateNoteParentName?: string;
  createFolderParentName: string;
  createFolderLabel?: string;
  createNoteParentName: string;
  folderColorSubject: "folder" | "section";
  isBookmarked: boolean;
  showCreateSection: boolean;
  state: ContextMenuState;
  onCreateFolder: () => void;
  onCreateNote: () => void;
  onCreateNoteInActiveFolder?: () => void;
  onCreateSection: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveTo: () => void;
  onOpenInNewTab: () => void;
  onOpenInNewWindow: () => void;
  onReveal: () => void;
  onRenameFolder: () => void;
  onSetFolderColor: () => void;
  onSetFolderIcon: () => void;
  onSetNoteIcon: () => void;
  onVersionHistory: () => void;
  onToggleBookmark: () => void;
  onClose: () => void;
}) {
  const { menuRef, menuStyle } = useClampedContextMenuPosition(state.x, state.y);

  return (
    <div className="context-menu" ref={menuRef} style={menuStyle} onClick={onClose}>
      {state.kind !== "note" ? (
        <>
          <button type="button" onClick={onCreateNote}>
            <FileText size={14} />
            <span>New Note in {createNoteParentName}</span>
          </button>
          {activeCreateNoteParentName && onCreateNoteInActiveFolder ? (
            <button type="button" onClick={onCreateNoteInActiveFolder}>
              <FileText size={14} />
              <span>New Note in {activeCreateNoteParentName}</span>
            </button>
          ) : null}
          <button type="button" onClick={onCreateFolder}>
            <Folder size={14} />
            <span>{createFolderLabel ?? "New Folder"} in {createFolderParentName}</span>
          </button>
        </>
      ) : null}
      {showCreateSection ? (
        <button type="button" onClick={onCreateSection}>
          <LayoutList size={14} />
          <span>New Section</span>
        </button>
      ) : null}
      {state.kind === "folder" ? (
        <>
          <button type="button" onClick={onOpenInNewWindow}>
            <PanelRightOpen size={14} />
            <span>Open in New Window</span>
          </button>
          <button type="button" onClick={onReveal}>
            <FolderOpen size={14} />
            <span>Reveal in Finder</span>
          </button>
          {state.path ? (
            <>
              <button type="button" onClick={onToggleBookmark}>
                <Bookmark size={14} />
                <span>{isBookmarked ? "Remove Bookmark" : "Add Bookmark"}</span>
              </button>
              <button type="button" onClick={onMoveTo}>
                <MoveRight size={14} />
                <span>Move to…</span>
              </button>
              <button type="button" onClick={onRenameFolder}>
                <Pencil size={14} />
                <span>Rename Folder</span>
              </button>
            </>
          ) : null}
          <button type="button" onClick={onSetFolderIcon}>
            <FileText size={14} />
            <span>Change Folder Icon</span>
          </button>
          <button type="button" onClick={onSetFolderColor}>
            <Palette size={14} />
            <span>Change {folderColorSubject === "section" ? "Section" : "Folder"} Color</span>
          </button>
        </>
      ) : null}
      {state.kind === "note" ? (
        <>
          <button type="button" onClick={onOpenInNewTab}>
            <Plus size={14} />
            <span>Open in New Tab</span>
          </button>
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
          <button type="button" onClick={onMoveTo}>
            <MoveRight size={14} />
            <span>Move to…</span>
          </button>
          <button type="button" onClick={onDuplicate}>
            <Copy size={14} />
            <span>Duplicate</span>
          </button>
          <button type="button" onClick={onSetNoteIcon}>
            <FileText size={14} />
            <span>Change Note Icon</span>
          </button>
          <button type="button" onClick={onVersionHistory}>
            <History size={14} />
            <span>Version History</span>
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
  onReset,
  onSubmit,
}: {
  appError: string | null;
  state: PropertyDialogState;
  onChange: (value: string) => void;
  onClose: () => void;
  onReset?: () => void;
  onSubmit: () => void;
}) {
  const config = {
    "rename-folder": {
      title: "Rename folder",
      description: state.name,
      label: "Folder name",
      placeholder: "Folder name",
      icon: <Pencil size={18} />,
      type: "text",
      action: "Rename",
    },
    "folder-icon": {
      title: "Folder icon",
      description: state.name,
      label: "Icon",
      placeholder: "Emoji or short mark",
      icon: <Folder size={18} />,
      type: "text",
      action: "Save",
    },
    "folder-color": {
      title: state.kind === "folder-color" && state.subject === "section" ? "Section color" : "Folder color",
      description: state.name,
      label: "Color",
      placeholder: "#4b7d75",
      icon: <Palette size={18} />,
      type: "color",
      action: "Save",
    },
    "note-icon": {
      title: "Note icon",
      description: state.name,
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
          {onReset ? (
            <button className="toolbar-button dialog-reset-button" type="button" onClick={onReset}>
              Reset
            </button>
          ) : null}
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

function MoveDialog({
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

export type LinkPickerResult = { href: string; title: string };

function EmojiPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (shortcode: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searching = Boolean(query.trim());
  const filtered = useMemo(() => searchEmojiItems(gitHubEmojis, query), [query]);
  const browseSections = useMemo(() => buildEmojiBrowseSections(gitHubEmojis), []);
  const browsable = useMemo(() => browseSections.flatMap((section) => section.items), [browseSections]);
  const visibleItems = searching ? filtered : browsable;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const submitAtIndex = (index: number) => {
    const emoji = visibleItems[index];
    const shortcode = emoji?.shortcodes[0] ?? emoji?.name;
    if (shortcode) onPick(shortcode);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog emoji-picker" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-icon">😊</span>
          <div>
            <h2>Insert emoji</h2>
            <p>Search by emoji name or shortcode</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <input
          className="dialog-input"
          placeholder="Search emoji"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedIndex((index) => Math.min(index + 1, Math.max(visibleItems.length - 1, 0)));
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
        <div className={`emoji-picker-list${searching ? " is-searching" : ""}`} role="listbox">
          {searching ? (
            filtered.length ? filtered.map((emoji, index) => (
              <EmojiSearchRow
                emoji={emoji}
                index={index}
                key={`${emoji.name}-${emoji.shortcodes[0] ?? ""}`}
                selectedIndex={selectedIndex}
                onPick={submitAtIndex}
                onSelect={setSelectedIndex}
              />
            )) : <div className="move-empty">No matches</div>
          ) : browseSections.length ? (
            browseSections.map((section) => {
              const sectionStart = browsable.indexOf(section.items[0]);
              return (
                <section className="emoji-picker-section" key={section.id}>
                  <h3>{section.title}</h3>
                  <div className="emoji-picker-grid">
                    {section.items.map((emoji, index) => {
                      const totalIndex = sectionStart + index;
                      const shortcode = emoji.shortcodes[0] ?? emoji.name;
                      return (
                        <button
                          key={`${emoji.name}-${shortcode}`}
                          type="button"
                          className={`emoji-picker-tile${totalIndex === selectedIndex ? " is-selected" : ""}`}
                          aria-label={`${humanizeEmojiName(emoji.name)} :${shortcode}:`}
                          title={`:${shortcode}:`}
                          onMouseEnter={() => setSelectedIndex(totalIndex)}
                          onClick={() => submitAtIndex(totalIndex)}
                        >
                          {emoji.emoji ?? "?"}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })
          ) : (
            <div className="move-empty">No matches</div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmojiSearchRow({
  emoji,
  index,
  selectedIndex,
  onPick,
  onSelect,
}: {
  emoji: EmojiItem;
  index: number;
  selectedIndex: number;
  onPick: (index: number) => void;
  onSelect: (index: number) => void;
}) {
  return (
    <button
      type="button"
      className={`emoji-picker-row${index === selectedIndex ? " is-selected" : ""}`}
      onMouseEnter={() => onSelect(index)}
      onClick={() => onPick(index)}
    >
      <span className="emoji-picker-glyph">{emoji.emoji ?? "?"}</span>
      <span className="emoji-picker-title">{humanizeEmojiName(emoji.name)}</span>
      <span className="emoji-picker-shortcode">:{emoji.shortcodes[0] ?? emoji.name}:</span>
    </button>
  );
}

function searchEmojiItems(items: EmojiItem[], query: string) {
  const normalized = query.trim().replace(/^:|:$/g, "").toLowerCase();
  if (!normalized) return [];
  return items
    .filter((emoji) =>
      emoji.name.toLowerCase().includes(normalized) ||
      emoji.shortcodes.some((shortcode) => shortcode.toLowerCase().includes(normalized)) ||
      emoji.tags.some((tag) => tag.toLowerCase().includes(normalized)),
    )
    .slice(0, 80);
}

type EmojiBrowseSection = {
  id: string;
  title: string;
  items: EmojiItem[];
};

const emojiGroupOrder = [
  "(smileys)",
  "people & body",
  "animals & nature",
  "food & drink",
  "activities",
  "travel & places",
  "objects",
  "symbols",
  "flags",
  "GitHub",
] as const;

function buildEmojiBrowseSections(items: EmojiItem[]): EmojiBrowseSection[] {
  const sections = new Map<string, EmojiItem[]>();
  emojiGroupOrder.forEach((group) => sections.set(group, []));

  items.forEach((emoji) => {
    if (!emoji.emoji || emoji.name.startsWith("regional_indicator_") || emoji.group === "components") return;
    const group = emoji.group || "(smileys)";
    sections.get(group)?.push(emoji);
  });

  return emojiGroupOrder
    .map((group) => ({
      id: group,
      title: emojiGroupTitle(group),
      items: sections.get(group) ?? [],
    }))
    .filter((section) => section.items.length);
}

function emojiGroupTitle(group: string) {
  switch (group) {
    case "(smileys)":
      return "Smileys & Emotion";
    case "people & body":
      return "People & Body";
    case "animals & nature":
      return "Animals & Nature";
    case "food & drink":
      return "Food & Drink";
    case "travel & places":
      return "Travel & Places";
    default:
      return group.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
}

function humanizeEmojiName(name: string) {
  return name.replace(/[_-]+/g, " ");
}

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

function DictationPanel({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (text: string) => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState("Preparing microphone");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [level, setLevel] = useState(0);
  const interimTranscriptRef = useRef("");

  const commitInterimTranscript = useCallback(() => {
    const value = interimTranscriptRef.current.trim();
    if (!value) return;
    onInsert(value);
    setFinalTranscript((current) => `${current}${value} `);
    interimTranscriptRef.current = "";
    setInterimTranscript("");
  }, [onInsert]);

  const stopDictation = useCallback(() => {
    commitInterimTranscript();
    setEnabled(false);
  }, [commitInterimTranscript]);

  const closeDictation = useCallback(() => {
    commitInterimTranscript();
    onClose();
  }, [commitInterimTranscript, onClose]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((items) => setDevices(items.filter((item) => item.kind === "audioinput")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus("Stopped");
      setLevel(0);
      setInterimTranscript("");
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setStatus("Unavailable");
      setError("Speech recognition is not available in this app webview on this Mac.");
      setEnabled(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Unavailable");
      setError("Microphone access is not available in this app webview.");
      setEnabled(false);
      return;
    }

    let cancelled = false;
    let restartTimer = 0;
    let animationFrame = 0;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    const recognition = new Recognition();

    async function start() {
      try {
        setStatus("Requesting microphone");
        setError(null);
        const audio: MediaTrackConstraints | boolean = selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId } }
          : true;
        stream = await navigator.mediaDevices.getUserMedia({ audio });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const inputs = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = inputs.filter((item) => item.kind === "audioinput");
        setDevices(audioInputs);

        const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextConstructor) {
          audioContext = new AudioContextConstructor();
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const samples = new Uint8Array(analyser.frequencyBinCount);
          const updateLevel = () => {
            if (cancelled) return;
            analyser.getByteFrequencyData(samples);
            const average = samples.reduce((sum, value) => sum + value, 0) / Math.max(samples.length, 1);
            setLevel(Math.min(1, average / 128));
            animationFrame = window.requestAnimationFrame(updateLevel);
          };
          updateLevel();
        }

        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = navigator.language || "en-US";
        recognition.onstart = () => {
          if (!cancelled) setStatus("Listening");
        };
        recognition.onresult = (event) => {
          if (cancelled) return;
          let interim = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results.item(index);
            const transcript = result.item(0).transcript;
            if (result.isFinal) {
              interimTranscriptRef.current = "";
              setInterimTranscript("");
              setFinalTranscript((current) => `${current}${transcript.trim()} `);
              onInsert(transcript);
            } else {
              interim += transcript;
            }
          }
          const normalizedInterim = interim.trim();
          interimTranscriptRef.current = normalizedInterim;
          setInterimTranscript(normalizedInterim);
        };
        recognition.onerror = (event) => {
          if (cancelled) return;
          const message = dictationErrorMessage(event);
          setError(message);
          setStatus("Needs attention");
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            setEnabled(false);
          }
        };
        recognition.onend = () => {
          if (cancelled) return;
          commitInterimTranscript();
          restartTimer = window.setTimeout(() => {
            try {
              recognition.start();
            } catch {
              setStatus("Stopped");
            }
          }, 250);
        };
        recognition.start();
      } catch (caught) {
        if (cancelled) return;
        setStatus("Unavailable");
        setError(caught instanceof Error ? caught.message : String(caught));
        setEnabled(false);
      }
    }

    void start();

    return () => {
      cancelled = true;
      window.clearTimeout(restartTimer);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      try {
        recognition.onend = null;
        recognition.onerror = null;
        recognition.onresult = null;
        recognition.stop();
      } catch {
        try {
          recognition.abort();
        } catch {
          // Ignore cleanup errors from engines that were never fully started.
        }
      }
      stream?.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
      setLevel(0);
    };
  }, [commitInterimTranscript, enabled, onInsert, selectedDeviceId]);

  const insertedCount = finalTranscript.trim() ? finalTranscript.trim().split(/\s+/).length : 0;

  return (
    <div className="dictation-popover" role="dialog" aria-modal="false" aria-labelledby="dictation-title">
      <div className="dictation-header">
        <span className={enabled ? "dictation-icon is-recording" : "dictation-icon"}>
          <Mic size={17} />
        </span>
        <div>
          <h2 id="dictation-title">Dictation</h2>
          <p>{status}{insertedCount ? ` - ${insertedCount} words inserted` : ""}</p>
        </div>
        <button className="icon-button" type="button" title="Close dictation" onClick={closeDictation}>
          <X size={17} />
        </button>
      </div>
      <label className="field-label" htmlFor="dictation-source">
        Microphone
      </label>
      <select
        id="dictation-source"
        className="dialog-input dictation-select"
        value={selectedDeviceId}
        onChange={(event) => {
          setSelectedDeviceId(event.target.value);
          setEnabled(true);
        }}
        disabled={!devices.length}
      >
        <option value="">System default</option>
        {devices.map((device, index) => (
          <option key={device.deviceId || index} value={device.deviceId}>
            {device.label || `Microphone ${index + 1}`}
          </option>
        ))}
      </select>
      <div className="dictation-meter" aria-hidden="true">
        <span style={{ width: `${Math.max(6, Math.round(level * 100))}%` }} />
      </div>
      <p className="dictation-live-text" aria-live="polite">
        {interimTranscript ? `Hearing: ${interimTranscript}` : "Recognized text is inserted directly into the note."}
      </p>
      {error ? <p className="dialog-error">{error}</p> : null}
      <div className="dialog-actions">
        {enabled ? (
          <button className="secondary-button" type="button" onClick={stopDictation}>
            <Square size={14} />
            Stop
          </button>
        ) : (
          <button className="primary-button" type="button" onClick={() => setEnabled(true)}>
            <Mic size={14} />
            Start
          </button>
        )}
      </div>
    </div>
  );
}

function ImageInsertDialog({
  workspace,
  onClose,
  onError,
  onInsert,
}: {
  workspace: string;
  onClose: () => void;
  onError: (message: string) => void;
  onInsert: (src: string, alt?: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [saving, setSaving] = useState(false);

  async function insertFile(file: File | null | undefined) {
    if (!file) return;
    if (!workspace) {
      onError("Open a notebook before inserting local images.");
      return;
    }
    setSaving(true);
    try {
      const src = await saveAsset(workspace, file);
      onInsert(src, alt || file.name || "Image");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form
        className="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim()) onInsert(url.trim(), alt || "Image");
        }}
      >
        <div className="dialog-header">
          <span className="dialog-icon">
            <FileText size={18} />
          </span>
          <div>
            <h2>Insert image</h2>
            <p>Add an image URL or choose a local file.</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <label className="field-label" htmlFor="image-url">Image URL</label>
        <input
          id="image-url"
          className="dialog-input"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/image.png"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
        />
        <label className="field-label" htmlFor="image-alt">Alt text</label>
        <input
          id="image-alt"
          className="dialog-input"
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
          placeholder="Image"
          spellCheck={false}
        />
        <label className="toolbar-button image-file-button">
          Choose Local Image
          <input
            type="file"
            accept="image/*"
            disabled={saving}
            onChange={(event) => {
              void insertFile(event.currentTarget.files?.[0]);
            }}
          />
        </label>
        <div className="dialog-actions">
          <button className="toolbar-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={!url.trim() || saving}>
            Insert
          </button>
        </div>
      </form>
    </div>
  );
}

function LinkPicker({
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

function formatUnknownError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function nextUntitledNoteTitle(usedTitles: Set<string>) {
  if (!usedTitles.has("Untitled")) return "Untitled";
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `Untitled ${suffix}`;
    if (!usedTitles.has(candidate)) return candidate;
  }
}

function isDuplicateNoteTitleError(error: unknown) {
  return formatUnknownError(error).toLowerCase().includes("note with that title already exists");
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

function readStoredNumber(key: string, fallback: number) {
  const rawValue = localStorage.getItem(key);
  if (rawValue === null) return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readStoredSpellcheckEnabled() {
  const value = localStorage.getItem(spellcheckKey);
  return value === null ? true : value === "true";
}

function countPlainTextMatches(text: string, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const haystack = text.toLowerCase();
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function menuFormatCommandToEditorCommand(command: string): EditorCommand | null {
  const map: Record<string, EditorCommand> = {
    format_bold: "bold",
    format_italic: "italic",
    format_strike: "strike",
    format_code: "code",
    format_highlight: "highlight",
    format_link: "link",
    format_clear: "clear",
    format_paragraph: "paragraph",
    format_h1: "h1",
    format_h2: "h2",
    format_h3: "h3",
    format_h4: "h4",
    format_h5: "h5",
    format_h6: "h6",
    format_bullet_list: "bulletList",
    format_ordered_list: "orderedList",
    format_task_list: "taskList",
    format_quote: "quote",
    format_code_block: "codeBlock",
    format_divider: "divider",
    format_table: "table",
  };
  return map[command] ?? null;
}

function readStoredEditorWidthMode(): EditorWidthMode {
  const value = localStorage.getItem(widthModeKey);
  if (value === "comfortable" || value === "narrow" || value === "full") return value;
  return localStorage.getItem(legacyFullWidthKey) === "true" ? "full" : "comfortable";
}

function readStoredNoteAlignment(): NoteAlignment {
  const value = localStorage.getItem(alignmentKey);
  return value === "left" || value === "center" ? value : "center";
}

function readAppearanceFontSize(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 11 && value <= 28 ? value : fallback;
}

function readStoredLastPath(workspace: string): string | null {
  try {
    const raw = localStorage.getItem(lastPathKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { workspace?: string; path?: string };
    return parsed.workspace === workspace && typeof parsed.path === "string" ? parsed.path : null;
  } catch {
    return null;
  }
}

function readStoredWindowSize(): { width: number; height: number } | null {
  try {
    const raw = localStorage.getItem(windowSizeKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown };
    const width = Number(parsed.width);
    const height = Number(parsed.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  } catch {
    return null;
  }
}

function readStoredWindowPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(windowPositionKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

function writeStoredWindowSize(size: { width: number; height: number }) {
  try {
    localStorage.setItem(windowSizeKey, JSON.stringify(size));
  } catch {
    // localStorage may be unavailable (private mode quota); ignore.
  }
}

function writeStoredWindowPosition(position: { x: number; y: number }) {
  try {
    localStorage.setItem(windowPositionKey, JSON.stringify(position));
  } catch {
    // localStorage may be unavailable (private mode quota); ignore.
  }
}

function fitWindowToMonitors(
  position: { x: number; y: number },
  size: { width: number; height: number },
  monitors: Monitor[],
) {
  const target = monitors.reduce((nearest, monitor) => {
    return monitorDistance(position, monitor) < monitorDistance(position, nearest) ? monitor : nearest;
  });
  const { workArea } = target;
  const fittedSize = new PhysicalSize(
    Math.min(size.width, workArea.size.width),
    Math.min(size.height, workArea.size.height),
  );
  const maxX = workArea.position.x + Math.max(workArea.size.width - fittedSize.width, 0);
  const maxY = workArea.position.y + Math.max(workArea.size.height - fittedSize.height, 0);
  return {
    position: new PhysicalPosition(
      clamp(position.x, workArea.position.x, maxX),
      clamp(position.y, workArea.position.y, maxY),
    ),
    size: fittedSize,
  };
}

function monitorDistance(position: { x: number; y: number }, monitor: Monitor) {
  const { workArea } = monitor;
  const x = clamp(position.x, workArea.position.x, workArea.position.x + workArea.size.width);
  const y = clamp(position.y, workArea.position.y, workArea.position.y + workArea.size.height);
  return (position.x - x) ** 2 + (position.y - y) ** 2;
}

type StoredSession = { openTabs: string[]; activeTab: string | null };

function readStoredSession(workspace: string): StoredSession {
  try {
    const raw = localStorage.getItem(`${sessionKeyPrefix}${workspace}`);
    if (!raw) return { openTabs: [], activeTab: null };
    const parsed = JSON.parse(raw) as { openTabs?: unknown; activeTab?: unknown };
    const openTabs = Array.isArray(parsed.openTabs)
      ? parsed.openTabs.filter((path): path is string => typeof path === "string")
      : [];
    const activeTab = typeof parsed.activeTab === "string" ? parsed.activeTab : null;
    return { openTabs, activeTab };
  } catch {
    return { openTabs: [], activeTab: null };
  }
}

function writeStoredSession(workspace: string, session: StoredSession) {
  try {
    localStorage.setItem(`${sessionKeyPrefix}${workspace}`, JSON.stringify(session));
  } catch {
    // ignore localStorage failures
  }
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

function normalizeThemeColors(
  colors?: Partial<Record<"light" | "dark", NotebookThemeColors>>,
  legacyAccent?: string | null,
): NotebookThemeColorSettings {
  const defaults = defaultNotebookThemeColors();
  return {
    light: { ...defaults.light, ...(colors?.light ?? {}), ...(!colors?.light && legacyAccent ? { accentColor: legacyAccent } : {}) },
    dark: { ...defaults.dark, ...(colors?.dark ?? {}), ...(!colors?.dark && legacyAccent ? { accentColor: legacyAccent } : {}) },
  };
}

function readAppearanceThemeColors(appearance: NonNullable<WorkspaceMetadata["appearance"]>) {
  return normalizeThemeColors(appearance.colors, appearance.accentColor);
}

function readStoredNotebookThemeColors() {
  return normalizeThemeColors(undefined, localStorage.getItem(accentKey));
}

function appearanceColorsMatch(
  left?: Partial<Record<"light" | "dark", NotebookThemeColors>>,
  right?: Partial<Record<"light" | "dark", NotebookThemeColors>>,
) {
  return (["light", "dark"] as const).every((mode) =>
    (left?.[mode]?.accentColor ?? null) === (right?.[mode]?.accentColor ?? null) &&
    (left?.[mode]?.titlebarColor ?? null) === (right?.[mode]?.titlebarColor ?? null) &&
    (left?.[mode]?.titlebarUseAccent ?? true) === (right?.[mode]?.titlebarUseAccent ?? true),
  );
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

function getSpeechRecognitionConstructor() {
  const target = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return target.SpeechRecognition ?? target.webkitSpeechRecognition ?? null;
}

function dictationErrorMessage(event: SpeechRecognitionErrorEventLike) {
  if (event.message) return event.message;
  switch (event.error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone or speech recognition permission was denied.";
    case "audio-capture":
      return "No microphone input is available.";
    case "network":
      return "Speech recognition could not connect.";
    case "no-speech":
      return "No speech was detected.";
    default:
      return event.error ? `Speech recognition stopped: ${event.error}.` : "Speech recognition stopped.";
  }
}

function formatDictationInsertion(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return `${normalized} `;
}

function displayFolderName(path: string, folders: FolderEntry[], workspace: string) {
  if (!path) return getNotebookName(workspace);
  const match = folders.find((folder) => folder.path === path)?.name;
  if (match) return match;
  const tail = path.split("/").at(-1) || path;
  return decodeTitleFromFilename(tail);
}

function getTopLevelFolderPath(path: string) {
  return path.split("/").filter(Boolean)[0] ?? "";
}

function isSectionContextTarget(
  target: ContextMenuState,
  navigationStyle: NavigationStyle,
  folders: FolderEntry[],
) {
  return navigationStyle === "section-view" &&
    target.kind === "folder" &&
    (target.path === "" || folders.some((folder) => folder.path === target.path && folder.parent_path === ""));
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
    const sidebar = shiftLightness(bg, -3);
    return {
      surface: sidebar,
      surfaceSoft: sidebar,
      surfaceStrong: shiftLightness(bg, 4),
      surfaceMuted: shiftLightness(sidebar, -1),
      border: "rgba(238, 232, 223, 0.1)",
      text: "#eee8df",
      textMuted: "rgba(238, 232, 223, 0.62)",
      ...overrides,
    };
  }
  const sidebar = shiftLightness(bg, -4);
  return {
    surface: sidebar,
    surfaceSoft: sidebar,
    surfaceStrong: shiftLightness(bg, 4),
    surfaceMuted: shiftLightness(sidebar, -2),
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

function readableTextColor(background: string) {
  const rgb = hexToRgb(background);
  if (!rgb) return "#ffffff";
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.54 ? "#192d2b" : "#ffffff";
}
