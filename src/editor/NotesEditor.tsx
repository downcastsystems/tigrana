import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Extension, InputRule, PasteRule } from "@tiptap/core";
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
import { DOMSerializer, type Fragment as ProseMirrorFragment, type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, CellSelection, deleteColumn, deleteRow, TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet, type EditorProps, type EditorView, type NodeView, type ViewMutationRecord } from "@tiptap/pm/view";
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
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Menu,
  Plus,
  Quote,
  Search,
  Scissors,
  Strikethrough,
  Trash2,
  X,
} from "lucide-react";
import { common, createLowlight } from "lowlight";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureParagraphAfterCurrentTable, filterSlashCommands, markCurrentTableAsTigranaHtml } from "./slashCommands";
import { createDeferredCommit, type DeferredCommit } from "../lib/deferredCommit";
import { emojiShortcodeToText } from "../lib/emoji";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown";
import { isTauri, openExternal } from "../lib/desktop";
import { notebookStorage } from "../lib/notebookStorage";
import type { NotePositionMetadata } from "../types";

const { readAssetDataUrl, saveAsset, saveClipboardImageAsset } = notebookStorage;

type NotesEditorProps = {
  content: string;
  commandRequest?: EditorCommandRequest | null;
  focusRequest: number;
  focusAtEndRequest: number;
  findRequest: number;
  reloadRequest?: number;
  notePath: string | null;
  restorePosition: NotePositionMetadata | null;
  editable: boolean;
  spellcheckEnabled: boolean;
  workspace: string;
  onChange: (markdown: string, sourceNotePath: string | null) => void;
  onPendingChange: (change: PendingEditorChange | null) => void;
  onLoadError: (error: unknown) => void;
  onPositionChange: (position: { selectedText: string; selectionFrom: number; selectionTo: number }) => void;
  onInternalLinkClick?: (href: string) => void;
  onRequestEmoji?: () => Promise<string | null>;
  onRequestLink?: () => Promise<{ href: string; title: string } | null>;
  onRequestImage?: () => Promise<{ src: string; alt?: string } | null>;
};

export type EditorMarkdownSnapshot = {
  markdown: string;
  sourceNotePath: string | null;
};

export type PendingEditorChange = {
  flush(): EditorMarkdownSnapshot | null;
};

export type EditorCommand =
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

type EditableEditor = {
  setEditable(editable: boolean, emitUpdate?: boolean): void;
};

type SpellcheckEditor = {
  options: { editorProps?: EditorProps };
  setOptions(options: { editorProps: EditorProps }): void;
};

// Tiptap emits an `update` event by default when editability changes. The
// document can still belong to the previous note at that point, so changing
// read-only state must not look like a user edit.
export function setEditorEditableSilently(editor: EditableEditor | null, editable: boolean) {
  editor?.setEditable(editable, false);
}

// Update the editor through Tiptap so ProseMirror retains the attribute across
// view redraws. This only runs when the preference changes, never while typing.
export function setEditorSpellcheck(editor: SpellcheckEditor | null, enabled: boolean) {
  if (!editor) return;
  const editorProps = editor.options.editorProps ?? {};
  const currentAttributes = editorProps.attributes;
  const spellcheck = enabled ? "true" : "false";
  editor.setOptions({
    editorProps: {
      ...editorProps,
      attributes: typeof currentAttributes === "function"
        ? (state) => ({ ...currentAttributes(state), spellcheck })
        : { ...currentAttributes, spellcheck },
    },
  });
}

export type EditorCommandRequest = {
  id: number;
  command: EditorCommand;
  src?: string;
  alt?: string;
  selectionFrom?: number;
  selectionTo?: number;
};

type SlashState = {
  range: Range;
  query: string;
  selected: number;
};

const lowlight = createLowlight(common);
const searchHighlightKey = new PluginKey<SearchHighlightState>("searchHighlight");
const notebookImagePreviewCache = new Map<string, string>();
const markdownCommitDelayMs = 80;

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

