import "./styles/responsive-panes.css";
import "./styles/theme-api.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition, LogicalSize, availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  ChevronDown,
  ChevronUp,
  EllipsisVertical,
  FileCode2,
  Focus,
  Folder,
  Image as ImageIcon,
  Lock,
  Paintbrush,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  Sigma,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { EditorOptionsSubmenu } from "./components/EditorOptionsSubmenu";
import { GlobalSearchModal } from "./components/GlobalSearchModal";
import { IconBrowserModal, type IconBrowserState } from "./components/IconBrowser";
import { ManageNotebooksModal } from "./components/ManageNotebooksModal";
import { MoveDialog } from "./components/MoveDialog";
import { RightSidebar, type RightSidebarMode } from "./components/NoteDetailsSidebar";
import { EditorErrorBoundary, EditorTopbar, EmptyNoteSurface } from "./components/NoteSurface";
import { NoteTabs, TabHistoryControls, TabListDropdown } from "./components/NoteTabs";
import { ContextMenu, TabContextMenu } from "./components/NotebookContextMenu";
import { PropertyDialog, type PropertyDialogState } from "./components/NotebookPropertyDialog";
import { PaneResizer, SidebarOverlayActions, stopChromeMouseDown } from "./components/PaneChrome";
import PlasmaTheme from "./components/PlasmaTheme";
import { QuickAppearanceControls } from "./components/QuickAppearanceControls";
import { RecentlyDeletedDialog } from "./components/RecentlyDeletedDialog";
import { ReleaseNotice } from "./components/ReleaseNotice";
import SettingsModal, { type SettingsSection } from "./components/SettingsModal";
import { ThemeBuilder, ThemeReconciliation } from "./components/ThemeBuilder";
import { ThemeStyles } from "./components/ThemeStyles";
import { VersionHistoryDialog, type VersionHistoryState } from "./components/VersionHistoryDialog";
import { WindowsMenuBar, isWindowsDesktop } from "./components/WindowsMenuBar";
import { DictationPanel, formatDictationInsertion, type DictationTarget } from "./components/insertion/DictationPanel";
import { EmojiPicker } from "./components/insertion/EmojiPicker";
import { ImageInsertDialog, type ImageInsertResult } from "./components/insertion/ImageInsertDialog";
import { LinkPicker, type LinkPickerResult } from "./components/insertion/LinkPicker";
import { FolderPane } from "./components/navigation/FolderPane";
import { NoteDragPreviewLayer, NotesPane, type NoteDragPreview } from "./components/navigation/NotesPane";
import { SectionViewFolderPane } from "./components/navigation/SectionViewFolderPane";
import { UnifiedTreePane } from "./components/navigation/UnifiedTreePane";
import { buildNoteCreationTargets, displayFolderName, type DraftNote } from "./lib/notebookNavigation";
import type {
  ContextMenuState,
  ContextMenuTarget,
  DragItem,
  DropPlacement,
  FolderDropIntent,
  FolderOrderingMode,
  OpenTarget,
  TabContextMenuState,
} from "./lib/notebookNavigation";
import { NotesEditor } from "./editor/NotesEditor";
import type {
  EditorCommand,
  EditorCommandRequest,
  EditorPersistenceHandle,
  PendingEditorChange,
} from "./editor/editorContract";
import { isSortCommand } from "./editor/sortLines";
import {
  ActiveNoteLifecycle,
  getMissingNoteChangeAction,
  getWatchedContentChangeAction,
  type ActiveNoteAccess,
} from "./lib/activeNoteLifecycle";
import {
  APP_ZOOM_STORAGE_KEY,
  readStoredAppZoom,
  resolveAppZoomCommand,
  writeStoredAppZoom,
  type AppZoomCommand,
} from "./lib/appZoom";
import {
  bulletMethodDisplayKey,
  bulletMethodSettingsKey,
  readBulletMethodDisplay,
  readBulletMethodStatuses,
  writeBulletMethodDisplay,
  writeBulletMethodStatuses,
} from "./lib/bulletMethod";
import { classicThemes, themeCatalogWarnings } from "./lib/bundledThemes";
import { captureCurrentThemeSettings } from "./lib/currentThemeSettings";
import type { AppMenuState } from "./lib/desktop";
import {
  exportTextFile,
  focusNotebookWindow,
  isTauri,
  printCurrentWebview,
  readAppPreferences,
  registerNotebookWindow,
  setCurrentWebviewZoom,
  unregisterNotebookWindow,
  updateAppMenuState,
  writeAppPreferences,
} from "./lib/desktop";
import { shouldDockNoteTitle } from "./lib/dockedTitle";
import { DraftSaveRevisions, type DraftSaveRevision } from "./lib/draftSaveRevisions";
import { buildNoteExportHtml, noteExportFileStem } from "./lib/exportNote";
import { toggleFocusMode, type PaneVisibility } from "./lib/focusMode";
import { isInlineColorCommand } from "./lib/inlineColors";
import { normalizeMarkdownImageLines } from "./lib/markdown";
import {
  createNoteDocument,
  measureNoteText,
  normalizeNoteMarkdown,
  readNoteDocument,
  reviseNoteDocument,
} from "./lib/noteDocument";
import { shouldApplyEditorUpdate } from "./lib/noteEditorUpdates";
import {
  createNoteTab,
  getNoteTabHistoryTarget,
  moveInNoteTabHistory,
  pruneNoteTabHistory,
  resolveNoteTabHistory,
  visitNoteInTab,
  type NoteTab,
} from "./lib/noteTabHistory";
import { adoptNotebookMetadata as applyNotebookMetadataAdoption } from "./lib/notebookAppearance";
import {
  addFolderToOrder,
  addToOrder,
  buildBookmarkViews,
  buildFolderTree,
  getFolderColors,
  getNotebookName,
  orderFolders,
  orderNotes,
  placeNoteInOrder,
  removeFolderFromMetadata,
  removeNoteFromMetadata,
  reorderBookmarks,
  setFolderColor,
  setMetadataValue,
} from "./lib/notebookMetadata";
import { NotebookMetadataPersistence } from "./lib/notebookMetadataPersistence";
import { NotebookMetadataSession } from "./lib/notebookMetadataSession";
import { decodeTitleFromFilename, validateNoteTitle } from "./lib/notebookNames";
import { createNotebookPathMutations } from "./lib/notebookPathMutations";
import {
  lastPathKey,
  readInitialOpenTarget,
  readInitialWorkspace,
  readRecentNotebooks,
  readStoredLastPath,
  readStoredSession,
  touchRecentNotebook,
  workspaceKey,
  writeRecentNotebooks,
  writeStoredSession,
  type RecentNotebook,
} from "./lib/notebookSession";
import { LatestNotebookSnapshot } from "./lib/notebookSnapshot";
import type { TrashEntry } from "./lib/notebookStorage";
import { defaultWorkspaceMetadata, notebookStorage } from "./lib/notebookStorage";
import { notebookWallpapers, sameWallpaper, wallpaperDeletionReason } from "./lib/notebookWallpapers";
import { PendingNoteContents } from "./lib/pendingNoteContents";
import { applyQuickAppearance, quickAppearanceResetPatch, quickAppearanceStyles } from "./lib/quickAppearance";
import { buildRecentNoteViews } from "./lib/recentNotes";
import { getScrollFadeVisibility, type ScrollFadeVisibility } from "./lib/scrollFade";
import { recoveryTheme } from "./lib/themeCatalog";
import { themeDefaultsPatch, type ThemeDefaultsScope } from "./lib/themeDefaults";
import { themeFamily } from "./lib/themeFamilies";
import { readableThemeText, themeBackgroundImage, themeRenderingMode, themeVariables } from "./lib/themeRuntime";
import { listThemes, readTheme, resolveThemeVariant, themeAppearance, type ThemeDocument } from "./lib/themes";
import { updateNoteEntryAfterSave } from "./lib/updateNoteEntryAfterSave";
import { useNoteOutline } from "./lib/useNoteOutline";
import { useNoteTextStats } from "./lib/useNoteTextStats";
import { useResponsivePanes } from "./lib/useResponsivePanes";
import { sidebarHoverEdgeWidth } from "./lib/useSidebarOverlay";
import { sidebarSlideDuration } from "./lib/useSidebarOverlayMotion";
import {
  clamp,
  fitWindowToMonitors,
  readStoredWindowPosition,
  readStoredWindowSize,
  writeStoredWindowPosition,
  writeStoredWindowSize,
} from "./lib/windowGeometry";
import { readStoredWordCountVisibility, writeStoredWordCountVisibility } from "./lib/wordCountVisibility";
import { readWritingStyle, setWritingStyle } from "./lib/writingStyle";
import type {
  BookmarkEntry,
  FolderEntry,
  LinkIndex,
  NavigationStyle,
  NoteEntry,
  NotePositionMetadata,
  NotebookSnapshot,
  NotebookThemeColors,
  WorkspaceMetadata,
} from "./types";
const { listTrash, cleanupTrash, watchWorkspace, readWorkspaceMetadata, ensureWelcomeNote, readNotebookSnapshot, readNote, readAssetDataUrl, listNotes, createNote, saveNote, readLinkIndex, deleteNote, createFolder, trashNote, duplicateNote, trashFolder, restoreTrash, restoreNoteVersion, purgeTrash, purgeTrashAll, revealPath } = notebookStorage;

const notebookMetadataPersistence = new NotebookMetadataPersistence(notebookStorage);

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

const plasmaBackgroundBlurKey = "tigrana-plasma-background-blur";

const plasmaFrostKey = "tigrana-plasma-frost";

const plasmaThemeKey = "tigrana-plasma-theme";

const themeKey = "tigrana-theme";

const accentKey = "tigrana-accent";

const themePresetKey = "tigrana-theme-preset";

const widthModeKey = "tigrana-width-mode";

const alignmentKey = "tigrana-note-alignment";

const legacyFullWidthKey = "tigrana-full-width";

const folderPaneWidthKey = "tigrana-folder-pane-width";

const notesPaneWidthKey = "tigrana-notes-pane-width";

const rightPaneWidthKey = "tigrana-right-pane-width";

const accentTitlebarKey = "tigrana-accent-titlebar";

const spellcheckKey = "tigrana-spellcheck";

const notePositionFreshMs = 24 * 60 * 60 * 1000;

const autosaveDelayMs = 650;

const autosaveRetryDelayMs = 1_500;

const defaultAppFontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const defaultEditorFontFamily = defaultAppFontFamily;

const defaultAppFontSize = 14;

const defaultEditorFontSize = 16;

type EditorWidthMode = "comfortable" | "narrow" | "full";

type NoteAlignment = "left" | "center";

const editorWidthOptions: { value: EditorWidthMode; label: string; hint?: string }[] = [
  { value: "comfortable", label: "Comfortable Width", hint: "Default" },
  { value: "narrow", label: "Narrow Width", hint: "Best for writing stories" },
  { value: "full", label: "Full Width", hint: "Use all available editor space" },
];

type NoteChangedEvent = {
  workspace: string;
  path: string;
};

type NotePointerDrag = {
  dragging: boolean;
  path: string;
  startX: number;
  startY: number;
};

type ColorScheme = "system" | "light" | "dark";

type ThemePresetId =
  | "default" | "atom" | "solarized" | "dracula" | "nord" | "gruvbox" | "everforest"
  | "catppuccin-latte" | "catppuccin-frappe" | "catppuccin-macchiato" | "catppuccin-mocha"
  | "plasma-ooze" | "plasma-undertow" | "plasma-witches-brew";

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
  saveRevision: DraftSaveRevision;
};

const themePresets = classicThemes.map(theme => ({
  id: theme.id, name: theme.name,
  accent: { light: theme.light.accent, dark: theme.dark.accent },
  appBackground: { light: theme.light.background, dark: theme.dark.background },
  tokens: { light: theme.light, dark: theme.dark },
}));

