import type { Editor, Range } from "@tiptap/react";
import {
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image,
  List,
  ListOrdered,
  Minus,
  Quote,
  Type,
  type LucideIcon,
} from "lucide-react";

export type SlashCommand = {
  id: string;
  title: string;
  hint: string;
  icon: LucideIcon;
  keywords: string[];
  run: (editor: Editor, range: Range) => void;
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
];

export function filterSlashCommands(query: string) {
  const lower = query.toLowerCase();
  return slashCommands.filter((command) => {
    return (
      command.title.toLowerCase().includes(lower) ||
      command.keywords.some((keyword) => keyword.includes(lower))
    );
  });
}