const EmojiText = Extension.create({
  name: "emojiText",

  addInputRules() {
    return [
      new InputRule({
        find: /:([a-zA-Z0-9_+-]+):$/,
        handler: ({ state, range, match }) => {
          const emoji = emojiShortcodeToText(match[1] ?? "");
          if (!emoji) return null;
          state.tr.insertText(emoji, range.from, range.to);
          return undefined;
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      new PasteRule({
        find: /:([a-zA-Z0-9_+-]+):/g,
        handler: ({ state, range, match }) => {
          const emoji = emojiShortcodeToText(match[1] ?? "");
          if (!emoji) return null;
          state.tr.insertText(emoji, range.from, range.to);
          return undefined;
        },
      }),
    ];
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
  editor,
  getPos,
  node,
  updateAttributes,
}: {
  editor: Editor;
  getPos: () => number;
  node: ProseMirrorNode;
  updateAttributes: (attrs: Record<string, unknown>) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [blockCopied, setBlockCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const language = (node.attrs.language as string | null) ?? "";

  useEffect(() => {
    if (!menuOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (toolsRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [menuOpen]);

  const resolvePos = () => {
    const pos = getPos();
    return typeof pos === "number" ? pos : null;
  };

  const selectCodeBlock = () => {
    const pos = resolvePos();
    if (pos == null) return;
    const { state, view } = editor;
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView());
    view.focus();
  };

  const deleteCodeBlock = () => {
    const pos = resolvePos();
    const paragraph = editor.state.schema.nodes.paragraph;
    if (pos == null || !paragraph) return;

    const { state, view } = editor;
    const blockTo = pos + node.nodeSize;
    let tr = state.tr;

    if (state.doc.childCount === 1) {
      tr = tr.replaceWith(pos, blockTo, paragraph.create());
      tr = tr.setSelection(TextSelection.create(tr.doc, Math.min(pos + 1, tr.doc.content.size)));
    } else {
      tr = tr.delete(pos, blockTo);
      const selectionPos = Math.min(pos, tr.doc.content.size);
      tr = tr.setSelection(Selection.near(tr.doc.resolve(selectionPos), -1));
    }

    view.dispatch(tr.scrollIntoView());
    view.focus();
    setMenuOpen(false);
  };

  const copyCodeBlockSection = async () => {
    const serialized = DOMSerializer.fromSchema(editor.state.schema).serializeNode(node);
    const container = document.createElement("div");
    container.appendChild(serialized);
    const html = normalizeTableClipboardHtml(container.innerHTML).trim();
    const markdown = htmlToMarkdown(html).trimEnd();
    await writeRichClipboard(html || markdownToHtml(markdown), markdown);
  };

  const handleCopySection = () => {
    void copyCodeBlockSection().then(() => {
      setBlockCopied(true);
      window.setTimeout(() => setBlockCopied(false), 1200);
    }).catch((error) => {
      console.error("Failed to copy code block", error);
    });
  };

  const handleCutSection = () => {
    void copyCodeBlockSection().then(() => {
      deleteCodeBlock();
    }).catch((error) => {
      console.error("Failed to cut code block", error);
    });
  };

  const insertParagraphNearBlock = (placement: "before" | "after") => {
    const pos = resolvePos();
    if (pos == null) return;
    const { state, view } = editor;
    const paragraph = state.schema.nodes.paragraph;
    if (!paragraph) return;
    const insertPos = placement === "before" ? pos : pos + node.nodeSize;
    const tr = state.tr.insert(insertPos, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1)).scrollIntoView();
    view.dispatch(tr);
    view.focus();
    setMenuOpen(false);
  };

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
    <NodeViewWrapper as="div" className={`code-block-node-view${menuOpen ? " is-active" : ""}`}>
      <div
        ref={toolsRef}
        className="code-block-side-tools"
        contentEditable={false}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <div className="code-block-menu-wrap">
          <button
            type="button"
            className="code-block-tool-button"
            title="Code block options"
            aria-label="Code block options"
            aria-expanded={menuOpen}
            onClick={() => {
              selectCodeBlock();
              setMenuOpen((value) => !value);
            }}
          >
            <Menu size={16} />
          </button>
          {menuOpen ? (
            <div className="code-block-context-menu">
              <button type="button" onClick={handleCopySection}>
                {blockCopied ? <Check size={14} /> : <Copy size={14} />}
                <span>{blockCopied ? "Copied" : "Copy code block"}</span>
              </button>
              <button type="button" onClick={handleCutSection}>
                <Scissors size={14} />
                <span>Cut code block</span>
              </button>
              <button type="button" onClick={() => insertParagraphNearBlock("before")}>
                <Plus size={14} />
                <span>Add line above</span>
              </button>
              <button type="button" onClick={() => insertParagraphNearBlock("after")}>
                <Plus size={14} />
                <span>Add line below</span>
              </button>
              <button type="button" className="danger-item" onClick={deleteCodeBlock}>
                <Trash2 size={14} />
                <span>Delete code block</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <pre className="code-block">
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
      </pre>
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

type NodeViewGetPos = (() => number | undefined) | boolean;
type TableAxis = "row" | "column";
type ResizeState = {
  startX: number;
  columnIndex: number;
  widths: number[];
};

const RICH_TABLE_DEFAULT_COLUMN_WIDTH = 180;
const RICH_TABLE_MIN_COLUMN_WIDTH = 96;

function isRichTableNode(node: ProseMirrorNode) {
  return node.attrs.tigranaTable === true;
}

function parseCellColwidth(element: HTMLElement) {
  const colwidth = element.getAttribute("colwidth");
  const value = colwidth ? colwidth.split(",").map((width) => parseInt(width, 10)).filter(Number.isFinite) : null;
  if (value?.length) return value;

  const cols = element.closest("table")?.querySelectorAll("colgroup > col");
  const cellIndex = Array.from(element.parentElement?.children ?? []).indexOf(element);
  const col = cellIndex >= 0 ? cols?.[cellIndex] : null;
  const raw =
    col?.getAttribute("data-width") ??
    col?.getAttribute("width") ??
    (/width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(col?.getAttribute("style") ?? "")?.[1] ?? null);
  const width = raw ? Math.round(Number(raw)) : null;
  return width && Number.isFinite(width) ? [width] : null;
}

class TableControlsNodeView implements NodeView {
  node: ProseMirrorNode;
  cellMinWidth: number;
  view: EditorView;
  getPos: NodeViewGetPos;
  dom: HTMLDivElement;
  table: HTMLTableElement;
  colgroup: HTMLTableColElement;
  contentDOM: HTMLTableSectionElement;
  rowHandle: HTMLButtonElement;
  columnHandle: HTMLButtonElement;
  addColumnEdgeButton: HTMLButtonElement;
  addRowEdgeButton: HTMLButtonElement;
  resizeLayer: HTMLDivElement;
  axisMenu: HTMLDivElement | null = null;
  selectionOverlay: HTMLDivElement;
  copiedTimer: number | null = null;
  selectionActive = false;
  hoveredRow: number | null = null;
  hoveredColumn: number | null = null;
  selectedRowRange: { start: number; end: number } | null = null;
  selectedColumnRange: { start: number; end: number } | null = null;
  addRowButtonHovered = false;
  addColumnButtonHovered = false;
  pendingRowMenu: { index: number; anchorRect: DOMRect } | null = null;
  pendingColumnMenu: { index: number; anchorRect: DOMRect } | null = null;
  resizeState: ResizeState | null = null;
  isOpeningAxisMenu = false;
  wrapperResizeObserver: ResizeObserver | null = null;

  constructor(node: ProseMirrorNode, cellMinWidth: number, view: EditorView, getPos: NodeViewGetPos) {
    this.node = node;
    this.cellMinWidth = cellMinWidth;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement("div");
    this.dom.className = "tableWrapper table-node-view";

    this.table = this.dom.appendChild(document.createElement("table"));
    this.dom.classList.toggle("is-rich-table", isRichTableNode(node));
    if (node.attrs.style) {
      this.table.style.cssText = String(node.attrs.style);
    }
    this.colgroup = this.table.appendChild(document.createElement("colgroup"));
    updateTableColumns(node, this.colgroup, this.table, cellMinWidth);
    this.contentDOM = this.table.appendChild(document.createElement("tbody"));
    this.applyRichTableLayout();
    this.rowHandle = this.dom.appendChild(createTableToolButton("Row options", tableIconSvg("ellipsisVertical", 16)));
    this.rowHandle.classList.add("table-axis-handle", "table-row-handle");
    this.rowHandle.contentEditable = "false";
    this.isOpeningAxisMenu = false;
    this.rowHandle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const raw = this.rowHandle.dataset.targetRow;
      const row = raw == null || raw === "" ? null : Number(raw);
      if (row == null || !Number.isFinite(row)) {
        this.pendingRowMenu = null;
        return;
      }
      this.pendingRowMenu = {
        index: row,
        anchorRect: this.rowHandle.getBoundingClientRect(),
      };
      this.isOpeningAxisMenu = true;
      this.armPendingMenuSafetyReset();
    });
    this.rowHandle.addEventListener("mouseenter", this.keepAxisHandlesVisible);
    this.rowHandle.addEventListener("mouseleave", this.handleAxisHandleLeave);
    this.rowHandle.addEventListener("click", () => {
      const pending = this.pendingRowMenu;
      this.pendingRowMenu = null;
      if (!pending) {
        this.isOpeningAxisMenu = false;
        return;
      }
      this.hoveredRow = pending.index;
      this.selectRow(pending.index, { preserveHandlePosition: true });
      this.openAxisMenu("row", pending.index, pending.anchorRect);
      window.requestAnimationFrame(() => {
        this.isOpeningAxisMenu = false;
      });
    });

    this.columnHandle = this.dom.appendChild(createTableToolButton("Column options", tableIconSvg("ellipsis", 16)));
    this.columnHandle.classList.add("table-axis-handle", "table-column-handle");
    this.columnHandle.contentEditable = "false";
    this.columnHandle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const raw = this.columnHandle.dataset.targetColumn;
      const column = raw == null || raw === "" ? null : Number(raw);
      if (column == null || !Number.isFinite(column)) {
        this.pendingColumnMenu = null;
        return;
      }
      this.pendingColumnMenu = {
        index: column,
        anchorRect: this.columnHandle.getBoundingClientRect(),
      };
      this.isOpeningAxisMenu = true;
      this.armPendingMenuSafetyReset();
    });
    this.columnHandle.addEventListener("mouseenter", this.keepAxisHandlesVisible);
    this.columnHandle.addEventListener("mouseleave", this.handleAxisHandleLeave);
    this.columnHandle.addEventListener("click", () => {
      const pending = this.pendingColumnMenu;
      this.pendingColumnMenu = null;
      if (!pending) {
        this.isOpeningAxisMenu = false;
        return;
      }
      this.hoveredColumn = pending.index;
      this.selectColumn(pending.index, { preserveHandlePosition: true });
      this.openAxisMenu("column", pending.index, pending.anchorRect);
      window.requestAnimationFrame(() => {
        this.isOpeningAxisMenu = false;
      });
    });

    this.addColumnEdgeButton = this.dom.appendChild(createTableToolButton("Add column", tableIconSvg("plus", 14)));
    this.addColumnEdgeButton.classList.add("table-edge-add", "table-edge-add-column");
    this.addColumnEdgeButton.contentEditable = "false";
    this.addColumnEdgeButton.addEventListener("mousedown", this.stopToolEvent);
    this.addColumnEdgeButton.addEventListener("click", () => this.addColumnToEnd());
    this.addColumnEdgeButton.addEventListener("mouseenter", () => {
      this.addColumnButtonHovered = true;
      this.positionEdgeButtons();
    });
    this.addColumnEdgeButton.addEventListener("mouseleave", () => {
      this.addColumnButtonHovered = false;
      this.positionEdgeButtons();
    });

    this.addRowEdgeButton = this.dom.appendChild(createTableToolButton("Add row", tableIconSvg("plus", 14)));
    this.addRowEdgeButton.classList.add("table-edge-add", "table-edge-add-row");
    this.addRowEdgeButton.contentEditable = "false";
    this.addRowEdgeButton.addEventListener("mousedown", this.stopToolEvent);
    this.addRowEdgeButton.addEventListener("click", () => this.addRowToBottom());
    this.addRowEdgeButton.addEventListener("mouseenter", () => {
      this.addRowButtonHovered = true;
      this.positionEdgeButtons();
    });
    this.addRowEdgeButton.addEventListener("mouseleave", () => {
      this.addRowButtonHovered = false;
      this.positionEdgeButtons();
    });

    this.selectionOverlay = this.dom.appendChild(document.createElement("div"));
    this.selectionOverlay.className = "table-selection-overlay";
    this.selectionOverlay.contentEditable = "false";

    this.resizeLayer = this.dom.appendChild(document.createElement("div"));
    this.resizeLayer.className = "table-resize-layer";
    this.resizeLayer.contentEditable = "false";
    this.resizeLayer.addEventListener("mousedown", this.stopToolEvent);
    this.dom.addEventListener("mousemove", this.handleMouseMove);
    this.dom.addEventListener("mouseleave", this.handleMouseLeave);
    this.view.dom.addEventListener("keyup", this.refreshSelectionActive);
    this.view.dom.addEventListener("mouseup", this.refreshSelectionActive);
    this.view.dom.addEventListener("mousedown", this.refreshSelectionActive);
    window.addEventListener("selectionchange", this.refreshSelectionActive);
    // The edge buttons, resize handles, and selection overlay are positioned
    // in absolute pixel coordinates; when the wrapper resizes (window resize,
    // editor width change, splitter drag) those positions go stale until the
    // next mouseover. Observe the wrapper and refresh chrome immediately.
    if (typeof ResizeObserver !== "undefined") {
      this.wrapperResizeObserver = new ResizeObserver(() => {
        this.applyRichTableLayout();
        this.positionEdgeButtons();
        this.renderResizeHandles();
        this.updateSelectionOverlay();
      });
      this.wrapperResizeObserver.observe(this.dom);
    }
    window.setTimeout(() => {
      this.refreshSelectionActive();
      this.positionEdgeButtons();
      this.renderResizeHandles();
    });
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    updateTableColumns(node, this.colgroup, this.table, this.cellMinWidth);
    this.applyRichTableLayout();
    this.dom.classList.toggle("is-rich-table", isRichTableNode(node));
    this.positionEdgeButtons();
    this.renderResizeHandles();
    this.refreshSelectionActive();
    this.updateSelectionOverlay();
    return true;
  }

  selectNode() {
    this.dom.classList.add("is-active");
  }

  deselectNode() {
    if (!this.axisMenu) this.dom.classList.remove("is-active");
  }

  destroy() {
    this.rowHandle.removeEventListener("mousedown", this.stopToolEvent);
    this.columnHandle.removeEventListener("mousedown", this.stopToolEvent);
    this.rowHandle.removeEventListener("mouseenter", this.keepAxisHandlesVisible);
    this.rowHandle.removeEventListener("mouseleave", this.handleAxisHandleLeave);
    this.columnHandle.removeEventListener("mouseenter", this.keepAxisHandlesVisible);
    this.columnHandle.removeEventListener("mouseleave", this.handleAxisHandleLeave);
    this.addColumnEdgeButton.removeEventListener("mousedown", this.stopToolEvent);
    this.addRowEdgeButton.removeEventListener("mousedown", this.stopToolEvent);
    this.resizeLayer.removeEventListener("mousedown", this.stopToolEvent);
    this.dom.removeEventListener("mousemove", this.handleMouseMove);
    this.dom.removeEventListener("mouseleave", this.handleMouseLeave);
    this.view.dom.removeEventListener("keyup", this.refreshSelectionActive);
    this.view.dom.removeEventListener("mouseup", this.refreshSelectionActive);
    this.view.dom.removeEventListener("mousedown", this.refreshSelectionActive);
    window.removeEventListener("selectionchange", this.refreshSelectionActive);
    window.removeEventListener("pointermove", this.handleResizePointerMove);
    window.removeEventListener("pointerup", this.handleResizePointerUp);
    this.removeOutsideListeners();
    this.wrapperResizeObserver?.disconnect();
    this.wrapperResizeObserver = null;
    if (this.copiedTimer !== null) window.clearTimeout(this.copiedTimer);
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    const target = mutation.target as Node;
    const isInsideWrapper = this.dom.contains(target);
    const isInsideContent = this.contentDOM.contains(target);

    if (isInsideWrapper && !isInsideContent) {
      return mutation.type === "attributes" || mutation.type === "childList" || mutation.type === "characterData";
    }

    return false;
  }

  stopToolEvent = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  handleOutsideMouseDown = (event: MouseEvent) => {
    if (this.axisMenu?.contains(event.target as Node)) return;
    this.closeAxisMenu();
  };

  handleOutsideKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      this.closeAxisMenu();
    }
  };

  refreshSelectionActive = () => {
    const pos = this.resolvePos();
    if (pos == null) {
      this.selectionActive = false;
      this.selectedRowRange = null;
      this.selectedColumnRange = null;
      if (!this.axisMenu) this.dom.classList.remove("is-active");
      this.updateSelectionOverlay();
      this.positionEdgeButtons();
      return;
    }

    const { from, to } = this.view.state.selection;
    this.selectionActive = from >= pos && to <= pos + this.node.nodeSize;
    if (this.selectionActive || this.axisMenu) {
      this.dom.classList.add("is-active");
    } else {
      this.dom.classList.remove("is-active");
    }

    this.computeSelectedRanges();
    this.updateSelectionOverlay();
    this.positionEdgeButtons();
    this.applyHandleVisibility();

    if (this.isOpeningAxisMenu) return;

    const selectedCell = this.findSelectionCellElement();
    if (selectedCell && this.hoveredRow == null && this.hoveredColumn == null) {
      // Only reposition handles from selection state when we don't already
      // have a hover-driven position; otherwise hover wins and stays put.
      const row = selectedCell.parentElement as HTMLTableRowElement | null;
      const rowIndex = row ? Array.from(this.table.rows).indexOf(row) : -1;
      if (rowIndex >= 0 && selectedCell.cellIndex >= 0) {
        this.positionAxisHandles(selectedCell, rowIndex, selectedCell.cellIndex);
      }
    }
  };

  computeSelectedRanges() {
    const { selection } = this.view.state;
    if (!(selection instanceof CellSelection)) {
      this.selectedRowRange = null;
      this.selectedColumnRange = null;
      return;
    }
    const map = TableMap.get(this.node);
    let rowStart = Infinity;
    let rowEnd = -Infinity;
    let colStart = Infinity;
    let colEnd = -Infinity;
    selection.forEachCell((_cell, cellPos) => {
      const tablePos = this.resolvePos();
      if (tablePos == null) return;
      const rel = cellPos - tablePos - 1;
      const idx = map.map.indexOf(rel);
      if (idx < 0) return;
      const row = Math.floor(idx / map.width);
      const col = idx % map.width;
      rowStart = Math.min(rowStart, row);
      rowEnd = Math.max(rowEnd, row);
      colStart = Math.min(colStart, col);
      colEnd = Math.max(colEnd, col);
    });
    if (!Number.isFinite(rowStart) || !Number.isFinite(colStart)) {
      this.selectedRowRange = null;
      this.selectedColumnRange = null;
      return;
    }
    this.selectedRowRange = { start: rowStart, end: rowEnd };
    this.selectedColumnRange = { start: colStart, end: colEnd };
  }

  updateSelectionOverlay = () => {
    const { selection } = this.view.state;
    if (!(selection instanceof CellSelection) || !this.selectionActive) {
      this.selectionOverlay.classList.remove("is-visible");
      return;
    }
    const cells: HTMLTableCellElement[] = [];
    selection.forEachCell((_node, cellPos) => {
      try {
        const dom = this.view.nodeDOM(cellPos);
        if (dom instanceof HTMLTableCellElement) cells.push(dom);
      } catch {
        // ignore
      }
    });
    if (!cells.length) {
      this.selectionOverlay.classList.remove("is-visible");
      return;
    }
    const domRect = this.dom.getBoundingClientRect();
    let top = Infinity;
    let bottom = -Infinity;
    let left = Infinity;
    let right = -Infinity;
    cells.forEach((cell) => {
      const rect = cell.getBoundingClientRect();
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    });
    this.selectionOverlay.style.top = `${top - domRect.top}px`;
    this.selectionOverlay.style.left = `${left - domRect.left}px`;
    this.selectionOverlay.style.width = `${Math.max(0, right - left)}px`;
    this.selectionOverlay.style.height = `${Math.max(0, bottom - top)}px`;
    this.selectionOverlay.classList.add("is-visible");
  };

  armPendingMenuSafetyReset() {
    // If mousedown captured a pending menu but click never fires (e.g. the
    // user drags off the button before releasing), clear the captured state
    // so future selection refreshes can reposition the handle normally.
    const onUp = () => {
      window.removeEventListener("mouseup", onUp, true);
      // The click event fires after mouseup; defer cleanup until after that
      // so a successful click can consume the pending state first.
      window.setTimeout(() => {
        this.pendingRowMenu = null;
        this.pendingColumnMenu = null;
        if (!this.axisMenu) this.isOpeningAxisMenu = false;
      }, 0);
    };
    window.addEventListener("mouseup", onUp, true);
  }

  applyRichTableLayout() {
    if (!isRichTableNode(this.node)) {
      this.table.classList.remove("rich-table-fluid");
      return;
    }
    // Force the table to fill its container. Pixel col widths from
    // updateTableColumns would otherwise force the table wider than the
    // container under table-layout:fixed; convert them into percentages so
    // the columns always proportionally fill 100% of the available width.
    this.table.classList.add("rich-table-fluid");
    this.table.style.width = "100%";
    this.table.style.minWidth = "";
    const cols = Array.from(this.colgroup.children) as HTMLTableColElement[];
    if (!cols.length) return;
    const pxWidths = cols.map((col) => {
      const raw = col.style.width || col.getAttribute("data-width") || "";
      const w = parseFloat(raw);
      return Number.isFinite(w) && w > 0 ? w : null;
    });
    let totalKnown = 0;
    let knownCount = 0;
    for (const w of pxWidths) {
      if (w != null) {
        totalKnown += w;
        knownCount += 1;
      }
    }
    const avg = knownCount > 0 ? totalKnown / knownCount : RICH_TABLE_DEFAULT_COLUMN_WIDTH;
    const widths = pxWidths.map((w) => w ?? avg);
    const total = widths.reduce((sum, w) => sum + w, 0) || widths.length;
    cols.forEach((col, index) => {
      const pct = (widths[index] / total) * 100;
      col.style.width = `${pct}%`;
      col.style.minWidth = "";
    });
  }

  findSelectionCellElement() {
    const { selection } = this.view.state;
    const domAtSelection = this.view.domAtPos(selection.from).node;
    const element = domAtSelection instanceof Element ? domAtSelection : domAtSelection.parentElement;
    const cell = element?.closest("td, th") as HTMLTableCellElement | null;
    return cell && this.table.contains(cell) ? cell : null;
  }

  resolvePos() {
    if (typeof this.getPos !== "function") return null;
    const pos = this.getPos();
    return typeof pos === "number" ? pos : null;
  }

  handleMouseMove = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    if (
      event.target.closest(".table-axis-handle") ||
      event.target.closest(".table-edge-add") ||
      event.target.closest(".table-context-menu") ||
      event.target.closest(".table-column-resize-handle")
    ) {
      this.keepAxisHandlesVisible();
      this.positionEdgeButtons();
      return;
    }

    const cell = event.target.closest("td, th") as HTMLTableCellElement | null;
    if (!cell || !this.table.contains(cell)) {
      return;
    }

    const row = cell.parentElement as HTMLTableRowElement | null;
    const rowIndex = row ? Array.from(this.table.rows).indexOf(row) : -1;
    const columnIndex = cell.cellIndex;
    if (rowIndex < 0 || columnIndex < 0) return;

    this.hoveredRow = rowIndex;
    this.hoveredColumn = columnIndex;
    this.positionAxisHandles(cell, rowIndex, columnIndex);
    this.positionEdgeButtons();
    this.renderResizeHandles();
  };

  handleMouseLeave = () => {
    if (this.axisMenu || this.resizeState) return;
    window.setTimeout(() => {
      if (this.dom.matches(":hover") || this.rowHandle.matches(":hover") || this.columnHandle.matches(":hover")) return;
      if (this.addRowButtonHovered || this.addColumnButtonHovered) return;
      if (this.selectionActive) return;
      this.hoveredRow = null;
      this.hoveredColumn = null;
      this.rowHandle.classList.remove("is-visible");
      this.columnHandle.classList.remove("is-visible");
      this.positionEdgeButtons();
    }, 450);
  };

  keepAxisHandlesVisible = () => {
    // Just re-run the gating; the per-handle :hover branches keep whichever
    // handle the user is on, without re-showing the gated-off one.
    this.applyHandleVisibility();
  };

  handleAxisHandleLeave = () => {
    window.setTimeout(() => {
      if (this.dom.matches(":hover") || this.rowHandle.matches(":hover") || this.columnHandle.matches(":hover") || this.axisMenu || this.selectionActive) return;
      this.rowHandle.classList.remove("is-visible");
      this.columnHandle.classList.remove("is-visible");
    }, 450);
  };

  positionAxisHandles(cell: HTMLTableCellElement, rowIndex: number, columnIndex: number) {
    const tableRect = this.table.getBoundingClientRect();
    const domRect = this.dom.getBoundingClientRect();
    const rowRect = this.table.rows[rowIndex]?.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    if (!rowRect) return;

    this.rowHandle.style.top = `${rowRect.top - domRect.top + Math.max((rowRect.height - 32) / 2, 0)}px`;
    // Mirror the column handle's overlap with the table top: the row handle
    // sits 20 px left of the table edge so its right edge laps 4 px over
    // the first column, matching the column handle's vertical placement.
    this.rowHandle.style.left = `${tableRect.left - domRect.left - 20}px`;
    this.rowHandle.dataset.targetRow = String(rowIndex);

    // Position the column handle to overlap the top of the table by a few
    // pixels rather than floating above it, so it doesn't crash into text or
    // a sibling block sitting directly above the table.
    this.columnHandle.style.top = `${tableRect.top - domRect.top - 20}px`;
    this.columnHandle.style.left = `${cellRect.left - domRect.left + Math.max((cellRect.width - 32) / 2, 0)}px`;
    this.columnHandle.dataset.targetColumn = String(columnIndex);

    this.rowHandle.setAttribute("aria-label", `Row ${rowIndex + 1} options`);
    this.columnHandle.setAttribute("aria-label", `Column ${columnIndex + 1} options`);

    this.applyHandleVisibility();
  }

  applyHandleVisibility() {
    // Notion-style gating: the row handle (left of the row) only shows when
    // the user is hovering or has the cursor in the FIRST column, and the
    // column handle (above the column) only shows when in the FIRST row.
    // A full-row or full-column selection (from clicking a handle) keeps
    // the relevant handle visible at the selected row/column.
    const map = TableMap.get(this.node);
    const lastRow = Math.max(0, map.height - 1);
    const lastCol = Math.max(0, map.width - 1);
    const rowRange = this.selectedRowRange;
    const colRange = this.selectedColumnRange;
    const isFullRowSelection =
      Boolean(rowRange && colRange && colRange.start === 0 && colRange.end === lastCol);
    const isFullColumnSelection =
      Boolean(rowRange && colRange && rowRange.start === 0 && rowRange.end === lastRow);
    const isRowSelection = isFullRowSelection && !isFullColumnSelection;
    const isColumnSelection = isFullColumnSelection && !isFullRowSelection;

    const rowFromHover = this.hoveredColumn === 0 && !isColumnSelection;
    const colFromHover = this.hoveredRow === 0 && !isRowSelection;
    const rowHandleHovered = this.rowHandle.matches(":hover");
    const columnHandleHovered = this.columnHandle.matches(":hover");

    const showRow = rowFromHover || isRowSelection || rowHandleHovered;
    const showCol = colFromHover || isColumnSelection || columnHandleHovered;

    this.rowHandle.classList.toggle("is-visible", showRow);
    this.columnHandle.classList.toggle("is-visible", showCol);
  }

  getRowIndexAtY(clientY: number) {
    const rows = Array.from(this.table.rows);
    if (!rows.length) return null;
    const exactIndex = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return clientY >= rect.top && clientY <= rect.bottom;
    });
    if (exactIndex >= 0) return exactIndex;

    let closestIndex = 0;
    let closestDistance = Infinity;
    rows.forEach((row, index) => {
      const rect = row.getBoundingClientRect();
      const distance = Math.abs(clientY - (rect.top + rect.height / 2));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    return closestIndex;
  }

  getColumnIndexAtX(clientX: number) {
    const firstRow = this.table.rows[0];
    if (!firstRow) return null;
    const cells = Array.from(firstRow.cells);
    if (!cells.length) return null;
    const exactIndex = cells.findIndex((cell) => {
      const rect = cell.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right;
    });
    if (exactIndex >= 0) return exactIndex;

    let closestIndex = 0;
    let closestDistance = Infinity;
    cells.forEach((cell, index) => {
      const rect = cell.getBoundingClientRect();
      const distance = Math.abs(clientX - (rect.left + rect.width / 2));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    return closestIndex;
  }

  positionEdgeButtons() {
    const tableRect = this.table.getBoundingClientRect();
    const domRect = this.dom.getBoundingClientRect();
    const map = TableMap.get(this.node);
    const lastRow = Math.max(0, map.height - 1);
    const lastCol = Math.max(0, map.width - 1);

    // A "full-row" selection (selecting an entire row) spans every column —
    // but the user isn't acting on the last column, so don't reveal the
    // add-column edge button in that case. Same for full-column selections
    // and the add-row button.
    const rowRange = this.selectedRowRange;
    const colRange = this.selectedColumnRange;
    const isFullRowSelection =
      Boolean(rowRange && colRange && colRange.start === 0 && colRange.end === lastCol && rowRange.end - rowRange.start < map.height - 1);
    const isFullColumnSelection =
      Boolean(rowRange && colRange && rowRange.start === 0 && rowRange.end === lastRow && colRange.end - colRange.start < map.width - 1);

    const cursorInLastRow = rowRange?.end === lastRow && !isFullColumnSelection;
    const cursorInLastCol = colRange?.end === lastCol && !isFullRowSelection;
    const hoverInLastRow = this.hoveredRow === lastRow;
    const hoverInLastCol = this.hoveredColumn === lastCol;

    const columnVisible =
      hoverInLastCol || cursorInLastCol || this.addColumnButtonHovered;
    const rowVisible =
      hoverInLastRow || cursorInLastRow || this.addRowButtonHovered;

    // Position the add-column button flush with the right edge of the table.
    // The CSS provides a transparent hover-bridge to the right of the table so
    // the cursor can travel from the last column to the button without losing
    // its hover position.
    this.addColumnEdgeButton.style.left = `${tableRect.right - domRect.left}px`;
    this.addColumnEdgeButton.style.top = `${tableRect.top - domRect.top}px`;
    this.addColumnEdgeButton.style.height = `${Math.max(tableRect.height, 42)}px`;
    this.addColumnEdgeButton.classList.toggle("is-visible", columnVisible);

    this.addRowEdgeButton.style.left = `${tableRect.left - domRect.left}px`;
    this.addRowEdgeButton.style.top = `${tableRect.bottom - domRect.top}px`;
    this.addRowEdgeButton.style.width = `${Math.max(tableRect.width, 120)}px`;
    this.addRowEdgeButton.classList.toggle("is-visible", rowVisible);
  }

  scheduleChromeRefresh() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        this.applyRichTableLayout();
        this.positionEdgeButtons();
        this.renderResizeHandles();
        this.computeSelectedRanges();
        this.updateSelectionOverlay();
      });
    });
  }

  renderResizeHandles() {
    this.resizeLayer.innerHTML = "";
    if (!isRichTableNode(this.node)) return;
    const firstRow = this.table.rows[0];
    if (!firstRow || firstRow.cells.length < 2) return;
    // Read boundaries from the actual rendered cells. The col widths are
    // stored as percentages (for fluid layout), so adding the numeric
    // values as pixels would put handles inside cells rather than at the
    // cell boundaries.
    const tableRect = this.table.getBoundingClientRect();
    const domRect = this.dom.getBoundingClientRect();
    const cells = Array.from(firstRow.cells);
    cells.slice(0, -1).forEach((cell, index) => {
      const cellRect = cell.getBoundingClientRect();
      const handle = this.resizeLayer.appendChild(document.createElement("button"));
      handle.type = "button";
      handle.className = "table-column-resize-handle";
      handle.title = "Resize column";
      handle.style.left = `${cellRect.right - domRect.left - 4}px`;
      handle.style.top = `${tableRect.top - domRect.top}px`;
      handle.style.height = `${Math.max(tableRect.height, 24)}px`;
      handle.addEventListener("pointerdown", (event) => this.startColumnResize(event, index));
    });
  }

  startColumnResize(event: PointerEvent, columnIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    this.resizeState = {
      startX: event.clientX,
      columnIndex,
      widths: this.getColumnWidths(),
    };
    this.dom.classList.add("is-resizing-table");
    window.addEventListener("pointermove", this.handleResizePointerMove);
    window.addEventListener("pointerup", this.handleResizePointerUp);
  }

  handleResizePointerMove = (event: PointerEvent) => {
    if (!this.resizeState) return;
    const widths = this.nextResizeWidths(event.clientX);
    this.applyVisualColumnWidths(widths);
  };

  handleResizePointerUp = (event: PointerEvent) => {
    if (!this.resizeState) return;
    const widths = this.nextResizeWidths(event.clientX);
    this.resizeState = null;
    this.dom.classList.remove("is-resizing-table");
    window.removeEventListener("pointermove", this.handleResizePointerMove);
    window.removeEventListener("pointerup", this.handleResizePointerUp);
    this.commitColumnWidths(widths);
  };

  nextResizeWidths(clientX: number) {
    const state = this.resizeState;
    if (!state) return this.getColumnWidths();
    const widths = [...state.widths];
    const idx = state.columnIndex;
    const startLeft = state.widths[idx];
    const startRight = state.widths[idx + 1];
    // Clamp delta so neither column shrinks below the minimum, preserving
    // the sum of the two adjacent columns (so the rest of the table doesn't
    // shift around when one side hits its minimum).
    const maxIncrease = startRight - RICH_TABLE_MIN_COLUMN_WIDTH;
    const maxDecrease = RICH_TABLE_MIN_COLUMN_WIDTH - startLeft;
    const delta = Math.max(maxDecrease, Math.min(maxIncrease, clientX - state.startX));
    widths[idx] = startLeft + delta;
    widths[idx + 1] = startRight - delta;
    return widths.map((width) => Math.round(width));
  }

  getColumnWidths() {
    const map = TableMap.get(this.node);
    // For fluid rich tables col widths are stored as percentages, so the
    // rendered cell rect is the source of truth in pixels. Fall back to
    // the colgroup styles / data attributes for non-fluid tables.
    const firstRow = this.table.rows[0];
    const cols = Array.from(this.colgroup.children) as HTMLTableColElement[];
    return Array.from({ length: map.width }, (_value, index) => {
      const cell = firstRow?.cells[index];
      if (cell) {
        const rendered = Math.round(cell.getBoundingClientRect().width);
        if (rendered > 0) return rendered;
      }
      const col = cols[index];
      const rawStyleWidth = col?.style.width || "";
      // Percentages in the style aren't usable pixels — only treat as
      // pixels when the unit is missing or explicitly "px".
      const isPxStyleWidth = /^\s*\d+(\.\d+)?(px)?\s*$/.test(rawStyleWidth);
      const styleWidth = isPxStyleWidth ? parseFloat(rawStyleWidth) : NaN;
      const attrWidth = parseFloat(col?.getAttribute("data-width") ?? col?.getAttribute("width") ?? "");
      const width = Number.isFinite(styleWidth) && styleWidth > 0 ? styleWidth : attrWidth;
      if (Number.isFinite(width) && width > 0) return Math.round(width);
      const nodeFirstRow = this.node.firstChild;
      const cellNode = nodeFirstRow?.child(index);
      const colwidth = Array.isArray(cellNode?.attrs.colwidth) ? cellNode?.attrs.colwidth[0] : null;
      return typeof colwidth === "number" && Number.isFinite(colwidth) ? colwidth : RICH_TABLE_DEFAULT_COLUMN_WIDTH;
    });
  }

  applyVisualColumnWidths(widths: number[]) {
    if (isRichTableNode(this.node)) {
      // Keep the table at fluid 100% width during drag; express the new
      // column widths as percentages of their (preserved) total so only the
      // two adjacent columns change visually.
      const total = widths.reduce((sum, w) => sum + w, 0) || 1;
      Array.from(this.colgroup.children).forEach((col, index) => {
        const width = widths[index];
        if (!(col instanceof HTMLTableColElement) || !width) return;
        col.style.width = `${(width / total) * 100}%`;
        col.style.minWidth = "";
      });
      this.table.style.width = "100%";
      this.table.style.minWidth = "";
      this.renderResizeHandles();
      return;
    }
    Array.from(this.colgroup.children).forEach((col, index) => {
      const width = widths[index];
      if (!(col instanceof HTMLTableColElement) || !width) return;
      col.style.width = `${width}px`;
      col.style.minWidth = "";
    });
    this.table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
    this.table.style.minWidth = "";
    this.renderResizeHandles();
  }

  commitColumnWidths(widths: number[]) {
    const pos = this.resolvePos();
    if (pos == null) return;
    const tr = this.view.state.tr;
    applyColumnWidthsToTransaction(tr, this.node, pos, widths);
    this.preserveScrollAround(() => {
      this.view.dispatch(tr);
      this.refreshSelectionActive();
      this.focusWithoutScroll();
    });
  }

  insertParagraphAfterTable() {
    const pos = this.resolvePos();
    const paragraph = this.view.state.schema.nodes.paragraph;
    if (pos == null || !paragraph) return;

    const { state } = this.view;
    const afterTable = pos + this.node.nodeSize;
    // Always insert a fresh empty paragraph immediately after the table and
    // drop the cursor into it. The user explicitly asked for a blank line —
    // skipping the insert when another block already follows would leave
    // them with no visible "new line", which is what they reported.
    let tr = state.tr.insert(afterTable, paragraph.create());
    const cursorPos = Math.min(afterTable + 1, tr.doc.content.size);
    tr = tr.setSelection(TextSelection.create(tr.doc, cursorPos)).scrollIntoView();
    this.view.dispatch(tr);
    this.refreshSelectionActive();
    this.view.focus();
    this.closeAxisMenu();
    this.scheduleChromeRefresh();
  }

  addRowToBottom() {
    const map = TableMap.get(this.node);
    this.runTableCommandAt(map.height - 1, 0, addRowAfter);
  }

  addColumnToEnd() {
    const map = TableMap.get(this.node);
    this.runTableCommandAt(0, map.width - 1, addColumnAfter, { rebalanceColumns: 1 });
  }

  runTableCommandAt(row: number, col: number, command: typeof addRowAfter, options: { rebalanceColumns?: number } = {}) {
    const pos = this.resolvePos();
    if (pos == null || row < 0 || col < 0) return;

    const map = TableMap.get(this.node);
    const cellPos = map.positionAt(row, col, this.node);
    const absoluteCellPos = pos + 1 + cellPos;
    const { state } = this.view;
    const selection = Selection.near(state.doc.resolve(Math.min(absoluteCellPos + 1, state.doc.content.size)));

    this.preserveScrollAround(() => {
      this.view.dispatch(state.tr.setSelection(selection));
      command(this.view.state, (tr) => this.view.dispatch(tr));
      if (isRichTableNode(this.node)) {
        this.normalizeRichHeaderCells();
      }
      if (options.rebalanceColumns && isRichTableNode(this.node)) {
        this.rebalanceColumns(options.rebalanceColumns);
      }
      this.refreshSelectionActive();
      this.focusWithoutScroll();
    });
    this.closeAxisMenu();
    this.scheduleChromeRefresh();
  }

  selectRow(row: number, options: { preserveHandlePosition?: boolean } = {}) {
    const pos = this.resolvePos();
    if (pos == null) return;
    const map = TableMap.get(this.node);
    if (row < 0 || row >= map.height) return;
    const anchor = pos + 1 + map.positionAt(row, 0, this.node);
    const head = pos + 1 + map.positionAt(row, map.width - 1, this.node);
    this.preserveScrollAround(() => {
      this.view.dispatch(this.view.state.tr.setSelection(CellSelection.create(this.view.state.doc, anchor, head)));
      if (!options.preserveHandlePosition) this.refreshSelectionActive();
    });
    this.hoveredRow = row;
    this.scheduleChromeRefresh();
  }

  selectColumn(column: number, options: { preserveHandlePosition?: boolean } = {}) {
    const pos = this.resolvePos();
    if (pos == null) return;
    const map = TableMap.get(this.node);
    if (column < 0 || column >= map.width) return;
    const anchor = pos + 1 + map.positionAt(0, column, this.node);
    const head = pos + 1 + map.positionAt(map.height - 1, column, this.node);
    this.preserveScrollAround(() => {
      this.view.dispatch(this.view.state.tr.setSelection(CellSelection.create(this.view.state.doc, anchor, head)));
      if (!options.preserveHandlePosition) this.refreshSelectionActive();
    });
    this.hoveredColumn = column;
    this.scheduleChromeRefresh();
  }

  insertRow(row: number, direction: "above" | "below") {
    this.runTableCommandAt(row, 0, direction === "above" ? addRowBefore : addRowAfter);
    this.closeAxisMenu();
  }

  insertColumn(column: number, direction: "left" | "right") {
    this.runTableCommandAt(0, column, direction === "left" ? addColumnBefore : addColumnAfter, { rebalanceColumns: 1 });
    this.closeAxisMenu();
  }

  duplicateRow(row: number) {
    const pos = this.resolvePos();
    if (pos == null) return;
    const rowInfo = getRowInfo(this.node, pos, row);
    if (!rowInfo) return;
    this.preserveScrollAround(() => {
      this.view.dispatch(this.view.state.tr.insert(rowInfo.pos + rowInfo.node.nodeSize, rowInfo.node.copy(rowInfo.node.content)));
      this.normalizeRichHeaderCells();
      this.refreshSelectionActive();
    });
    this.closeAxisMenu();
    this.scheduleChromeRefresh();
  }

  duplicateColumn(column: number) {
    const pos = this.resolvePos();
    if (pos == null) return;
    const cells = getColumnCellInfos(this.node, pos, column).reverse();
    if (!cells.length) return;
    let tr = this.view.state.tr;
    cells.forEach(({ pos: cellPos, node }) => {
      tr = tr.insert(cellPos + node.nodeSize, node.copy(node.content));
    });
    this.preserveScrollAround(() => {
      this.view.dispatch(tr);
      this.normalizeRichHeaderCells();
      if (isRichTableNode(this.node)) this.rebalanceColumns(1);
      this.refreshSelectionActive();
    });
    this.closeAxisMenu();
    this.scheduleChromeRefresh();
  }

  clearRow(row: number) {
    const pos = this.resolvePos();
    const paragraph = this.view.state.schema.nodes.paragraph;
    if (pos == null || !paragraph) return;
    const cells = getRowCellInfos(this.node, pos, row).reverse();
    let tr = this.view.state.tr;
    cells.forEach(({ pos: cellPos, node }) => {
      tr = tr.replaceWith(cellPos + 1, cellPos + node.nodeSize - 1, paragraph.create());
    });
    this.preserveScrollAround(() => {
      this.view.dispatch(tr);
      this.refreshSelectionActive();
    });
    this.closeAxisMenu();
    this.scheduleChromeRefresh();
  }

  clearColumn(column: number) {
    const pos = this.resolvePos();
    const paragraph = this.view.state.schema.nodes.paragraph;
    if (pos == null || !paragraph) return;
    const cells = getColumnCellInfos(this.node, pos, column).reverse();
    let tr = this.view.state.tr;
    cells.forEach(({ pos: cellPos, node }) => {
      tr = tr.replaceWith(cellPos + 1, cellPos + node.nodeSize - 1, paragraph.create());
    });
    this.preserveScrollAround(() => {
      this.view.dispatch(tr);
      this.refreshSelectionActive();
    });
    this.closeAxisMenu();
    this.scheduleChromeRefresh();
  }

  deleteSelectedRow(row: number) {
    this.runTableCommandAt(row, 0, deleteRow);
    this.closeAxisMenu();
  }

  deleteSelectedColumn(column: number) {
    this.runTableCommandAt(0, column, deleteColumn, { rebalanceColumns: -1 });
    this.closeAxisMenu();
  }

  rebalanceColumns(delta: number) {
    if (!isRichTableNode(this.node)) return;
    const pos = this.resolvePos();
    if (pos == null) return;
    const nextNode = this.view.state.doc.nodeAt(pos);
    if (!nextNode) return;
    const map = TableMap.get(nextNode);
    const currentWidths = this.getColumnWidths();
    const total = currentWidths.reduce((sum, width) => sum + width, 0) || map.width * RICH_TABLE_DEFAULT_COLUMN_WIDTH;
    const widths = Array.from({ length: map.width }, (_value, index) => currentWidths[index] ?? RICH_TABLE_DEFAULT_COLUMN_WIDTH);
    if (delta > 0) {
      const target = total / map.width;
      const scaled = widths.map((width) => Math.max(RICH_TABLE_MIN_COLUMN_WIDTH, width - target / Math.max(map.width - 1, 1)));
      scaled[scaled.length - 1] = Math.max(RICH_TABLE_MIN_COLUMN_WIDTH, target);
      this.commitColumnWidths(normalizeWidthsToTotal(scaled, total));
    } else {
      this.commitColumnWidths(normalizeWidthsToTotal(widths, total));
    }
  }

  normalizeRichHeaderCells() {
    const pos = this.resolvePos();
    if (pos == null || !isRichTableNode(this.node)) return;
    const table = this.view.state.doc.nodeAt(pos);
    if (!table) return;
    const tr = this.view.state.tr;
    applyHeaderCellsToTransaction(tr, table, pos, Boolean(table.attrs.headerRow), Boolean(table.attrs.headerColumn));
    if (tr.docChanged) this.view.dispatch(tr);
  }

  copyTable(label: HTMLSpanElement, iconSlot: HTMLSpanElement) {
    const serialized = DOMSerializer.fromSchema(this.view.state.schema).serializeNode(this.node);
    const container = document.createElement("div");
    container.appendChild(serialized);
    const html = normalizeTableClipboardHtml(container.innerHTML);
    const markdown = htmlToMarkdown(html);
    void writeRichClipboard(html, markdown).then(() => {
      iconSlot.innerHTML = tableIconSvg("check", 14);
      label.textContent = "Copied";
      if (this.copiedTimer !== null) window.clearTimeout(this.copiedTimer);
      this.copiedTimer = window.setTimeout(() => {
        iconSlot.innerHTML = tableIconSvg("copy", 14);
        label.textContent = "Copy table";
      }, 1200);
    }).catch((error) => {
      console.error("Failed to copy table", error);
    });
  }

  deleteTable() {
    const pos = this.resolvePos();
    const paragraph = this.view.state.schema.nodes.paragraph;
    if (pos == null || !paragraph) return;

    const { state } = this.view;
    const tableTo = pos + this.node.nodeSize;
    let tr = state.tr;

    if (state.doc.childCount === 1) {
      tr = tr.replaceWith(pos, tableTo, paragraph.create());
      tr = tr.setSelection(TextSelection.create(tr.doc, Math.min(pos + 1, tr.doc.content.size)));
    } else {
      tr = tr.delete(pos, tableTo);
      const selectionPos = Math.min(pos, tr.doc.content.size);
      tr = tr.setSelection(Selection.near(tr.doc.resolve(selectionPos), -1));
    }

    this.preserveScrollAround(() => {
      this.view.dispatch(tr);
      this.refreshSelectionActive();
      this.focusWithoutScroll();
    });
    this.closeAxisMenu();
  }

  convertToRichTable() {
    const pos = this.resolvePos();
    if (pos == null) return;
    const widths = this.getColumnWidths();
    const originalSelection = this.view.state.selection;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      tigranaTable: true,
      headerRow: true,
      headerColumn: false,
    });
    applyHeaderCellsToTransaction(tr, this.node, pos, true, false);
    applyColumnWidthsToTransaction(tr, this.node, pos, widths);
    this.preserveSelectionThrough(tr, originalSelection);
    this.preserveScrollAround(() => {
      this.view.dispatch(tr);
      this.refreshSelectionActive();
      this.focusWithoutScroll();
    });
    this.closeAxisMenu();
  }

  convertToMarkdownTable() {
    const pos = this.resolvePos();
    if (pos == null) return;
    const originalSelection = this.view.state.selection;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      tigranaTable: false,
      headerRow: true,
      headerColumn: false,
    });
    applyHeaderCellsToTransaction(tr, this.node, pos, true, false, { clearWidths: true });
    this.preserveSelectionThrough(tr, originalSelection);
    this.preserveScrollAround(() => {
      this.view.dispatch(tr);
      this.refreshSelectionActive();
      this.focusWithoutScroll();
    });
    this.closeAxisMenu();
  }

  toggleHeaderRow() {
    if (!isRichTableNode(this.node)) return;
    this.setHeaderOptions(!this.node.attrs.headerRow, Boolean(this.node.attrs.headerColumn));
  }

  toggleHeaderColumn() {
    if (!isRichTableNode(this.node)) return;
    this.setHeaderOptions(Boolean(this.node.attrs.headerRow), !this.node.attrs.headerColumn);
  }

  setHeaderOptions(headerRow: boolean, headerColumn: boolean) {
    const pos = this.resolvePos();
    if (pos == null) return;
    const originalSelection = this.view.state.selection;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      tigranaTable: true,
      headerRow,
      headerColumn,
    });
    applyHeaderCellsToTransaction(tr, this.node, pos, headerRow, headerColumn);
    this.preserveSelectionThrough(tr, originalSelection);
    this.preserveScrollAround(() => {
      this.view.dispatch(tr);
      this.refreshSelectionActive();
      this.focusWithoutScroll();
    });
    this.closeAxisMenu();
  }

  preserveSelectionThrough(tr: Transaction, original: Selection) {
    // setNodeMarkup on cells doesn't shift positions, but changing cell
    // types invalidates a CellSelection's internal type guard, which makes
    // ProseMirror fall back to a near-by selection — typically position 1
    // or the end of the table. Explicitly re-anchor instead.
    // Use duck-typing because instanceof can fail across bundled copies of
    // prosemirror-tables.
    const asCell = original as Selection & {
      $anchorCell?: { pos: number };
      $headCell?: { pos: number };
    };
    try {
      if (asCell.$anchorCell && asCell.$headCell) {
        const anchorPos = asCell.$anchorCell.pos;
        const headPos = asCell.$headCell.pos;
        if (tr.doc.nodeAt(anchorPos) && tr.doc.nodeAt(headPos)) {
          tr.setSelection(CellSelection.create(tr.doc, anchorPos, headPos));
          return;
        }
      }
      tr.setSelection(original.map(tr.doc, tr.mapping));
    } catch {
      // leave whatever default mapping produced
    }
  }

  collectScrollContainers() {
    const containers: HTMLElement[] = [];
    let el: HTMLElement | null = this.view.dom as HTMLElement;
    while (el && el !== document.body && el !== document.documentElement) {
      const style = window.getComputedStyle(el);
      const overflow = `${style.overflowY} ${style.overflowX}`;
      if (overflow.includes("auto") || overflow.includes("scroll")) {
        containers.push(el);
      }
      el = el.parentElement;
    }
    return containers;
  }

  preserveScrollAround(work: () => void) {
    // Save scroll positions of every scrollable ancestor + the window, run
    // the work (transaction dispatches, focus, etc.), then re-pin scroll so
    // the user's view doesn't jump to the caret. ProseMirror's selection
    // sync and the browser's focus behavior can each scroll the editor or
    // the page; restoring twice (immediately + in rAF) handles both.
    const containers = this.collectScrollContainers();
    const saved = containers.map((el) => ({ el, top: el.scrollTop, left: el.scrollLeft }));
    const winX = window.scrollX;
    const winY = window.scrollY;
    const restore = () => {
      for (const { el, top, left } of saved) {
        if (el.scrollTop !== top) el.scrollTop = top;
        if (el.scrollLeft !== left) el.scrollLeft = left;
      }
      if (window.scrollX !== winX || window.scrollY !== winY) {
        window.scrollTo(winX, winY);
      }
    };
    work();
    restore();
    window.requestAnimationFrame(() => {
      restore();
      window.requestAnimationFrame(restore);
    });
  }

  focusWithoutScroll() {
    if (this.view.hasFocus()) return;
    // Avoid the browser scrolling the editor into view when re-focusing,
    // which would visually "jump" the cursor. After focus is granted, the
    // browser fires a domSelectionChange that can reset the PM selection
    // (typically collapsing it to position 1), so re-assert the captured
    // selection on the next frame.
    const sel = this.view.state.selection;
    const anchorCellPos = (sel as Selection & { $anchorCell?: { pos: number } }).$anchorCell?.pos;
    const headCellPos = (sel as Selection & { $headCell?: { pos: number } }).$headCell?.pos;
    try {
      (this.view.dom as HTMLElement).focus({ preventScroll: true });
    } catch {
      this.view.focus();
    }
    window.requestAnimationFrame(() => {
      if (this.view.isDestroyed) return;
      const current = this.view.state.selection;
      if (anchorCellPos != null && headCellPos != null) {
        const curAnchor = (current as Selection & { $anchorCell?: { pos: number } }).$anchorCell?.pos;
        const curHead = (current as Selection & { $headCell?: { pos: number } }).$headCell?.pos;
        if (curAnchor === anchorCellPos && curHead === headCellPos) return;
        try {
          this.view.dispatch(
            this.view.state.tr.setSelection(
              CellSelection.create(this.view.state.doc, anchorCellPos, headCellPos),
            ),
          );
        } catch {
          // ignore
        }
      }
    });
  }

  appendTableMenuActions(menu: HTMLDivElement) {
    const copyButton = menu.appendChild(createTableMenuButton(tableIconSvg("copy", 14), "Copy table"));
    const copyIcon = copyButton.querySelector(".table-menu-icon") as HTMLSpanElement;
    const copyLabel = copyButton.querySelector("span:last-child") as HTMLSpanElement;
    copyButton.addEventListener("click", () => this.copyTable(copyLabel, copyIcon));

    menu.appendChild(createTableMenuButton(tableIconSvg("plus", 14), "Add blank line after table")).addEventListener("click", () => this.insertParagraphAfterTable());

    const convertButton = menu.appendChild(createTableMenuButton(
      tableIconSvg("table", 14),
      isRichTableNode(this.node) ? "Convert to Markdown table (loses formatting)" : "Convert to HTML table for more options",
    ));
    convertButton.addEventListener("click", () => {
      if (isRichTableNode(this.node)) this.convertToMarkdownTable();
      else this.convertToRichTable();
    });

    const deleteButton = menu.appendChild(createTableMenuButton(tableIconSvg("trash", 14), "Delete table"));
    deleteButton.classList.add("danger-item");
    deleteButton.addEventListener("click", () => this.deleteTable());
  }

  appendTableOptionsSubmenu(menu: HTMLDivElement) {
    const wrap = menu.appendChild(document.createElement("div"));
    wrap.className = "table-menu-submenu";
    const trigger = wrap.appendChild(createTableSubmenuButton(tableIconSvg("table", 14), "Table options"));
    const submenu = wrap.appendChild(document.createElement("div"));
    submenu.className = "table-context-menu table-submenu-panel";
    submenu.setAttribute("role", "menu");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    this.appendTableMenuActions(submenu);

    const setOpen = (open: boolean) => {
      wrap.classList.toggle("is-open", open);
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
    };

    wrap.addEventListener("mouseenter", () => setOpen(true));
    wrap.addEventListener("mouseleave", () => setOpen(false));
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setOpen(!wrap.classList.contains("is-open"));
    });
  }

  openAxisMenu(axis: TableAxis, index: number, anchorRect: DOMRect) {
    this.closeAxisMenu();
    this.axisMenu = document.createElement("div");
    this.axisMenu.className = "table-context-menu table-axis-menu";

    if (axis === "row") {
      this.appendTableOptionsSubmenu(this.axisMenu);
      this.axisMenu.appendChild(createTableMenuSeparator());
      this.axisMenu.appendChild(createTableMenuHeader("Row options"));
      const isRichTable = isRichTableNode(this.node);
      const headerButton = this.axisMenu.appendChild(createTableMenuSwitchButton("Header row", isRichTable ? Boolean(this.node.attrs.headerRow) : true, !isRichTable));
      if (isRichTable) {
        headerButton.addEventListener("click", () => this.toggleHeaderRow());
      }
      this.axisMenu.appendChild(createTableMenuButton(tableIconSvg("arrowUp", 14), "Insert row above")).addEventListener("click", () => this.insertRow(index, "above"));
      this.axisMenu.appendChild(createTableMenuButton(tableIconSvg("arrowDown", 14), "Insert row below")).addEventListener("click", () => this.insertRow(index, "below"));
      this.axisMenu.appendChild(createTableMenuButton(tableIconSvg("copy", 14), "Duplicate row")).addEventListener("click", () => this.duplicateRow(index));
      this.axisMenu.appendChild(createTableMenuButton(tableIconSvg("xCircle", 14), "Clear row contents")).addEventListener("click", () => this.clearRow(index));
      const deleteButton = this.axisMenu.appendChild(createTableMenuButton(tableIconSvg("trash", 14), "Delete row"));
      deleteButton.classList.add("danger-item");
      deleteButton.addEventListener("click", () => this.deleteSelectedRow(index));
    } else {
      const isRichTable = isRichTableNode(this.node);
      const headerButton = this.axisMenu.appendChild(createTableMenuSwitchButton(
        isRichTable ? "Header column" : "Convert to HTML table to customize header column",
        isRichTable ? Boolean(this.node.attrs.headerColumn) : false,
        !isRichTable,
      ));
      if (isRichTable) {
        headerButton.addEventListener("click", () => this.toggleHeaderColumn());
      }
      this.axisMenu.appendChild(createTableMenuSeparator());
      this.axisMenu.appendChild(createTableMenuButton(tableIconSvg("arrowLeft", 14), "Insert column left")).addEventListener("click", () => this.insertColumn(index, "left"));
      this.axisMenu.appendChild(createTableMenuButton(tableIconSvg("arrowRight", 14), "Insert column right")).addEventListener("click", () => this.insertColumn(index, "right"));
      this.axisMenu.appendChild(createTableMenuButton(tableIconSvg("copy", 14), "Duplicate column")).addEventListener("click", () => this.duplicateColumn(index));
      this.axisMenu.appendChild(createTableMenuButton(tableIconSvg("xCircle", 14), "Clear column contents")).addEventListener("click", () => this.clearColumn(index));
      const deleteButton = this.axisMenu.appendChild(createTableMenuButton(tableIconSvg("trash", 14), "Delete column"));
      deleteButton.classList.add("danger-item");
      deleteButton.addEventListener("click", () => this.deleteSelectedColumn(index));
    }

    // Render the menu to <body> with position: fixed so it can't be clipped
    // by an ancestor's overflow (e.g. the editor pane). anchorRect is already
    // viewport-relative, so we use it directly without translating into the
    // wrapper's coordinate system.
    this.axisMenu.style.position = "fixed";
    this.axisMenu.style.top = `${anchorRect.bottom + 6}px`;
    this.axisMenu.style.left = `${anchorRect.left}px`;
    document.body.appendChild(this.axisMenu);
    this.clampAxisMenuToViewport();
    this.dom.classList.add("is-active");
    window.addEventListener("mousedown", this.handleOutsideMouseDown, true);
    window.addEventListener("keydown", this.handleOutsideKeyDown, true);
  }

  clampAxisMenuToViewport() {
    if (!this.axisMenu) return;
    const menuRect = this.axisMenu.getBoundingClientRect();
    const margin = 8;
    const viewportRight = window.innerWidth - margin;
    const viewportBottom = window.innerHeight - margin;

    let leftPx = parseFloat(this.axisMenu.style.left) || 0;
    let topPx = parseFloat(this.axisMenu.style.top) || 0;

    const overflowRight = menuRect.right - viewportRight;
    if (overflowRight > 0) leftPx -= overflowRight;
    if (leftPx < margin) leftPx = margin;

    const overflowBottom = menuRect.bottom - viewportBottom;
    if (overflowBottom > 0) {
      // Flip the menu above the anchor when it would run off the bottom.
      topPx -= menuRect.height + 12;
      if (topPx < margin) topPx = margin;
    }

    this.axisMenu.style.left = `${leftPx}px`;
    this.axisMenu.style.top = `${topPx}px`;
  }

  closeAxisMenu() {
    this.axisMenu?.remove();
    this.axisMenu = null;
    if (!this.selectionActive) this.dom.classList.remove("is-active");
    this.removeOutsideListeners();
  }

  removeOutsideListeners() {
    window.removeEventListener("mousedown", this.handleOutsideMouseDown, true);
    window.removeEventListener("keydown", this.handleOutsideKeyDown, true);
  }
}

