import { filterSlashCommands } from "./slashCommands";
// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, expect, it } from "vitest";
import { TextAlignmentExtension, setTextAlignment } from "./textAlignment";
import { StoryParagraphs } from "./storyParagraphs";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown";
import { measureNoteText } from "../lib/noteTextStats";
import { extractNoteOutline } from "../lib/noteDocument";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function create(content: string) {
  const editor = new Editor({ extensions: [StarterKit, StoryParagraphs, TextAlignmentExtension], content });
  editors.push(editor);
  return editor;
}

it.each(["center", "right"] as const)("round-trips %s paragraphs and headings with readable Markdown", alignment => {
  const editor = create('<h2>Heading</h2><p data-story-indent="none"><strong>Bold</strong> and <em>italic</em>.</p>');
  editor.commands.selectAll();
  expect(setTextAlignment(editor, alignment)).toBe(true);
  const markdown = htmlToMarkdown(editor.getHTML());
  expect(markdown).toContain(`<div style="text-align: ${alignment}">\n\n## Heading\n\n</div>`);
  expect(markdown).toContain('**Bold** and *italic*.');
  expect(measureNoteText(markdown)).toEqual(measureNoteText('## Heading\n\n**Bold** and *italic*.'));
  expect(extractNoteOutline('', markdown)).toEqual([{ id: 'heading-0', level: 2, text: 'Heading' }]);
  const restored = create(markdownToHtml(markdown));
  expect(restored.state.doc.firstChild?.attrs.textAlign).toBe(alignment);
  expect(restored.state.doc.child(1).attrs.storyIndent).toBe('none');
  expect(htmlToMarkdown(restored.getHTML())).toBe(markdown);
  restored.commands.selectAll();
  expect(setTextAlignment(restored, 'left')).toBe(true);
  expect(htmlToMarkdown(restored.getHTML())).not.toContain('<div');
});

it('aligns the current paragraph without selecting text and can undo it', () => {
  const editor = create('<p>Text</p>');
  editor.commands.setTextSelection(2);
  expect(setTextAlignment(editor, 'center')).toBe(true);
  expect(editor.state.doc.firstChild?.attrs.textAlign).toBe('center');
  editor.commands.undo();
  expect(editor.state.doc.firstChild?.attrs.textAlign).toBeNull();
});

it.each(['<ul><li><p>List</p></li></ul>', '<blockquote><p>Quote</p></blockquote>', '<pre><code>Code</code></pre>'])(
  'does not apply unsupported block alignment: %s', content => {
    const editor = create(content);
    editor.commands.selectAll();
    expect(setTextAlignment(editor, 'center')).toBe(false);
  },
);

it('keeps div examples literal in code and rejects arbitrary alignment attributes', () => {
  const markdown = '```html\n<div style="text-align: center">\n\nText\n\n</div>\n```';
  expect(htmlToMarkdown(markdownToHtml(markdown)).trim()).toBe(markdown);
  const html = markdownToHtml('<div style="text-align: center" onclick="alert(1)">\n\nText\n\n</div>');
  expect(html).not.toContain('<div');
  expect(html).toContain('&lt;div');
});

it('preserves alignment on an empty paragraph across save and reload', () => {
  const editor = create('<p></p>');
  setTextAlignment(editor, 'right');
  const restored = create(markdownToHtml(htmlToMarkdown(editor.getHTML())));
  expect(restored.state.doc.firstChild?.attrs.textAlign).toBe('right');
});

it('keeps Text first in slash commands and hides alignment inside lists', () => {
  const paragraph = create('<p>/align</p>');
  expect(filterSlashCommands('', paragraph)[0].id).toBe('paragraph');
  expect(filterSlashCommands('align', paragraph)).toHaveLength(3);
  const list = create('<ul><li><p>/align</p></li></ul>');
  expect(filterSlashCommands('align', list)).toHaveLength(0);
});
