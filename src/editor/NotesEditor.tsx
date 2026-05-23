import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Extension } from "@tiptap/core";
import Emoji, { gitHubEmojis } from "@tiptap/extension-emoji";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import type { Fragment as ProseMirrorFragment, Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { EditorContent, NodeViewContent, NodeViewWrapper, Range, ReactNodeViewRenderer, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Bold,
  Check,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Code,
  Copy,
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
  Search,
  Strikethrough,
  X,
} from "lucide-react";
import { common, createLowlight } from "lowlight";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filterSlashCommands } from "./slashCommands";
import { htmlToMarkdown, markdownToHtml, normalizeMarkdownImageLines } from "../lib/markdown";
import { isTauri, openExternal, readAssetDataUrl, saveAsset, saveClipboardImageAsset } from "../lib/notesApi";
import type { NotePositionMetadata } from "../types";

type NotesEditorProps = {
  content: string;
  focusRequest: number;
  focusAtEndRequest: number;
  findRequest: number;
  reloadRequest?: number;
  notePath: string | null;
  restorePosition: NotePositionMetadata | null;
  workspace: string;
  onChange: (markdown: string) => void;
  onLoadError: (error: unknown) => void;
  onPositionChange: (position: { selectedText: string; selectionFrom: number; selectionTo: number }) => void;
  onInternalLinkClick?: (href: string) => void;
  onRequestEmoji?: () => Promise<string | null>;
  onRequestLink?: () => Promise<{ href: string; title: string } | null>;
};

type SlashState = {
  range: Range;
  query: string;
  selected: number;
};

const lowlight = createLowlight(common);
const searchHighlightKey = new PluginKey<SearchHighlightState>("searchHighlight");

type SearchHighlightState = {
  activeIndex: number;
  decorations: DecorationSet;
  query: string;
};

type SearchHighlightMeta = {
  activeIndex: number;
  query: string;
};

const EM_SPACE = " ";

const ListItemSeparator = Extension.create({
  name: "listItemSeparator",
  addGlobalAttributes() {
    return [
      {
        types: ["listItem", "taskItem"],
        attributes: {
          separatorAfter: {
            default: false,
            parseHTML: (element) => element.getAttribute("data-separator-after") === "true",
            renderHTML: (attributes) =>
              attributes.separatorAfter ? { "data-separator-after": "true" } : {},
          },
        },
      },
    ];
  },
});

const EmSpaceIndent = Extension.create({
  name: "emSpaceIndent",
  addKeyboardShortcuts() {
    const passThroughContext = () => {
      const { editor } = this;
      return (
        editor.isActive("listItem") ||
        editor.isActive("taskItem") ||
        editor.isActive("table") ||
        editor.isActive("codeBlock")
      );
    };

    return {
      Tab: () => {
        if (passThroughContext()) return false;
        return this.editor.commands.insertContent(EM_SPACE);
      },
      "Shift-Tab": () => {
        if (passThroughContext()) return false;
        const { state } = this.editor;
        const { from, empty } = state.selection;
        if (!empty || from === 0) return false;
        if (state.doc.textBetween(from - 1, from) !== EM_SPACE) return false;
        return this.editor.chain().deleteRange({ from: from - 1, to: from }).run();
      },
    };
  },
});