function getRowInfo(table: ProseMirrorNode, tablePos: number, row: number) {
  if (row < 0 || row >= table.childCount) return null;
  let offset = 0;
  for (let index = 0; index < table.childCount; index += 1) {
    const rowNode = table.child(index);
    if (index === row) return { node: rowNode, pos: tablePos + 1 + offset };
    offset += rowNode.nodeSize;
  }
  return null;
}

function getRowCellInfos(table: ProseMirrorNode, tablePos: number, row: number) {
  const map = TableMap.get(table);
  if (row < 0 || row >= map.height) return [];
  return Array.from({ length: map.width }, (_value, column) => {
    const pos = tablePos + 1 + map.positionAt(row, column, table);
    return { pos, node: table.nodeAt(pos - tablePos - 1)! };
  }).filter((info, index, all) => info.node && all.findIndex((other) => other.pos === info.pos) === index);
}

function getColumnCellInfos(table: ProseMirrorNode, tablePos: number, column: number) {
  const map = TableMap.get(table);
  if (column < 0 || column >= map.width) return [];
  return Array.from({ length: map.height }, (_value, row) => {
    const pos = tablePos + 1 + map.positionAt(row, column, table);
    return { pos, node: table.nodeAt(pos - tablePos - 1)! };
  }).filter((info, index, all) => info.node && all.findIndex((other) => other.pos === info.pos) === index);
}