export default function App() {
  const initialOpenTargetRef = useRef(readInitialOpenTarget());
  const [colorToolbarElement, setColorToolbarElement] = useState<HTMLDivElement | null>(null);
  const [workspace, setWorkspace] = useState(() => readInitialWorkspace());
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => readStoredColorScheme());
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const resolvedTheme = colorScheme === "system" ? (prefersDark ? "dark" : "light") : colorScheme;
  const [plasmaBackgroundBlur, setPlasmaBackgroundBlur] = useState(() => {
    const stored = Number(localStorage.getItem(plasmaBackgroundBlurKey) ?? 0);
    return Number.isFinite(stored) ? Math.min(40, Math.max(0, stored)) : 0;
  });
  const [plasmaFrost, setPlasmaFrost] = useState(() => {
    const stored = localStorage.getItem(plasmaFrostKey);
    const value = stored === null ? 80 : Number(stored);
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 80;
  });
  const [plasmaEnabled, setPlasmaEnabled] = useState(() => localStorage.getItem(plasmaThemeKey) === "true");
  const [themePresetId, setThemePresetId] = useState<ThemePresetId>(() => readStoredThemePreset());
  const [themeColors, setThemeColors] = useState<NotebookThemeColorSettings>(() => readStoredNotebookThemeColors());
  const [savedAccentTitlebar, setAccentTitlebar] = useState<boolean>(() => localStorage.getItem(accentTitlebarKey) === "true");
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
  const [contentsActive, setContentsActive] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);
  const [hasEditorSelection, setHasEditorSelection] = useState(false);
  const [selectedEditorText, setSelectedEditorText] = useState("");
  const [editorRestorePosition, setEditorRestorePosition] = useState<NotePositionMetadata | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [noteFindRequest, setNoteFindRequest] = useState(0);
  const [appError, setAppError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bulletMethodDisplay, setBulletMethodDisplay] = useState(readBulletMethodDisplay);
  const [bulletMethodStatuses, setBulletMethodStatuses] = useState(readBulletMethodStatuses);
  useEffect(() => {
    const syncBulletMethod = (event: StorageEvent) => {
      if (event.key === bulletMethodDisplayKey || event.key === null) setBulletMethodDisplay(readBulletMethodDisplay());
      if (event.key === bulletMethodSettingsKey || event.key === null) setBulletMethodStatuses(readBulletMethodStatuses());
    };
    window.addEventListener("storage", syncBulletMethod);
    return () => window.removeEventListener("storage", syncBulletMethod);
  }, []);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [notebooksManageOpen, setNotebooksManageOpen] = useState(false);
  const [recentlyDeletedOpen, setRecentlyDeletedOpen] = useState(false);
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [versionHistory, setVersionHistory] = useState<VersionHistoryState | null>(null);
  const [recentNotebooks, setRecentNotebooks] = useState<RecentNotebook[]>(() => readRecentNotebooks());
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [preferredLeftVisible, setLeftVisible] = useState(true);
  const [plasmaFlow, setPlasmaFlow] = useState(0);
  const [plasmaAmbientDrops, setPlasmaAmbientDrops] = useState(false);
  const [preferredOutlineVisible, setOutlineVisible] = useState(true);
  const focusRestoreRef = useRef<PaneVisibility | null>(null);
  const [wordCountVisible, setWordCountVisible] = useState(() => readStoredWordCountVisibility());
  const [noteScrollFades, setNoteScrollFades] = useState<ScrollFadeVisibility>({ top: false, bottom: false });
  const [dockedTitleState, setDockedTitleState] = useState({ visible: false, animate: false });
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
  const responsivePanes = useResponsivePanes({
    leftVisible: preferredLeftVisible, outlineVisible: preferredOutlineVisible,
    navigationStyle, folderWidth: folderPaneWidth, notesWidth: notesPaneWidth, rightWidth: rightPaneWidth,
    theme: metadata.appearance?.customTheme, mode: resolvedTheme, notebook: workspace, plasma: plasmaEnabled,
  });
  const { leftVisible, outlineVisible, setOverlay: setPaneOverlay } = responsivePanes;

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [folderDialogParent, setFolderDialogParent] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [propertyDialog, setPropertyDialog] = useState<PropertyDialogState | null>(null);
  // Preview stays local to navigation; only Save updates Notebook metadata.
  const navigationMetadata = useMemo(() => {
    const folderColors = getFolderColors(metadata, navigationStyle);
    const preview = propertyDialog?.kind === "folder-color" &&
      propertyDialog.navigationStyle === navigationStyle ? propertyDialog : null;
    const color = preview?.previewColor?.trim();
    return {
      ...metadata,
      folderColors: preview && color && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)
        ? { ...folderColors, [preview.path]: color }
        : folderColors,
    };
  }, [metadata, navigationStyle, propertyDialog]);
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
  const dockedTitleAnimationReadyRef = useRef(false);
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
  const metadataSessionRef = useRef(new NotebookMetadataSession(workspace));
  const notebookAppearanceDefaultsRef = useRef({
    plasma: { enabled: plasmaEnabled, frost: plasmaFrost, backgroundBlur: plasmaBackgroundBlur, flow: plasmaFlow, ambientDrops: plasmaAmbientDrops },
    colorScheme: readStoredColorScheme(),
    themePresetId: readStoredThemePreset(),
    colors: readStoredNotebookThemeColors(),
    accentTitlebar: localStorage.getItem(accentTitlebarKey) === "true",
    navigationStyle: "section-view" as const,
    rightSidebarOpen: true,
    wordCountVisible: readStoredWordCountVisibility(),
    editorWidthMode: readStoredEditorWidthMode(),
    noteAlignment: readStoredNoteAlignment(),
    appFontFamily: defaultAppFontFamily,
    appFontSize: defaultAppFontSize,
    editorFontFamily: defaultEditorFontFamily,
    editorFontSize: defaultEditorFontSize,
  });
  const adoptAuthoritativeMetadata = useCallback((adoptedWorkspace: string, next: WorkspaceMetadata) => {
    if (!metadataSessionRef.current.adopt(adoptedWorkspace, next)) return;
    applyNotebookMetadataAdoption(next, notebookAppearanceDefaultsRef.current, themePresets.map((preset) => preset.id), {
      metadata: (adopted) => {
        metadataRef.current = adopted;
        setMetadata(adopted);
      },
      appearance: (appearance) => {
        if (appearance.plasma) {
          setPlasmaEnabled(appearance.plasma.enabled);
          setPlasmaFrost(appearance.plasma.frost);
          setPlasmaBackgroundBlur(appearance.plasma.backgroundBlur);
          setPlasmaFlow(appearance.plasma.flow ?? 0);
          setPlasmaAmbientDrops(appearance.plasma.ambientDrops ?? false);
        }
        setColorScheme(appearance.colorScheme);
        setThemePresetId(appearance.themePresetId as ThemePresetId);
        setThemeColors(appearance.colors);
        setAccentTitlebar(appearance.accentTitlebar);
        setNavigationStyle(appearance.navigationStyle);
        if (appearance.wordCountVisible !== undefined) setWordCountVisible(appearance.wordCountVisible);
        if (appearance.editorWidthMode !== undefined) setEditorWidthMode(appearance.editorWidthMode);
        if (appearance.noteAlignment !== undefined) setNoteAlignment(appearance.noteAlignment);
        if (appearance.rightSidebarOpen !== undefined) setOutlineVisible(appearance.rightSidebarOpen);
        setAppFontFamily(appearance.appFontFamily);
        setAppFontSize(appearance.appFontSize);
        setEditorFontFamily(appearance.editorFontFamily);
        setEditorFontSize(appearance.editorFontSize);
      },
    });
  }, []);
  const acceptPersistedMetadata = useCallback((persistedWorkspace: string, next: WorkspaceMetadata) => {
    adoptAuthoritativeMetadata(persistedWorkspace, next);
  }, [adoptAuthoritativeMetadata]);
  const isWorkspaceActive = useCallback(
    (candidateWorkspace: string) => metadataSessionRef.current.isActive(candidateWorkspace),
    [],
  );
  const positionWriteTimerRef = useRef<number | null>(null);
  const editorPersistenceRef = useRef<EditorPersistenceHandle | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const userPathMutationRef = useRef(false);
  const withSavedEditorRef = useRef<<T>(path: string, operation: (path: string) => Promise<T>) => Promise<T>>(
    () => Promise.reject(new Error("The Notebook is still loading.")),
  );
  const registerEditorPersistence = useCallback((handle: EditorPersistenceHandle | null) => {
    editorPersistenceRef.current = handle;
  }, []);
  const pendingEditorChangeRef = useRef<PendingEditorChange | null>(null);
  const activeNoteIdentityRef = useRef<string | null>(null);
  const pendingNoteContentsRef = useRef(new PendingNoteContents());
  const latestNotebookSnapshotRef = useRef(new LatestNotebookSnapshot<NotebookSnapshot>());
  const latestTrashSnapshotRef = useRef(new LatestNotebookSnapshot<TrashEntry[]>());
  const windowResizeTimerRef = useRef<number | null>(null);
  const restoredTabsWorkspaceRef = useRef<string | null>(null);
  const openTabsRef = useRef<NoteTab[]>([]);
  const activeTabIdRef = useRef<string | null>(null);
  const chooseWorkspaceRef = useRef<(intent: "open" | "new", openInNewWindow?: boolean) => void>(() => {});
  const externalNoteChangeRef = useRef<(path: string) => void>(() => {});
  const undoableNewNoteRef = useRef<{ workspace: string; path: string } | null>(null);
  const titleEscapeUndoInFlightRef = useRef(false);
  const appZoomRef = useRef(readStoredAppZoom());
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
  const draftSaveRevisionsRef = useRef<DraftSaveRevisions | null>(null);
  if (!draftSaveRevisionsRef.current) draftSaveRevisionsRef.current = new DraftSaveRevisions();
  const draftSaveRevisions = draftSaveRevisionsRef.current;
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
    requestCreateNoteInContext: () => void;
    toggleRawMarkdown: () => void;
    toggleSidebar: () => void;
    toggleRightSidebar: () => void;
  }>({
    addEmptyTab: () => {},
    chooseWorkspace: () => {},
    hasOpenNote: () => false,
    persistDraft: () => {},
    requestCreateNoteInContext: () => {},
    toggleRawMarkdown: () => {},
    toggleSidebar: () => {},
    toggleRightSidebar: () => {},
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
  const setActivePathAuthoritatively = useCallback<React.Dispatch<React.SetStateAction<string | null>>>((next) => {
    if (typeof next === "function") {
      setActivePath((current) => {
        const resolved = next(current);
        activeDraftStateRef.current.activePath = resolved;
        return resolved;
      });
      return;
    }
    activeDraftStateRef.current.activePath = next;
    setActivePath(next);
  }, []);
  const pathChangeSaveInFlight = activeNoteLifecycle.hasPathChange;
  const transientActiveDraftOpen = Boolean(activePath && titleDraft.trim() && pathChangeSaveInFlight);
  const noteOpen = pendingNote || activeNote || transientActiveDraftOpen;
  const hasOpenNote = Boolean(noteOpen);
  const folderTree = useMemo(() => buildFolderTree(folders, workspace, metadata), [folders, metadata, workspace]);
  const visibleNotes = useMemo(
    () => orderNotes(notes.filter((note) => note.parent_path === selectedFolder), selectedFolder, metadata),
    [metadata, notes, selectedFolder],
  );
  const noteDocument = useMemo(
    () => createNoteDocument({ title: titleDraft, body: draft, frontmatter: frontmatterDraft }),
    [draft, frontmatterDraft, titleDraft],
  );
  const writingStyle = readWritingStyle(frontmatterDraft);
  const newNoteWritingStyle = metadata.newNoteWritingStyle === "notes" || metadata.newNoteWritingStyle === "story" ? metadata.newNoteWritingStyle : "last-used";
  const lastWritingStyle = metadata.lastWritingStyle === "story" ? "story" : "notes";
  const writingStyleNoteLoading = activeNoteLifecycle.isLoading;
  const activeNoteHistoryKey = activePath
    ? activeNoteIdentityRef.current || linkIndex?.pathToId[activePath] || activePath
    : null;
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
  const noteSaveState = !activeNoteEditable ? "read-only" : hasUnsavedChanges ? "unsaved" : "saved";
  const noteSaveStateLabel = noteSaveState === "read-only"
    ? "Read-only"
    : noteSaveState === "unsaved" ? "Unsaved" : "Saved";

  useLayoutEffect(() => {
    draftSaveRevisions.observe(rawMarkdownDraft);
  }, [draftSaveRevisions, rawMarkdownDraft]);
  backlinkPaneVisibleRef.current = outlineVisible && rightSidebarMode === "backlinks";
  const customTheme = useMemo(() => readTheme(metadata.appearance?.customTheme), [metadata.appearance?.customTheme]);
  const invalidNotebookTheme = !!metadata.appearance?.customTheme && !customTheme;
  const themePreset = useMemo(() => {
    const base = getThemePreset(invalidNotebookTheme ? "default" : themePresetId);
    if (!customTheme) return base;
    return { ...base, accent: { light: customTheme.light.accent, dark: customTheme.dark.accent },
      appBackground: { light: customTheme.light.background, dark: customTheme.dark.background },
      tokens: { light: customTheme.light, dark: customTheme.dark } };
  }, [themePresetId, customTheme, invalidNotebookTheme]);
  const activeThemeColors = themeColors[resolvedTheme];
  const quickAppearance = metadata.appearance?.quickAppearance;
  const quickAppearanceTheme = (customTheme ? resolveThemeVariant(customTheme, metadata.appearance?.themeColorPreferences?.[customTheme.id]) : null) ?? classicThemes.find(theme => theme.id === themePresetId) ?? recoveryTheme;
  // Title-bar styling belongs to the theme; ignore retired notebook quick overrides.
  const accentTitlebar = savedAccentTitlebar;
  const accentColor = quickAppearance?.accentColor ?? activeThemeColors.accentColor ?? null;
  const effectiveAccentColor = quickAppearance?.accentColor || (customTheme?.colorVariants ? quickAppearanceTheme[resolvedTheme].accent : accentColor || themePreset.accent[resolvedTheme]);
  const titlebarUseAccent = quickAppearance?.accentColor ? true : activeThemeColors.titlebarUseAccent ?? true;
  const titlebarColor = activeThemeColors.titlebarColor ?? null;
  const defaultTitlebarColor = !customTheme && themePresetId === "default" ? "#001428" : effectiveAccentColor;
  const effectiveTitlebarColor = titlebarUseAccent ? defaultTitlebarColor : (titlebarColor || defaultTitlebarColor);
  const quickStyles = quickAppearanceStyles(quickAppearance, accentTitlebar, defaultTitlebarColor);
  // Legacy notebook preferences are overlaid without rewriting saved metadata.
  // Both old presets and portable themes use the same renderer and preview document.
  const renderedTheme = useMemo<ThemeDocument>(() => {
    if (invalidNotebookTheme) return recoveryTheme;
    if (customTheme) return applyQuickAppearance(resolveThemeVariant(customTheme, metadata.appearance?.themeColorPreferences?.[customTheme.id]), quickAppearance);
    const base = classicThemes.find(t => t.id === themePresetId) ?? classicThemes[0];
    const palette = (mode: "light" | "dark") => {
      const colors = themeColors[mode];
      const accent = quickAppearance?.accentColor || colors.accentColor || base[mode].accent;
      return { ...base[mode], accent, selectedText: accent === base[mode].accent ? base[mode].selectedText : readableThemeText(accent),
        titlebar: colors.titlebarUseAccent !== false
          ? (base.id === "default" ? "#001428" : accent)
          : colors.titlebarColor || base[mode].titlebar };
    };
    return applyQuickAppearance({ ...base, light: palette("light"), dark: palette("dark"),
      appFontFamily, appFontSize, editorFontFamily, editorFontSize, accentTitlebar: savedAccentTitlebar }, quickAppearance);
  }, [metadata.appearance?.themeColorPreferences, customTheme, invalidNotebookTheme, themePresetId, themeColors, quickAppearance, appFontFamily, appFontSize, editorFontFamily, editorFontSize, savedAccentTitlebar]);
  const renderedColorMode = themeRenderingMode(renderedTheme, resolvedTheme);
  const plasmaBackgroundImage = useMemo(() => themeBackgroundImage(renderedTheme), [renderedTheme]);
  useEffect(() => {
    const variables = themeVariables(renderedTheme, resolvedTheme, 'notebook');
    const root = document.documentElement.style;
    const roles = Object.entries(variables).filter(([key]) => key.startsWith('--tigrana-'));
    for (const [key, value] of roles) root.setProperty(key, value);
    if (quickAppearance?.accentColor) {
      root.setProperty('--tigrana-accent', quickAppearance.accentColor);
      root.setProperty('--tigrana-selected-text', readableThemeText(quickAppearance.accentColor));
    }
    return () => { for (const [key] of roles) root.removeProperty(key); };
  }, [renderedTheme, resolvedTheme, quickAppearance?.accentColor]);
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
  const mainCreationFolderPath = navigationStyle === "section-view" ? selectedSection : selectedFolder;
  const currentCreationFolderPath = activeNote?.parent_path ?? selectedFolder;
  const noteCreationTargets = useMemo(
    () => buildNoteCreationTargets(
      mainCreationFolderPath,
      currentCreationFolderPath,
      activeNote,
      folders,
      workspace,
    ),
    [activeNote, currentCreationFolderPath, folders, mainCreationFolderPath, workspace],
  );
  const bookmarks = useMemo(() => buildBookmarkViews(metadata.bookmarks, folders, notes, metadata, workspace), [folders, metadata, notes, workspace]);
  const recentNotes = useMemo(
    () => buildRecentNoteViews(notes, metadata),
    [metadata, notes],
  );
  const visibleTabs = useMemo(
    () =>
      openTabs.map((tab) => ({
        ...tab,
        note: tab.path ? notes.find((note) => note.path === tab.path) ?? null : null,
      })),
    [notes, openTabs],
  );
  const activeNavigationTab = openTabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeTabHistory = activeNavigationTab ? resolveNoteTabHistory(activeNavigationTab) : null;
  const canNavigateBack = Boolean(activeTabHistory && activeTabHistory.historyIndex > 0);
  const canNavigateForward = Boolean(
    activeTabHistory && activeTabHistory.historyIndex < activeTabHistory.history.length - 1,
  );
  const focusModeActive = !leftVisible && !outlineVisible;
  const renderedVariables = themeVariables(renderedTheme, resolvedTheme, "notebook");
  const frameStyle = {
    "--sidebar-slide-duration": `${sidebarSlideDuration}ms`,
    "--sidebar-hover-width": `${sidebarHoverEdgeWidth}px`,
    "--sidebar-hover-offset": `${responsivePanes.hoverOffset}ms`,
    "--sidebar-hover-duration": `${responsivePanes.hoverDelay}ms`,
    "--folder-pane-width": `${folderPaneWidth}px`,
    "--notes-pane-width": `${notesPaneWidth}px`,
    "--right-pane-width": `${rightPaneWidth}px`,
    "--app-font-family": renderedVariables["--app-font-family"],
    "--app-font-size": `${appFontSize}px`,
    "--editor-font-family": renderedVariables["--editor-font-family"],
    "--editor-font-size": renderedVariables["--editor-font-size"],
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
    else if (/Win/.test(platform)) document.documentElement.dataset.platform = "windows";
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
    localStorage.setItem(plasmaBackgroundBlurKey, String(plasmaBackgroundBlur));
  }, [plasmaBackgroundBlur]);

  useEffect(() => {
    localStorage.setItem(plasmaFrostKey, String(plasmaFrost));
  }, [plasmaFrost]);

  useEffect(() => {
    localStorage.setItem(plasmaThemeKey, String(plasmaEnabled));
  }, [plasmaEnabled]);

  useEffect(() => {
    document.documentElement.dataset.theme = renderedColorMode;
    document.documentElement.dataset.themePreset = customTheme ? "custom" : themePreset.id;
    const root = document.documentElement.style;
    root.setProperty("--app-bg", themePreset.appBackground[resolvedTheme]);
    const tokens = themePreset.tokens[resolvedTheme];
    root.setProperty("--surface", tokens.surface);
    root.setProperty("--surface-soft", tokens.surfaceSoft);
    root.setProperty("--surface-strong", tokens.surfaceStrong);
    root.setProperty("--surface-muted", tokens.surfaceMuted);
    root.setProperty("--border", tokens.border);
    root.setProperty("--text", tokens.text);
    root.setProperty("--text-muted", tokens.textMuted);
    root.setProperty("--muted", tokens.textMuted);
    localStorage.setItem(themeKey, colorScheme);
    localStorage.setItem(themePresetKey, themePreset.id);
  }, [colorScheme, resolvedTheme, renderedColorMode, themePreset, customTheme]);

  useEffect(() => {
    const root = document.documentElement.style;
    const variables = themeVariables(renderedTheme, resolvedTheme, "notebook");
    for (const name of ["--app-font-family", "--app-font-size", "--editor-font-family", "--editor-font-size"]) {
      root.setProperty(name, variables[name]);
    }
  }, [renderedTheme, resolvedTheme]);

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

  useEffect(() => {
    localStorage.setItem(widthModeKey, editorWidthMode);
  }, [editorWidthMode]);

  useEffect(() => {
    localStorage.setItem(alignmentKey, noteAlignment);
  }, [noteAlignment]);

  useEffect(() => {
    writeStoredWordCountVisibility(wordCountVisible);
  }, [wordCountVisible]);

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
    const requestWorkspace = workspace;
    if (!requestWorkspace) {
      latestTrashSnapshotRef.current.invalidate();
      setTrashEntries([]);
      return;
    }
    setTrashLoading(true);
    try {
      const loaded = await latestTrashSnapshotRef.current.load(
        requestWorkspace,
        () => listTrash(requestWorkspace),
        isWorkspaceActive,
      );
      if (!loaded) return;
      setTrashEntries(loaded.snapshot.sort((a, b) => b.deletedAt - a.deletedAt));
      setTrashLoading(false);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
      setTrashLoading(false);
    }
  }, [isWorkspaceActive, workspace]);

  useEffect(() => {
    if (!isTauri()) return;
    const handleCommand = (event: Event) => {
      const command = (event as CustomEvent<unknown>).detail;
      if (typeof command === "string") void handleMenuCommand(command);
    };
    window.addEventListener("tigrana-menu-command", handleCommand);
    return () => window.removeEventListener("tigrana-menu-command", handleCommand);
  });

  const applyAppZoomCommand = useCallback((command: AppZoomCommand) => {
    const nextZoom = resolveAppZoomCommand(appZoomRef.current, command);
    appZoomRef.current = nextZoom;
    writeStoredAppZoom(nextZoom);
    void setCurrentWebviewZoom(nextZoom).catch((error) => {
      setAppError(error instanceof Error ? error.message : String(error));
    });
  }, []);

  useEffect(() => {
    void setCurrentWebviewZoom(appZoomRef.current).catch((error) => {
      console.warn("setCurrentWebviewZoom failed", error);
    });

    const syncStoredZoom = (event: StorageEvent) => {
      if (event.key !== APP_ZOOM_STORAGE_KEY) return;
      const nextZoom = readStoredAppZoom();
      appZoomRef.current = nextZoom;
      void setCurrentWebviewZoom(nextZoom).catch((error) => {
        console.warn("setCurrentWebviewZoom failed", error);
      });
    };
    window.addEventListener("storage", syncStoredZoom);
    return () => window.removeEventListener("storage", syncStoredZoom);
  }, []);

  useEffect(() => {
    const handleZoomKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      let command: AppZoomCommand | null = null;
      if (event.key === "+" || event.key === "=") command = "in";
      else if (event.key === "-") command = "out";
      else if (event.key === "0") command = "reset";
      if (!command) return;

      event.preventDefault();
      event.stopPropagation();
      applyAppZoomCommand(command);
    };
    window.addEventListener("keydown", handleZoomKeyDown, true);
    return () => window.removeEventListener("keydown", handleZoomKeyDown, true);
  }, [applyAppZoomCommand]);

  useEffect(() => {
    const trackContents = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Editor menus and pane toggles retain the last editing target.
      if (target.closest(".note-view-menu, .outline-toggle, .sidebar-toggle")) return;
      setContentsActive(!!target.closest(".ProseMirror"));
    };
    document.addEventListener("focusin", trackContents);
    document.addEventListener("mousedown", trackContents, true);
    return () => {
      document.removeEventListener("focusin", trackContents);
      document.removeEventListener("mousedown", trackContents, true);
    };
  }, []);
  useEffect(() => { setContentsActive(!!document.activeElement?.closest(".ProseMirror")); }, [activePath]);

  useEffect(() => {
    if (!isTauri()) return;
    const label = getCurrentWindow().label;
    const state: AppMenuState = {
      hasWorkspace: Boolean(workspace),
      hasOpenNote,
      activeNoteEditable,
      hasEditorSelection,
      bulletMethodEnabled: Boolean(bulletMethodDisplay.enabled),
      titleFocused,
      contentsActive,
      hasUnsavedChanges,
      rawMarkdownVisible: rawMarkdownVisible || Boolean(frontmatterError),
      leftVisible,
      outlineVisible,
      wordCountVisible,
      spellcheckEnabled,
      navigationStyle,
      editorWidthMode,
      noteAlignment,
      recentNotes: recentNotes.map(({ path, title }) => ({ path, title })),
    };
    const handle = window.setTimeout(() => {
      void updateAppMenuState(label, state).catch((error) => {
        console.warn("update_app_menu_state failed", error);
      });
    }, 50);
    return () => window.clearTimeout(handle);
  }, [
    activeNoteEditable,
    bulletMethodDisplay.enabled,
    hasEditorSelection,
    titleFocused,
    contentsActive,
    navigationStyle,
    editorWidthMode,
    frontmatterError,
    hasOpenNote,
    hasUnsavedChanges,
    leftVisible,
    noteAlignment,
    outlineVisible,
    rawMarkdownVisible,
    recentNotes,
    spellcheckEnabled,
    wordCountVisible,
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
      if (!isWorkspaceActive(workspace)) return;
      externalNoteChangeRef.current(event.payload.path);
    }).then((callback) => {
      unlisten = callback;
    });

    return () => unlisten?.();
  }, [isWorkspaceActive, workspace]);

  useEffect(() => {
    if (!workspace) return;
    setMetadataLoaded(false);
    let disposed = false;
    void readWorkspaceMetadata(workspace)
      .then(async (nextMetadata) => {
        const ensured = await ensureWelcomeNote(workspace, nextMetadata);
        if (disposed) return;
        adoptAuthoritativeMetadata(workspace, ensured.metadata);
        if (ensured.created) {
          void refreshWorkspace(workspace).catch((error) => {
            if (metadataSessionRef.current.isActive(workspace)) {
              setAppError(error instanceof Error ? error.message : String(error));
            }
          });
        }
      })
      .catch((error) => {
        if (disposed) return;
        setAppError(error instanceof Error ? error.message : String(error));
        adoptAuthoritativeMetadata(workspace, defaultWorkspaceMetadata());
      })
      .finally(() => {
        if (!disposed) setMetadataLoaded(true);
      });
    return () => {
      disposed = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptAuthoritativeMetadata, workspace]);

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
        if (isWindowsDesktop()) await invoke("prepare_windows_chrome");
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
    metadataSessionRef.current.activate(workspace);
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
      if (!target?.closest(".note-view-menu")) setWidthMenuOpen(false);
      // Don't dismiss when clicking inside a context menu, app menu, or any
      // dialog — those popovers handle their own lifecycle.
      if (target?.closest(".context-menu, .app-menu, .note-view-menu, .dialog, .dialog-backdrop")) return;
      setAppMenuOpen(false);
      setContextMenu(null);
      setTabContextMenu(null);
    };
    // Capture phase so descendants that call stopPropagation (e.g. section
    // rows) still trigger menu dismissal.
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    setWidthMenuOpen(false);
  }, [activePath, workspace, settingsOpen]);

  const refreshWorkspace = useCallback(async (nextWorkspace = workspace) => {
    if (!nextWorkspace) {
      latestNotebookSnapshotRef.current.invalidate();
      pendingNoteContentsRef.current.clear();
      setFolders([]);
      setNotes([]);
      setContents(new Map());
      setOpenTabs([]);
      setSelectedFolder("");
      setLinkIndex(null);
      return;
    }
    if (!isWorkspaceActive(nextWorkspace)) return;

    const loaded = await latestNotebookSnapshotRef.current.load(
      nextWorkspace,
      () => readNotebookSnapshot(nextWorkspace),
      isWorkspaceActive,
    );
    if (!loaded || !isWorkspaceActive(nextWorkspace)) return;
    const { snapshot } = loaded;
    setFolders(snapshot.folders);
    setNotes(snapshot.notes);
    setContents(new Map(Object.entries(snapshot.contents)));

    setSelectedFolder((current) => (snapshot.folders.some((folder) => folder.path === current) ? current : ""));

    setLinkIndex(snapshot.linkIndex);
  }, [isWorkspaceActive, workspace]);

  useEffect(() => {
    pendingNoteContentsRef.current.clear();
  }, [workspace]);

  useEffect(() => {
    void refreshWorkspace().catch((error) => {
      setAppError(error instanceof Error ? error.message : String(error));
    });
  }, [refreshWorkspace]);

  const recordNotePosition = useCallback((path: string, markdown: string, patch: Partial<NotePositionMetadata> = {}) => {
    if (!workspace) return;
    const current = metadataSessionRef.current.read(workspace);
    if (!current) return;
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

    const next = metadataSessionRef.current.updateActive(workspace, updater);
    if (!next) return;
    metadataRef.current = next;
    void notebookMetadataPersistence.mutate(
      workspace,
      updater,
      next,
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

  const beginNoteNavigation = useCallback((path: string | null = null) => {
    setWidthMenuOpen(false);
    armedTitleFocusRequestRef.current = 0;
    titleCommitInFlightRef.current = false;
    return activeNoteLifecycle.beginNavigation(path);
  }, [activeNoteLifecycle]);

  const setNoteNavigationTarget = useCallback((token: number, path: string) => {
    return activeNoteLifecycle.setNavigationTarget(token, path);
  }, [activeNoteLifecycle]);

  const captureNoteNavigation = useCallback(() => {
    return activeNoteLifecycle.captureNavigation();
  }, [activeNoteLifecycle]);

  const isCurrentNoteNavigation = useCallback(
    (token: number) => activeNoteLifecycle.isCurrentNavigation(token),
    [activeNoteLifecycle],
  );

  const abandonNoteNavigation = useCallback(() => {
    armedTitleFocusRequestRef.current = 0;
    titleCommitInFlightRef.current = false;
    activeNoteLifecycle.cancelNavigation();
  }, [activeNoteLifecycle]);

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

  const loadExistingNoteIntoEditor = useCallback(async (
    path: string,
    options: { preserveSelectedFolder?: boolean; navigationToken?: number } = {},
  ) => {
    const navigationToken = options.navigationToken ?? beginNoteNavigation(path);
    if (!setNoteNavigationTarget(navigationToken, path)) return;
    const token = beginNoteLoad();
    try {
      const content = pendingNoteContentsRef.current.read(path, contents.get(path) ?? (await readNote(workspace, path)));
      if (!isCurrentNoteLoad(token) || !isCurrentNoteNavigation(navigationToken)) return;
      const note = notes.find((entry) => entry.path === path);
      const restorePosition = getRestorableNotePosition(metadataRef.current, path, content);
      const access = await acquireActiveNoteLock(path);
      if (!isCurrentNoteLoad(token) || !isCurrentNoteNavigation(navigationToken)) {
        if (access === "editable") await releaseActiveNoteLock();
        return;
      }
      activeNoteLifecycle.acceptDiskContent(path, content);
      disarmUndoableNewNote(path);
      setActivePathAuthoritatively(path);
      activeDraftStateRef.current.pendingNote = null;
      setPendingNote(null);
      if (note && !options.preserveSelectedFolder) {
        setSelectedFolder(navigationStyle === "section-view" ? getTopLevelFolderPath(note.parent_path) : note.parent_path);
      }
      loadContentIntoEditor(note ?? null, content, restorePosition);
      applyNoteAccess(access);
      recordNotePosition(path, content, { lastOpenedAt: Date.now() });
    } finally {
      finishNoteLoad(token);
      activeNoteLifecycle.settleNavigation(navigationToken);
    }
  }, [acquireActiveNoteLock, activeNoteLifecycle, applyNoteAccess, beginNoteLoad, beginNoteNavigation, contents, disarmUndoableNewNote, finishNoteLoad, isCurrentNoteLoad, isCurrentNoteNavigation, navigationStyle, notes, recordNotePosition, releaseActiveNoteLock, setActivePathAuthoritatively, setNoteNavigationTarget, workspace]);

  useEffect(() => {
    return () => {
      void releaseActiveNoteLock();
    };
  }, [releaseActiveNoteLock]);

  const clearCurrentNote = useCallback((preserveNavigation = false) => {
    armedTitleFocusRequestRef.current = 0;
    titleCommitInFlightRef.current = false;
    if (!preserveNavigation) {
      activeNoteLifecycle.cancelNavigation();
      cancelPendingNoteLoads();
    }
    disarmUndoableNewNote(activePath);
    if (!preserveNavigation) void releaseActiveNoteLock();
    applyNoteAccess("editable");
    setActivePathAuthoritatively(null);
    activeNoteIdentityRef.current = null;
    activeDraftStateRef.current.pendingNote = null;
    draftSaveRevisions.reset("");
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
    setHasEditorSelection(false);
  }, [activeNoteLifecycle, activePath, applyNoteAccess, cancelPendingNoteLoads, disarmUndoableNewNote, draftSaveRevisions, releaseActiveNoteLock, setActivePathAuthoritatively]);

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
    setOpenTabs([createNoteTab(tabId, targetNote.path)]);
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
      setOpenTabs([createNoteTab(tabId, target.path)]);
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

    const tabs = existingPaths.map((path) => createNoteTab(createTabId(), path));
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
    autoSelectedWorkspaceRef.current = workspace;
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
    if (!workspace) return null;
    const next = metadataSessionRef.current.updateActive(workspace, updater);
    if (!next) return null;
    metadataRef.current = next;
    setMetadata(next);
    if (options.persist !== false) {
      void notebookMetadataPersistence
        .mutate(workspace, updater, metadataRef.current, acceptPersistedMetadata)
        .catch((error) => {
          setAppError(error instanceof Error ? error.message : String(error));
        });
    }
    return next;
  }, [acceptPersistedMetadata, workspace]);

  const rememberWritingStyle = useCallback((style: "notes" | "story") => {
    if (!metadataLoaded || metadataRef.current.lastWritingStyle === style) return;
    updateMetadata(current => ({ ...current, lastWritingStyle: style }));
  }, [metadataLoaded, updateMetadata]);

  useEffect(() => {
    if (activePath && !writingStyleNoteLoading && !frontmatterError) rememberWritingStyle(writingStyle);
  }, [activePath, writingStyleNoteLoading, frontmatterError, writingStyle, rememberWritingStyle]);

  const notebookPathMutations = useMemo(() => createNotebookPathMutations({
    activePath,
    getActivePath: () => activeDraftStateRef.current.activePath,
    withSavedEditor: (path, operation) => withSavedEditorRef.current(path, operation),
    activeNoteLockRef,
    folders,
    getMetadata: () => metadataSessionRef.current.isActive(workspace)
      ? metadataSessionRef.current.readActive(workspace) ?? metadataRef.current
      : metadataSessionRef.current.read(workspace) ?? defaultWorkspaceMetadata(),
    navigationStyle,
    notes,
    isWorkspaceActive: () => isWorkspaceActive(workspace),
    refreshWorkspace,
    selectedFolder,
    setActivePath: setActivePathAuthoritatively,
    setOpenTabs,
    setSelectedFolder,
    adoptMetadata: (next) => adoptAuthoritativeMetadata(workspace, next),
    updateMetadata,
    workspace,
    rebasePendingMetadata: (forward, reverse, localMetadata) => {
      notebookMetadataPersistence.rebasePending(workspace, forward, reverse, localMetadata);
    },
    runDurableMutation: (operation, scope) => activeNoteLifecycle.runPathMutation(
      scope.path,
      scope.includesDescendants,
      () => notebookMetadataPersistence.runExclusive(workspace, operation),
    ),
  }), [activeNoteLifecycle, activeNoteLockRef, activePath, adoptAuthoritativeMetadata, folders, isWorkspaceActive, navigationStyle, notes, refreshWorkspace, selectedFolder, setActivePathAuthoritatively, updateMetadata, workspace]);

  const setFolderExpanded = useCallback((path: string, expanded: boolean) => {
    updateMetadata((current) => ({
      ...current,
      expandedFolders: {
        ...current.expandedFolders,
        [path]: expanded,
      },
    }));
  }, [updateMetadata]);

  const updateNotebookAppearance = useCallback((patch: Partial<NonNullable<WorkspaceMetadata["appearance"]>>) => {
    const next = updateMetadata((current) => {
      const previous = current.appearance;
      const colors = patch.colors
        ? {
            ...previous?.colors,
            ...(patch.colors.light ? { light: { ...previous?.colors?.light, ...patch.colors.light } } : {}),
            ...(patch.colors.dark ? { dark: { ...previous?.colors?.dark, ...patch.colors.dark } } : {}),
          }
        : previous?.colors;
      return {
        ...current,
        appearance: {
          ...previous,
          ...patch,
          wallpapers: notebookWallpapers(previous?.wallpapers, previous?.quickAppearance?.backgroundImage, patch.quickAppearance?.backgroundImage),
          ...(patch.colors ? { colors } : {}),
        },
      };
    });
    if (!next) return;

    if (patch.plasma) {
      setPlasmaEnabled(patch.plasma.enabled);
      setPlasmaFrost(patch.plasma.frost);
      setPlasmaBackgroundBlur(patch.plasma.backgroundBlur);
      setPlasmaFlow(patch.plasma.flow ?? 0);
      setPlasmaAmbientDrops(patch.plasma.ambientDrops ?? false);
    }
    if (patch.colorScheme !== undefined) setColorScheme(patch.colorScheme);
    if (patch.themePresetId && themePresets.some((preset) => preset.id === patch.themePresetId)) {
      setThemePresetId(patch.themePresetId as ThemePresetId);
    }
    if (patch.colors) {
      setThemeColors((current) => ({
        light: { ...current.light, ...(patch.colors?.light ?? {}) },
        dark: { ...current.dark, ...(patch.colors?.dark ?? {}) },
      }));
    }
    if (patch.accentTitlebar !== undefined) setAccentTitlebar(patch.accentTitlebar);
    if (patch.rightSidebarOpen !== undefined) setOutlineVisible(patch.rightSidebarOpen);
    if (patch.navigationStyle !== undefined) setNavigationStyle(patch.navigationStyle);
    if (patch.wordCountVisible !== undefined) setWordCountVisible(patch.wordCountVisible);
    if (patch.editorWidthMode !== undefined) setEditorWidthMode(patch.editorWidthMode);
    if (patch.noteAlignment !== undefined) setNoteAlignment(patch.noteAlignment);
    if (patch.appFontFamily !== undefined) setAppFontFamily(patch.appFontFamily);
    if (patch.appFontSize !== undefined) setAppFontSize(patch.appFontSize);
    if (patch.editorFontFamily !== undefined) setEditorFontFamily(patch.editorFontFamily);
    if (patch.editorFontSize !== undefined) setEditorFontSize(patch.editorFontSize);

  }, [updateMetadata]);

  function useThemeDefaults(theme: ThemeDocument, scope: ThemeDefaultsScope) {
    if (workspaceRef.current !== workspace) return;
    if (theme.id === "default" && scope === "all") {
      resetThemeAppearance();
      return;
    }
    updateNotebookAppearance(themeDefaultsPatch(theme, scope));
  }

  function resetThemeAppearance() {
    const defaultTheme = classicThemes.find(theme => theme.id === "default") ?? recoveryTheme;
    updateNotebookAppearance({
      ...themeDefaultsPatch(defaultTheme, "all"),
      customTheme: null,
      themePresetId: "default",
      themeColorPreferences: { ...metadata.appearance?.themeColorPreferences, classic: "default" },
      accentColor: null,
      // Full appearance recovery is independent of themes that keep the current layout.
      editorWidthMode: "comfortable",
      noteAlignment: "center",
      rightSidebarOpen: true,
      wordCountVisible: true,
    });
    focusRestoreRef.current = null;
    setPaneOverlay(null);
    setLeftVisible(true);
  }

  function selectThemeColor(id: string, colorsOnly: boolean) {
    const theme = classicThemes.find(theme => theme.id === id);
    if (!theme) return;
    const family = themeFamily(id);
    updateNotebookAppearance({
      ...themeAppearance(theme), customTheme: null, themePresetId: id,
      navigationStyle, rightSidebarOpen: preferredOutlineVisible,
      ...(colorsOnly ? {
        editorWidthMode, noteAlignment, wordCountVisible, plasma: metadata.appearance?.plasma,
        appFontFamily, appFontSize, editorFontFamily, editorFontSize, accentTitlebar: savedAccentTitlebar,
      } : {}),
      quickAppearance: colorsOnly ? { ...quickAppearance, accentColor: undefined } : null,
      themeColorPreferences: { ...metadata.appearance?.themeColorPreferences, ...(family ? { [family.id]: id } : {}) },
    });
  }

  function applyCustomTheme(theme: ThemeDocument) {
    if (workspaceRef.current !== workspace) return;
    // Retain notebook layout; the snapshot keeps the author defaults for the opt-in action.
    updateNotebookAppearance({ ...themeAppearance(theme), quickAppearance: null, navigationStyle, rightSidebarOpen: preferredOutlineVisible });
  }

  function themeSeed(): ThemeDocument {
    return captureCurrentThemeSettings(renderedTheme, {
      quickAppearance, navigationStyle, rightSidebarOpen: preferredOutlineVisible,
      editorWidthMode, noteAlignment, wordCountVisible,
      accentTitlebar, plasma: { enabled: plasmaEnabled, frost: plasmaFrost, backgroundBlur: plasmaBackgroundBlur, flow: plasmaFlow, ambientDrops: plasmaAmbientDrops },
    });
  }

  function requestEditorCommand(command: EditorCommand, payload: Partial<EditorCommandRequest> = {}) {
    if (isInlineColorCommand(command) && (titleFocused || document.activeElement === titleInputRef.current)) return;
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
      const document = readNoteDocument(markdown, titleDraft);
      const html = await buildNoteExportHtml(titleDraft, document.body, {
        writingStyle: readWritingStyle(document.frontmatter),
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
      const document = readNoteDocument(markdown, titleDraft);
      const html = await buildNoteExportHtml(titleDraft, document.body, {
        writingStyle: readWritingStyle(document.frontmatter),
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
    if (userPathMutationRef.current) return;
    if (isSortCommand(command)) {
      if (command === "sort_bullet_method" && !bulletMethodDisplay.enabled) return;
      if (activeNoteEditable && !rawMarkdownVisible && !frontmatterError && (hasEditorSelection || command === "sort_bullet_method")) requestEditorCommand(command);
      return;
    }
    if (command.startsWith("open_recent_note:")) {
      const index = Number(command.slice("open_recent_note:".length));
      const recentNote = Number.isInteger(index) ? recentNotes[index] : undefined;
      if (recentNote) await selectNote(recentNote.path);
      return;
    }

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
        await requestCreateNoteInCurrentContext();
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
        setSearchOpen(true);
        setSearchFocusRequest((value) => value + 1);
        break;
      case "toggle_spellcheck":
        setSpellcheckEnabled((value) => !value);
        break;
      case "toggle_sidebar":
        toggleLeftSidebar();
        break;
      case "toggle_outline":
        toggleRightSidebar();
        break;
      case "toggle_focus":
        toggleEditorFocusMode();
        break;
      case "toggle_word_count":
        updateNotebookAppearance({ wordCountVisible: !wordCountVisible });
        break;
      case "toggle_raw_markdown":
        toggleRawMarkdownMode();
        break;
      case "zoom_in":
        applyAppZoomCommand("in");
        break;
      case "zoom_out":
        applyAppZoomCommand("out");
        break;
      case "zoom_reset":
        applyAppZoomCommand("reset");
        break;
      case "navigation_dual_pane":
        updateNotebookAppearance({ navigationStyle: "dual-pane" });
        break;
      case "navigation_section_view":
        updateNotebookAppearance({ navigationStyle: "section-view" });
        break;
      case "navigation_single_pane":
        updateNotebookAppearance({ navigationStyle: "single-pane" });
        break;
      case "width_comfortable":
        updateNotebookAppearance({ editorWidthMode: "comfortable" });
        break;
      case "width_narrow":
        updateNotebookAppearance({ editorWidthMode: "narrow" });
        break;
      case "width_full":
        updateNotebookAppearance({ editorWidthMode: "full" });
        break;
      case "align_left":
        updateNotebookAppearance({ noteAlignment: "left" });
        break;
      case "align_center":
        updateNotebookAppearance({ noteAlignment: "center" });
        break;
      case "format_equation":
        if (contentsActive && activeNoteEditable && !rawMarkdownVisible && !frontmatterError) requestEditorCommand("equation");
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

  function toggleLeftSidebar() {
    if (!responsivePanes.canDockLeft) {
      setPaneOverlay(current => current === "left" ? null : "left");
      return;
    }
    setPaneOverlay(null);
    setLeftVisible(value => !value);
  }

  function toggleRightSidebar() {
    if (!responsivePanes.canDockRight) {
      setPaneOverlay(current => current === "right" ? null : "right");
      return;
    }
    setPaneOverlay(null);
    updateNotebookAppearance({ rightSidebarOpen: !preferredOutlineVisible });
  }

  function toggleEditorFocusMode() {
    // Automatic focus mode must still offer a way to reach navigation.
    if (!leftVisible && !outlineVisible && (preferredLeftVisible || preferredOutlineVisible)) {
      toggleLeftSidebar();
      return;
    }
    setPaneOverlay(null);
    const transition = toggleFocusMode(
      { leftVisible: preferredLeftVisible, outlineVisible: preferredOutlineVisible },
      focusRestoreRef.current,
    );
    focusRestoreRef.current = transition.restore;
    setLeftVisible(transition.panes.leftVisible);
    updateNotebookAppearance({ rightSidebarOpen: transition.panes.outlineVisible });
    if (transition.panes.leftVisible && !responsivePanes.canDockLeft) setPaneOverlay("left");
  }

  function getRestorableNotePosition(current: WorkspaceMetadata, path: string, markdown: string) {
    const position = current.notePositions[path];
    if (!position) return null;
    if (Date.now() - position.lastOpenedAt > notePositionFreshMs) return null;
    if (position.contentLength !== markdown.length) return null;
    return position;
  }

  const updateNoteScrollFades = useCallback(() => {
    const scrollElement = rawMarkdownVisible || frontmatterError
      ? rawMarkdownInputRef.current
      : noteSurfaceRef.current;
    const next = scrollElement
      ? getScrollFadeVisibility(scrollElement)
      : { top: false, bottom: false };
    setNoteScrollFades((current) =>
      current.top === next.top && current.bottom === next.bottom ? current : next,
    );
  }, [frontmatterError, rawMarkdownVisible]);

  const updateDockedNoteTitle = useCallback((animate: boolean) => {
    const surface = noteSurfaceRef.current;
    const titleInput = titleInputRef.current;
    const visible = Boolean(
      surface
      && titleInput
      && shouldDockNoteTitle(titleInput.getBoundingClientRect(), surface.getBoundingClientRect()),
    );
    setDockedTitleState((current) =>
      current.visible === visible && current.animate === animate
        ? current
        : { visible, animate },
    );
  }, []);

  const resizeNoteTitleInput = useCallback(() => {
    const titleInput = titleInputRef.current;
    if (!titleInput) return;
    titleInput.style.height = "0px";
    titleInput.style.height = `${titleInput.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    dockedTitleAnimationReadyRef.current = false;
    setDockedTitleState({ visible: false, animate: false });
  }, [activePath]);

  useEffect(() => {
    const surface = noteSurfaceRef.current;
    if (!surface || !activePath) return;
    let readyFrame = 0;
    const restoreFrame = requestAnimationFrame(() => {
      const target = editorRestorePosition?.scrollTop ?? 0;
      const maxScroll = Math.max(0, surface.scrollHeight - surface.clientHeight);
      surface.scrollTop = target >= 0 && target <= maxScroll + 16 ? target : 0;
      const nextFades = getScrollFadeVisibility(surface);
      setNoteScrollFades((current) =>
        current.top === nextFades.top && current.bottom === nextFades.bottom ? current : nextFades,
      );
      updateDockedNoteTitle(false);
      readyFrame = requestAnimationFrame(() => {
        dockedTitleAnimationReadyRef.current = true;
      });
    });
    // noteOpen intentionally excluded: refreshWorkspace (auto-save) regenerates the notes
    // array which gives noteOpen a new object reference, spuriously re-firing this effect
    // and scrolling back to the top. activePath and editorRestorePosition only change on
    // actual note switches, which is the only time scroll should be restored.
    return () => {
      cancelAnimationFrame(restoreFrame);
      cancelAnimationFrame(readyFrame);
    };
  }, [activePath, editorRestorePosition, updateDockedNoteTitle]);

  useEffect(() => {
    if (!hasOpenNote) return;
    const surface = noteSurfaceRef.current;
    const titleInput = titleInputRef.current;
    if (!surface || !titleInput) return;

    let titleWidth = titleInput.getBoundingClientRect().width;
    const updateWithoutAnimation = (entries?: ResizeObserverEntry[]) => {
      const titleEntry = entries?.find((entry) => entry.target === titleInput);
      const nextTitleWidth = titleEntry?.contentRect.width ?? titleInput.getBoundingClientRect().width;
      if (Math.abs(nextTitleWidth - titleWidth) > 0.5) {
        titleWidth = nextTitleWidth;
        resizeNoteTitleInput();
      }
      updateDockedNoteTitle(false);
    };
    const frame = requestAnimationFrame(() => updateWithoutAnimation());
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateWithoutAnimation);
    observer?.observe(surface);
    observer?.observe(titleInput);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [activePath, hasOpenNote, resizeNoteTitleInput, titleDraft, updateDockedNoteTitle]);

  useEffect(() => {
    if (!hasOpenNote) {
      setNoteScrollFades({ top: false, bottom: false });
      return;
    }

    const surface = noteSurfaceRef.current;
    const scrollElement = rawMarkdownVisible || frontmatterError
      ? rawMarkdownInputRef.current
      : surface;
    if (!scrollElement) return;
    const frame = requestAnimationFrame(updateNoteScrollFades);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateNoteScrollFades);
    observer?.observe(scrollElement);
    if (scrollElement === surface) {
      Array.from(surface?.children ?? []).forEach((child) => observer?.observe(child));
    }

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [
    activePath,
    draft,
    editorWidthMode,
    frontmatterError,
    hasOpenNote,
    leftVisible,
    noteAlignment,
    outlineVisible,
    rawMarkdownDraft,
    rawMarkdownVisible,
    titleDraft,
    updateNoteScrollFades,
  ]);

  function handleNoteSurfaceScroll() {
    updateNoteScrollFades();
    updateDockedNoteTitle(dockedTitleAnimationReadyRef.current);
    if (!activePath) return;
    const scrollTop = noteSurfaceRef.current?.scrollTop ?? 0;
    if (metadataRef.current.notePositions[activePath]?.scrollTop === scrollTop) return;
    recordNotePosition(activePath, rawMarkdownDraft, {
      scrollTop,
    });
  }

  function handleEditorPositionChange(position: { selectedText: string; selectionFrom: number; selectionTo: number }) {
    setHasEditorSelection(position.selectionFrom !== position.selectionTo);
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
      const tabs = current.some((tab) => tab.id === tabId) ? current : [...current, createNoteTab(tabId, null)];
      return tabs.map((tab) => (tab.id === tabId ? visitNoteInTab(tab, path) : tab));
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
    if (!workspace || !activePath) return;
    const operationWorkspace = workspace;
    const operationPath = activePath;
    const navigationToken = captureNoteNavigation();
    const access = await acquireActiveNoteLock(operationPath);
    if (
      !isWorkspaceActive(operationWorkspace)
      || !isCurrentNoteNavigation(navigationToken)
      || activeDraftStateRef.current.activePath !== operationPath
    ) return;
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

  async function selectNote(
    path: string,
    options: { preserveSelectedFolder?: boolean; skipPersist?: boolean; navigationToken?: number } = {},
  ) {
    if (!workspace) return;
    const operationWorkspace = workspace;
    const navigationToken = options.navigationToken ?? beginNoteNavigation(path);
    if (!options.skipPersist && !await persistDraftForNavigation()) return;
    if (!isWorkspaceActive(operationWorkspace) || !isCurrentNoteNavigation(navigationToken)) return;
    placePathInActiveTab(path);
    await loadExistingNoteIntoEditor(path, {
      preserveSelectedFolder: options.preserveSelectedFolder,
      navigationToken,
    });
    if (!isWorkspaceActive(operationWorkspace) || !isCurrentNoteNavigation(navigationToken)) return;
    setSearchQuery("");
    setPaneOverlay(null);
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
    if (!workspace) return;
    const operationWorkspace = workspace;
    const navigationToken = beginNoteNavigation(sectionPath);
    if (!await persistDraftForNavigation()) return;
    if (!isWorkspaceActive(operationWorkspace) || !isCurrentNoteNavigation(navigationToken)) return;

    setSelectedFolder(sectionPath);
    const lastOpenedNote = findLastOpenedNoteInSection(sectionPath);
    if (lastOpenedNote) {
      await selectNote(lastOpenedNote.path, {
        preserveSelectedFolder: true,
        skipPersist: true,
        navigationToken,
      });
      return;
    }

    clearCurrentNote();
  }

  async function selectFolderForNewNote(folderPath: string) {
    if (!workspace) return;
    const operationWorkspace = workspace;
    const navigationToken = beginNoteNavigation(folderPath);
    if (!await persistDraftForNavigation()) return;
    if (!isWorkspaceActive(operationWorkspace) || !isCurrentNoteNavigation(navigationToken)) return;
    setSelectedFolder(folderPath);
    clearCurrentNote();
  }

  async function handleExternalNoteChange(path: string) {
    if (!workspace) return;
    const operationWorkspace = workspace;
    const navigationToken = captureNoteNavigation();
    try {
      const nextContent = await readNote(operationWorkspace, path);
      if (!isWorkspaceActive(operationWorkspace)) return;
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
      const changedNoteIdentity =
        readNoteDocument(nextContent, "").frontmatterFields
          .find((field) => field.key === "id")?.value.trim()
        || null;
      const contentChangeAction = getWatchedContentChangeAction({
        diskChange,
        hasPathChange: activeNoteLifecycle.hasPathChange,
        activeNoteIdentity: activeNoteIdentityRef.current,
        changedNoteIdentity,
        hasUnsavedChanges: hasUnsavedChanges
          || hadPendingEditorChange
          || Boolean(pendingEditorChangeRef.current),
      });
      if (contentChangeAction === "accept") {
        cacheObservedContent();
        return;
      }
      if (contentChangeAction === "defer") {
        activeNoteLifecycle.acceptDiskContent(path, nextContent);
        return;
      }

      // For the active note, the editor's snapshot — not the contents cache — is the
      // source of truth. A move that rewrote inbound links on disk also calls
      // refreshWorkspace, which has already updated the contents map; without this
      // check we'd short-circuit and the editor would keep showing the stale link.
      const currentContent = contents.get(path);
      if (activePath !== path && currentContent !== undefined && normalizeNoteMarkdown(currentContent) === nextNormalized) return;

      setContents((current) => {
        const next = new Map(current);
        next.set(path, nextContent);
        return next;
      });

      const refreshedNotes = await listNotes(operationWorkspace);
      if (!isWorkspaceActive(operationWorkspace)) return;
      setNotes(refreshedNotes);
      const note = refreshedNotes.find((entry) => entry.path === path) ?? notes.find((entry) => entry.path === path) ?? null;
      if (
        !isCurrentNoteNavigation(navigationToken)
        || activeDraftStateRef.current.activePath !== path
      ) return;

      if (contentChangeAction === "warn") {
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
      if (!isWorkspaceActive(operationWorkspace)) return;
      const missingChangeAction = getMissingNoteChangeAction({
        activePath: activeDraftStateRef.current.activePath,
        changedPath: path,
        hasPathMutation: activeNoteLifecycle.isPathMutationInFlight(path),
        hasUnsavedChanges: hasUnsavedChanges || Boolean(pendingEditorChangeRef.current),
      });
      if (missingChangeAction === "defer") return;
      if (missingChangeAction === "preserve") {
        setAppError("This note is temporarily unavailable on disk, but your unsaved edits are still open. Save to retry or switch notes when you are ready.");
        return;
      }
      await refreshWorkspace(operationWorkspace);
      if (!isWorkspaceActive(operationWorkspace)) return;
      if (
        isCurrentNoteNavigation(navigationToken)
        && activeDraftStateRef.current.activePath === path
      ) {
        clearCurrentNote();
      }
    }
  }

  externalNoteChangeRef.current = (path: string) => void handleExternalNoteChange(path);

  const acceptSavedMarkdown = useCallback((savedPath: string, written: string, snapshot: PersistDraftSnapshot) => {
    if (!metadataSessionRef.current.isActive(snapshot.workspace)) return;
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
    const shouldSaveNewerDraft = draftSaveRevisions.complete(snapshot.saveRevision);
    currentDraft.savedRawMarkdownText = written;
    currentDraft.savedTitle = snapshot.title;
    setSavedRawMarkdownText(written);
    setSavedTitle(snapshot.title);
    if (shouldSaveNewerDraft) {
      void activeNoteLifecycle
        .requestPersistence(() => persistDraftAttemptRef.current())
        .catch(() => undefined);
    }
    if (!sameDraft) return;

    setDraft(nextBody);
    setFrontmatterDraft(nextFrontmatter);
    setRawMarkdownText(written);
    if (!savedDocument.frontmatterError) setFrontmatterError(null);
  }, [activeNoteLifecycle, draftSaveRevisions]);

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
      saveRevision: draftSaveRevisions.observe(markdown),
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
            if (metadataSessionRef.current.isActive(snapshot.workspace)) {
              activeNoteLifecycle.acceptDiskContent(note.path, initial);
            }
          } catch {
            // Best-effort; the saveNote below will overwrite the entry anyway.
          }
          if (metadataSessionRef.current.isActive(snapshot.workspace)) {
            const createdAccess = await acquireActiveNoteLock(note.path);
            if (!metadataSessionRef.current.isActive(snapshot.workspace)) {
              if (createdAccess === "editable") await releaseActiveNoteLock();
            } else {
              applyNoteAccess(createdAccess);
              if (createdAccess !== "editable") return;
              activeDraftStateRef.current.activePath = note.path;
              activeDraftStateRef.current.pendingNote = null;
              setNotes((current) => current.some((entry) => entry.path === note.path) ? current : [...current, note]);
              setActivePathAuthoritatively(note.path);
              setPendingNote(null);
              setSelectedFolder(navigationStyle === "section-view" ? getTopLevelFolderPath(note.parent_path) : note.parent_path);
              placePathInActiveTab(note.path);
              updateMetadata((current) => addToOrder(current, note.parent_path, note.path));
            }
          }
        } else if (snapshot.path && snapshot.title !== snapshot.savedTitle) {
          const renamed = await notebookPathMutations.renameActiveNote(snapshot.path, snapshot.title);
          nextPath = renamed.path;
          if (metadataSessionRef.current.isActive(snapshot.workspace)) {
            activeDraftStateRef.current.activePath = renamed.path;
          }
        }

        if (!nextPath) return;

        const savedPath = nextPath;
        draftSaveRevisions.markRequested(snapshot.saveRevision);
        const written = await activeNoteLifecycle.runExpectedDiskWrite(
          savedPath,
          snapshot.markdown,
          () => saveNote(snapshot.workspace, savedPath, snapshot.markdown),
        );
        if (!metadataSessionRef.current.isActive(snapshot.workspace)) return;
        if (snapshot.path && snapshot.path !== savedPath) activeNoteLifecycle.forgetDiskContent(snapshot.path);
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
    draftSaveRevisions.markRequested(snapshot.saveRevision);

    enqueueNoteSave(snapshot.path, async () => {
      const savedPath = snapshot.path as string;
      const written = await activeNoteLifecycle.runExpectedDiskWrite(
        savedPath,
        snapshot.markdown,
        () => saveNote(snapshot.workspace, savedPath, snapshot.markdown),
      );
      if (!metadataSessionRef.current.isActive(snapshot.workspace)) return;
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
        const savedAt = Date.now() / 1000;
        setNotes((current) => current.map((note) =>
          updateNoteEntryAfterSave(note, savedPath, written, savedAt)
        ));
      });
      if (backlinkPaneVisibleRef.current) {
        const nextIndex = await readLinkIndex(snapshot.workspace);
        if (metadataSessionRef.current.isActive(snapshot.workspace)) {
          startTransition(() => setLinkIndex(nextIndex));
        }
      }
    });
    return snapshot.markdown;
  }, [acceptSavedMarkdown, acquireActiveNoteLock, activeNoteEditable, activeNoteLifecycle, applyNoteAccess, draft, draftSaveRevisions, enqueueNoteSave, flushPendingEditorBody, frontmatterDraft, frontmatterError, navigationStyle, noteOpen, notebookPathMutations, placePathInActiveTab, rawMarkdownDraft, rawMarkdownVisible, recordNotePosition, refreshWorkspace, releaseActiveNoteLock, setActivePathAuthoritatively, titleDraft, updateMetadata, workspace]);

  persistDraftAttemptRef.current = persistDraftAttempt;
  const persistDraft = useCallback(
    () => activeNoteLifecycle.requestPersistence(() => persistDraftAttemptRef.current()),
    [activeNoteLifecycle],
  );
  const persistDraftInBackground = useCallback(() => {
    void persistDraft().catch(() => undefined);
  }, [persistDraft]);

  withSavedEditorRef.current = async (path, operation) => {
    if (userPathMutationRef.current) throw new Error("Wait for the current move or rename to finish.");
    if (activeNoteLifecycle.isLoading) throw new Error("Wait for the Note to finish loading before moving or renaming it.");
    const operationWorkspace = workspace;
    const navigationToken = captureNoteNavigation();
    const originalActivePath = activeDraftStateRef.current.activePath;
    const editor = editorPersistenceRef.current;
    const shell = appShellRef.current;
    userPathMutationRef.current = true;
    try {
      // Capture DOM-only accessibility changes as well as deferred transactions
      // before freezing input. Persistence must read the committed React draft.
      flushSync(() => {
        if (!activeNoteEditable) return;
        const snapshot = editor?.capture();
        if (snapshot && snapshot.sourceNotePath === originalActivePath) setDraft(snapshot.markdown);
        if (titleInputRef.current) setTitleDraft(titleInputRef.current.value);
        if ((rawMarkdownVisible || frontmatterError) && rawMarkdownInputRef.current) {
          handleRawMarkdownChange(rawMarkdownInputRef.current.value);
        }
      });
      if (activeNoteEditable && originalActivePath) validateNoteTitle(activeDraftStateRef.current.titleDraft);
      editor?.setReadOnly(true);
      if (shell) shell.inert = true;
      const persisted = await activeNoteLifecycle.requestPersistence(() => persistDraftAttemptRef.current());
      await activeNoteLifecycle.flushPendingSaves();
      if (!isWorkspaceActive(operationWorkspace) || !isCurrentNoteNavigation(navigationToken)) {
        throw new Error("The open Note changed before the move or rename could finish. Try again.");
      }
      const current = activeDraftStateRef.current;
      // A validation error must not silently turn a failed save into a move.
      if (activeNoteEditable && current.activePath && (persisted === undefined || current.titleDraft.trim() !== current.savedTitle)) {
        throw new Error("Save a valid Note title before moving or renaming it.");
      }
      // Saving a pending title may itself have renamed the source file.
      const resolvedPath = originalActivePath === path ? current.activePath ?? path : path;
      return await operation(resolvedPath);
    } finally {
      if (shell) shell.inert = false;
      editorPersistenceRef.current?.setReadOnly(false);
      userPathMutationRef.current = false;
    }
  };

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

    const operationWorkspace = workspace;
    const navigationToken = captureNoteNavigation();
    const noteIntentIsCurrent = () => {
      if (!operationWorkspace) return false;
      return isWorkspaceActive(operationWorkspace) && isCurrentNoteNavigation(navigationToken);
    };
    titleCommitInFlightRef.current = true;
    let clearInFinally = true;
    try {
      await persistDraft();
      if (!noteIntentIsCurrent()) return;
      requestAnimationFrame(() => {
        if (!noteIntentIsCurrent()) {
          titleCommitInFlightRef.current = false;
          return;
        }
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
  }, [activeNoteEditable, captureNoteNavigation, disarmPendingTitleFocus, hasUnsavedChanges, isCurrentNoteNavigation, isWorkspaceActive, persistDraft, titleDraft, workspace]);

  async function persistDraftForNavigation() {
    if (!hasUnsavedChanges && !pendingEditorChangeRef.current) return true;
    try {
      await persistDraft();
      return true;
    } catch {
      abandonNoteNavigation();
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
    requestCreateNoteInContext: () => void requestCreateNoteInCurrentContext(),
    toggleRawMarkdown: toggleRawMarkdownMode,
    toggleSidebar: toggleLeftSidebar,
    toggleRightSidebar,
  };

  useEffect(() => {
    // Handle sidebar shortcuts before editor key handlers see them. Plain
    // slashes still reach the editor for typing and slash commands.
    const onShortcutCapture = (event: KeyboardEvent) => {
      if (userPathMutationRef.current || event.isComposing || event.defaultPrevented) return;
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key !== "/" && event.key !== "\\") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "/") keyboardActionsRef.current.toggleSidebar();
      else keyboardActionsRef.current.toggleRightSidebar();
    };
    window.addEventListener("keydown", onShortcutCapture, true);
    return () => window.removeEventListener("keydown", onShortcutCapture, true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (userPathMutationRef.current) return;
      const actions = keyboardActionsRef.current;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (event.key === "Escape") {
        setPaneOverlay(null);
        setSearchOpen(false);
        setSearchQuery("");
        setSettingsOpen(false);
        setNotebooksManageOpen(false);
        setAppMenuOpen(false);
        setWidthMenuOpen(false);
        setContextMenu(null);
        setTabContextMenu(null);
      }
      if (command && event.shiftKey && key === "f") {
        event.preventDefault();
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
        actions.requestCreateNoteInContext();
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
  }, [setPaneOverlay]);

  useEffect(() => {
    if (activeNoteLifecycle.isLoading) return;
    if (!activeNoteEditable) return;
    if (!hasUnsavedBody) return;
    if (pendingNote && !titleDraft.trim()) return;
    const persistIfIdle = () => {
      const path = activeDraftStateRef.current.activePath;
      if (activeNoteLifecycle.hasSaveInFlight(path)) return;
      persistDraftInBackground();
    };
    const initialHandle = window.setTimeout(persistIfIdle, autosaveDelayMs);
    const retryHandle = window.setInterval(persistIfIdle, autosaveRetryDelayMs);
    return () => {
      window.clearTimeout(initialHandle);
      window.clearInterval(retryHandle);
    };
  }, [activeNoteEditable, activeNoteLifecycle, hasUnsavedBody, pendingNote, persistDraftInBackground, titleDraft]);


  async function requestCreateNote(
    parentPath = selectedFolder,
    afterPath?: string,
  ) {
    if (!workspace) {
      setAppError("Open a notes folder before creating a note.");
      return;
    }
    const initialContent = createNoteDocument({ title: "", body: "", frontmatter: setWritingStyle("", newNoteWritingStyle === "last-used" ? lastWritingStyle : newNoteWritingStyle) }).markdown;
    const operationWorkspace = workspace;
    const followsActivePath = Boolean(afterPath && afterPath === activeDraftStateRef.current.activePath);
    let placementTargetPath = afterPath;
    const navigationToken = beginNoteNavigation();
    const navigationIsCurrent = () =>
      isWorkspaceActive(operationWorkspace) && isCurrentNoteNavigation(navigationToken);
    const placeCreatedNote = (current: WorkspaceMetadata, createdNote: NoteEntry) => {
      const targetPath = placementTargetPath;
      if (!targetPath) return addToOrder(current, createdNote.parent_path, createdNote.path);
      const orderingNotes = targetPath !== afterPath
        ? notes.map((note) => note.path === afterPath ? { ...note, path: targetPath } : note)
        : notes;
      return placeNoteInOrder(current, orderingNotes, createdNote.parent_path, createdNote.path, {
        targetPath,
        placement: "after",
      });
    };
    const reconcileCreatedNote = async (createdNote: NoteEntry) => {
      if (!isWorkspaceActive(operationWorkspace)) return;
      updateMetadata((current) => placeCreatedNote(current, createdNote));
      await refreshWorkspace(operationWorkspace);
    };
    try {
      if (!await persistDraftForNavigation()) return;
      if (!navigationIsCurrent()) return;
      if (followsActivePath) placementTargetPath = activeDraftStateRef.current.activePath ?? afterPath;

      cancelPendingNoteLoads();
      await releaseActiveNoteLock();
      if (!navigationIsCurrent()) return;
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
          note = await createNote(operationWorkspace, parentPath, title, initialContent);
          if (!navigationIsCurrent()) {
            await reconcileCreatedNote(note);
            return;
          }
          break;
        } catch (error) {
          if (!isDuplicateNoteTitleError(error)) throw error;
          if (!navigationIsCurrent()) return;
        }
      }
      if (!note) throw new Error("Could not create an untitled note.");
      const createdNote = note;
      if (!setNoteNavigationTarget(navigationToken, createdNote.path)) {
        await reconcileCreatedNote(createdNote);
        return;
      }

      const content = await readNote(operationWorkspace, createdNote.path);
      if (!navigationIsCurrent()) {
        await reconcileCreatedNote(createdNote);
        return;
      }
      const access = await acquireActiveNoteLock(createdNote.path);
      if (!navigationIsCurrent()) {
        await reconcileCreatedNote(createdNote);
        return;
      }
      activeNoteLifecycle.acceptDiskContent(createdNote.path, content);
      undoableNewNoteRef.current = access === "editable" ? { workspace: operationWorkspace, path: createdNote.path } : null;
      setNotes((current) => current.some((entry) => entry.path === createdNote.path) ? current : [...current, createdNote]);
      setContents((current) => {
        const next = new Map(current);
        next.set(createdNote.path, content);
        return next;
      });
      setActivePathAuthoritatively(createdNote.path);
      activeDraftStateRef.current.pendingNote = null;
      loadContentIntoEditor(createdNote, content);
      applyNoteAccess(access);
      recordNotePosition(createdNote.path, content, { lastOpenedAt: Date.now() });
      setSelectedFolder(navigationStyle === "section-view" ? getTopLevelFolderPath(createdNote.parent_path) : createdNote.parent_path);
      placePathInActiveTab(createdNote.path);
      updateMetadata((current) => placeCreatedNote(current, createdNote));
      setPaneOverlay(null);
      setTitleFocusRequest((value) => value + 1);
      activeNoteLifecycle.settleNavigation(navigationToken);
      await refreshWorkspace(operationWorkspace);
    } catch (error) {
      if (navigationIsCurrent()) {
        setAppError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function requestCreateNoteInCurrentContext() {
    const target = activeNote
      ? { parentPath: activeNote.parent_path, afterPath: activeNote.path }
      : noteCreationTargets.at(-1);
    await requestCreateNote(target?.parentPath ?? selectedFolder, target?.afterPath);
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
    const operationWorkspace = workspace;
    const path = activePath;
    const navigationToken = beginNoteNavigation();
    titleEscapeUndoInFlightRef.current = true;
    undoableNewNoteRef.current = null;
    try {
      await releaseActiveNoteLock();
      await deleteNote(operationWorkspace, path);
      if (!isWorkspaceActive(operationWorkspace)) return;
      activeNoteLifecycle.forgetDiskContent(path);
      setNotes((current) => current.filter((note) => note.path !== path));
      setContents((current) => {
        const next = new Map(current);
        next.delete(path);
        return next;
      });
      setOpenTabs((current) => current
        .filter((tab) => tab.path !== path)
        .map((tab) => pruneNoteTabHistory(tab, (historyPath) => historyPath === path)));
      updateMetadata((current) => removeNoteFromMetadata(current, path));
      if (
        isCurrentNoteNavigation(navigationToken)
        && activeDraftStateRef.current.activePath === path
      ) {
        clearCurrentNote();
      }
      await refreshWorkspace(operationWorkspace);
    } catch (error) {
      if (isWorkspaceActive(operationWorkspace) && isCurrentNoteNavigation(navigationToken)) {
        setAppError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      window.setTimeout(() => {
        titleEscapeUndoInFlightRef.current = false;
      }, 0);
    }
  }

  useLayoutEffect(() => {
    if (!noteOpen) return;
    resizeNoteTitleInput();
  }, [noteOpen, resizeNoteTitleInput, titleDraft]);

  async function addEmptyTab() {
    if (!workspace) return;
    const operationWorkspace = workspace;
    const navigationToken = beginNoteNavigation();
    if (!await persistDraftForNavigation()) return;
    if (!isWorkspaceActive(operationWorkspace) || !isCurrentNoteNavigation(navigationToken)) return;
    const tabId = createTabId();
    setOpenTabs((current) => [...current, createNoteTab(tabId, null)]);
    setActiveTabId(tabId);
    clearCurrentNote();
  }

  async function activateTab(tabId: string) {
    const tab = openTabs.find((entry) => entry.id === tabId);
    if (!workspace || !tab) return;
    const operationWorkspace = workspace;
    const navigationToken = beginNoteNavigation(tab.path);

    if (!await persistDraftForNavigation()) return;
    if (!isWorkspaceActive(operationWorkspace) || !isCurrentNoteNavigation(navigationToken)) return;

    setActiveTabId(tab.id);
    if (tab.path) {
      await loadExistingNoteIntoEditor(tab.path, { navigationToken });
      return;
    }

    clearCurrentNote();
  }

  async function navigateActiveTabHistory(offset: -1 | 1) {
    const tab = openTabs.find((entry) => entry.id === activeTabId);
    const targetPath = tab ? getNoteTabHistoryTarget(tab, offset) : null;
    if (!workspace || !tab || !targetPath) return;
    const operationWorkspace = workspace;
    const navigationToken = beginNoteNavigation(targetPath);

    if (!await persistDraftForNavigation()) return;
    if (!isWorkspaceActive(operationWorkspace) || !isCurrentNoteNavigation(navigationToken)) return;

    setOpenTabs((current) => current.map((entry) => {
      if (entry.id !== tab.id || getNoteTabHistoryTarget(entry, offset) !== targetPath) return entry;
      return moveInNoteTabHistory(entry, offset);
    }));
    await loadExistingNoteIntoEditor(targetPath, { navigationToken });
    if (!isWorkspaceActive(operationWorkspace) || !isCurrentNoteNavigation(navigationToken)) return;
    setSearchQuery("");
  }

  async function openNoteInNewTab(path: string) {
    if (!workspace) return;
    const operationWorkspace = workspace;
    const navigationToken = beginNoteNavigation(path);
    if (!await persistDraftForNavigation()) return;
    if (!isWorkspaceActive(operationWorkspace) || !isCurrentNoteNavigation(navigationToken)) return;
    const tabId = createTabId();
    setOpenTabs((current) => [...current, createNoteTab(tabId, path)]);
    setActiveTabId(tabId);

    await loadExistingNoteIntoEditor(path, { navigationToken });
  }

  async function closeTab(tabId: string) {
    if (!workspace) return;
    const operationWorkspace = workspace;
    const tab = openTabs.find((entry) => entry.id === tabId);
    const nextTabs = openTabs.filter((entry) => entry.id !== tabId);
    const closesActiveNote = activeTabId === tabId || activePath === tab?.path;
    const navigationToken = closesActiveNote
      ? beginNoteNavigation(nextTabs.at(-1)?.path ?? null)
      : null;
    if (closesActiveNote && !await persistDraftForNavigation()) return;
    if (
      !isWorkspaceActive(operationWorkspace)
      || (navigationToken !== null && !isCurrentNoteNavigation(navigationToken))
    ) return;
    setOpenTabs(nextTabs);
    setTabContextMenu(null);
    if (!closesActiveNote) return;

    const nextTab = nextTabs.at(-1);
    if (nextTab) {
      setActiveTabId(nextTab.id);
      if (nextTab.path) {
        await loadExistingNoteIntoEditor(nextTab.path, { navigationToken: navigationToken ?? undefined });
      } else {
        clearCurrentNote();
      }
      return;
    }

    setActiveTabId(null);
    clearCurrentNote();
  }

  async function closeAllTabs() {
    if (!workspace) return;
    const operationWorkspace = workspace;
    const navigationToken = beginNoteNavigation();
    if (!await persistDraftForNavigation()) return;
    if (!isWorkspaceActive(operationWorkspace) || !isCurrentNoteNavigation(navigationToken)) return;
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
    const operationWorkspace = workspace;
    const navigationToken = beginNoteNavigation();
    if (!await persistDraftForNavigation()) return;
    if (!isWorkspaceActive(operationWorkspace) || !isCurrentNoteNavigation(navigationToken)) return;
    try {
      const folder = await createFolder(operationWorkspace, folderDialogParent, folderName);
      if (!isWorkspaceActive(operationWorkspace) || !isCurrentNoteNavigation(navigationToken)) {
        await refreshWorkspace(operationWorkspace);
        return;
      }
      updateMetadata((current) => addFolderToOrder(current, folder.parent_path, folder.path));
      setFolderDialogParent(null);
      setFolderName("");
      setSelectedFolder(folder.path);
      clearCurrentNote();
      await refreshWorkspace(operationWorkspace);
    } catch (error) {
      if (isWorkspaceActive(operationWorkspace) && isCurrentNoteNavigation(navigationToken)) {
        setAppError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  function switchNotebook(path: string) {
    if (path === workspaceRef.current) return;
    void releaseActiveNoteLock();
    localStorage.setItem(workspaceKey, path);
    metadataSessionRef.current.activate(path);
    latestNotebookSnapshotRef.current.invalidate();
    latestTrashSnapshotRef.current.invalidate();
    pendingNoteContentsRef.current.clear();
    setMetadataLoaded(false);
    restoredTabsWorkspaceRef.current = null;
    autoSelectedWorkspaceRef.current = null;
    initialOpenTargetRef.current = null;
    setWorkspace(path);
    const emptyMetadata = defaultWorkspaceMetadata();
    metadataRef.current = emptyMetadata;
    setMetadata(emptyMetadata);
    setFolders([]);
    setNotes([]);
    setContents(new Map());
    setLinkIndex(null);
    setSelectedFolder("");
    clearCurrentNote();
    setOpenTabs([]);
    setActiveTabId(null);
    setRecentlyDeletedOpen(false);
    setTrashEntries([]);
    setTrashLoading(false);
    setVersionHistory(null);
    setFolderDialogParent(null);
    setFolderName("");
    setPropertyDialog(null);
    setIconBrowser(null);
    setMoveDialog(null);
    setContextMenu(null);
    setTabContextMenu(null);
    setDraggingItem(null);
    draggingItemRef.current = null;
    setDropTargetFolder(null);
    setNoteDragPreview(null);
    setSectionReorderHover(null);
    setFolderDropIntent(null);
    setNoteDropIndicator(null);
    linkPickerResolverRef.current?.(null);
    linkPickerResolverRef.current = null;
    setLinkPickerOpen(false);
    emojiPickerResolverRef.current?.(null);
    emojiPickerResolverRef.current = null;
    setEmojiPickerOpen(false);
    imagePickerResolverRef.current?.(null);
    imagePickerResolverRef.current = null;
    setImageDialogOpen(false);
    setSearchOpen(false);
    setSearchQuery("");
    setAppMenuOpen(false);
    setSettingsOpen(false);
    setAppError(null);
    setRecentNotebooks((current) => writeRecentNotebooks(touchRecentNotebook(current, path)));
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
      title: getNotebookName(path),
      width: 1280,
      height: 860,
      minWidth: 920,
      minHeight: 620,
      decorations: !isWindowsDesktop(),
      ...(isWindowsDesktop() ? { visible: false } : {}),
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
    const operationWorkspace = workspace;
    if (!canMutateNotePath(path)) {
      showReadOnlyNoteWarning();
      return;
    }
    const deletesActiveNote = activePath === path;
    const deletedNote = deletesActiveNote ? notes.find((note) => note.path === path) : null;
    const orderedSiblings = deletedNote
      ? orderNotes(
          notes.filter((note) => note.parent_path === deletedNote.parent_path),
          deletedNote.parent_path,
          metadataRef.current,
        )
      : [];
    const deletedIndex = orderedSiblings.findIndex((note) => note.path === path);
    const replacementPath = deletedIndex === -1
      ? null
      : orderedSiblings[deletedIndex + 1]?.path ?? orderedSiblings[deletedIndex - 1]?.path ?? null;
    const deletionNavigationToken = deletesActiveNote ? beginNoteNavigation() : null;
    if (deletesActiveNote) {
      await releaseActiveNoteLock();
    }
    await trashNote(operationWorkspace, path);
    if (!isWorkspaceActive(operationWorkspace)) return;
    await activeNoteLifecycle.releaseLockMatching(operationWorkspace, (lockPath) => lockPath === path);
    if (!isWorkspaceActive(operationWorkspace)) return;
    const deletedTargetDisposition = activeNoteLifecycle.deletedTargetDisposition(
      deletionNavigationToken,
      activeDraftStateRef.current.activePath,
      (targetPath) => targetPath === path,
    );
    const shouldSelectReplacement = deletedTargetDisposition === "clearAndCancelNavigation" && replacementPath !== null;
    if (deletedTargetDisposition === "clearAndCancelNavigation" && !shouldSelectReplacement) {
      clearCurrentNote();
      setActiveTabId(null);
    } else if (deletedTargetDisposition === "clearAndPreserveNavigation") {
      clearCurrentNote(true);
    }
    setOpenTabs((current) => current
      .filter((tab) => tab.path !== path)
      .map((tab) => pruneNoteTabHistory(tab, (historyPath) => historyPath === path)));
    updateMetadata((current) => removeNoteFromMetadata(current, path));
    if (shouldSelectReplacement) {
      await selectNote(replacementPath, {
        preserveSelectedFolder: true,
        skipPersist: true,
        navigationToken: deletionNavigationToken ?? undefined,
      });
    }
    await refreshWorkspace(operationWorkspace);
  }

  async function handleDuplicateNote(path: string) {
    if (!workspace) return;
    const operationWorkspace = workspace;
    const navigationToken = beginNoteNavigation();
    const navigationIsCurrent = () =>
      isWorkspaceActive(operationWorkspace) && isCurrentNoteNavigation(navigationToken);
    const reconcileDuplicatedNote = async (duplicated: NoteEntry) => {
      if (!isWorkspaceActive(operationWorkspace)) return;
      updateMetadata((current) => addToOrder(current, duplicated.parent_path, duplicated.path));
      await refreshWorkspace(operationWorkspace);
    };
    try {
      if (!await persistDraftForNavigation()) return;
      if (!navigationIsCurrent()) return;
      const duplicated = await duplicateNote(operationWorkspace, path);
      if (!navigationIsCurrent()) {
        await reconcileDuplicatedNote(duplicated);
        return;
      }
      if (!setNoteNavigationTarget(navigationToken, duplicated.path)) {
        await reconcileDuplicatedNote(duplicated);
        return;
      }
      const content = await readNote(operationWorkspace, duplicated.path);
      if (!navigationIsCurrent()) {
        await reconcileDuplicatedNote(duplicated);
        return;
      }
      const access = await acquireActiveNoteLock(duplicated.path);
      if (!navigationIsCurrent()) {
        await reconcileDuplicatedNote(duplicated);
        return;
      }
      activeNoteLifecycle.acceptDiskContent(duplicated.path, content);
      setNotes((current) => current.some((entry) => entry.path === duplicated.path) ? current : [...current, duplicated]);
      setContents((current) => {
        const next = new Map(current);
        next.set(duplicated.path, content);
        return next;
      });
      setActivePathAuthoritatively(duplicated.path);
      activeDraftStateRef.current.pendingNote = null;
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
      activeNoteLifecycle.settleNavigation(navigationToken);
      await refreshWorkspace(operationWorkspace);
    } catch (error) {
      if (navigationIsCurrent()) {
        setAppError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function handleDeleteFolder(path: string) {
    if (!workspace || !path) return;
    const operationWorkspace = workspace;
    const deletesActiveNote = Boolean(activePath?.startsWith(`${path}/`));
    const deletionNavigationToken = deletesActiveNote ? beginNoteNavigation() : null;
    if (deletesActiveNote) {
      await releaseActiveNoteLock();
    }
    await trashFolder(operationWorkspace, path);
    if (!isWorkspaceActive(operationWorkspace)) return;
    await activeNoteLifecycle.releaseLockMatching(
      operationWorkspace,
      (lockPath) => lockPath.startsWith(`${path}/`),
    );
    if (!isWorkspaceActive(operationWorkspace)) return;
    setSelectedFolder((current) => current === path || current.startsWith(`${path}/`) ? "" : current);
    const deletedTargetDisposition = activeNoteLifecycle.deletedTargetDisposition(
      deletionNavigationToken,
      activeDraftStateRef.current.activePath,
      (targetPath) => targetPath === path || targetPath.startsWith(`${path}/`),
    );
    if (deletedTargetDisposition === "clearAndCancelNavigation") {
      clearCurrentNote();
    } else if (deletedTargetDisposition === "clearAndPreserveNavigation") {
      clearCurrentNote(true);
    }
    setOpenTabs((current) => current
      .filter((tab) => !tab.path?.startsWith(`${path}/`))
      .map((tab) => pruneNoteTabHistory(tab, (historyPath) => historyPath.startsWith(`${path}/`))));
    updateMetadata((current) => removeFolderFromMetadata(current, path));
    await refreshWorkspace(operationWorkspace);
  }

  async function handleRestoreTrash(id: string) {
    if (!workspace) return;
    const operationWorkspace = workspace;
    try {
      await restoreTrash(operationWorkspace, id);
      if (!isWorkspaceActive(operationWorkspace)) return;
      await refreshTrash();
      if (!isWorkspaceActive(operationWorkspace)) return;
      await refreshWorkspace(operationWorkspace);
    } catch (error) {
      if (isWorkspaceActive(operationWorkspace)) {
        setAppError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  function openVersionHistory(path: string) {
    const note = notes.find((entry) => entry.path === path);
    setVersionHistory({ path, title: note?.title ?? decodeTitleFromFilename(path.split("/").at(-1)?.replace(/\.md$/, "") ?? path) });
    setContextMenu(null);
  }

  async function handleRestoreNoteVersion(path: string, id: string) {
    if (!workspace) return;
    const operationWorkspace = workspace;
    const navigationToken = captureNoteNavigation();
    if (!canMutateNotePath(path)) {
      showReadOnlyNoteWarning();
      return;
    }
    try {
      if (activePath === path && (hasUnsavedChanges || pendingEditorChangeRef.current)) {
        await persistDraft();
        await waitForPendingNoteSaves();
      }
      const restored = await restoreNoteVersion(operationWorkspace, path, id);
      if (!isWorkspaceActive(operationWorkspace)) return;
      activeNoteLifecycle.acceptDiskContent(path, restored);
      setContents((current) => {
        const next = new Map(current);
        next.set(path, restored);
        return next;
      });
      if (
        isCurrentNoteNavigation(navigationToken)
        && activeDraftStateRef.current.activePath === path
      ) {
        const note = notes.find((entry) => entry.path === path) ?? null;
        loadContentIntoEditor(note, restored, {
          path,
          lastOpenedAt: Date.now(),
          scrollTop: 0,
          contentLength: restored.length,
        });
        setEditorReloadRequest((value) => value + 1);
      }
      await refreshWorkspace(operationWorkspace);
    } catch (error) {
      if (isWorkspaceActive(operationWorkspace)) {
        setAppError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function handlePurgeTrash(id: string) {
    if (!workspace) return;
    const operationWorkspace = workspace;
    try {
      await purgeTrash(operationWorkspace, id);
      if (!isWorkspaceActive(operationWorkspace)) return;
      await refreshTrash();
    } catch (error) {
      if (isWorkspaceActive(operationWorkspace)) {
        setAppError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function handlePurgeTrashAll() {
    if (!workspace) return;
    const operationWorkspace = workspace;
    try {
      await purgeTrashAll(operationWorkspace);
      if (!isWorkspaceActive(operationWorkspace)) return;
      await refreshTrash();
    } catch (error) {
      if (isWorkspaceActive(operationWorkspace)) {
        setAppError(error instanceof Error ? error.message : String(error));
      }
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
    const operationWorkspace = workspace;
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
      if (!isWorkspaceActive(operationWorkspace)) return;
      setMoveDialog(null);
    } catch (error) {
      if (isWorkspaceActive(operationWorkspace)) {
        setAppError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  function openPropertyDialog(kind: PropertyDialogState["kind"], path: string, subject: "folder" | "section" = "folder") {
    const folder = folders.find((entry) => entry.path === path);
    const name = folder?.name ?? (path ? decodeTitleFromFilename(path.split("/").at(-1) ?? path) : "Notebook");
    const value =
      kind === "rename-folder"
        ? folder?.name ?? ""
        : getFolderColors(metadata, navigationStyle)[path] ?? effectiveAccentColor;
    setPropertyDialog({ kind, path, value, name, ...(kind === "folder-color" ? { subject, navigationStyle } : {}) } as PropertyDialogState);
    setContextMenu(null);
    setAppError(null);
  }

  function resetFolderIcon(path: string) {
    updateMetadata((current) => setMetadataValue(current, "folderIcons", path, ""));
    setIconBrowser(null);
    setContextMenu(null);
  }

  function resetFolderColor(path: string, style: NavigationStyle) {
    updateMetadata((current) => setFolderColor(current, style, path, ""));
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
    const operationWorkspace = workspace;
    try {
      if (propertyDialog.kind === "rename-folder") {
        await notebookPathMutations.renameFolder(propertyDialog.path, propertyDialog.value);
      } else if (propertyDialog.kind === "folder-color") {
        updateMetadata((current) => setFolderColor(current, propertyDialog.navigationStyle, propertyDialog.path, propertyDialog.value.trim()));
      }
      if (!isWorkspaceActive(operationWorkspace)) return;
      setPropertyDialog(null);
    } catch (error) {
      if (isWorkspaceActive(operationWorkspace)) {
        setAppError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  function loadContentIntoEditor(note: NoteEntry | null, markdown: string, restorePosition: NotePositionMetadata | null = null) {
    const loadedDocument = readNoteDocument(markdown, note?.title ?? "");
    draftSaveRevisionsRef.current?.reset(loadedDocument.markdown);
    activeNoteIdentityRef.current =
      loadedDocument.frontmatterFields.find((field) => field.key === "id")?.value.trim()
      || note?.path
      || null;
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
    setHasEditorSelection(false);
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
    if (!revisedDocument.frontmatterError) rememberWritingStyle(readWritingStyle(revisedDocument.frontmatter));
    setFrontmatterDraft(revisedDocument.frontmatter);
    setFrontmatterError(revisedDocument.frontmatterError);
    if (revisedDocument.frontmatterError) setAppError(revisedDocument.frontmatterError);
    else setAppError(null);
  }

  function handleFrontmatterChange(frontmatter: string) {
    const revisedDocument = reviseNoteDocument(noteDocument, { frontmatter });
    if (!revisedDocument.frontmatterError) rememberWritingStyle(readWritingStyle(revisedDocument.frontmatter));
    setFrontmatterDraft(revisedDocument.frontmatter);
    setRawMarkdownText(revisedDocument.markdown);
    setFrontmatterError(revisedDocument.frontmatterError);
    if (revisedDocument.frontmatterError) setAppError(revisedDocument.frontmatterError);
    else setAppError(null);
  }

  async function handleNoteDrop(targetPath: string, placement: DropPlacement = "before") {
    if (!workspace) return;
    const operationWorkspace = workspace;
    const sourceItem = draggingItem?.kind === "note" ? draggingItem : draggingItemRef.current?.kind === "note" ? draggingItemRef.current : null;
    const source = sourceItem?.path ?? null;
    if (!source || source === targetPath) return;
    if (!canMutateNotePath(source)) {
      showReadOnlyNoteWarning();
      return;
    }
    const sourceNote = notes.find((entry) => entry.path === source);
    const targetNote = notes.find((entry) => entry.path === targetPath);
    if (!sourceNote || !targetNote) return;
    try {
      if (sourceNote.parent_path === targetNote.parent_path) {
        updateMetadata((current) => placeNoteInOrder(
          current,
          notes,
          targetNote.parent_path,
          source,
          { targetPath, placement },
        ));
      } else {
        await notebookPathMutations.moveNote(source, targetNote.parent_path, {
          siblingPlacement: { targetPath, placement },
        });
      }
    } catch (error) {
      if (isWorkspaceActive(operationWorkspace)) {
        setAppError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (isWorkspaceActive(operationWorkspace)) {
        setDraggingItem(null);
        draggingItemRef.current = null;
        setDropTargetFolder(null);
        setNoteDragPreview(null);
      }
    }
  }

  async function handleDropOnFolder(targetFolderPath: string, droppedItem = draggingItem ?? draggingItemRef.current) {
    if (!workspace || !droppedItem) return;
    const operationWorkspace = workspace;
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
      if (isWorkspaceActive(operationWorkspace)) {
        setAppError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (isWorkspaceActive(operationWorkspace)) {
        setDraggingItem(null);
        draggingItemRef.current = null;
        setDropTargetFolder(null);
        setFolderDropIntent(null);
        setNoteDragPreview(null);
      }
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
    const operationWorkspace = workspace;
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
      if (isWorkspaceActive(operationWorkspace)) {
        setAppError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (isWorkspaceActive(operationWorkspace)) {
        setFolderDropIntent(null);
        setDropTargetFolder(null);
        setCurrentDragItem(null);
      }
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
    if (event.button !== 0 || event.ctrlKey) {
      event.preventDefault();
      return;
    }
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
    if (event.button !== 0 || event.ctrlKey) {
      event.preventDefault();
      return;
    }
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
        if (candidate && candidate.path !== drag.path && sourceParent !== undefined) {
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
          void handleNoteDrop(targetNote.path, targetNote.placement);
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
    if (event.button !== 0 || event.ctrlKey) {
      event.preventDefault();
      return;
    }
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
      decorations: !isWindowsDesktop(),
      ...(isWindowsDesktop() ? { visible: false } : {}),
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

  function reorderBookmark(draggedId: string, targetId: string, placement: DropPlacement) {
    updateMetadata((current) => reorderBookmarks(current, draggedId, targetId, placement));
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
    setPaneOverlay(null);
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

  const leftLabel = responsivePanes.overlay === "left" && responsivePanes.canDockLeft
    ? "Keep left sidebar open" : leftVisible ? "Hide left sidebar" : "Show left sidebar";
  const rightLabel = responsivePanes.overlay === "right" && responsivePanes.canDockRight
    ? "Keep right sidebar open" : outlineVisible ? "Hide right sidebar" : "Show right sidebar";
  const shortcutModifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

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
    <div className="app-shell" ref={appShellRef} data-plasma={plasmaEnabled || undefined} style={plasmaEnabled ? {
      "--plasma-panel-opacity": `${plasmaFrost * 0.9}%`,
      "--plasma-editor-opacity": `${Math.min(95, plasmaFrost * 1.1)}%`,
    } as CSSProperties : undefined}>
      {plasmaEnabled ? <PlasmaTheme ambientDrops={plasmaAmbientDrops} backgroundImage={plasmaBackgroundImage} flow={plasmaFlow / 100} backgroundBlur={plasmaBackgroundBlur} frost={plasmaFrost / 100} theme={renderedColorMode} accentColor={effectiveAccentColor} layoutKey={`${leftVisible}-${outlineVisible}-${navigationStyle}`} /> : null}
      {isWindowsDesktop() ? <WindowsMenuBar onError={setAppError} onMouseDown={handleChromeMouseDown} onDoubleClick={handleChromeDoubleClick} /> : null}
      <header
        data-theme-region="notebook" data-theme-api={renderedTheme.design ? "1" : undefined}
        className={`app-titlebar theme-${renderedColorMode} ${plasmaEnabled ? "theme-plasma" : "theme-standard"}`}
        style={{ ...quickStyles.palette, ...quickStyles.titlebar }}
        data-tauri-drag-region=""
        onMouseDown={handleChromeMouseDown}
        onDoubleClick={handleChromeDoubleClick}
      >
        <span className="titlebar-traffic-padding" data-tauri-drag-region="" />
        <button
          data-sidebar-peek="left"
          className="icon-button sidebar-toggle titlebar-icon-button chrome-interactive"
          type="button"
          title={`${leftLabel} (${shortcutModifier}/)`}
          aria-label={leftLabel}
          aria-controls="left-navigation-panes"
          aria-expanded={leftVisible}
          onMouseDown={stopChromeMouseDown}
          onClick={toggleLeftSidebar}
        >
          {leftVisible ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </button>
        <TabHistoryControls
          canGoBack={canNavigateBack}
          canGoForward={canNavigateForward}
          onBack={() => void navigateActiveTabHistory(-1)}
          onForward={() => void navigateActiveTabHistory(1)}
        />
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
        <ReleaseNotice />
        <TabListDropdown
          tabs={visibleTabs}
          activeTabId={activeTabId}
          onSelect={(tabId) => void activateTab(tabId)}
          onClose={(tabId) => void closeTab(tabId)}
          onCloseAll={() => void closeAllTabs()}
        />
        <button
          className="icon-button titlebar-icon-button chrome-interactive"
          type="button"
          title="Settings"
          aria-label="Settings"
          aria-haspopup="dialog"
          onMouseDown={stopChromeMouseDown}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={15} aria-hidden="true" />
        </button>
        <button
          data-sidebar-peek="right"
          className="icon-button outline-toggle titlebar-icon-button chrome-interactive"
          type="button"
          title={`${rightLabel} (${shortcutModifier}\\)`}
          aria-label={rightLabel}
          aria-controls="right-note-sidebar"
          aria-expanded={outlineVisible}
          onMouseDown={stopChromeMouseDown}
          onClick={toggleRightSidebar}
        >
          {outlineVisible ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
        </button>
      </header>

      <div ref={responsivePanes.frameRef} onPointerDownCapture={(event) => {
        if (responsivePanes.overlay && event.target instanceof Element && event.target.closest(".main-pane") && !event.target.closest(".sidebar-toggle, .outline-toggle")) setPaneOverlay(null);
      }} data-theme-region="notebook" data-theme-api={renderedTheme.design ? "1" : undefined} className={`app-frame${responsivePanes.visibleOverlay ? ` has-${responsivePanes.visibleOverlay}-overlay${responsivePanes.closing ? " is-overlay-closing" : ""}` : ""} theme-${renderedColorMode} ${plasmaEnabled ? "theme-plasma" : "theme-standard"} ${responsivePanes.docked.leftVisible ? "" : "is-left-hidden"} ${responsivePanes.docked.outlineVisible ? "" : "is-outline-hidden"} ${navigationStyle === "single-pane" ? "is-single-col" : ""}`} style={{ ...frameStyle, ...quickStyles.palette }}>
      {!responsivePanes.docked.leftVisible && !responsivePanes.overlay && <div className="sidebar-hover-edge is-left" data-sidebar-peek="left" data-sidebar-peek-edge aria-hidden="true" />}
      {responsivePanes.hoverSide && <div key={responsivePanes.hoverRevision} className={`sidebar-hover-glow is-${responsivePanes.hoverSide}`} aria-hidden="true" />}
      {leftVisible ? (
        <aside
          id="left-navigation-panes"
          className={`left-panes${navigationStyle === "single-pane" ? " is-single-col" : ""}`}
          onContextMenu={(event) => openContextMenu(event, { kind: "empty" })}
        >
          {responsivePanes.visibleOverlay === "left" && <SidebarOverlayActions side="left"
            onClose={() => setPaneOverlay(null)}
            onPin={responsivePanes.canDockLeft ? () => { setPaneOverlay(null); setLeftVisible(true); } : undefined} />}
          {navigationStyle === "single-pane" ? (
            <UnifiedTreePane
              activePath={activePath}
              bookmarks={bookmarks}
              bookmarksExpanded={metadata.bookmarksExpanded}
              createNoteTargets={noteCreationTargets}
              createParentPath={selectedFolder}
              contents={contents}
              folderDropIntent={folderDropIntent}
              folderOrderingMode="alphabetical"
              folders={folders}
              menuOpen={appMenuOpen}
              metadata={navigationMetadata}
              notes={notes}
              recentNotebooks={recentNotebooks}
              rootPath=""
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
              onReorderBookmark={reorderBookmark}
              onSelectBookmark={selectBookmark}
              onSelectFolder={(path) => void selectFolderForNewNote(path)}
              onSelectNotebook={openNotebookInNewWindow}
              onSelectNote={handleNoteSelectFromCard}
              onSetFolderExpanded={setFolderExpanded}
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
                bookmarks={bookmarks}
                bookmarksExpanded={metadata.bookmarksExpanded}
                draggingItem={draggingItem}
                dropTargetFolder={dropTargetFolder}
                folders={folderTree[0]?.children ?? []}
                metadata={navigationMetadata}
                selectedFolder={selectedSection}
                workspace={workspace}
                menuOpen={appMenuOpen}
                recentNotebooks={recentNotebooks}
                reorderHover={sectionReorderHover}
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
                onReorderBookmark={reorderBookmark}
                onSelectBookmark={selectBookmark}
                onSelectFolder={(path) => void selectSection(path)}
                onSelectNotebook={openNotebookInNewWindow}
                onToggleBookmarksExpanded={toggleBookmarksExpanded}
                onToggleMenu={(event) => { event.stopPropagation(); setAppMenuOpen((v) => !v); }}
                onToggleSearch={() => setSearchOpen((value) => !value)}
              />
              <PaneResizer label="Resize folder pane" variant="inner" onPointerDown={startFolderPaneResize} />
              <UnifiedTreePane
                activePath={activePath}
                createNoteTargets={noteCreationTargets}
                createParentPath={selectedFolder}
                contents={contents}
                folderDropIntent={folderDropIntent}
                folderOrderingMode="custom"
                folders={folders}
                metadata={navigationMetadata}
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
                bookmarks={bookmarks}
                bookmarksExpanded={metadata.bookmarksExpanded}
                disabled={!workspace}
                draggingItem={draggingItem}
                dropTargetFolder={dropTargetFolder}
                folders={folderTree}
                metadata={navigationMetadata}
                menuOpen={appMenuOpen}
                recentNotebooks={recentNotebooks}
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
                onReorderBookmark={reorderBookmark}
                onSelectBookmark={selectBookmark}
                onSelectNotebook={openNotebookInNewWindow}
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
                createNoteTargets={noteCreationTargets}
                draggingPath={draggingItem?.kind === "note" ? draggingItem.path : null}
                folderTitle={selectedFolderTitle}
                metadata={metadata}
                contents={contents}
                notes={visibleNotes}
                onCreateFolder={requestCreateFolder}
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
      {responsivePanes.docked.leftVisible ? <PaneResizer label="Resize notes pane" variant="left-of-main" onPointerDown={startNotesPaneResize} /> : null}

      <main className="main-pane">
        <EditorTopbar
          animateTitle={dockedTitleState.animate}
          title={titleDraft}
          titleVisible={dockedTitleState.visible}
          onTitleClick={() => noteSurfaceRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
        >
          {noteOpen ? (
            <>
              <div
                className={`save-state is-${noteSaveState}`}
                role="status"
                aria-label={noteSaveStateLabel}
                data-tooltip={noteSaveStateLabel}
              >
                {noteSaveState === "read-only" ? <Lock className="save-state-lock" size={13} aria-hidden="true" /> : null}
                <span className="save-state-dot" aria-hidden="true" />
                <span className="save-state-label">{noteSaveStateLabel}</span>
              </div>
              <button
                className="icon-button"
                type="button"
                title="Find in note"
                onClick={() => setNoteFindRequest((v) => v + 1)}
              >
                <Search size={17} />
              </button>
              <div className="editor-color-toolbar-slot" ref={setColorToolbarElement}>
                {rawMarkdownVisible || frontmatterError ? (
                  <div className="editor-color-controls" role="group" aria-label="Text formatting">
                    <button type="button" className="icon-button" disabled
                      title="Text and highlight colors" aria-label="Text and highlight colors" aria-haspopup="menu" aria-expanded={false}>
                      <Paintbrush size={17} />
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                className={`icon-button ${focusModeActive ? "is-active" : ""}`}
                type="button"
                title={focusModeActive ? "Exit focus mode" : "Enter focus mode"}
                aria-label={focusModeActive ? "Exit focus mode" : "Enter focus mode"}
                aria-pressed={focusModeActive}
                onClick={toggleEditorFocusMode}
              >
                <Focus size={17} />
              </button>
              <div className="note-view-control note-view-menu">
                <button
                  className={`icon-button ${widthMenuOpen ? "is-active" : ""}`}
                  type="button"
                  title="Editor options"
                  aria-label="Editor options"
                  aria-haspopup="menu"
                  aria-expanded={widthMenuOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    setWidthMenuOpen((value) => !value);
                  }}
                >
                  <EllipsisVertical size={18} />
                </button>
                {widthMenuOpen ? (
                  <div className="note-view-dropdown" role="menu" aria-label="Editor options">
                    <EditorOptionsSubmenu label="Insert" disabled={!contentsActive || !activeNoteEditable || rawMarkdownVisible || Boolean(frontmatterError)}>
                      <button type="button" role="menuitem"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => { void handleMenuCommand("format_image"); setWidthMenuOpen(false); }}>
                        <span><strong>Image</strong></span><ImageIcon size={16} />
                      </button>
                      <button type="button" role="menuitem"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => { requestEditorCommand("equation"); setWidthMenuOpen(false); }}>
                        <span><strong>Equation</strong></span><Sigma size={16} />
                      </button>
                    </EditorOptionsSubmenu>
                    <div className="note-view-menu-divider" />
                    <button
                      type="button"
                      className={focusModeActive ? "is-active" : ""}
                      role="menuitemcheckbox"
                      aria-checked={focusModeActive}
                      onClick={() => {
                        toggleEditorFocusMode();
                        setWidthMenuOpen(false);
                      }}
                    >
                      <span>
                        <strong>{focusModeActive ? "Exit focus mode" : "Enter focus mode"}</strong>
                        <small>Hide navigation and outline</small>
                      </span>
                      <Focus size={16} />
                    </button>
                    <button
                      type="button"
                      className={rawMarkdownVisible || frontmatterError ? "is-active" : ""}
                      role="menuitemcheckbox"
                      aria-checked={rawMarkdownVisible || Boolean(frontmatterError)}
                      onClick={() => {
                        toggleRawMarkdownMode();
                        setWidthMenuOpen(false);
                      }}
                    >
                      <span>
                        <strong>{rawMarkdownVisible ? "Show rich editor" : "Show raw Markdown"}</strong>
                        <small>Markdown editor style</small>
                      </span>
                      <FileCode2 size={16} />
                    </button>
                    <div className="note-view-menu-divider" />
                    <EditorOptionsSubmenu label="Writing Style" value={writingStyle === "story" ? "Story" : "Notes"} disabled={!activeNoteEditable || Boolean(frontmatterError)}>
                    {(["notes", "story"] as const).map(style => (
                      <button key={style} type="button" role="menuitemradio"
                        aria-checked={writingStyle === style} className={writingStyle === style ? "is-active" : ""}
                        disabled={!activeNoteEditable || Boolean(frontmatterError)}
                        onClick={() => {
                          const body = flushPendingEditorBody() ?? draft;
                          const frontmatter = setWritingStyle(frontmatterDraft, style);
                          rememberWritingStyle(style);
                          setFrontmatterDraft(frontmatter);
                          setRawMarkdownText(createNoteDocument({ title: titleDraft, body, frontmatter }).markdown);
                        }}>
                        <span><strong>{style === "notes" ? "Notes" : "Story"}</strong>
                          <small>{style === "notes" ? "Space between paragraphs" : "Indented paragraphs, no extra spacing"}</small></span>
                        {writingStyle === style ? <Check size={15} /> : null}
                      </button>
                    ))}
                    </EditorOptionsSubmenu>
                    <EditorOptionsSubmenu label="Editor Width" value={editorWidthOptions.find(option => option.value === editorWidthMode)?.label}>
                    {editorWidthOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={option.value === editorWidthMode ? "is-active" : ""}
                        role="menuitemradio"
                        aria-checked={option.value === editorWidthMode}
                        onClick={() => {
                          updateNotebookAppearance({ editorWidthMode: option.value });
                        }}
                      >
                        <span>
                          <strong>{option.label}</strong>
                          {option.hint ? <small>{option.hint}</small> : null}
                        </span>
                        {option.value === editorWidthMode ? <Check size={15} /> : null}
                      </button>
                    ))}
                    </EditorOptionsSubmenu>
                    <EditorOptionsSubmenu label="Editor Alignment" value={noteAlignment === "left" ? "Left" : "Center"}>
                    {(["left", "center"] as const).map((alignment) => (
                      <button
                        key={alignment}
                        type="button"
                        className={alignment === noteAlignment ? "is-active" : ""}
                        role="menuitemradio"
                        aria-checked={alignment === noteAlignment}
                        onClick={() => { updateNotebookAppearance({ noteAlignment: alignment }); setWidthMenuOpen(false); }}
                      >
                        <span>
                          <strong>{alignment === "left" ? "Left" : "Center"}</strong>
                        </span>
                        {alignment === noteAlignment ? <Check size={15} /> : null}
                      </button>
                    ))}
                    </EditorOptionsSubmenu>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </EditorTopbar>

        {noteOpen ? (
          <section
            className={`note-surface writing-style-${writingStyle} is-${editorWidthMode}-width is-${noteAlignment}-aligned${!rawMarkdownVisible && !frontmatterError && noteScrollFades.top ? " has-scroll-above" : ""}${!rawMarkdownVisible && !frontmatterError && noteScrollFades.bottom ? " has-scroll-below" : ""}`}
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
                onFocus={() => setTitleFocused(true)}
                value={titleDraft}
                disabled={!activeNoteEditable}
                onChange={(event) => {
                  if (!activeNoteEditable) return;
                  disarmPendingTitleFocus();
                  setTitleDraft(event.target.value);
                }}
                onBlur={() => {
                  setTitleFocused(false);
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
                <div className={`raw-markdown-input-frame${noteScrollFades.top ? " has-scroll-above" : ""}${noteScrollFades.bottom ? " has-scroll-below" : ""}`}>
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
                    onScroll={updateNoteScrollFades}
                    onSelect={(event) => {
                      const input = event.currentTarget;
                      const selectedText = input.value.slice(input.selectionStart, input.selectionEnd);
                      selectedEditorTextRef.current = selectedText;
                      setSelectedEditorText(selectedText);
                    }}
                    spellCheck={spellcheckEnabled}
                  />
                </div>
              </div>
            ) : (
              <EditorErrorBoundary resetKey={activePath ?? "pending-note"} onError={handleNoteLoadError}>
                <NotesEditor
                  bulletMethodDisplay={bulletMethodDisplay}
                  bulletMethodStatuses={bulletMethodStatuses}
                  writingStyle={writingStyle}
                  colorToolbarElement={colorToolbarElement}
                  colorsDisabled={titleFocused}
                  content={draft}
                  focusRequest={editorFocusRequest}
                  focusAtEndRequest={editorFocusAtEndRequest}
                  findRequest={noteFindRequest}
                  historyKey={activeNoteHistoryKey}
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
                  onPersistenceReady={registerEditorPersistence}
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
        {noteOpen && wordCountVisible ? (
          <div className="note-status-bar">
            <span>{noteStats.words.toLocaleString()} {noteStats.words === 1 ? "word" : "words"}</span>
            <span>{noteStats.characters.toLocaleString()} {noteStats.characters === 1 ? "character" : "characters"}</span>
          </div>
        ) : null}
      </main>

      {responsivePanes.docked.outlineVisible ? <PaneResizer label="Resize right sidebar" variant="right-of-main" onPointerDown={startRightPaneResize} /> : null}
      {outlineVisible ? (
        <RightSidebar
          id="right-note-sidebar"
          overlayActions={responsivePanes.visibleOverlay === "right" ? <SidebarOverlayActions side="right"
            onClose={() => setPaneOverlay(null)}
            onPin={responsivePanes.canDockRight ? () => { setPaneOverlay(null); updateNotebookAppearance({ rightSidebarOpen: true }); } : undefined} /> : undefined}
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

      {searchOpen ? (
        <GlobalSearchModal
          contents={contents}
          focusRequest={searchFocusRequest}
          folders={folders}
          metadata={metadata}
          notes={notes}
          query={searchQuery}
          onClose={() => {
            setSearchOpen(false);
            setSearchQuery("");
          }}
          onQueryChange={setSearchQuery}
          onSelect={(path) => {
            setSearchOpen(false);
            setSearchQuery("");
            void selectNote(path);
          }}
        />
      ) : null}

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
                <h2>{navigationStyle === "section-view" && folderDialogParent === "" ? "New section" : "New folder"}</h2>
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
              placeholder={navigationStyle === "section-view" && folderDialogParent === "" ? "Section name" : "Folder name"}
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

      {invalidNotebookTheme ? <div className="theme-recovery-notice" role="alert"><strong>This notebook’s theme could not be loaded. Showing Default.</strong><p>Your saved theme has been kept. Open Settings to choose another theme or import a corrected version.</p><button className="toolbar-button" onClick={() => { setSettingsSection('appearance'); setSettingsOpen(true); }}>Open Appearance</button></div> : null}
      {themeCatalogWarnings.length > 0 ? <div className="theme-recovery-notice" role="alert">
        <strong>Some themes could not be loaded. Default is available.</strong>
        {themeCatalogWarnings.map(message => <p key={message}>{message}</p>)}
      </div> : null}
      <ThemeStyles theme={renderedTheme} mode={resolvedTheme} onReset={resetThemeAppearance} />
      {settingsOpen ? (
          <SettingsModal
            colorMode={renderedColorMode}
            bulletMethodDisplay={bulletMethodDisplay}
                  bulletMethodStatuses={bulletMethodStatuses}
            onBulletMethodDisplayChange={display => setBulletMethodDisplay(writeBulletMethodDisplay(display))}
            onBulletMethodStatusesChange={statuses => setBulletMethodStatuses(writeBulletMethodStatuses(statuses))}
            newNoteWritingStyle={newNoteWritingStyle}
            lastWritingStyle={lastWritingStyle}
            onNewNoteWritingStyleChange={value => updateMetadata(current => ({ ...current, newNoteWritingStyle: value }))}
            initialSection={settingsSection}
            onSectionChange={setSettingsSection}
            editorWidthMode={editorWidthMode}
            onEditorWidthModeChange={value => updateNotebookAppearance({ editorWidthMode: value })}
            noteAlignment={noteAlignment}
            onNoteAlignmentChange={value => updateNotebookAppearance({ noteAlignment: value })}
            navigationStyle={navigationStyle}
            onNavigationStyleChange={(style) => updateNotebookAppearance({ navigationStyle: style })}
            spellcheckEnabled={spellcheckEnabled}
            onSpellcheckEnabledChange={setSpellcheckEnabled}
            wordCountVisible={wordCountVisible}
            onWordCountVisibleChange={(wordCountVisible) => updateNotebookAppearance({ wordCountVisible })}
            onResetTheme={resetThemeAppearance}
            onClose={() => setSettingsOpen(false)}
            themeContent={<>
              {metadata.appearance?.customTheme && !customTheme ? <p role="alert">This notebook contains an invalid or unsupported theme. Choose a theme to replace it.</p> : null}
              <ThemeBuilder key={workspace} current={customTheme} seed={themeSeed()} onApply={applyCustomTheme} onUseThemeDefaults={useThemeDefaults} onRestoreDefault={resetThemeAppearance}
                onSaved={() => setSettingsOpen(false)}
                quickAppearanceControls={<QuickAppearanceControls onDeleteWallpaper={async wallpaper => {
                  const library = await listThemes();
                  if (workspaceRef.current !== workspace) return;
                  if (library.warnings.length) throw new Error('Some custom themes could not be checked.');
                  updateMetadata(current => {
                    const appearance = current.appearance;
                    const currentTheme = readTheme(appearance?.customTheme);
                    if (wallpaperDeletionReason(wallpaper, [...library.themes, ...(currentTheme ? [currentTheme] : [])], appearance?.quickAppearance?.backgroundImage)) return current;
                    return { ...current, appearance: { ...appearance,
                      wallpapers: (appearance?.wallpapers ?? []).filter(saved => !sameWallpaper(saved, wallpaper)),
                    } };
                  });
                }} key={`${workspace}:${quickAppearanceTheme.id}`} theme={quickAppearanceTheme} mode={resolvedTheme} quick={quickAppearance} wallpapers={metadata.appearance?.wallpapers}
                  current={{ accentColor: effectiveAccentColor, editorFontFamily: renderedTheme.editorFontFamily, editorFontSize: renderedTheme.editorFontSize }}
                  onChange={patch => updateNotebookAppearance({ quickAppearance: { ...quickAppearance, ...patch } })}
                  onReset={field => updateNotebookAppearance(quickAppearanceResetPatch(quickAppearanceTheme, quickAppearance, field))} />}
                builtInThemes={themePresets} builtInThemeId={themePresetId}
                themeColorPreferences={metadata.appearance?.themeColorPreferences}
                selectedVariantId={customTheme ? metadata.appearance?.themeColorPreferences?.[customTheme.id] : undefined}
                onVariantChange={id => {
                  if (!customTheme) return;
                  const chosen = resolveThemeVariant(customTheme, id);
                  updateNotebookAppearance({ colors: themeAppearance(chosen).colors, quickAppearance: { ...quickAppearance, accentColor: undefined }, themeColorPreferences: { ...metadata.appearance?.themeColorPreferences, [customTheme.id]: id } });
                }}
                onColorChange={id => selectThemeColor(id, true)}
                onBuiltInChange={id => selectThemeColor(id, false)}
                colorScheme={colorScheme} onColorSchemeChange={(scheme) => updateNotebookAppearance({ colorScheme: scheme })} />
            </>}
          />
      ) : null}

      {workspace && metadataLoaded && !settingsOpen ? <ThemeReconciliation key={workspace} current={customTheme} onApply={applyCustomTheme}
        acknowledgedDifference={metadata.appearance?.acknowledgedThemeDifference}
        onKeepBoth={(difference) => updateNotebookAppearance({ acknowledgedThemeDifference: difference })} /> : null}

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
          onChange={(value) => setPropertyDialog(propertyDialog.kind === "folder-color"
            ? { ...propertyDialog, value, previewColor: value }
            : { ...propertyDialog, value })}
          onClose={() => setPropertyDialog(null)}
          onReset={propertyDialog.kind === "folder-color" ? () => resetFolderColor(propertyDialog.path, propertyDialog.navigationStyle) : undefined}
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
  const colorCommand = command.replace(/^format_/, "");
  if (isInlineColorCommand(colorCommand)) return colorCommand;
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

function readStoredNotebookThemeColors() {
  return normalizeThemeColors(undefined, localStorage.getItem(accentKey));
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

function normalizeColorForInput(value: string) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const rgb = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgb) return "#075f83";
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((part) => clamp(Number(part), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function readableTextColor(background: string) {
  return readableThemeText(background);
}