const SearchHighlight = Extension.create({
  name: "searchHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchHighlightState>({
        key: searchHighlightKey,
        state: {
          init: () => ({
            activeIndex: 0,
            decorations: DecorationSet.empty,
            query: "",
          }),
          apply(transaction, value, _oldState, newState) {
            const meta = transaction.getMeta(searchHighlightKey) as SearchHighlightMeta | undefined;
            if (meta) {
              return {
                activeIndex: meta.activeIndex,
                decorations: buildSearchDecorations(newState.doc, meta.query, meta.activeIndex),
                query: meta.query,
              };
            }
            if (transaction.docChanged && value.query) {
              return {
                ...value,
                decorations: buildSearchDecorations(newState.doc, value.query, value.activeIndex),
              };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            return searchHighlightKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

function ResizableImageNodeView({
  node,
  updateAttributes,
  selected,
}: {
  node: ProseMirrorNode;
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    startXRef.current = event.clientX;
    startWidthRef.current =
      containerRef.current?.getBoundingClientRect().width ?? (node.attrs.width as number | null) ?? 400;

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.max(60, Math.round(startWidthRef.current + delta));
      updateAttributes({ width: newWidth });
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const width = node.attrs.width as number | null;

  return (
    <NodeViewWrapper as="span" className="image-resizable-wrapper">
      <span
        ref={containerRef}
        className={`image-resizable${selected ? " is-selected" : ""}`}
        style={width ? { width: `${width}px` } : undefined}
      >
        <img
          src={node.attrs.src as string}
          alt={(node.attrs.alt as string) || ""}
          data-markdown-src={node.attrs.markdownSrc as string | undefined}
        />
        {selected && (
          <span className="image-resize-handle" onMouseDown={handleResizeStart} />
        )}
      </span>
    </NodeViewWrapper>
  );
}

function CodeBlockNodeView({
  node,
  updateAttributes,
}: {
  node: ProseMirrorNode;
  updateAttributes: (attrs: Record<string, unknown>) => void;
}) {
  const [copied, setCopied] = useState(false);
  const language = (node.attrs.language as string | null) ?? "";

  const handleCopy = (event: React.MouseEvent) => {
    event.preventDefault();
    const text = node.textContent;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }).catch((error) => {
      console.error("Failed to copy code", error);
    });
  };

  return (
    <NodeViewWrapper as="pre" className="code-block">
      <div className="code-block-controls" contentEditable={false}>
        <select
          className="code-block-language"
          value={language}
          onChange={(event) => {
            const value = event.target.value;
            updateAttributes({ language: value || null });
          }}
          onMouseDown={(event) => event.stopPropagation()}
          aria-label="Code language"
        >
          <option value="">Plain text</option>
          {CODE_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>
        <button
          type="button"
          className="code-block-copy"
          title={copied ? "Copied" : "Copy code"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleCopy}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <NodeViewContent as="code" className={language ? `language-${language}` : undefined} />
    </NodeViewWrapper>
  );
}

const CODE_LANGUAGES: string[] = (() => {
  try {
    const list = lowlight.listLanguages();
    return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
})();

const CodeBlockWithControls = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView);
  },
});

const MarkdownImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      markdownSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-markdown-src"),
        renderHTML: (attributes) => (attributes.markdownSrc ? { "data-markdown-src": attributes.markdownSrc } : {}),
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const w = element.getAttribute("width");
          return w ? Number(w) : null;
        },
        renderHTML: (attributes) => (attributes.width ? { width: String(attributes.width) } : {}),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageNodeView);
  },
});