function applyColumnWidthsToTransaction(tr: Transaction, table: ProseMirrorNode, tablePos: number, widths: number[]) {
  const firstRow = table.firstChild;
  if (!firstRow) return;
  const map = TableMap.get(table);
  // prosemirror-tables' `fixTables` plugin reverts colwidth changes that are
  // inconsistent across rows in the same column. Write the same width to
  // every cell in each column so the table is internally consistent.
  for (let column = 0; column < Math.min(map.width, widths.length); column += 1) {
    const width = Math.max(RICH_TABLE_MIN_COLUMN_WIDTH, Math.round(widths[column]));
    const seenPositions = new Set<number>();
    for (let row = 0; row < map.height; row += 1) {
      const cellPos = tablePos + 1 + map.positionAt(row, column, table);
      if (seenPositions.has(cellPos)) continue;
      seenPositions.add(cellPos);
      const cell = tr.doc.nodeAt(cellPos);
      if (!cell) continue;
      const colspan = Number(cell.attrs.colspan ?? 1);
      let nextColwidth: number[];
      if (colspan > 1 && Array.isArray(cell.attrs.colwidth) && cell.attrs.colwidth.length === colspan) {
        // For spanning cells, only update the slot for this column.
        const localIndex = column - findCellColumnStart(map, cellPos - tablePos - 1);
        nextColwidth = [...cell.attrs.colwidth];
        if (localIndex >= 0 && localIndex < nextColwidth.length) nextColwidth[localIndex] = width;
      } else {
        nextColwidth = Array.from({ length: colspan }, (_, i) => {
          if (i === 0) return width;
          return widths[column + i] != null
            ? Math.max(RICH_TABLE_MIN_COLUMN_WIDTH, Math.round(widths[column + i]))
            : width;
        });
      }
      tr.setNodeMarkup(cellPos, undefined, {
        ...cell.attrs,
        colwidth: nextColwidth,
      });
    }
  }
}

