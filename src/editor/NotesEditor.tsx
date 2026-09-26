import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableRow } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { closeHistory } from "@tiptap/pm/history";
import {
  DOMParser as ProseMirrorDOMParser,
  type Node as ProseMirrorNode,
  type ResolvedPos,
  type TagParseRule,
} from "@tiptap/pm/model";
import { NodeSelection, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, Range, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Bold,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  RemoveFormatting,
  Search,
  Sigma,
  Strikethrough,
  Underline,
  X,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { BulletMethodIcon } from "../components/BulletMethodIcon";
import { defaultBulletMethodDisplay, defaultBulletMethodStatuses, type BulletMethodStatus } from "../lib/bulletMethod";
import { createDeferredCommit, type DeferredCommit } from "../lib/deferredCommit";
import { openExternal } from "../lib/desktop";
import { isInlineColorCommand } from "../lib/inlineColors";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown";
import { BulletMethodMarkers, bulletMethodMarkersKey } from "./bulletMethodMarkers";
import { CodeBlockWithControls, lowlight } from "./codeBlock";
import type {
  EditorCommandRequest,
  EditorMarkdownSnapshot,
  NotesEditorProps,
  PendingEditorChange,
} from "./editorContract";
import {
  MarkdownImage,
  blobToFile,
  getClipboardImageFile,
  getClipboardImageFromHtml,
  hydrateNotebookImageNodes,
  insertImageFile,
  insertNativeClipboardImage,
  isRenderableImageType,
  mayContainAsyncClipboardImage,
  resolveNotebookImageSrc,
} from "./editorImages";
import { EquationContextMenu } from "./EquationContextMenu";
import { EquationDialog } from "./EquationDialog";
import { ColorHighlight, TextColor, applyInlineColor } from "./inlineColorMarks";
import { EditorColorControls, InlineColorPicker } from "./InlineColorPicker";
import { BlockMath, InlineMath, requestEquation } from "./mathNodes";
import {
  BoundedNoteStateCache,
  cacheCurrentNoteEditorState,
  collapseBoundarySelectionAt,
  decodeInternalHref,
  deleteEmptyListItem,
  findListItemAtSelection,
  findSlashQueryInState,
  getEditorDocumentLoadAction,
  getTaskLineCutDeleteRange,
  handleEmptyListItemBackspace,
  handleNestedListBoundaryDelete,
  handleOutermostListItemBackspace,
  handleSameLevelListItemBackspace,
  isFormattingSelection,
  isInternalNotebookHref,
  isPlainDeleteKey,
  resetEditorHistory,
  restoreCachedNoteEditorState,
  serializeEditorSelectionForClipboard,
  setEditorEditableSilently,
  setEditorSpellcheck,
  type ListItemRange,
} from "./notesEditorBehavior";
import { SearchHighlight, getEditorMatches, scrollEditorPositionIntoView, searchHighlightKey } from "./searchHighlight";
import { ensureParagraphAfterCurrentTable, filterSlashCommands, markCurrentTableAsTigranaHtml } from "./slashCommands";
import { isSortCommand, sortSelectedLines, type SortCommand } from "./sortLines";
import { refreshSortedSelectionPaint } from "./sortSelectionPaint";
import { OrderedListWithGutter } from "./orderedList";
import { StoryParagraphs, handleStoryParagraphKey, setParagraphIndent } from "./storyParagraphs";
import { TableWithControls, TigranaTableCell, TigranaTableHeader, isTableChromeTarget } from "./tableControls";
import { EM_SPACE, EmSpaceIndent, EmojiText, ListItemSeparator } from "./textExtensions";

type SlashState = {
  range: Range;
  query: string;
  selected: number;
};

const markdownCommitDelayMs = 80;

const noteHistoryCacheLimit = 30;

export function NotesEditor({ bulletMethodDisplay = defaultBulletMethodDisplay, bulletMethodStatuses = defaultBulletMethodStatuses, writingStyle = "notes", colorsDisabled = false, colorToolbarElement, content, commandRequest, focusRequest, focusAtEndRequest, findRequest, historyKey, reloadRequest, notePath, restorePosition, editable, spellcheckEnabled, workspace, onChange, onPendingChange, onPersistenceReady, onLoadError, onPositionChange, onInternalLinkClick, onRequestEmoji, onRequestLink, onRequestImage }: NotesEditorProps) {
  const writingStyleRef = useRef(writingStyle);
  writingStyleRef.current = writingStyle;
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [findDocumentVersion, setFindDocumentVersion] = useState(0);
  const slashRef = useRef<SlashState | null>(null);
  const selectedSlashItemRef = useRef<HTMLButtonElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const handledFindRequest = useRef(findRequest);
  const handledCommandRequest = useRef(commandRequest?.id ?? 0);
  const lastLoadedNote = useRef<string | null>(null);
  const handledReloadRequest = useRef(reloadRequest ?? 0);
  const notePathRef = useRef(notePath);
  const loadedHistoryKey = useRef<string | null>(null);
  const historyWorkspace = useRef(workspace);
  const noteHistoryCache = useRef<BoundedNoteStateCache | null>(null);
  const onChangeRef = useRef(onChange);
  const onPendingChangeRef = useRef(onPendingChange);
  const deferredMarkdownRef = useRef<DeferredCommit<EditorMarkdownSnapshot> | null>(null);
  const pendingChangeHandleRef = useRef<PendingEditorChange | null>(null);

  onChangeRef.current = onChange;
  onPendingChangeRef.current = onPendingChange;
  if (!deferredMarkdownRef.current) {
    deferredMarkdownRef.current = createDeferredCommit(markdownCommitDelayMs, (snapshot) => {
      onPendingChangeRef.current(null);
      onChangeRef.current(snapshot.markdown, snapshot.sourceNotePath);
    });
  }
  if (!pendingChangeHandleRef.current) {
    pendingChangeHandleRef.current = {
      flush: () => deferredMarkdownRef.current?.flush() ?? null,
    };
  }
  if (!noteHistoryCache.current) {
    noteHistoryCache.current = new BoundedNoteStateCache(noteHistoryCacheLimit);
  }

  useEffect(() => {
    notePathRef.current = notePath;
  }, [notePath]);

  const initialContentRef = useRef<{ error: unknown; html: string } | null>(null);
  if (!initialContentRef.current) {
    try {
      initialContentRef.current = {
        error: null,
        html: markdownToHtml(content, { resolveImageSrc: (src) => resolveNotebookImageSrc(workspace, src) }),
      };
    } catch (error) {
      initialContentRef.current = { error, html: "" };
    }
  }
  const initialContent = initialContentRef.current;

  useEffect(() => {
    if (initialContent.error) onLoadError(initialContent.error);
  }, [initialContent.error, onLoadError]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        codeBlock: false,
        orderedList: false,
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        link: {
          autolink: true,
          openOnClick: false,
          // Don't render target="_blank" on links. In Tauri the webview's
          // new-window flow can intercept those clicks before our JS handler
          // gets a chance to route internal notebook hrefs to onInternalLinkClick.
          // Routing for both internal and external happens via the React onClick
          // on the editor-shell.
          HTMLAttributes: { target: null, rel: null, class: null },
          // The default isAllowedUri's regex treats `[.-:]` as a character range
          // (including `/`), which causes it to reject bare relative paths like
          // `Folder/Note.md` and strip their href at render time. We accept
          // anything that doesn't use a dangerous scheme so internal notebook
          // links survive round-tripping.
          isAllowedUri: (href) =>
            !href || !/^\s*(javascript|data|vbscript|file|about):/i.test(href),
        },
      }),
      StoryParagraphs,
      OrderedListWithGutter,
      BulletMethodMarkers,
      CodeBlockWithControls.configure({ lowlight }),
      TextColor,
      ColorHighlight,
      InlineMath,
      BlockMath,
      EmojiText,
      SearchHighlight,
      EmSpaceIndent,
      ListItemSeparator,
      MarkdownImage.configure({
        inline: false,
        allowBase64: false,
      }),
      Placeholder.configure({
        placeholder: "Start writing, or type / for blocks...",
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      TableWithControls.configure({ resizable: false, allowTableNodeSelection: true }),
      TableRow,
      TigranaTableHeader,
      TigranaTableCell,
    ],
    [],
  );

  const handleSlashKeyDown = useCallback((event: KeyboardEvent) => {
    const currentEditor = editorRef.current;
    const currentState = slashRef.current;
    if (!currentState || !currentEditor) return false;

    const currentSlash = findSlashQuery(currentEditor);
    if (!currentSlash) {
      slashRef.current = null;
      setSlash(null);
      return false;
    }
    const currentCommands = filterSlashCommands(currentSlash.query);

    if (event.key === "ArrowDown") {
      if (currentCommands.length === 0) return false;
      event.preventDefault();
      setSlash((current) =>
        current ? { ...current, selected: (current.selected + 1) % currentCommands.length } : current,
      );
      return true;
    }

    if (event.key === "ArrowUp") {
      if (currentCommands.length === 0) return false;
      event.preventDefault();
      setSlash((current) =>
        current
          ? { ...current, selected: (current.selected - 1 + currentCommands.length) % currentCommands.length }
          : current,
      );
      return true;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      const command = currentCommands[currentState.selected] ?? currentCommands[0];
      if (!command) return false;
      event.preventDefault();
      event.stopPropagation();
      command.run(currentEditor, currentSlash.range, { requestEmoji: onRequestEmoji, requestLink: onRequestLink, requestImage: onRequestImage });
      slashRef.current = null;
      setSlash(null);
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      slashRef.current = null;
      setSlash(null);
      return true;
    }
    return false;
  }, [onRequestEmoji, onRequestImage, onRequestLink]);

  const editor = useEditor({
    // Tiptap v3 defaults this to false. Keep it explicit because publishing
    // React updates per ProseMirror transaction violates the editor's typing
    // performance contract; dependent UI subscribes to targeted editor events.
    shouldRerenderOnTransaction: false,
    extensions,
    editable,
    content: initialContent.html,
    editorProps: {
      scrollThreshold: {
        top: 32,
        right: 8,
        bottom: 160,
        left: 8,
      },
      scrollMargin: {
        top: 56,
        right: 8,
        bottom: 220,
        left: 8,
      },
      attributes: {
        autocapitalize: "off",
        autocomplete: "off",
        autocorrect: "off",
        spellcheck: spellcheckEnabled ? "true" : "false",
      },
      handleDoubleClick(view, position) {
        window.setTimeout(() => {
          if (!view.isDestroyed) collapseBoundarySelectionAt(view, position);
        }, 0);
        return false;
      },
      handleDOMEvents: {
        keydown(_view, event) {
          if (handleNestedListBoundaryDelete(_view, event)) return true;
          if (handleSameLevelListItemBackspace(_view, event)) return true;
          if (handleEmptyListItemBackspace(_view, event)) return true;
          if (handleEmptyTaskItemForwardDelete(_view, event)) return true;
          if (handleEmptyListItemDelete(_view, event)) return true;
          if (handleOutermostListItemBackspace(_view, event)) return true;
          if (handleSlashKeyDown(event)) return true;
          const currentEditor = editorRef.current;
          if (currentEditor && handleStoryParagraphKey(currentEditor, event, writingStyleRef.current)) return true;
          if (currentEditor && handleEditorTabKeyDown(currentEditor, event)) return true;
          return false;
        },
        // Leave presses in the editor's bottom padding to ProseMirror and
        // the browser so they can start a native drag selection.
        copy(view, event) {
          return writeEditorSelectionToClipboard(view, event);
        },
        cut(view, event) {
          return cutSelectedTaskLines(view, event);
        },
      },
      handlePaste(view, event) {
        const file = getClipboardImageFile(event.clipboardData);
        const htmlFile = file ? null : getClipboardImageFromHtml(event.clipboardData);
        if (!file && !htmlFile && !mayContainAsyncClipboardImage(event.clipboardData)) return false;

        event.preventDefault();
        const pasteNotePath = notePathRef.current;
        void getBestClipboardImageFile(file ?? htmlFile)
          .then((imageFile) => {
            if (notePathRef.current !== pasteNotePath) return undefined;
            if (imageFile) return insertImageFile(view, workspace, imageFile, pasteNotePath, () => notePathRef.current);
            return insertNativeClipboardImage(view, workspace, pasteNotePath, () => notePathRef.current);
          })
          .catch((error) => {
            console.error("Failed to paste image", error);
          });
        return true;
      },
    },
    onUpdate({ editor }) {
      const sourceNotePath = lastLoadedNote.current;
      deferredMarkdownRef.current?.schedule(() => ({
        markdown: htmlToMarkdown(editor.getHTML()),
        sourceNotePath,
      }));
      onPendingChangeRef.current(pendingChangeHandleRef.current);
      const match = findSlashQuery(editor);
      const nextSlash = match ? { ...match, selected: 0 } : null;
      slashRef.current = nextSlash;
      setSlash(nextSlash);
    },
    onSelectionUpdate({ editor }) {
      const currentSlash = slashRef.current;
      if (currentSlash) {
        const match = findSlashQuery(editor);
        if (!match) {
          slashRef.current = null;
          setSlash(null);
        } else if (
          match.query !== currentSlash.query
          || match.range.from !== currentSlash.range.from
          || match.range.to !== currentSlash.range.to
        ) {
          const nextSlash = { ...match, selected: 0 };
          slashRef.current = nextSlash;
          setSlash(nextSlash);
        }
      }
      onPositionChange({
        selectedText: getSelectedText(editor),
        selectionFrom: editor.state.selection.from,
        selectionTo: editor.state.selection.to,
      });
    },
  });

  useLayoutEffect(() => {
    if (!editor || !onPersistenceReady) return;
    onPersistenceReady({
      capture() {
        if (!editableRef.current) return null;
        if (editor.view.composing) throw new Error("Finish entering text before moving this Note.");
        // A native accessibility replacement can precede the browser's mutation
        // notification. Reconcile visible content only at an explicit navigation
        // boundary, never on the typing/autosave path. Keep the change undoable.
        const parseOptions = {
          preserveWhitespace: true as const,
          // Use the same node-view rules as ProseMirror's DOM-change reader.
          // Parsing raw editor HTML would include table/code controls and lose
          // task-list attributes. Keep this internal adapter covered by fixtures.
          ruleFromNode(node: Node) {
            const description = (node as Node & {
              pmViewDesc?: { parseRule(): Omit<TagParseRule, "tag"> | null };
            }).pmViewDesc;
            if (description) return description.parseRule();
            if (node.nodeName === "BR" && node === node.parentNode?.lastChild) return { ignore: true };
            return null;
          },
        };
        const visible = ProseMirrorDOMParser.fromSchema(editor.schema).parse(editor.view.dom, parseOptions);
        if (!visible.eq(editor.state.doc)) {
          editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, visible.content));
        }
        return deferredMarkdownRef.current?.flush() ?? null;
      },
      setReadOnly(readOnly) {
        setEditorEditableSilently(editor, !readOnly && editableRef.current);
      },
    });
    return () => onPersistenceReady(null);
  }, [editor, onPersistenceReady]);

  useEffect(() => {
    slashRef.current = slash;
  }, [slash]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    setEditorEditableSilently(editor, editable);
  }, [editable, editor]);

  useEffect(() => {
    setEditorSpellcheck(editor, spellcheckEnabled);
  }, [editor, spellcheckEnabled]);

  useEffect(() => () => {
    deferredMarkdownRef.current?.flush();
    onPendingChangeRef.current(null);
  }, []);

  useEffect(() => {
    if (!editor) return;
    if (historyWorkspace.current !== workspace) {
      noteHistoryCache.current?.clear();
      historyWorkspace.current = workspace;
      loadedHistoryKey.current = null;
      lastLoadedNote.current = null;
    }
    const nextHistoryKey = notePath ? `${workspace}\0${historyKey ?? notePath}` : null;
    const requestedReload = (reloadRequest ?? 0) !== handledReloadRequest.current;
    const loadAction = getEditorDocumentLoadAction({
      currentHistoryKey: loadedHistoryKey.current,
      currentPath: lastLoadedNote.current,
      nextHistoryKey,
      nextPath: notePath,
      requestedReload,
    });
    if (loadAction === "unchanged") {
      const previousHistoryKey = loadedHistoryKey.current;
      if (nextHistoryKey && previousHistoryKey && nextHistoryKey !== previousHistoryKey && noteHistoryCache.current) {
        cacheCurrentNoteEditorState(noteHistoryCache.current, nextHistoryKey, editor);
        noteHistoryCache.current.delete(previousHistoryKey);
        loadedHistoryKey.current = nextHistoryKey;
      }
      return;
    }
    if (loadAction === "preserve") {
      lastLoadedNote.current = notePath;
      loadedHistoryKey.current = nextHistoryKey;
      handledReloadRequest.current = reloadRequest ?? 0;
      return;
    }
    deferredMarkdownRef.current?.cancel();
    onPendingChangeRef.current(null);
    const previousHistoryKey = loadedHistoryKey.current;
    if (previousHistoryKey && noteHistoryCache.current) {
      cacheCurrentNoteEditorState(noteHistoryCache.current, previousHistoryKey, editor);
    }
    let next = "";
    try {
      next = markdownToHtml(content, { resolveImageSrc: (src) => resolveNotebookImageSrc(workspace, src) });
    } catch (error) {
      onLoadError(error);
      return;
    }
    // Chain content + selection into one transaction so there is no intermediate
    // paint that could leave a ghost cursor from the previous note.
    const selectionFrom = restorePosition?.selectionFrom;
    const selectionTo = restorePosition?.selectionTo ?? selectionFrom;
    const hasValidRestore =
      typeof selectionFrom === "number" &&
      typeof selectionTo === "number" &&
      selectionFrom >= 0 &&
      selectionTo >= selectionFrom;
    // Clear only a stale editor caret, synchronously, when no control has focus.
    // Tiptap's blur schedules a page-wide removeAllRanges in the next frame;
    // that can erase the new title's selection after App has focused it.
    const wasFocused = editor.isFocused || editor.view.dom === document.activeElement;
    if (!wasFocused && document.activeElement === document.body) {
      const selection = window.getSelection();
      if (selection?.anchorNode && editor.view.dom.contains(selection.anchorNode)) {
        selection.removeAllRanges();
      }
    }
    setFindOpen(false);
    try {
      if (requestedReload && nextHistoryKey) {
        noteHistoryCache.current?.delete(nextHistoryKey);
      }
      const restoredHistory = Boolean(
        !requestedReload
        && nextHistoryKey
        && noteHistoryCache.current
        && restoreCachedNoteEditorState(noteHistoryCache.current, nextHistoryKey, content, editor),
      );
      if (!restoredHistory) {
        editor
          .chain()
          .setContent(next, { emitUpdate: false })
          .command(({ tr, state }) => {
            const docSize = state.doc.content.size;
            const targetTo = hasValidRestore
              ? Math.min(Math.max(1, selectionTo as number), docSize)
              : 1;
            const targetFrom = hasValidRestore
              ? Math.min(Math.max(1, selectionFrom as number), targetTo)
              : 1;
            tr.setSelection(TextSelection.create(state.doc, targetFrom, targetTo));
            return true;
          })
          .run();
        resetEditorHistory(editor);
      }
      lastLoadedNote.current = notePath;
      loadedHistoryKey.current = nextHistoryKey;
      handledReloadRequest.current = reloadRequest ?? 0;
      if (wasFocused) {
        editor.view.dom.focus({ preventScroll: true });
      }
      void hydrateNotebookImageNodes(editor, workspace, notePath, () => notePathRef.current);
    } catch (error) {
      onLoadError(error);
    }
  }, [content, editor, historyKey, notePath, onLoadError, reloadRequest, restorePosition, workspace]);

  // Loading resets plugin state; cached notes may carry old global settings.
  // Reapply after either path, without reloading content or disturbing history.
  useEffect(() => {
    if (editor) editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, bulletMethodStatuses).setMeta("bulletMethodDisplay", bulletMethodDisplay));
  }, [editor, bulletMethodStatuses, bulletMethodDisplay, historyKey, notePath, reloadRequest, workspace]);

  useEffect(() => {
    if (!editor || !focusRequest) return;
    const scrollSurface = editor.view.dom.closest(".note-surface");
    const preservedScrollTop = scrollSurface instanceof HTMLElement ? scrollSurface.scrollTop : null;
    const restoreScroll = () => {
      if (
        preservedScrollTop !== null
        && scrollSurface instanceof HTMLElement
        && scrollSurface.isConnected
        && scrollSurface.scrollTop !== preservedScrollTop
      ) {
        scrollSurface.scrollTop = preservedScrollTop;
      }
    };
    // Force a synchronous DOM focus first — Tiptap's chain().focus() defers
    // the actual view.focus() to rAF, which races with later effects (e.g. a
    // content reload that blurs+refocuses) and can drop us back to BODY. WebKit
    // may also scroll a tall empty contenteditable despite preventScroll, so
    // pin the Note viewport through Tiptap's deferred focus frames.
    editor.view.dom.focus({ preventScroll: true });
    const chain = editor.chain().focus("start", { scrollIntoView: false });
    if (editable && !editor.state.doc.textContent.trim()) {
      chain.setParagraph().run();
    } else {
      chain.run();
    }
    restoreScroll();
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      restoreScroll();
      secondFrame = window.requestAnimationFrame(restoreScroll);
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [editable, editor, focusRequest]);

  useEffect(() => {
    if (!editor || !focusAtEndRequest) return;
    editor.chain().focus().setTextSelection(editor.state.doc.content.size).run();
  }, [editor, focusAtEndRequest]);

  useEffect(() => {
    if (!findRequest || findRequest === handledFindRequest.current) return;
    handledFindRequest.current = findRequest;
    setFindOpen((prev) => !prev);
  }, [findRequest]);

  useEffect(() => {
    if (!findOpen) return;
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, [findOpen]);

  useEffect(() => {
    if (!editor || !findOpen) return;
    const handleTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) setFindDocumentVersion((version) => version + 1);
    };
    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor, findOpen]);

  const findMatches = useMemo(
    () => {
      void findDocumentVersion;
      return editor && findOpen && findQuery.trim() ? getEditorMatches(editor, findQuery.trim()) : [];
    },
    [editor, findDocumentVersion, findOpen, findQuery],
  );

  const selectMatchFromList = useCallback((matches: Array<{ from: number; to: number }>, index: number) => {
    if (!editor || !matches.length) {
      setFindIndex(0);
      return;
    }
    const nextIndex = (index + matches.length) % matches.length;
    const match = matches[nextIndex];
    setFindIndex(nextIndex);
    editor.commands.setTextSelection({ from: match.from, to: match.to });
    requestAnimationFrame(() => {
      scrollEditorPositionIntoView(editor, match.from);
      findInputRef.current?.focus();
    });
  }, [editor]);

  const selectFindMatch = useCallback((index: number) => {
    selectMatchFromList(findMatches, index);
  }, [findMatches, selectMatchFromList]);

  const replaceCurrentMatch = useCallback(() => {
    const query = findQuery.trim();
    if (!editor || !query || !editor.isEditable) return;
    const currentMatches = getEditorMatches(editor, query);
    if (!currentMatches.length) {
      selectMatchFromList([], 0);
      return;
    }
    const { from, to } = editor.state.selection;
    const selectedMatch = currentMatches.find((match) => match.from === from && match.to === to);
    const match = selectedMatch ?? currentMatches[Math.min(findIndex, currentMatches.length - 1)];
    editor.chain().focus().insertContentAt({ from: match.from, to: match.to }, replaceText).run();
    requestAnimationFrame(() => {
      const nextMatches = getEditorMatches(editor, query);
      selectMatchFromList(nextMatches, Math.min(findIndex, nextMatches.length - 1));
    });
  }, [editor, findIndex, findQuery, replaceText, selectMatchFromList]);

  const replaceAllMatches = useCallback(() => {
    const query = findQuery.trim();
    if (!editor || !query || !editor.isEditable) return;
    const currentMatches = getEditorMatches(editor, query);
    if (!currentMatches.length) {
      selectMatchFromList([], 0);
      return;
    }
    const { tr } = editor.state;
    [...currentMatches].reverse().forEach((match) => {
      tr.insertText(replaceText, match.from, match.to);
    });
    editor.view.dispatch(tr);
    editor.view.focus();
    requestAnimationFrame(() => {
      selectMatchFromList(getEditorMatches(editor, query), 0);
    });
  }, [editor, findQuery, replaceText, selectMatchFromList]);

  const applyEditorCommand = useCallback((request: EditorCommandRequest) => {
    if (!editor) return;
    if (request.command === "equation") {
      requestEquation(editor);
      return;
    }
    if (isInlineColorCommand(request.command)) {
      applyInlineColor(editor, request.command);
      return;
    }
    if (isSortCommand(request.command)) {
      if (request.command !== "sort_bullet_method" || bulletMethodDisplay.enabled) applyLineSort(editor, request.command, bulletMethodStatuses);
      return;
    }
    if (request.command === "findNext") {
      setFindOpen(true);
      selectFindMatch(findIndex + 1);
      return;
    }
    if (request.command === "findPrevious") {
      setFindOpen(true);
      selectFindMatch(findIndex - 1);
      return;
    }
    if (request.command === "replace") {
      setFindOpen(true);
      setReplaceOpen(true);
      return;
    }
    if (request.command === "insertText") {
      if (!editor.isEditable || !request.src) return;
      if (typeof request.selectionFrom === "number") {
        const docSize = editor.state.doc.content.size;
        const from = Math.min(Math.max(1, request.selectionFrom), docSize);
        const to = Math.min(Math.max(from, request.selectionTo ?? from), docSize);
        editor.chain().focus().insertContentAt({ from, to }, request.src).setTextSelection(from + request.src.length).run();
        return;
      }
      editor.chain().focus().insertContent(request.src).run();
      return;
    }
    if (!editor.isEditable) return;
    const chain = editor.chain().focus();
    switch (request.command) {
      case "bold":
        chain.toggleBold().run();
        break;
      case "italic":
        chain.toggleItalic().run();
        break;
      case "strike":
        chain.toggleStrike().run();
        break;
      case "code":
        chain.toggleCode().run();
        break;
      case "highlight":
        chain.toggleHighlight().run();
        break;
      case "link":
        void applyLinkToEditorSelection(editor, onRequestLink);
        break;
      case "clear":
        chain.unsetAllMarks().clearNodes().run();
        break;
      case "paragraphAuto":
      case "paragraphIndent":
      case "paragraphNoIndent":
        setParagraphIndent(editor, request.command === "paragraphAuto" ? null : request.command === "paragraphIndent" ? "indent" : "none");
        break;
      case "paragraph":
        chain.setParagraph().run();
        break;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        chain.toggleHeading({ level: Number(request.command.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
        break;
      case "bulletList":
        chain.toggleBulletList().run();
        break;
      case "orderedList":
        chain.toggleOrderedList().run();
        break;
      case "taskList":
        chain.toggleTaskList().run();
        break;
      case "quote":
        chain.toggleBlockquote().run();
        break;
      case "codeBlock":
        chain.toggleCodeBlock().run();
        break;
      case "divider":
        chain.setHorizontalRule().run();
        break;
      case "table":
        chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        markCurrentTableAsTigranaHtml(editor);
        ensureParagraphAfterCurrentTable(editor);
        break;
      case "image":
        if (request.src) chain.setImage({ src: request.src, alt: request.alt || "Image" }).run();
        break;
      default:
        break;
    }
  }, [editor, findIndex, onRequestLink, selectFindMatch, bulletMethodStatuses, bulletMethodDisplay.enabled]);

  useEffect(() => {
    if (!commandRequest || commandRequest.id === handledCommandRequest.current) return;
    handledCommandRequest.current = commandRequest.id;
    applyEditorCommand(commandRequest);
  }, [applyEditorCommand, commandRequest]);

  useEffect(() => {
    setFindIndex(0);
    if (findMatches.length) selectFindMatch(0);
  }, [findMatches.length, selectFindMatch]);

  useEffect(() => {
    if (!editor) return;
    const query = findOpen ? findQuery.trim() : "";
    const activeIndex = findMatches.length ? Math.min(findIndex, findMatches.length - 1) : 0;
    editor.view.dispatch(editor.state.tr.setMeta(searchHighlightKey, { query, activeIndex }));
  }, [editor, findIndex, findMatches.length, findOpen, findQuery]);

  const commands = slash ? filterSlashCommands(slash.query) : [];
  const selectedSlashIndex = slash?.selected ?? -1;

  useLayoutEffect(() => {
    if (selectedSlashIndex < 0 || commands.length === 0) return;
    selectedSlashItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [commands.length, selectedSlashIndex]);

  // Position the slash menu near the cursor in viewport coordinates.
  const slashMenuStyle = useMemo(() => {
    if (!slash || !editor) return undefined;
    const coords = editor.view.coordsAtPos(slash.range.from);
    const menuWidth = 292;
    const menuHeight = Math.min(commands.length * 54 + 14, 380);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = coords.bottom + 4;
    let left = coords.left;
    if (left + menuWidth > vw - 8) left = vw - menuWidth - 8;
    if (top + menuHeight > vh - 8) top = coords.top - menuHeight - 4;
    return { top, left } as CSSProperties;
  }, [slash, editor, commands.length]);

  return (
    <div
      className="editor-shell"
      data-editable={editable ? "true" : "false"}
      onMouseDown={(e) => {
        if (!editor || e.button !== 0) return;
        if ((e.target as HTMLElement | null)?.closest(".note-find-bar")) return;
        if ((e.target as HTMLElement | null)?.closest(".format-bubble, .editor-color-controls")) return;
        const pm = editor.view.dom;
        if (pm.contains(e.target as Node)) return;
        e.preventDefault();
        editor.chain().focus().setTextSelection(editor.state.doc.content.size).run();
      }}
      onClick={(e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const link = target.closest("a");
        if (!link) return;
        const href = link.getAttribute("href") ?? "";
        if (!href) return;
        e.preventDefault();
        if (isInternalNotebookHref(href)) {
          onInternalLinkClick?.(decodeInternalHref(href));
        } else {
          void openExternal(href).catch((error) => {
            console.error("Failed to open external link", error);
          });
        }
      }}
    >
      {editor && colorToolbarElement ? createPortal(<EditorColorControls editor={editor} disabled={!editable || colorsDisabled} />, colorToolbarElement) : null}
      {editor ? <EquationContextMenu editor={editor} disabled={!editable} /> : null}
      {editor ? <EquationDialog editor={editor} disabled={!editable} /> : null}
      {editor ? <FormattingBubbleMenu bulletMethodEnabled={Boolean(bulletMethodDisplay.enabled)} editor={editor} onRequestLink={onRequestLink} bulletMethodStatuses={bulletMethodStatuses} /> : null}
      {findOpen ? (
        <div className={replaceOpen ? "note-find-bar has-replace" : "note-find-bar"}>
          <div className="note-find-row">
            <Search size={15} />
            <input
              ref={findInputRef}
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  selectFindMatch(findIndex + (event.shiftKey ? -1 : 1));
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setFindOpen(false);
                  setReplaceOpen(false);
                }
              }}
              placeholder="Find in note"
              aria-label="Find in current note"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <span className="find-count">{findQuery.trim() ? `${findMatches.length ? findIndex + 1 : 0}/${findMatches.length}` : ""}</span>
          </div>
          {replaceOpen ? (
            <div className="note-replace-row">
              <span className="note-find-row-spacer" aria-hidden="true" />
              <input
                value={replaceText}
                onChange={(event) => setReplaceText(event.target.value)}
                placeholder="Replace"
                aria-label="Replace in current note"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <button type="button" disabled={!findMatches.length || !editable} onClick={replaceCurrentMatch}>
                Replace
              </button>
              <button type="button" disabled={!findMatches.length || !editable} onClick={replaceAllMatches}>
                All
              </button>
            </div>
          ) : null}
          <div className="note-find-controls">
            <button
              type="button"
              title="Previous match"
              disabled={!findMatches.length}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectFindMatch(findIndex - 1)}
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              title="Next match"
              disabled={!findMatches.length}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectFindMatch(findIndex + 1)}
            >
              <ChevronDown size={14} />
            </button>
            <button type="button" title="Close find" onClick={() => { setFindOpen(false); setReplaceOpen(false); }}>
              <X size={14} />
            </button>
          </div>
        </div>
      ) : null}
      <EditorContent editor={editor} className="editor-content" />
      {slash && commands.length > 0 ? (
        <div className="slash-menu" style={slashMenuStyle}>
          {commands.map((command, index) => {
            const Icon = command.icon;
            return (
              <button
                className={index === slash.selected ? "slash-item is-selected" : "slash-item"}
                key={command.id}
                ref={index === slash.selected ? selectedSlashItemRef : undefined}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  if (!editor) return;
                  const currentSlash = findSlashQuery(editor) ?? slash;
                  command.run(editor, currentSlash.range, { requestEmoji: onRequestEmoji, requestLink: onRequestLink, requestImage: onRequestImage });
                  slashRef.current = null;
                  setSlash(null);
                }}
              >
                <span className="slash-icon">
                  <Icon size={16} />
                </span>
                <span>
                  <strong>{command.title}</strong>
                  <small>{command.hint}</small>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function handleEditorTabKeyDown(editor: Editor, event: KeyboardEvent) {
  if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (editor.isActive("table")) {
    event.preventDefault();
    if (event.shiftKey) {
      editor.commands.goToPreviousCell();
      return true;
    }
    if (editor.commands.goToNextCell()) return true;
    if (editor.can().addRowAfter()) {
      editor.chain().addRowAfter().goToNextCell().run();
    }
    return true;
  }

  const listItemName = editor.isActive("taskItem") ? "taskItem" : editor.isActive("listItem") ? "listItem" : null;
  if (listItemName) {
    event.preventDefault();
    if (event.shiftKey) {
      editor.commands.liftListItem(listItemName);
    } else {
      editor.commands.sinkListItem(listItemName);
    }
    return true;
  }

  event.preventDefault();
  if (editor.isActive("codeBlock")) {
    if (!event.shiftKey) editor.commands.insertContent("  ");
    return true;
  }

  if (event.shiftKey) {
    removeTextblockIndent(editor);
  } else {
    insertTextblockIndent(editor);
  }
  return true;
}

function insertTextblockIndent(editor: Editor) {
  const { state, view } = editor;
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return;
  view.dispatch(state.tr.insertText(EM_SPACE, $from.start()).scrollIntoView());
}

function removeTextblockIndent(editor: Editor) {
  const { state, view } = editor;
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return;
  const start = $from.start();
  if (state.doc.textBetween(start, start + 1) !== EM_SPACE) return;
  view.dispatch(state.tr.delete(start, start + 1).scrollIntoView());
}

async function applyLinkToEditorSelection(
  editor: Editor,
  onRequestLink?: () => Promise<{ href: string; title: string } | null>,
) {
  if (!onRequestLink) return;
  const { from, to, empty } = editor.state.selection;
  const pick = await onRequestLink();
  if (!pick) return;

  if (empty) {
    editor
      .chain()
      .focus()
      .insertContent([
        {
          type: "text",
          text: pick.title,
          marks: [{ type: "link", attrs: { href: pick.href } }],
        },
        { type: "text", text: " " },
      ])
      .run();
    return;
  }

  editor
    .chain()
    .focus()
    .setTextSelection({ from, to })
    .extendMarkRange("link")
    .setLink({ href: pick.href })
    .run();
}

function applyLineSort(editor: Editor, command: SortCommand, statuses: readonly BulletMethodStatus[]) {
  if (!editor.isEditable) return;
  // A cursor-only shortcut must not act on a stale cursor while another field has focus.
  if (editor.state.selection.empty && !editor.isFocused) return;
  const tr = sortSelectedLines(editor.state, command, statuses);
  if (tr) {
    editor.view.dispatch(tr);
    editor.view.dispatch(closeHistory(editor.state.tr));
    refreshSortedSelectionPaint(editor.view);
  }
  editor.view.focus();
}

export function FormattingBubbleMenu({
  bulletMethodEnabled = false,
  editor,
  onRequestLink,
  bulletMethodStatuses = defaultBulletMethodStatuses,
}: {
  editor: Editor;
  bulletMethodEnabled?: boolean;
  bulletMethodStatuses?: readonly BulletMethodStatus[];
  onRequestLink?: () => Promise<{ href: string; title: string } | null>;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [suppressed, setSuppressed] = useState(false);
  const [tick, setTick] = useState(0);
  const [positionRevision, setPositionRevision] = useState(0);
  const [pendingShow, setPendingShow] = useState(false);
  const showTimerRef = useRef<number | null>(null);
  const hadTextSelectionRef = useRef(!editor.state.selection.empty);
  const selectionRangeRef = useRef({
    anchor: editor.state.selection.anchor,
    head: editor.state.selection.head,
  });

  // Editor transactions refresh button state, but only a genuinely new
  // selection or viewport movement may move an already-visible bubble. This
  // keeps block formatting (for example paragraph -> H1) from making the
  // toolbar jump when the selected text's line box changes size.
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const refreshSelection = () => {
      const { selection } = editor.state;
      const hasTextSelection = !selection.empty;
      const previousRange = selectionRangeRef.current;
      if (selection.anchor !== previousRange.anchor || selection.head !== previousRange.head) {
        selectionRangeRef.current = { anchor: selection.anchor, head: selection.head };
        setPositionRevision((value) => value + 1);
      }
      if (hasTextSelection || hadTextSelectionRef.current) refresh();
      hadTextSelectionRef.current = hasTextSelection;
    };
    const refreshSelectedTransaction = () => {
      if (!editor.state.selection.empty) refresh();
    };
    const refreshPosition = () => setPositionRevision((value) => value + 1);
    editor.on("selectionUpdate", refreshSelection);
    editor.on("transaction", refreshSelectedTransaction);
    editor.on("focus", refresh);
    editor.on("blur", refresh);
    window.addEventListener("resize", refreshPosition);
    window.addEventListener("scroll", refreshPosition, true);
    return () => {
      editor.off("selectionUpdate", refreshSelection);
      editor.off("transaction", refreshSelectedTransaction);
      editor.off("focus", refresh);
      editor.off("blur", refresh);
      window.removeEventListener("resize", refreshPosition);
      window.removeEventListener("scroll", refreshPosition, true);
    };
  }, [editor]);

  // Track Shift and left-mouse-button state. While either is held, suppress
  // the bubble. On release, re-evaluate immediately so the bubble can appear
  // without needing a follow-up editor action.
  useEffect(() => {
    let shift = false;
    let mouse = false;
    const sync = () => setSuppressed(shift || mouse);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Shift" || shift) return;
      shift = true;
      sync();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Shift" || !shift) return;
      shift = false;
      sync();
    };
    const isFromBubble = (event: MouseEvent) =>
      (event.target as HTMLElement | null)?.closest(".format-bubble, .editor-color-controls") != null;
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || mouse) return;
      // Clicks on the bubble itself are button presses, not new selections —
      // don't suppress (which would unmount the bubble mid-click).
      if (isFromBubble(event)) return;
      if (isTableChromeTarget(event.target)) {
        mouse = true;
        sync();
        return;
      }
      mouse = true;
      sync();
    };
    const handleMouseUp = (event: MouseEvent) => {
      if (event.button !== 0 || !mouse) return;
      if (isFromBubble(event)) return;
      mouse = false;
      sync();
    };
    const handleBlur = () => {
      if (!shift && !mouse) return;
      shift = false;
      mouse = false;
      sync();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const setLink = () => {
    if (!onRequestLink) return;
    const { from, to, empty } = editor.state.selection;
    void onRequestLink().then((pick) => {
      if (!pick) return;
      if (empty) {
        // Nothing selected: insert the link's title and link it.
        editor
          .chain()
          .focus()
          .insertContent([
            {
              type: "text",
              text: pick.title,
              marks: [{ type: "link", attrs: { href: pick.href } }],
            },
            { type: "text", text: " " },
          ])
          .run();
      } else {
        // Apply the link mark to the existing selection.
        editor
          .chain()
          .focus()
          .setTextSelection({ from, to })
          .extendMarkRange("link")
          .setLink({ href: pick.href })
          .run();
      }
    });
  };

  const buttonRows = [
    {
      label: "Text formatting",
      buttons: [
        { label: "Bold", icon: Bold, active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
        { label: "Italic", icon: Italic, active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
        { label: "Underline", icon: Underline, active: editor.isActive("underline"), run: () => editor.chain().focus().toggleUnderline().run() },
        { label: "Strikethrough", icon: Strikethrough, active: editor.isActive("strike"), run: () => editor.chain().focus().toggleStrike().run() },
        { label: "Code", icon: Code, active: editor.isActive("code"), run: () => editor.chain().focus().toggleCode().run() },
        { label: "Link", icon: LinkIcon, active: editor.isActive("link"), run: setLink },
        { label: "Insert equation", icon: Sigma, active: false, run: () => requestEquation(editor, { block: false }) },
        { label: "Quote", icon: Quote, active: editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
        { label: "Clear formatting", icon: RemoveFormatting, active: false, run: () => editor.chain().focus().unsetAllMarks().clearNodes().run() },
      ],
    },
    {
      label: "Block formatting",
      buttons: [
        { label: "H1", icon: Heading1, active: editor.isActive("heading", { level: 1 }), run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
        { label: "H2", icon: Heading2, active: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
        { label: "H3", icon: Heading3, active: editor.isActive("heading", { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
        { label: "H4", icon: Heading4, active: editor.isActive("heading", { level: 4 }), run: () => editor.chain().focus().toggleHeading({ level: 4 }).run() },
        { label: "H5", icon: Heading5, active: editor.isActive("heading", { level: 5 }), run: () => editor.chain().focus().toggleHeading({ level: 5 }).run() },
        { label: "H6", icon: Heading6, active: editor.isActive("heading", { level: 6 }), run: () => editor.chain().focus().toggleHeading({ level: 6 }).run() },
        { label: "Bullets", icon: List, active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
        { label: "Numbers", icon: ListOrdered, active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
        { label: "Tasks", icon: CheckSquare, active: editor.isActive("taskList"), run: () => editor.chain().focus().toggleTaskList().run() },
      ],
    },
  ];

  const eligible = (() => {
    if (typeof document === "undefined") return false;
    if (document.querySelector(".dialog-backdrop")) return false;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.closest(".note-find-bar")) return false;
    const { selection } = editor.state;
    if (selection instanceof NodeSelection && selection.node.type.name === "image") return false;
    if (selection instanceof NodeSelection && selection.node.type.name === "table") return false;
    if (selection instanceof CellSelection) return false;
    if (document.querySelector(".table-context-menu")) return false;
    if (isTableChromeTarget(activeElement)) return false;
    if (editor.isActive("image")) return false;
    return isFormattingSelection(selection) && editor.isEditable && (editor.isFocused || !!activeElement?.closest(".format-bubble, .editor-color-controls"));
  })();

  const visible = eligible && !suppressed && pendingShow;

  // Small show delay so the bubble doesn't jump in the moment a selection lands.
  useEffect(() => {
    if (eligible && !suppressed) {
      if (pendingShow) return;
      const timer = window.setTimeout(() => setPendingShow(true), 80);
      showTimerRef.current = timer;
      return () => window.clearTimeout(timer);
    }
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (pendingShow) setPendingShow(false);
    return undefined;
  }, [eligible, suppressed, pendingShow]);

  const position = useMemo(() => {
    void positionRevision;
    if (!visible) return null;
    const { from, to } = editor.state.selection;
    try {
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const top = Math.min(start.top, end.top);
      const left = (start.left + end.left) / 2;
      return { top, left, bottom: Math.max(start.bottom, end.bottom) };
    } catch {
      return null;
    }
  }, [editor, positionRevision, visible]);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!position || !bubble) return;
    const { width, height } = bubble.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(position.left - width / 2, window.innerWidth - width - margin));
    const above = position.top - height - margin;
    const top = Math.max(margin, Math.min(
      above >= margin ? above : position.bottom + margin,
      window.innerHeight - height - margin,
    ));
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  }, [position]);

  // Reference `tick` so editor state changes still refresh button/visibility
  // state without treating every transaction as an anchor invalidation.
  void tick;

  if (!visible || !position) return null;

  return createPortal(
    <div
      ref={bubbleRef}
      className="format-bubble format-bubble-toolbar"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        maxWidth: "calc(100vw - 16px)",
        boxSizing: "border-box",
        overflowX: "auto",
        zIndex: 55,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {buttonRows.map((row) => (
        <div className="format-bubble-row" role="group" aria-label={row.label} key={row.label}>
          {row.buttons.map((button) => {
            const Icon = button.icon;
            return (
              <Fragment key={button.label}>
                {button.label === "Insert equation" && <InlineColorPicker editor={editor} />}
                <button
                  className={button.active ? "is-active" : ""}
                  type="button"
                  title={button.label}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    button.run();
                  }}
                >
                  <Icon size={15} />
                </button>
                {button.label === "Tasks" && bulletMethodEnabled && (
                  <button
                    type="button"
                    aria-label="Sort by Bullet Method"
                    title={`Sort by Bullet Method (${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘⌥." : "Ctrl+Alt+."})`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyLineSort(editor, "sort_bullet_method", bulletMethodStatuses)}
                  >
                    <BulletMethodIcon size={15} />
                  </button>
                )}
              </Fragment>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );
}

function handleEmptyListItemDelete(view: EditorView, event: KeyboardEvent) {
  if (event.key !== "Delete" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const { selection, schema } = view.state;
  if (!selection.empty) return false;

  const { $from } = selection;
  let listItemDepth = -1;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const nodeName = $from.node(depth).type.name;
    if (nodeName === "listItem" || nodeName === "taskItem") {
      listItemDepth = depth;
      break;
    }
  }
  if (listItemDepth < 1) return false;

  const listItem = $from.node(listItemDepth);
  if (listItem.textContent.trim()) return false;

  const parentList = $from.node(listItemDepth - 1);
  const itemIndex = $from.index(listItemDepth - 1);
  if (itemIndex >= parentList.childCount - 1) return false;

  event.preventDefault();
  const deleteFrom = $from.before(listItemDepth);
  const deleteTo = $from.after(listItemDepth);
  const tr = view.state.tr.delete(deleteFrom, deleteTo);
  const nextTextPosition = findTextSelectionPosition(tr.doc, deleteFrom, schema.nodes.paragraph?.name ?? "paragraph");
  const nextSelection = nextTextPosition
    ? TextSelection.create(tr.doc, nextTextPosition)
    : Selection.near(tr.doc.resolve(Math.min(deleteFrom, tr.doc.content.size)), 1);
  view.dispatch(tr.setSelection(nextSelection).scrollIntoView());
  return true;
}

function handleEmptyTaskItemForwardDelete(view: EditorView, event: KeyboardEvent) {
  if (!isPlainDeleteKey(event, "Delete")) return false;
  const { selection } = view.state;
  if (!selection.empty || !selection.$from.parent.isTextblock) return false;
  if (selection.$from.parentOffset !== selection.$from.parent.content.size) return false;

  const item = findListItemAtSelection(selection.$from);
  if (!item) return false;

  const next = findNextEmptyTaskItem(selection.$from, item);
  if (!next) return false;

  event.preventDefault();
  deleteEmptyListItem(view, next, -1);
  return true;
}

function findNextEmptyTaskItem($from: ResolvedPos, current: ListItemRange): ListItemRange | null {
  const itemIndex = $from.index(current.parentDepth);
  const nextSibling = itemIndex < current.parentNode.childCount - 1
    ? current.parentNode.child(itemIndex + 1)
    : null;
  if (nextSibling?.type.name === "taskItem" && !nextSibling.textContent.trim()) {
    return {
      depth: current.depth,
      from: $from.after(current.depth),
      node: nextSibling,
      parentDepth: current.parentDepth,
      parentFrom: current.parentFrom,
      parentNode: current.parentNode,
    };
  }

  if (itemIndex < current.parentNode.childCount - 1) return null;

  const nextListFrom = $from.after(current.parentDepth);
  const nextList = $from.doc.resolve(nextListFrom).nodeAfter;
  const nextItem = nextList?.type.name === "taskList" ? nextList.firstChild : null;
  if (!nextList || !nextItem || nextItem.type.name !== "taskItem" || nextItem.textContent.trim()) return null;

  return {
    depth: current.parentDepth + 1,
    from: nextListFrom + 1,
    node: nextItem,
    parentDepth: current.parentDepth,
    parentFrom: nextListFrom,
    parentNode: nextList,
  };
}

function findTextSelectionPosition(doc: ProseMirrorNode, from: number, paragraphName: string) {
  let found: number | null = null;
  doc.nodesBetween(from, Math.min(doc.content.size, from + 32), (node, pos) => {
    if (found !== null) return false;
    if (node.type.name === paragraphName) {
      found = pos + 1;
      return false;
    }
    return true;
  });
  return found;
}

function writeEditorSelectionToClipboard(view: EditorView, event: ClipboardEvent) {
  if (!event.clipboardData) return false;
  const payload = serializeEditorSelectionForClipboard(view);
  if (!payload) return false;

  event.preventDefault();
  event.clipboardData.setData("text/plain", payload.plainText);
  event.clipboardData.setData("text/html", payload.html);
  return true;
}

function cutSelectedTaskLines(view: EditorView, event: ClipboardEvent) {
  const deleteRange = getTaskLineCutDeleteRange(view.state.selection);
  if (!deleteRange) return false;
  if (!writeEditorSelectionToClipboard(view, event)) return false;

  view.dispatch(
    view.state.tr
      .deleteRange(deleteRange.from, deleteRange.to)
      .scrollIntoView()
      .setMeta("uiEvent", "cut"),
  );
  return true;
}

function getSelectedText(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) return "";
  return editor.state.doc.textBetween(from, to, "\n", "\n");
}

async function getBestClipboardImageFile(existing: File | null) {
  return existing ?? await readClipboardImageFile().catch(() => null);
}

async function readClipboardImageFile() {
  const clipboard = navigator.clipboard as Clipboard & {
    read?: () => Promise<Array<{ types: string[]; getType: (type: string) => Promise<Blob> }>>;
  };
  if (!clipboard.read) return null;
  const items = await clipboard.read();
  for (const item of items) {
    const type = item.types.find(isRenderableImageType) ?? item.types.find((entry) => entry.startsWith("image/"));
    if (!type) continue;
    const blob = await item.getType(type);
    return blobToFile(blob, type);
  }
  return null;
}

function findSlashQuery(editor: NonNullable<ReturnType<typeof useEditor>>) {
  return findSlashQueryInState(editor.state);
}