export function NotesEditor({ content, focusRequest, focusAtEndRequest, findRequest, reloadRequest, notePath, restorePosition, workspace, onChange, onLoadError, onPositionChange, onInternalLinkClick, onRequestEmoji, onRequestLink }: NotesEditorProps) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const slashRef = useRef<SlashState | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const handledFindRequest = useRef(findRequest);
  const lastLoadedNote = useRef<string | null>(null);
  const handledReloadRequest = useRef(reloadRequest ?? 0);

  const initialContent = useMemo((): { error: unknown; html: string } => {
    try {
      return {
        error: null,
        html: markdownToHtml(content, { resolveImageSrc: (src) => resolveNotebookImageSrc(workspace, src) }),
      };
    } catch (error) {
      return { error, html: "" };
    }
  }, [content, workspace]);

  useEffect(() => {
    if (initialContent.error) onLoadError(initialContent.error);
  }, [initialContent.error, onLoadError]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        codeBlock: false,
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
      }),
      CodeBlockWithControls.configure({ lowlight }),
      Emoji.configure({
        emojis: gitHubEmojis,
      }),
      Highlight,
      SearchHighlight,
      EmSpaceIndent,
      ListItemSeparator,
      MarkdownImage.configure({
        inline: false,
        allowBase64: false,
      }),
      Link.configure({
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
      }),
      Placeholder.configure({
        placeholder: "Start writing, or type / for blocks...",
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    [],
  );

  const handleSlashKeyDown = useCallback((event: KeyboardEvent) => {
    const currentEditor = editorRef.current;
    const currentState = slashRef.current;
    if (!currentState || !currentEditor) return false;

    const currentSlash = findSlashQuery(currentEditor) ?? currentState;
    const currentCommands = filterSlashCommands(currentSlash.query);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSlash((current) =>
        current ? { ...current, selected: (current.selected + 1) % Math.max(currentCommands.length, 1) } : current,
      );
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSlash((current) =>
        current
          ? { ...current, selected: (current.selected - 1 + Math.max(currentCommands.length, 1)) % Math.max(currentCommands.length, 1) }
          : current,
      );
      return true;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      const command = currentCommands[currentState.selected] ?? currentCommands[0];
      if (!command) return false;
      event.preventDefault();
      command.run(currentEditor, currentSlash.range, { requestEmoji: onRequestEmoji, requestLink: onRequestLink });
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
  }, [onRequestEmoji, onRequestLink]);

  const editor = useEditor({
    extensions,
    content: initialContent.html,
    editorProps: {
      handleDOMEvents: {
        keydown(_view, event) {
          if (handleEmptyTaskItemBackspace(_view, event)) return true;
          if (handleEmptyTaskItemForwardDelete(_view, event)) return true;
          if (handleEmptyListItemDelete(_view, event)) return true;
          return handleSlashKeyDown(event);
        },
        mousedown(view, event) {
          if (event.button !== 0) return false;
          const editorElement = view.dom;
          if (!(event.target instanceof Node) || !editorElement.contains(event.target)) return false;
          const blockElements = Array.from(editorElement.children) as HTMLElement[];
          const lastBlock = blockElements.at(-1);
          const lastBlockBottom = lastBlock?.getBoundingClientRect().bottom ?? editorElement.getBoundingClientRect().top;
          if (event.clientY <= lastBlockBottom + 8) return false;

          event.preventDefault();
          view.focus();
          view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
          return true;
        },
        copy(view, event) {
          return writeEditorSelectionToClipboard(view, event);
        },
      },
      handlePaste(view, event) {
        const file = getClipboardImageFile(event.clipboardData);
        const htmlFile = file ? null : getClipboardImageFromHtml(event.clipboardData);
        if (!file && !htmlFile && !mayContainAsyncClipboardImage(event.clipboardData)) return false;

        event.preventDefault();
        void getBestClipboardImageFile(file ?? htmlFile)
          .then((imageFile) => {
            if (imageFile) return insertImageFile(view, workspace, imageFile);
            return insertNativeClipboardImage(view, workspace);
          })
          .catch((error) => {
            console.error("Failed to paste image", error);
          });
        return true;
      },
    },
    onUpdate({ editor }) {
      onChange(htmlToMarkdown(editor.getHTML()));
      onPositionChange({
        selectedText: getSelectedText(editor),
        selectionFrom: editor.state.selection.from,
        selectionTo: editor.state.selection.to,
      });
      const match = findSlashQuery(editor);
      const nextSlash = match ? { ...match, selected: 0 } : null;
      slashRef.current = nextSlash;
      setSlash(nextSlash);
    },
    onSelectionUpdate({ editor }) {
      onPositionChange({
        selectedText: getSelectedText(editor),
        selectionFrom: editor.state.selection.from,
        selectionTo: editor.state.selection.to,
      });
    },
  });

  useEffect(() => {
    slashRef.current = slash;
  }, [slash]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    void hydrateNotebookImageNodes(editor, workspace);
  }, [content, editor, workspace]);

  useEffect(() => {
    if (!editor) return;
    const requestedReload = (reloadRequest ?? 0) !== handledReloadRequest.current;
    if (lastLoadedNote.current === notePath && !requestedReload) return;
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
    // If the editor isn't focused, blur first so the browser removes any cached
    // cursor before new content is painted, preventing a ghost caret from the
    // previous note appearing briefly. If it IS focused (e.g. user just pressed
    // Enter on a new note's title and we just routed focus to the editor),
    // skip the blur — Tiptap's blur defers via rAF and would land AFTER any
    // refocus we attempt, dropping focus back to BODY.
    const wasFocused = editor.isFocused || editor.view.dom === document.activeElement;
    if (!wasFocused) {
      editor.commands.blur();
    }
    setFindOpen(false);
    try {
      editor
        .chain()
        .setContent(next, false)
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
      lastLoadedNote.current = notePath;
      handledReloadRequest.current = reloadRequest ?? 0;
      if (wasFocused) {
        editor.view.dom.focus({ preventScroll: true });
      }
      void hydrateNotebookImageNodes(editor, workspace);
    } catch (error) {
      onLoadError(error);
    }
  }, [content, editor, notePath, onLoadError, reloadRequest, restorePosition, workspace]);

  useEffect(() => {
    if (!editor || !focusRequest) return;
    // Force a synchronous DOM focus first — Tiptap's chain().focus() defers
    // the actual view.focus() to rAF, which races with later effects (e.g. a
    // content reload that blurs+refocuses) and can drop us back to BODY.
    editor.view.dom.focus({ preventScroll: true });
    const chain = editor.chain().focus("start", { scrollIntoView: false });
    if (!editor.state.doc.textContent.trim()) {
      chain.setParagraph().run();
    } else {
      chain.run();
    }
  }, [editor, focusRequest]);

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

  const findMatches = useMemo(() => (editor && findQuery.trim() ? getEditorMatches(editor, findQuery.trim()) : []), [editor, findQuery]);

  const selectFindMatch = useCallback((index: number) => {
    if (!editor || !findMatches.length) return;
    const nextIndex = (index + findMatches.length) % findMatches.length;
    const match = findMatches[nextIndex];
    setFindIndex(nextIndex);
    editor.commands.setTextSelection({ from: match.from, to: match.to });
    requestAnimationFrame(() => {
      scrollEditorPositionIntoView(editor, match.from);
      findInputRef.current?.focus();
    });
  }, [editor, findMatches]);

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

  useEffect(() => {
    if (!slash || !editor) return;
    window.addEventListener("keydown", handleSlashKeyDown, true);
    return () => window.removeEventListener("keydown", handleSlashKeyDown, true);
  }, [editor, handleSlashKeyDown, slash]);

  return (
    <div
      className="editor-shell"
      onMouseDown={(e) => {
        if (!editor || e.button !== 0) return;
        if ((e.target as HTMLElement | null)?.closest(".note-find-bar")) return;
        if ((e.target as HTMLElement | null)?.closest(".format-bubble")) return;
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
      {editor ? <FormattingBubbleMenu editor={editor} onRequestLink={onRequestLink} /> : null}
      {findOpen ? (
        <div className="note-find-bar">
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
              }
            }}
            placeholder="Find in note"
            aria-label="Find in current note"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className="find-count">{findQuery.trim() ? `${findMatches.length ? findIndex + 1 : 0}/${findMatches.length}` : ""}</span>
          <button type="button" title="Previous match" disabled={!findMatches.length} onClick={() => selectFindMatch(findIndex - 1)}>
            <ChevronUp size={14} />
          </button>
          <button type="button" title="Next match" disabled={!findMatches.length} onClick={() => selectFindMatch(findIndex + 1)}>
            <ChevronDown size={14} />
          </button>
          <button type="button" title="Close find" onClick={() => setFindOpen(false)}>
            <X size={14} />
          </button>
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
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  if (!editor) return;
                  const currentSlash = findSlashQuery(editor) ?? slash;
                  command.run(editor, currentSlash.range, { requestEmoji: onRequestEmoji, requestLink: onRequestLink });
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

function FormattingBubbleMenu({
  editor,
  onRequestLink,
}: {
  editor: Editor;
  onRequestLink?: () => Promise<{ href: string; title: string } | null>;
}) {
  const [suppressed, setSuppressed] = useState(false);
  const [tick, setTick] = useState(0);
  const [pendingShow, setPendingShow] = useState(false);
  const showTimerRef = useRef<number | null>(null);

  // Re-render the bubble when the editor's selection / document changes,
  // when focus changes, and on window resize/scroll so positioning stays sticky.
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    editor.on("selectionUpdate", refresh);
    editor.on("transaction", refresh);
    editor.on("focus", refresh);
    editor.on("blur", refresh);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
      editor.off("focus", refresh);
      editor.off("blur", refresh);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
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
      (event.target as HTMLElement | null)?.closest(".format-bubble") != null;
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || mouse) return;
      // Clicks on the bubble itself are button presses, not new selections —
      // don't suppress (which would unmount the bubble mid-click).
      if (isFromBubble(event)) return;
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

  const buttons = [
    { label: "Bold", icon: Bold, active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { label: "Italic", icon: Italic, active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { label: "Strike", icon: Strikethrough, active: editor.isActive("strike"), run: () => editor.chain().focus().toggleStrike().run() },
    { label: "Code", icon: Code, active: editor.isActive("code"), run: () => editor.chain().focus().toggleCode().run() },
    { label: "Link", icon: LinkIcon, active: editor.isActive("link"), run: setLink },
    { label: "H1", icon: Heading1, active: editor.isActive("heading", { level: 1 }), run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: "H2", icon: Heading2, active: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "H3", icon: Heading3, active: editor.isActive("heading", { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "H4", icon: Heading4, active: editor.isActive("heading", { level: 4 }), run: () => editor.chain().focus().toggleHeading({ level: 4 }).run() },
    { label: "H5", icon: Heading5, active: editor.isActive("heading", { level: 5 }), run: () => editor.chain().focus().toggleHeading({ level: 5 }).run() },
    { label: "H6", icon: Heading6, active: editor.isActive("heading", { level: 6 }), run: () => editor.chain().focus().toggleHeading({ level: 6 }).run() },
    { label: "Bullets", icon: List, active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "Numbers", icon: ListOrdered, active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "Tasks", icon: CheckSquare, active: editor.isActive("taskList"), run: () => editor.chain().focus().toggleTaskList().run() },
    { label: "Quote", icon: Quote, active: editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
  ];

  const eligible = (() => {
    if (typeof document === "undefined") return false;
    if (document.querySelector(".dialog-backdrop")) return false;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.closest(".note-find-bar")) return false;
    const { selection } = editor.state;
    if (selection instanceof NodeSelection && selection.node.type.name === "image") return false;
    if (editor.isActive("image")) return false;
    return !selection.empty && editor.isEditable && editor.isFocused;
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

  const position = (() => {
    if (!visible) return null;
    const { from, to } = editor.state.selection;
    try {
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const top = Math.min(start.top, end.top);
      const left = (start.left + end.left) / 2;
      return { top, left };
    } catch {
      return null;
    }
  })();

  // Reference `tick` so the closure stays subscribed to editor events without
  // ESLint warning. Position is recomputed every render anyway.
  void tick;

  if (!visible || !position) return null;

  return (
    <div
      className="format-bubble"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        transform: "translate(-50%, calc(-100% - 8px))",
        zIndex: 55,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {buttons.map((button) => {
        const Icon = button.icon;
        return (
          <button
            className={button.active ? "is-active" : ""}
            key={button.label}
            type="button"
            title={button.label}
            onMouseDown={(event) => {
              event.preventDefault();
              button.run();
            }}
          >
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}

function getEditorMatches(editor: Editor, query: string) {
  return getDocumentMatches(editor.state.doc, query);
}

function getDocumentMatches(doc: ProseMirrorNode, query: string) {
  const normalizedQuery = query.toLowerCase();
  const matches: Array<{ from: number; to: number }> = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let index = text.indexOf(normalizedQuery);
    while (index !== -1) {
      matches.push({ from: pos + index, to: pos + index + query.length });
      index = text.indexOf(normalizedQuery, index + Math.max(query.length, 1));
    }
  });

  return matches;
}

function buildSearchDecorations(doc: ProseMirrorNode, query: string, activeIndex: number) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return DecorationSet.empty;
  const decorations = getDocumentMatches(doc, trimmedQuery).map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class: index === activeIndex ? "search-match is-active" : "search-match",
    }),
  );
  return DecorationSet.create(doc, decorations);
}

function scrollEditorPositionIntoView(editor: Editor, position: number) {
  const scrollContainer = editor.view.dom.closest<HTMLElement>(".note-surface");
  if (!scrollContainer) return;
  const coords = editor.view.coordsAtPos(position);
  const containerRect = scrollContainer.getBoundingClientRect();
  const targetTop = scrollContainer.scrollTop + coords.top - containerRect.top - containerRect.height * 0.42;
  scrollContainer.scrollTo({
    top: Math.max(0, targetTop),
    behavior: "smooth",
  });
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

function handleEmptyTaskItemBackspace(view: EditorView, event: KeyboardEvent) {
  if (!isPlainDeleteKey(event, "Backspace")) return false;
  const { selection } = view.state;
  if (!selection.empty) return false;

  const item = findListItemAtSelection(selection.$from);
  if (!item || item.node.type.name !== "taskItem" || item.node.textContent.trim()) return false;

  event.preventDefault();
  deleteEmptyListItem(view, item, -1);
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

function isPlainDeleteKey(event: KeyboardEvent, key: "Backspace" | "Delete") {
  return event.key === key && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

type ListItemRange = {
  depth: number;
  from: number;
  node: ProseMirrorNode;
  parentDepth: number;
  parentFrom: number;
  parentNode: ProseMirrorNode;
};

function findListItemAtSelection($from: ResolvedPos): ListItemRange | null {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "listItem" && node.type.name !== "taskItem") continue;
    const parentDepth = depth - 1;
    return {
      depth,
      from: $from.before(depth),
      node,
      parentDepth,
      parentFrom: $from.before(parentDepth),
      parentNode: $from.node(parentDepth),
    };
  }
  return null;
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

function deleteEmptyListItem(view: EditorView, item: ListItemRange, bias: -1 | 1) {
  const removeParentList = item.parentNode.childCount === 1;
  const deleteFrom = removeParentList ? item.parentFrom : item.from;
  const deleteTo = deleteFrom + (removeParentList ? item.parentNode.nodeSize : item.node.nodeSize);
  const tr = view.state.tr.delete(deleteFrom, deleteTo);
  const near = Math.min(deleteFrom, tr.doc.content.size);
  view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(near), bias)).scrollIntoView());
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
  if (view.state.selection.empty || !event.clipboardData) return false;
  const slice = view.state.selection.content();
  const markdown = serializeClipboardFragment(slice.content).trimEnd();
  if (!markdown) return false;
  const html = markdownToHtml(markdown);

  event.preventDefault();
  event.clipboardData.setData("text/plain", markdown);
  event.clipboardData.setData("text/html", html);
  return true;
}

function serializeClipboardFragment(fragment: ProseMirrorFragment) {
  const blocks: string[] = [];
  fragment.forEach((node) => {
    const markdown = serializeClipboardNode(node, 0);
    if (markdown) blocks.push(markdown);
  });
  return normalizeMarkdownImageLines(blocks.join("\n\n")).trim();
}

function serializeClipboardNode(node: ProseMirrorNode, depth: number): string {
  const name = node.type.name;
  if (node.isText) return serializeTextNode(node);
  if (name === "image") return imageNodeToMarkdown(node);
  if (name === "paragraph") return serializeInlineContent(node).trim();
  if (name === "heading") return `${"#".repeat(Number(node.attrs.level) || 1)} ${serializeInlineContent(node).trim()}`.trim();
  if (name === "blockquote") {
    return serializeBlockContent(node, depth)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (name === "codeBlock") {
    const language = typeof node.attrs.language === "string" ? node.attrs.language : "";
    return `\`\`\`${language}\n${node.textContent}\n\`\`\``;
  }
  if (name === "horizontalRule") return "---";
  if (name === "bulletList" || name === "orderedList" || name === "taskList") return serializeClipboardList(node, depth);
  if (name === "listItem" || name === "taskItem") return serializeBlockContent(node, depth);
  return serializeBlockContent(node, depth);
}

function serializeClipboardList(list: ProseMirrorNode, depth: number) {
  const lines: string[] = [];
  const isOrdered = list.type.name === "orderedList";
  const isTask = list.type.name === "taskList";
  const start = Number(list.attrs.start) || 1;
  list.forEach((item, _offset, index) => {
    const prefix = isTask
      ? `- [${item.attrs.checked ? "x" : " "}] `
      : isOrdered
        ? `${start + index}. `
        : "- ";
    const content = serializeListItemContent(item, depth);
    if (!content.trim()) return;
    const [firstLine = "", ...rest] = content.split("\n");
    const indent = "  ".repeat(depth);
    lines.push(`${indent}${prefix}${firstLine}`);
    for (const line of rest) {
      lines.push(`${indent}  ${line}`);
    }
  });
  return lines.join("\n");
}

function serializeListItemContent(item: ProseMirrorNode, depth: number) {
  const parts: string[] = [];
  item.forEach((child) => {
    if (child.type.name === "bulletList" || child.type.name === "orderedList" || child.type.name === "taskList") {
      parts.push(serializeClipboardList(child, depth + 1));
      return;
    }
    const markdown = serializeClipboardNode(child, depth);
    if (markdown) parts.push(markdown);
  });
  return parts.join("\n");
}

function serializeBlockContent(node: ProseMirrorNode, depth: number) {
  const blocks: string[] = [];
  node.forEach((child) => {
    const markdown = serializeClipboardNode(child, depth);
    if (markdown) blocks.push(markdown);
  });
  return blocks.join("\n\n");
}

function serializeInlineContent(node: ProseMirrorNode) {
  const parts: string[] = [];
  node.forEach((child) => {
    parts.push(serializeInlineNode(child));
  });
  return parts.join("");
}

function serializeInlineNode(node: ProseMirrorNode): string {
  if (node.isText) return serializeTextNode(node);
  if (node.type.name === "image") return imageNodeToMarkdown(node);
  return serializeInlineContent(node);
}

function serializeTextNode(node: ProseMirrorNode) {
  let value = node.text ?? "";
  for (const mark of node.marks) {
    if (mark.type.name === "bold") value = `**${value}**`;
    else if (mark.type.name === "italic") value = `*${value}*`;
    else if (mark.type.name === "strike") value = `~~${value}~~`;
    else if (mark.type.name === "code") value = `\`${value}\``;
    else if (mark.type.name === "link") value = `[${value}](${mark.attrs.href ?? ""})`;
  }
  return value;
}

function imageNodeToMarkdown(node: ProseMirrorNode) {
  const src = (node.attrs.markdownSrc as string | null) ?? (node.attrs.src as string | null) ?? "";
  const alt = (node.attrs.alt as string | null) ?? "Image";
  const width = node.attrs.width as number | string | null;
  if (width) {
    return `<img src="${escapeMarkdownAttribute(src)}" alt="${escapeMarkdownAttribute(alt)}" width="${String(width)}" />`;
  }
  return `![${alt}](${src})`;
}

function escapeMarkdownAttribute(value: string) {
  return value.replace(/"/g, "&quot;");
}

export function isInternalNotebookHref(href: string) {
  if (!href) return false;
  if (/^(?:[a-z][a-z0-9+.-]*:)/i.test(href)) return false; // any scheme: http, mailto, lumen-note, etc.
  if (href.startsWith("//")) return false;
  if (href.startsWith("#")) return false;
  return true;
}

export function decodeInternalHref(href: string) {
  try {
    return decodeURI(href);
  } catch {
    return href;
  }
}

function getSelectedText(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) return "";
  return editor.state.doc.textBetween(from, to, "\n", "\n");
}

function resolveNotebookImageSrc(workspace: string, src: string) {
  if (!workspace || !isTauri() || isExternalImageSrc(src) || src.startsWith("data:")) return src;
  const relative = src.replace(/^\.?\//, "");
  return convertFileSrc(`${workspace}/${relative}`);
}

function isExternalImageSrc(src: string) {
  return /^(https?:|asset:|blob:|file:)/i.test(src);
}

function isRenderableImageType(type: string) {
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(type);
}

function getClipboardImageFile(data: DataTransfer | null) {
  const files = Array.from(data?.files ?? []).filter((file) => file.type.startsWith("image/"));
  const file = files.find((entry) => isRenderableImageType(entry.type)) ?? files[0];
  if (file) return file;

  const items = Array.from(data?.items ?? []).filter((item) => item.type.startsWith("image/"));
  const item = items.find((entry) => isRenderableImageType(entry.type)) ?? items[0];
  return item?.getAsFile() ?? null;
}

function getClipboardImageFromHtml(data: DataTransfer | null) {
  const html = data?.getData("text/html");
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const src = doc.querySelector("img")?.getAttribute("src") ?? "";
  if (!src.startsWith("data:image/")) return null;
  return dataUrlToFile(src);
}

function mayContainAsyncClipboardImage(data: DataTransfer | null) {
  return Array.from(data?.types ?? []).some((type) => type.startsWith("image/"));
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

function dataUrlToFile(dataUrl: string) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1] || "image/png";
  const encoded = match[3] || "";
  const binary = match[2] ? atob(encoded) : decodeURIComponent(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], `pasted-image.${extensionForImageType(mimeType)}`, { type: mimeType });
}

function blobToFile(blob: Blob, type: string) {
  return new File([blob], `pasted-image.${extensionForImageType(type)}`, { type });
}

function extensionForImageType(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/svg+xml") return "svg";
  return type.split("/").at(1)?.replace(/\W+/g, "-") || "png";
}

async function insertImageFile(view: EditorView, workspace: string, file: File) {
  const src = await saveAsset(workspace, file);
  const previewSrc = await previewSrcForNotebookImage(workspace, src);
  insertSavedImage(view, previewSrc, src, file.name || "Pasted image");
}

async function insertNativeClipboardImage(view: EditorView, workspace: string) {
  const src = await saveClipboardImageAsset(workspace);
  const previewSrc = await previewSrcForNotebookImage(workspace, src);
  insertSavedImage(view, previewSrc, src, "Pasted image");
}

function insertSavedImage(view: EditorView, previewSrc: string, markdownSrc: string, name: string) {
  const imageType = view.state.schema.nodes.image;
  if (!imageType) return;
  const node = imageType.create({
    src: previewSrc,
    alt: name,
    markdownSrc,
  });
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  view.focus();
}

async function previewSrcForNotebookImage(workspace: string, src: string) {
  if (!workspace || !isTauri() || isExternalImageSrc(src) || src.startsWith("data:")) return src;
  return readAssetDataUrl(workspace, src);
}

async function hydrateNotebookImageNodes(editor: Editor, workspace: string) {
  if (!workspace || !isTauri()) return;
  const pending: Array<{ attrs: Record<string, unknown>; pos: number; src: string }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "image") return;
    const markdownSrc = typeof node.attrs.markdownSrc === "string" ? node.attrs.markdownSrc : "";
    if (!markdownSrc || isExternalImageSrc(markdownSrc) || markdownSrc.startsWith("data:")) return;
    if (typeof node.attrs.src === "string" && node.attrs.src.startsWith("data:")) return;
    pending.push({ attrs: node.attrs, pos, src: markdownSrc });
  });

  if (!pending.length) return;

  const resolved = await Promise.all(
    pending.map(async (item) => ({
      ...item,
      previewSrc: await previewSrcForNotebookImage(workspace, item.src).catch(() => null),
    })),
  );

  const tr = editor.state.tr;
  let changed = false;
  for (const item of resolved) {
    if (!item.previewSrc) continue;
    const node = tr.doc.nodeAt(item.pos);
    if (!node || node.type.name !== "image") continue;
    tr.setNodeMarkup(item.pos, undefined, { ...item.attrs, src: item.previewSrc, markdownSrc: item.src });
    changed = true;
  }
  if (changed) editor.view.dispatch(tr);
}

function findSlashQuery(editor: NonNullable<ReturnType<typeof useEditor>>) {
  const { state } = editor;
  const { from } = state.selection;
  if (state.selection.$from.parent.type.name !== "paragraph") return null;
  const textBefore = state.doc.textBetween(Math.max(0, from - 48), from, "\n", "\0");
  const match = /(?:^|\s)\/([a-z0-9 -]*)$/i.exec(textBefore);
  if (!match) return null;
  const query = match[1] ?? "";
  const slashLength = query.length + 1;
  return {
    query,
    range: {
      from: from - slashLength,
      to: from,
    },
  };
}
