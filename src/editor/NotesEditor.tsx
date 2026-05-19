import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Extension } from "@tiptap/core";
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
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { BubbleMenu, EditorContent, Range, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Bold,
  ChevronDown,
  ChevronUp,
  CheckSquare,
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
  Search,
  Strikethrough,
  X,
} from "lucide-react";
import { common, createLowlight } from "lowlight";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filterSlashCommands } from "./slashCommands";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown";
import { isTauri, readAssetDataUrl, saveAsset, saveClipboardImageAsset } from "../lib/notesApi";
import type { NotePositionMetadata } from "../types";

type NotesEditorProps = {
  content: string;
  focusRequest: number;
  focusAtEndRequest: number;
  findRequest: number;
  notePath: string | null;
  restorePosition: NotePositionMetadata | null;
  workspace: string;
  onChange: (markdown: string) => void;
  onLoadError: (error: unknown) => void;
  onPositionChange: (position: { selectedText: string; selectionFrom: number; selectionTo: number }) => void;
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

const MarkdownImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      markdownSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-markdown-src"),
        renderHTML: (attributes) => (attributes.markdownSrc ? { "data-markdown-src": attributes.markdownSrc } : {}),
      },
    };
  },
});

export function NotesEditor({ content, focusRequest, focusAtEndRequest, findRequest, notePath, restorePosition, workspace, onChange, onLoadError, onPositionChange }: NotesEditorProps) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const slashRef = useRef<SlashState | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const handledFindRequest = useRef(findRequest);
  const lastLoadedNote = useRef<string | null>(null);

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
      CodeBlockLowlight.configure({ lowlight }),
      Highlight,
      SearchHighlight,
      MarkdownImage.configure({
        inline: false,
        allowBase64: false,
      }),
      Link.configure({
        autolink: true,
        openOnClick: false,
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
      command.run(currentEditor, currentSlash.range);
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
  }, []);

  const editor = useEditor({
    extensions,
    content: initialContent.html,
    editorProps: {
      handleDOMEvents: {
        keydown(_view, event) {
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
        click(_view, event) {
          const link = (event.target as HTMLElement | null)?.closest("a");
          if (!link) return false;
          event.preventDefault();
          return true;
        },
      },
      handlePaste(view, event) {
        const file = getClipboardImageFile(event.clipboardData);
        const htmlFile = file ? null : getClipboardImageFromHtml(event.clipboardData);
        const hasHtmlImage = clipboardHtmlHasImage(event.clipboardData);
        if (!file && !htmlFile && !hasHtmlImage && !mayContainAsyncClipboardImage(event.clipboardData)) return false;

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
    if (lastLoadedNote.current === notePath) return;
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
    // Blur first so the browser removes the cursor before new content is painted,
    // preventing a ghost caret from the previous note appearing briefly.
    editor.commands.blur();
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
      void hydrateNotebookImageNodes(editor, workspace);
    } catch (error) {
      onLoadError(error);
    }
  }, [content, editor, notePath, onLoadError, restorePosition, workspace]);

  useEffect(() => {
    if (!editor || !focusRequest) return;
    editor.chain().focus("start").run();
  }, [editor, focusRequest]);

  useEffect(() => {
    if (!editor || !focusAtEndRequest) return;
    editor.chain().focus().setTextSelection(editor.state.doc.content.size).run();
  }, [editor, focusAtEndRequest]);

  useEffect(() => {
    if (!findRequest || findRequest === handledFindRequest.current) return;
    handledFindRequest.current = findRequest;
    setFindOpen(true);
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
        const pm = editor.view.dom;
        if (pm.contains(e.target as Node)) return;
        e.preventDefault();
        editor.chain().focus().setTextSelection(editor.state.doc.content.size).run();
      }}
    >
      {editor ? <FormattingBubbleMenu editor={editor} /> : null}
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
                  command.run(editor, currentSlash.range);
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

function FormattingBubbleMenu({ editor }: { editor: Editor }) {
  const setLink = () => {
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previousUrl ?? "");
    if (url === null) return;
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
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

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{ duration: 120, placement: "top" }}
      shouldShow={({ editor }) => {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && activeElement.closest(".note-find-bar")) return false;
        return !editor.state.selection.empty && editor.isEditable;
      }}
    >
      <div className="format-bubble">
        {buttons.map((button) => {
          const Icon = button.icon;
          return (
            <button
              className={button.active ? "is-active" : ""}
              key={button.label}
              type="button"
              title={button.label}
              onClick={button.run}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </div>
    </BubbleMenu>
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

function clipboardHtmlHasImage(data: DataTransfer | null) {
  return /<img[\s>]/i.test(data?.getData("text/html") ?? "");
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