function findCellColumnStart(map: TableMap, cellRelPos: number) {
  for (let i = 0; i < map.map.length; i += 1) {
    if (map.map[i] === cellRelPos) return i % map.width;
  }
  return -1;
}

function applyHeaderCellsToTransaction(
  tr: Transaction,
  table: ProseMirrorNode,
  tablePos: number,
  headerRow: boolean,
  headerColumn: boolean,
  options: { clearWidths?: boolean } = {},
) {
  const map = TableMap.get(table);
  const tableCell = table.type.schema.nodes.tableCell;
  const tableHeader = table.type.schema.nodes.tableHeader;
  if (!tableCell || !tableHeader) return;

  for (let row = 0; row < map.height; row += 1) {
    for (let column = 0; column < map.width; column += 1) {
      const cellPos = tablePos + 1 + map.positionAt(row, column, table);
      const cell = tr.doc.nodeAt(cellPos);
      if (!cell) continue;
      const shouldBeHeader = (headerRow && row === 0) || (headerColumn && column === 0);
      const attrs = { ...cell.attrs };
      if (options.clearWidths) attrs.colwidth = null;
      tr.setNodeMarkup(cellPos, shouldBeHeader ? tableHeader : tableCell, attrs, cell.marks);
    }
  }
}

function normalizeWidthsToTotal(widths: number[], total: number) {
  const clamped = widths.map((width) => Math.max(RICH_TABLE_MIN_COLUMN_WIDTH, width));
  const sum = clamped.reduce((value, width) => value + width, 0);
  if (!sum || sum === total) return clamped.map(Math.round);
  return clamped.map((width) => Math.max(RICH_TABLE_MIN_COLUMN_WIDTH, Math.round((width / sum) * total)));
}

