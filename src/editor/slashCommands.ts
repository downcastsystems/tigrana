import type { Editor, Range } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import {
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image,
  Laugh,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Table,
  Type,
  type LucideIcon,
} from "lucide-react";

export type SlashCommandContext = {
  requestEmoji?: () => Promise<string | null>;
  requestLink?: () => Promise<{ href: string; title: string } | null>;
};

export type SlashCommand = {
  id: string;
  title: string;
  hint: string;
  icon: LucideIcon;
  keywords: string[];
  run: (editor: Editor, range: Range, context: SlashCommandContext) => void;
};

export const slashCommands: SlashCommand[] = [
  {
    id: "paragraph",
    title: "Text",
    hint: "Plain paragraph",
    icon: Type,
    keywords: ["p", "paragraph", "text"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    id: "heading-1",
    title: "Heading 1",
    hint: "Large section title",
    icon: Heading1,
    keywords: ["h1", "heading", "title"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    title: "Heading 2",
    hint: "Medium section title",
    icon: Heading2,
    keywords: ["h2", "heading", "subtitle"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    id: "heading-3",
    title: "Heading 3",
    hint: "Small section title",
    icon: Heading3,
    keywords: ["h3", "heading"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    id: "heading-4",
    title: "Heading 4",
    hint: "Nested section title",
    icon: Heading4,
    keywords: ["h4", "heading"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 4 }).run(),
  },
  {
    id: "heading-5",
    title: "Heading 5",
    hint: "Small nested title",
    icon: Heading5,
    keywords: ["h5", "heading"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 5 }).run(),
  },
  {
    id: "heading-6",
    title: "Heading 6",
    hint: "Tiny nested title",
    icon: Heading6,
    keywords: ["h6", "heading"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 6 }).run(),
  },
  {
    id: "bullet-list",
    title: "Bullet List",
    hint: "Simple unordered list",
    icon: List,
    keywords: ["ul", "bullet", "list"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "ordered-list",
    title: "Numbered List",
    hint: "Ordered list",
    icon: ListOrdered,
    keywords: ["ol", "number", "list"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "task-list",
    title: "Task List",
    hint: "Checkbox list",
    icon: CheckSquare,
    keywords: ["todo", "task", "check"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "quote",
    title: "Quote",
    hint: "Indented quotation",
    icon: Quote,
    keywords: ["blockquote", "quote"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: "code",
    title: "Code Block",
    hint: "Monospace block",
    icon: Code,
    keywords: ["code", "pre"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: "divider",
    title: "Divider",
    hint: "Horizontal rule",
    icon: Minus,
    keywords: ["hr", "divider", "line"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: "emoji",
    title: "Emoji",
    hint: "Search and insert an emoji",
    icon: Laugh,
    keywords: ["emoji", "emote", "smile", "icon", "shortcode"],
    run: (editor, range, context) => {
      if (!context.requestEmoji) return;
      void context.requestEmoji().then((shortcode) => {
        if (!shortcode) {
          editor.chain().focus().deleteRange(range).run();
          return;
        }
        editor.chain().focus().deleteRange(range).setEmoji(shortcode).run();
      });
    },
  },
  {
    id: "link",
    title: "Link to note, folder, or URL",
    hint: "Link inside this notebook or out to the web",
    icon: Link2,
    keywords: ["link", "note", "internal", "wiki", "reference"],
    run: (editor, range, context) => {
      if (!context.requestLink) return;
      void context.requestLink().then((pick) => {
        if (!pick) {
          editor.chain().focus().deleteRange(range).run();
          return;
        }
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent([
            {
              type: "text",
              text: pick.title,
              marks: [{ type: "link", attrs: { href: pick.href } }],
            },
            // Trailing plain-text space so subsequent typing is not part of the link.
            { type: "text", text: " " },
          ])
          .run();
      });
    },
  },
  {
    id: "image",
    title: "Image",
    hint: "Insert by URL",
    icon: Image,
    keywords: ["image", "photo", "picture"],
    run: (editor, range) => {
      const url = window.prompt("Image URL");
      if (!url) return;
      editor.chain().focus().deleteRange(range).setImage({ src: url, alt: "Image" }).run();
    },
  },
  {
    id: "table",
    title: "Table",
    hint: "Insert a table",
    icon: Table,
    keywords: ["table", "grid", "spreadsheet"],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      markCurrentTableAsTigranaHtml(editor);
      ensureParagraphAfterCurrentTable(editor);
    },
  },
];

function markCurrentTableAsTigranaHtml(editor: Editor) {
  const { state, view } = editor;
  const { selection } = state;
  let tableDepth = -1;
  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    if (selection.$from.node(depth).type.name === "table") {
      tableDepth = depth;
      break;
    }
  }
  if (tableDepth < 0) return;

  const tablePos = selection.$from.before(tableDepth);
  const tableNode = selection.$from.node(tableDepth);
  const map = TableMap.get(tableNode);
  let tr = state.tr.setNodeMarkup(tablePos, undefined, {
    ...tableNode.attrs,
    tigranaTable: true,
    headerRow: true,
    headerColumn: false,
  });

  // Set colwidth on every cell in every row so prosemirror-tables' fixTables
  // doesn't treat the row 0 widths as a "colwidth mismatch" and revert them.
  for (let column = 0; column < map.width; column += 1) {
    const seen = new Set<number>();
    for (let row = 0; row < map.height; row += 1) {
      const cellPos = tablePos + 1 + map.positionAt(row, column, tableNode);
      if (seen.has(cellPos)) continue;
      seen.add(cellPos);
      const cell = tr.doc.nodeAt(cellPos);
      if (!cell) continue;
      tr = tr.setNodeMarkup(cellPos, undefined, {
        ...cell.attrs,
        colwidth: [180],
      });
    }
  }

  view.dispatch(tr);
}

function ensureParagraphAfterCurrentTable(editor: Editor) {
  const { state, view } = editor;
  const { selection, schema } = state;
  const paragraph = schema.nodes.paragraph;
  if (!paragraph) return;

  let tableDepth = -1;
  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    if (selection.$from.node(depth).type.name === "table") {
      tableDepth = depth;
      break;
    }
  }
  if (tableDepth < 0) return;

  const tablePos = selection.$from.before(tableDepth);
  const tableNode = selection.$from.node(tableDepth);
  const afterTable = tablePos + tableNode.nodeSize;
  const nextNode = state.doc.nodeAt(afterTable);
  const tr = nextNode?.type.name === "paragraph"
    ? state.tr
    : state.tr.insert(afterTable, paragraph.create());
  const cursorPos = Math.min(afterTable + 1, tr.doc.content.size);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, cursorPos)).scrollIntoView());
}

export function filterSlashCommands(query: string) {
  const lower = query.toLowerCase();
  return slashCommands.filter((command) => {
    return (
      command.title.toLowerCase().includes(lower) ||
      command.keywords.some((keyword) => keyword.includes(lower))
    );
  });
}
