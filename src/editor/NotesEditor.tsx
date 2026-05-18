import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
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
import { TextSelection } from "@tiptap/pm/state";
import { BubbleMenu, EditorContent, Range, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import { common, createLowlight } from "lowlight";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filterSlashCommands } from "./slashCommands";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown";
import { saveAsset } from "../lib/notesApi";
import type { NotePositionMetadata } from "../types";

type NotesEditorProps = {
  content: string;
  focusRequest: number;
  focusAtEndRequest: number;
  notePath: string | null;
  restorePosition: NotePositionMetadata | null;
  workspace: string;
  onChange: (markdown: string) => void;
  onPositionChange: (position: { selectionFrom: number; selectionTo: number }) => void;
};

type SlashState = {
  range: Range;
  query: string;
  selected: number;
};

const lowlight = createLowlight(common);

export function NotesEditor({ content, focusRequest, focusAtEndRequest, notePath, restorePosition, workspace, onChange, onPositionChange }: NotesEditorProps) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const slashRef = useRef<SlashState | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const lastLoadedNote = useRef<string | null>(null);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({ lowlight }),
      Highlight,
      Image.configure({
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
    content: markdownToHtml(content),
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
      },
      handlePaste(view, event) {
        const item = Array.from(event.clipboardData?.items ?? []).find((clipboardItem) =>
          clipboardItem.type.startsWith("image/"),
        );
        const file = item?.getAsFile();
        if (!file) return false;

        event.preventDefault();
        void saveAsset(workspace, file).then((src) => {
          const name = file.name || "Pasted image";
          editor?.chain().focus().setImage({ src, alt: name }).run();
        });
        return true;
      },
    },
    onUpdate({ editor }) {
      onChange(htmlToMarkdown(editor.getHTML()));
      onPositionChange({
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
    if (lastLoadedNote.current === notePath) return;
    const next = markdownToHtml(content);
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
    editor
      .chain()
      .setContent(next, false)
      .command(({ tr, state }) => {
        const targetFrom = hasValidRestore ? Math.max(1, selectionFrom as number) : 1;
        const targetTo = hasValidRestore
          ? Math.min(Math.max(1, selectionTo as number), state.doc.content.size)
          : 1;
        tr.setSelection(TextSelection.create(state.doc, targetFrom, targetTo));
        return true;
      })
      .run();
    lastLoadedNote.current = notePath;
  }, [content, editor, notePath, restorePosition]);

  useEffect(() => {
    if (!editor || !focusRequest) return;
    editor.chain().focus("start").run();
  }, [editor, focusRequest]);

  useEffect(() => {
    if (!editor || !focusAtEndRequest) return;
    editor.chain().focus().setTextSelection(editor.state.doc.content.size).run();
  }, [editor, focusAtEndRequest]);

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
        const pm = editor.view.dom;
        if (pm.contains(e.target as Node)) return;
        e.preventDefault();
        editor.chain().focus().setTextSelection(editor.state.doc.content.size).run();
      }}
    >
      {editor ? <FormattingBubbleMenu editor={editor} /> : null}
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
    { label: "Bullets", icon: List, active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "Numbers", icon: ListOrdered, active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "Tasks", icon: CheckSquare, active: editor.isActive("taskList"), run: () => editor.chain().focus().toggleTaskList().run() },
    { label: "Quote", icon: Quote, active: editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
  ];

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{ duration: 120, placement: "top" }}
      shouldShow={({ editor }) => !editor.state.selection.empty && editor.isEditable}
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