const TableWithControls = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tigranaTable: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-tigrana-table") === "true",
        renderHTML: (attributes) => (attributes.tigranaTable ? { "data-tigrana-table": "true" } : {}),
      },
      headerRow: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-header-row") !== "false",
        renderHTML: (attributes) => attributes.tigranaTable ? { "data-header-row": attributes.headerRow ? "true" : "false" } : {},
      },
      headerColumn: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-header-column") === "true",
        renderHTML: (attributes) => attributes.tigranaTable ? { "data-header-column": attributes.headerColumn ? "true" : "false" } : {},
      },
    };
  },
  addNodeView() {
    return ({ node, view, getPos }) => new TableControlsNodeView(node, this.options.cellMinWidth, view, getPos);
  },
});

const TigranaTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colwidth: {
        default: null,
        parseHTML: parseCellColwidth,
      },
    };
  },
});

const TigranaTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colwidth: {
        default: null,
        parseHTML: parseCellColwidth,
      },
    };
  },
});

type TableIconName =
  | "arrowDown"
  | "arrowLeft"
  | "arrowRight"
  | "arrowUp"
  | "chevronRight"
  | "check"
  | "copy"
  | "columns"
  | "ellipsis"
  | "ellipsisVertical"
  | "grip"
  | "headerColumn"
  | "headerRow"
  | "menu"
  | "plus"
  | "rows"
  | "table"
  | "trash"
  | "xCircle";

const TABLE_ICON_PATHS: Record<TableIconName, string[]> = {
  arrowDown: ['<path d="M12 5v14"></path>', '<path d="m19 12-7 7-7-7"></path>'],
  arrowLeft: ['<path d="M19 12H5"></path>', '<path d="m12 19-7-7 7-7"></path>'],
  arrowRight: ['<path d="M5 12h14"></path>', '<path d="m12 5 7 7-7 7"></path>'],
  arrowUp: ['<path d="M12 19V5"></path>', '<path d="m5 12 7-7 7 7"></path>'],
  chevronRight: ['<path d="m9 18 6-6-6-6"></path>'],
  check: ['<path d="M20 6 9 17l-5-5"></path>'],
  copy: [
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>',
    '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>',
  ],
  columns: [
    '<rect width="18" height="18" x="3" y="3" rx="2"></rect>',
    '<path d="M9 3v18"></path>',
    '<path d="M15 3v18"></path>',
  ],
  ellipsis: [
    '<circle cx="12" cy="12" r="1"></circle>',
    '<circle cx="19" cy="12" r="1"></circle>',
    '<circle cx="5" cy="12" r="1"></circle>',
  ],
  ellipsisVertical: [
    '<circle cx="12" cy="12" r="1"></circle>',
    '<circle cx="12" cy="5" r="1"></circle>',
    '<circle cx="12" cy="19" r="1"></circle>',
  ],
  grip: [
    '<circle cx="9" cy="12" r="1"></circle>',
    '<circle cx="9" cy="5" r="1"></circle>',
    '<circle cx="9" cy="19" r="1"></circle>',
    '<circle cx="15" cy="12" r="1"></circle>',
    '<circle cx="15" cy="5" r="1"></circle>',
    '<circle cx="15" cy="19" r="1"></circle>',
  ],
  headerColumn: [
    '<rect width="18" height="16" x="3" y="4" rx="2"></rect>',
    '<path d="M9 4v16"></path>',
    '<path d="M3 9h18"></path>',
    '<path d="M3 14h18"></path>',
  ],
  headerRow: [
    '<rect width="18" height="16" x="3" y="4" rx="2"></rect>',
    '<path d="M3 9h18"></path>',
    '<path d="M9 4v16"></path>',
  ],
  menu: ['<path d="M4 12h16"></path>', '<path d="M4 6h16"></path>', '<path d="M4 18h16"></path>'],
  plus: ['<path d="M5 12h14"></path>', '<path d="M12 5v14"></path>'],
  rows: [
    '<rect width="18" height="18" x="3" y="3" rx="2"></rect>',
    '<path d="M3 9h18"></path>',
    '<path d="M3 15h18"></path>',
  ],
  table: [
    '<path d="M12 3v18"></path>',
    '<rect width="18" height="18" x="3" y="3" rx="2"></rect>',
    '<path d="M3 9h18"></path>',
    '<path d="M3 15h18"></path>',
  ],
  trash: [
    '<path d="M3 6h18"></path>',
    '<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>',
    '<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>',
    '<line x1="10" x2="10" y1="11" y2="17"></line>',
    '<line x1="14" x2="14" y1="11" y2="17"></line>',
  ],
  xCircle: ['<circle cx="12" cy="12" r="10"></circle>', '<path d="m15 9-6 6"></path>', '<path d="m9 9 6 6"></path>'],
};

function tableIconSvg(name: TableIconName, size: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TABLE_ICON_PATHS[name].join("")}</svg>`;
}

function createTableToolButton(title: string, iconMarkup: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "table-tool-button";
  button.title = title;
  button.innerHTML = iconMarkup;
  return button;
}

function createTableMenuButton(iconMarkup: string, label: string) {
  const button = document.createElement("button");
  button.type = "button";
  const icon = button.appendChild(document.createElement("span"));
  icon.className = "table-menu-icon";
  icon.innerHTML = iconMarkup;
  const text = button.appendChild(document.createElement("span"));
  text.textContent = label;
  return button;
}

function createTableSubmenuButton(iconMarkup: string, label: string) {
  const button = createTableMenuButton(iconMarkup, label);
  button.classList.add("table-submenu-trigger");
  const arrow = button.appendChild(document.createElement("span"));
  arrow.className = "table-submenu-arrow";
  arrow.innerHTML = tableIconSvg("chevronRight", 14);
  return button;
}

function createTableMenuHeader(label: string) {
  const header = document.createElement("div");
  header.className = "table-menu-header";
  header.textContent = label;
  return header;
}

function createTableMenuSwitchButton(label: string, checked: boolean, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "table-menu-switch-item";
  button.disabled = disabled;
  const text = button.appendChild(document.createElement("span"));
  text.textContent = label;
  const switchTrack = button.appendChild(document.createElement("span"));
  switchTrack.className = "table-menu-switch";
  switchTrack.setAttribute("aria-hidden", "true");
  switchTrack.dataset.checked = checked ? "true" : "false";
  if (checked) button.classList.add("is-checked");
  if (disabled) button.classList.add("is-disabled");
  return button;
}

function createTableMenuSeparator() {
  const separator = document.createElement("div");
  separator.className = "table-menu-separator";
  separator.setAttribute("role", "separator");
  return separator;
}

function updateTableColumns(
  node: ProseMirrorNode,
  colgroup: HTMLTableColElement,
  table: HTMLTableElement,
  cellMinWidth: number,
) {
  let totalWidth = 0;
  let fixedWidth = true;
  let nextDOM = colgroup.firstChild as HTMLTableColElement | null;
  const firstRow = node.firstChild;

  if (firstRow) {
    for (let cellIndex = 0, col = 0; cellIndex < firstRow.childCount; cellIndex += 1) {
      const cell = firstRow.child(cellIndex);
      const colspan = Number(cell.attrs.colspan ?? 1);
      const colwidth = Array.isArray(cell.attrs.colwidth) ? cell.attrs.colwidth as unknown[] : null;
      for (let span = 0; span < colspan; span += 1, col += 1) {
        const widthValue = colwidth?.[span];
        const width = typeof widthValue === "number" && Number.isFinite(widthValue) ? widthValue : null;
        totalWidth += width ?? cellMinWidth;
        if (!width) fixedWidth = false;

        if (!nextDOM) {
          nextDOM = document.createElement("col");
          colgroup.appendChild(nextDOM);
        }

        nextDOM.style.width = width ? `${Math.max(width, cellMinWidth)}px` : "";
        nextDOM.style.minWidth = width ? "" : `${cellMinWidth}px`;
        if (isRichTableNode(node) && width) nextDOM.setAttribute("data-width", String(Math.max(width, cellMinWidth)));
        else nextDOM.removeAttribute("data-width");
        nextDOM = nextDOM.nextSibling as HTMLTableColElement | null;
      }
    }
  }

  while (nextDOM) {
    const after = nextDOM.nextSibling as HTMLTableColElement | null;
    nextDOM.parentNode?.removeChild(nextDOM);
    nextDOM = after;
  }

  const styleAttr = typeof node.attrs.style === "string" ? node.attrs.style : "";
  const hasUserWidth = /\bwidth\s*:/i.test(styleAttr);
  if (fixedWidth && !hasUserWidth) {
    table.style.width = `${totalWidth}px`;
    table.style.minWidth = "";
  } else {
    table.style.width = "";
    table.style.minWidth = `${totalWidth}px`;
  }
}

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

export function NotesEditor({ content, commandRequest, focusRequest, focusAtEndRequest, findRequest, reloadRequest, notePath, restorePosition, editable, spellcheckEnabled, workspace, onChange, onPendingChange, onLoadError, onPositionChange, onInternalLinkClick, onRequestEmoji, onRequestLink, onRequestImage }: NotesEditorProps) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [findDocumentVersion, setFindDocumentVersion] = useState(0);
  const slashRef = useRef<SlashState | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const handledFindRequest = useRef(findRequest);
  const handledCommandRequest = useRef(commandRequest?.id ?? 0);
  const lastLoadedNote = useRef<string | null>(null);
  const handledReloadRequest = useRef(reloadRequest ?? 0);
  const notePathRef = useRef(notePath);
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
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
      }),
      CodeBlockWithControls.configure({ lowlight }),
      Highlight,
      EmojiText,
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
      handleDOMEvents: {
        keydown(_view, event) {
          if (handleEmptyTaskItemBackspace(_view, event)) return true;
          if (handleEmptyTaskItemForwardDelete(_view, event)) return true;
          if (handleEmptyListItemDelete(_view, event)) return true;
          if (handleSlashKeyDown(event)) return true;
          const currentEditor = editorRef.current;
          if (currentEditor && handleEditorTabKeyDown(currentEditor, event)) return true;
          return false;
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
    const requestedReload = (reloadRequest ?? 0) !== handledReloadRequest.current;
    if (lastLoadedNote.current === notePath && !requestedReload) return;
    deferredMarkdownRef.current?.cancel();
    onPendingChangeRef.current(null);
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
      void hydrateNotebookImageNodes(editor, workspace, notePath, () => notePathRef.current);
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
    if (editable && !editor.state.doc.textContent.trim()) {
      chain.setParagraph().run();
    } else {
      chain.run();
    }
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
  }, [editor, findIndex, onRequestLink, selectFindMatch]);

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
      data-editable={editable ? "true" : "false"}
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
            <button type="button" title="Previous match" disabled={!findMatches.length} onClick={() => selectFindMatch(findIndex - 1)}>
              <ChevronUp size={14} />
            </button>
            <button type="button" title="Next match" disabled={!findMatches.length} onClick={() => selectFindMatch(findIndex + 1)}>
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

function isTableChromeTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest(".table-axis-handle, .table-edge-add, .table-context-menu, .table-column-resize-handle") != null
  );
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
  const hadTextSelectionRef = useRef(!editor.state.selection.empty);

  // Re-render the bubble when the editor's selection / document changes,
  // when focus changes, and on window resize/scroll so positioning stays sticky.
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const refreshSelection = () => {
      const hasTextSelection = !editor.state.selection.empty;
      if (hasTextSelection || hadTextSelectionRef.current) refresh();
      hadTextSelectionRef.current = hasTextSelection;
    };
    const refreshSelectedTransaction = () => {
      if (!editor.state.selection.empty) refresh();
    };
    editor.on("selectionUpdate", refreshSelection);
    editor.on("transaction", refreshSelectedTransaction);
    editor.on("focus", refresh);
    editor.on("blur", refresh);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      editor.off("selectionUpdate", refreshSelection);
      editor.off("transaction", refreshSelectedTransaction);
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

  const buttons = [
    { label: "Bold", icon: Bold, active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { label: "Italic", icon: Italic, active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { label: "Strike", icon: Strikethrough, active: editor.isActive("strike"), run: () => editor.chain().focus().toggleStrike().run() },
    { label: "Code", icon: Code, active: editor.isActive("code"), run: () => editor.chain().focus().toggleCode().run() },
    { label: "Highlight", icon: Highlighter, active: editor.isActive("highlight"), run: () => editor.chain().focus().toggleHighlight().run() },
    { label: "Link", icon: LinkIcon, active: editor.isActive("link"), run: setLink },
    { label: "Clear formatting", icon: Eraser, active: false, run: () => editor.chain().focus().unsetAllMarks().clearNodes().run() },
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
    if (selection instanceof NodeSelection && selection.node.type.name === "table") return false;
    if (selection instanceof CellSelection) return false;
    if (document.querySelector(".table-context-menu")) return false;
    if (isTableChromeTarget(activeElement)) return false;
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
  const html = serializeClipboardHtmlFragment(view, slice.content);
  const markdown = htmlToMarkdown(html).trimEnd();
  if (!markdown && !html) return false;

  event.preventDefault();
  event.clipboardData.setData("text/plain", markdown);
  event.clipboardData.setData("text/html", html || markdownToHtml(markdown));
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

export function getTaskLineCutDeleteRange(selection: Selection) {
  if (selection.empty) return null;

  const firstItem = findTaskItemAtEndpoint(selection, "from");
  const lastItem = findTaskItemAtEndpoint(selection, "to");
  if (!firstItem || !lastItem) return null;
  if (firstItem.parentFrom !== lastItem.parentFrom) return null;

  const firstTextStart = findFirstTextblockContentStart(firstItem.node, firstItem.from);
  const lastTextEnd = findLastTextblockContentEnd(lastItem.node, lastItem.from);
  if (firstTextStart === null || lastTextEnd === null) return null;

  const startsAtLineStart = selection.from === firstTextStart || selection.from === firstItem.from;
  const endsAtLineEnd = selection.to === lastTextEnd || selection.to === lastItem.from + lastItem.node.nodeSize;
  if (!startsAtLineStart || !endsAtLineEnd) return null;

  const firstIndex = getChildIndexAtPos(firstItem.parentNode, firstItem.parentFrom, firstItem.from);
  const lastIndex = getChildIndexAtPos(lastItem.parentNode, lastItem.parentFrom, lastItem.from);
  if (firstIndex === null || lastIndex === null || lastIndex < firstIndex) return null;

  if (firstIndex === 0 && lastIndex === firstItem.parentNode.childCount - 1) {
    return {
      from: firstItem.parentFrom,
      to: firstItem.parentFrom + firstItem.parentNode.nodeSize,
    };
  }

  return {
    from: firstItem.from,
    to: lastItem.from + lastItem.node.nodeSize,
  };
}

function findTaskItemAtEndpoint(selection: Selection, endpoint: "from" | "to") {
  const doc = selection.$from.doc;
  const position = endpoint === "from" ? selection.from : selection.to;
  const primary = findListItemAtSelection(doc.resolve(position));
  if (primary?.node.type.name === "taskItem") return primary;

  if (endpoint === "to" && position > 0) {
    const previous = findListItemAtSelection(doc.resolve(position - 1));
    if (previous?.node.type.name === "taskItem") return previous;
  }

  if (endpoint === "from" && position < doc.content.size) {
    const next = findListItemAtSelection(doc.resolve(position + 1));
    if (next?.node.type.name === "taskItem") return next;
  }

  return null;
}

function findFirstTextblockContentStart(node: ProseMirrorNode, pos: number): number | null {
  if (node.isTextblock) return pos + 1;

  let found: number | null = null;
  node.forEach((child, offset) => {
    if (found !== null) return;
    found = findFirstTextblockContentStart(child, pos + 1 + offset);
  });
  return found;
}

function findLastTextblockContentEnd(node: ProseMirrorNode, pos: number): number | null {
  if (node.isTextblock) return pos + 1 + node.content.size;

  let found: number | null = null;
  node.forEach((child, offset) => {
    const childEnd = findLastTextblockContentEnd(child, pos + 1 + offset);
    if (childEnd !== null) found = childEnd;
  });
  return found;
}

function getChildIndexAtPos(parent: ProseMirrorNode, parentFrom: number, childFrom: number) {
  let childPos = parentFrom + 1;
  for (let index = 0; index < parent.childCount; index += 1) {
    const child = parent.child(index);
    if (childPos === childFrom) return index;
    childPos += child.nodeSize;
  }
  return null;
}

function serializeClipboardHtmlFragment(view: EditorView, fragment: ProseMirrorFragment) {
  const container = document.createElement("div");
  container.appendChild(DOMSerializer.fromSchema(view.state.schema).serializeFragment(fragment));
  return normalizeTableClipboardHtml(container.innerHTML).trim();
}

function normalizeTableClipboardHtml(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll("colgroup").forEach((colgroup) => colgroup.remove());
  container.querySelectorAll<HTMLElement>("[data-node-view-wrapper], [data-node-view-content], [data-node-view-content-react]").forEach((element) => {
    element.removeAttribute("data-node-view-wrapper");
    element.removeAttribute("data-node-view-content");
    element.removeAttribute("data-node-view-content-react");
  });
  container.querySelectorAll<HTMLElement>("table").forEach((table) => {
    table.removeAttribute("style");
    table.removeAttribute("data-node-view-wrapper");
    table.removeAttribute("data-tigrana-table");
    table.removeAttribute("data-header-row");
    table.removeAttribute("data-header-column");
  });
  return container.innerHTML;
}

async function writeRichClipboard(html: string, plainText: string) {
  if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plainText], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(plainText);
}

export function isInternalNotebookHref(href: string) {
  if (!href) return false;
  if (/^(?:[a-z][a-z0-9+.-]*:)/i.test(href)) return false; // any scheme: http, mailto, tigrana-note, etc.
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

async function insertImageFile(
  view: EditorView,
  workspace: string,
  file: File,
  expectedNotePath: string | null,
  getCurrentNotePath: () => string | null,
) {
  const src = await saveAsset(workspace, file);
  const previewSrc = await previewSrcForNotebookImage(workspace, src);
  if (getCurrentNotePath() !== expectedNotePath) return;
  insertSavedImage(view, previewSrc, src, file.name || "Pasted image");
}

async function insertNativeClipboardImage(
  view: EditorView,
  workspace: string,
  expectedNotePath: string | null,
  getCurrentNotePath: () => string | null,
) {
  const src = await saveClipboardImageAsset(workspace);
  const previewSrc = await previewSrcForNotebookImage(workspace, src);
  if (getCurrentNotePath() !== expectedNotePath) return;
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
  const cacheKey = `${workspace}\0${src}`;
  const cached = notebookImagePreviewCache.get(cacheKey);
  if (cached) return cached;

  const dataUrl = await readAssetDataUrl(workspace, src);
  const file = dataUrlToFile(dataUrl);
  if (!file) return dataUrl;
  const objectUrl = URL.createObjectURL(file);
  notebookImagePreviewCache.set(cacheKey, objectUrl);
  return objectUrl;
}

async function hydrateNotebookImageNodes(
  editor: Editor,
  workspace: string,
  expectedNotePath: string | null,
  getCurrentNotePath: () => string | null,
) {
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

  if (getCurrentNotePath() !== expectedNotePath) return;
  const tr = editor.state.tr;
  let changed = false;
  for (const item of resolved) {
    if (getCurrentNotePath() !== expectedNotePath) return;
    if (!item.previewSrc) continue;
    const node = tr.doc.nodeAt(item.pos);
    if (!node || node.type.name !== "image") continue;
    if (node.attrs.src === item.previewSrc && node.attrs.markdownSrc === item.src) continue;
    tr.setNodeMarkup(item.pos, undefined, { ...item.attrs, src: item.previewSrc, markdownSrc: item.src });
    changed = true;
  }
  if (changed) editor.view.dispatch(tr);
}

function findSlashQuery(editor: NonNullable<ReturnType<typeof useEditor>>) {
  return findSlashQueryInState(editor.state);
}

export function findSlashQueryInState(state: EditorState) {
  const { from } = state.selection;
  const parentName = state.selection.$from.parent.type.name;
  if (parentName !== "paragraph" && parentName !== "heading") return null;
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
