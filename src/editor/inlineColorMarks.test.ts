// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { afterEach, describe, expect, it } from "vitest";
import { applyInlineColor, ColorHighlight, TextColor } from "./inlineColorMarks";
import { inlineColors, isInlineColorCommand, normalizeInlineColor } from "../lib/inlineColors";

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
const { markdownToHtml, htmlToMarkdown } = await import("../lib/markdown");
const { readNoteDocument, measureNoteText } = await import("../lib/noteDocument");

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function makeEditor(markdown = "Some **important** [linked](https://example.com) text.") {
  const editor = new Editor({ extensions: [StarterKit, TextColor, ColorHighlight, TaskList, TaskItem, Table, TableRow, TableCell, TableHeader], content: markdownToHtml(markdown) });
  editors.push(editor);
  editor.commands.selectAll();
  return editor;
}
const save = (editor: Editor) => htmlToMarkdown(editor.getHTML()).trim();
function pressEnter(editor: Editor, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey, bubbles: true, cancelable: true });
  editor.view.someProp("handleKeyDown", handler => handler(editor.view, event));
}
function type(editor: Editor, text: string) {
  editor.view.dispatch(editor.state.tr.insertText(text));
}

describe("portable inline colors", () => {
  it("uses the note foreground for external rich-text paste while retaining nested formatting", () => {
    const editor = makeEditor("");
    editor.view.pasteHTML('<ul><li><p>Git worktrees</p><ul><li><p><strong>The AI benefit:</strong> <span style="color: rgb(0, 0, 0)">agents can edit independently</span></p></li></ul></li></ul>', new Event("paste") as ClipboardEvent);
    expect(save(editor)).toContain("**The AI benefit:** agents can edit independently");
    expect(save(editor)).not.toContain("span");
    expect(editor.getHTML()).toContain("<ul>");
  });

  it("retains explicit Tigrana colors when pasting between notes", () => {
    const source = makeEditor("Colored");
    applyInlineColor(source, "textColor_red");
    applyInlineColor(source, "highlightColor_green");
    const target = makeEditor("");
    target.view.pasteHTML(source.getHTML(), new Event("paste") as ClipboardEvent);
    expect(save(target)).toBe(save(source));
  });

  it.each(["black", "white", "#ffffff", "rgb(0, 0, 0)", "red"])("drops external %s foreground without losing highlights or links", color => {
    const editor = makeEditor("");
    editor.view.pasteHTML(`<p><span style="color: ${color}; background-color: #ffff00"><a href="https://example.com"><em>Linked</em></a></span></p>`, new Event("paste") as ClipboardEvent);
    expect(editor.getHTML()).not.toContain("data-text-color");
    expect(editor.getHTML()).toContain('data-highlight-color="#ffff00"');
    expect(save(editor)).toContain("https://example.com");
    expect(editor.getHTML()).toContain("<em>");
  });

  it("preserves stored literal colors when loading a note", () => {
    const markdown = '<span style="color: #000000">Explicit black</span>';
    expect(save(makeEditor(markdown))).toBe(markdown);
  });

  it.each(inlineColors)("round-trips $label text and highlights through the real editor", color => {
    const editor = makeEditor();
    const original = editor.getJSON();
    applyInlineColor(editor, `textColor_${color.id}`);
    applyInlineColor(editor, `highlightColor_${color.id}`);
    const markdown = save(editor);
    expect(markdown).toContain(`color: ${color.text.light}`);
    expect(markdown).toContain(`background-color: ${color.highlight.light}`);
    expect(markdown).not.toMatch(/data-text|data-highlight|var\(/);
    const loaded = makeEditor(markdown);
    expect(loaded.getJSON()).toEqual(editor.getJSON());
    expect(save(loaded)).toBe(markdown);
    applyInlineColor(loaded, "textColor_default");
    expect(save(loaded)).not.toContain(`style="color:`);
    expect(save(loaded)).toContain("background-color:");
    applyInlineColor(loaded, "highlightColor_none");
    expect(loaded.getJSON()).toEqual(original);
    expect(save(loaded)).not.toContain("span");
  });

  it("preserves default highlights and independently removes highlight or text color", () => {
    const editor = makeEditor("==Old highlight==");
    expect(save(editor)).toBe("==Old highlight==");
    applyInlineColor(editor, "textColor_red");
    applyInlineColor(editor, "highlightColor_green");
    applyInlineColor(editor, "highlightColor_none");
    expect(editor.isActive("textColor")).toBe(true);
    expect(editor.isActive("highlight")).toBe(false);
    applyInlineColor(editor, "highlightColor_default");
    expect(save(editor)).toMatch(/^==<span style="color: #a83232">Old highlight<\/span>==$/);
    applyInlineColor(editor, "textColor_default");
    expect(save(editor)).toBe("==Old highlight==");
    editor.commands.unsetAllMarks();
    expect(save(editor)).toBe("Old highlight");
  });

  it.each([
    "## Heading\n\n- **First**\n  - Second\n- Third",
    "| Name | Value |\n| --- | --- |\n| *Green* | [Link](https://example.com) |",
    "> <u>Underlined</u> and ~~struck~~",
  ])("preserves block structure and existing marks in %s", markdown => {
    const editor = makeEditor(markdown);
    const before = editor.getJSON();
    applyInlineColor(editor, "textColor_green");
    applyInlineColor(editor, "highlightColor_yellow");
    const loaded = makeEditor(save(editor));
    expect(loaded.getJSON()).toEqual(editor.getJSON());
    applyInlineColor(loaded, "textColor_default");
    applyInlineColor(loaded, "highlightColor_none");
    expect(loaded.getJSON()).toEqual(before);
  });

  it("undoes color changes and refuses edits to read-only notes", () => {
    const editor = makeEditor("Plain");
    applyInlineColor(editor, "textColor_red");
    expect(save(editor)).toContain("span");
    editor.commands.undo();
    expect(save(editor)).toBe("Plain");
    editor.setEditable(false);
    expect(applyInlineColor(editor, "textColor_blue")).toBe(false);
    expect(save(editor)).toBe("Plain");
  });

  it("supports a combined span and nested spans without losing either color", () => {
    const md = '<span style="color: #a83232; background-color: #dcecdf">**Red** on green</span>';
    const editor = makeEditor(md);
    expect(editor.getAttributes("textColor").color).toBe("#a83232");
    expect(editor.getAttributes("highlight").color).toBe("#dcecdf");
    expect(makeEditor(save(editor)).getJSON()).toEqual(editor.getJSON());
  });

  it("keeps color examples literal in code and rejects arbitrary HTML/CSS", () => {
    const html = markdownToHtml('`<span style="color: #a83232">literal</span>`\n\n```html\n<span style="color: #a83232">literal</span>\n```');
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("span")).toBeNull();
    expect(doc.querySelectorAll("code")).toHaveLength(2);
    for (const markup of [
      '<span style="color: #ff0000" onclick="alert(1)">Unsafe</span>',
      '<span style="background-color: url(https://example.com)">Unsafe</span>',
      '<span style="color: #ff0000; position: fixed">Unsafe</span>',
      '<span style="color: #ff0000">Unclosed',
    ]) expect(new DOMParser().parseFromString(markdownToHtml(markup), "text/html").querySelector("span")).toBeNull();
  });

  it("does not count span markup in note stats, previews, or headings", () => {
    const plain = "# Important\n\nSome words here";
    const colored = '# <span style="color: #a83232">Important</span>\n\nSome <span style="background-color: #dcecdf">words</span> here';
    expect(measureNoteText(colored)).toEqual(measureNoteText(plain));
    const a = readNoteDocument(plain, "Title"), b = readNoteDocument(colored, "Title");
    expect(b.outline).toEqual(a.outline);
    expect(b.preview).toEqual(a.preview);
  });

  it("saves portable colors in rich HTML tables", () => {
    const editor = makeEditor("Table text");
    applyInlineColor(editor, "textColor_red");
    applyInlineColor(editor, "highlightColor_green");
    const markdown = htmlToMarkdown(`<table data-tigrana-table="true" data-header-row="false"><tbody><tr><td>${editor.getHTML()}</td></tr></tbody></table>`);
    expect(markdown).toContain('data-tigrana-table="true"');
    expect(markdown).toContain("color: #a83232");
    expect(markdown).toContain("background-color: #dcecdf");
    expect(markdown).not.toMatch(/data-text-color|data-highlight-color|var\(/);
    const loaded = makeEditor(markdown);
    expect(loaded.getAttributes("textColor").color).toBe("#a83232");
    expect(loaded.getAttributes("highlight").color).toBe("#dcecdf");
  });

  it("preserves marks when coloring a partial selection and subsequent typing", () => {
    const editor = makeEditor("First second third");
    editor.commands.setTextSelection({ from: 7, to: 13 });
    applyInlineColor(editor, "textColor_red");
    expect(save(editor)).toBe('First <span style="color: #a83232">second</span> third');
    editor.commands.setTextSelection(13);
    applyInlineColor(editor, "textColor_default");
    editor.commands.insertContent(" plain");
    expect(save(editor)).toBe('First <span style="color: #a83232">second</span> plain third');
    expect(makeEditor(save(editor)).getJSON()).toEqual(editor.getJSON());
  });

  it("accepts ordinary named HTML colors", () => {
    const editor = makeEditor('<span style="color: red">Red</span> and <span style="background-color: green">green</span>');
    expect(save(editor)).toContain("color: #ff0000");
    expect(save(editor)).toContain("background-color: #008000");
    expect(normalizeInlineColor("constructor")).toBeNull();
  });

  it.each(["**Colored**", "- **Colored**", "1. **Colored**", "- [ ] **Colored**", "> **Colored**", "## **Colored**"])("ends highlighting on Enter while retaining text color and existing formatting: %s", markdown => {
    const editor = makeEditor(markdown);
    applyInlineColor(editor, "textColor_red");
    applyInlineColor(editor, "highlightColor_green");
    let end = 0;
    editor.state.doc.descendants((node, pos) => { if (node.isText) end = pos + node.nodeSize; });
    editor.commands.setTextSelection(end);
    pressEnter(editor);
    type(editor, "Normal");
    const texts: Array<{ text: string; marks: string[] }> = [];
    editor.state.doc.descendants(node => {
      if (node.isText) texts.push({ text: node.text!, marks: node.marks.map(mark => mark.type.name) });
    });
    expect(texts).toHaveLength(2);
    expect(texts[0]).toEqual({ text: "Colored", marks: expect.arrayContaining(["bold", "textColor", "highlight"]) });
    expect(texts[1]).toEqual({ text: "Normal", marks: ["bold", "textColor"] });
  });

  it("stops legacy highlights on Enter too", () => {
    const editor = makeEditor("==Highlighted==");
    editor.commands.setTextSelection(12);
    pressEnter(editor);
    type(editor, "Normal");
    expect(save(editor)).toBe("==Highlighted==\n\nNormal");
  });

  it("ends highlighting but retains text color after Shift+Enter", () => {
    const editor = makeEditor("Colored");
    applyInlineColor(editor, "textColor_red");
    applyInlineColor(editor, "highlightColor_green");
    editor.commands.setTextSelection(8);
    pressEnter(editor, true);
    type(editor, "Continued");
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild!.lastChild!.text).toBe("Continued");
    expect(editor.state.doc.firstChild!.lastChild!.marks.map(mark => mark.type.name)).toEqual(["textColor"]);
  });

  it("keeps typing in the chosen colors until independently reset without changing earlier text", () => {
    const editor = makeEditor("Plain");
    editor.commands.setTextSelection(6);
    expect(applyInlineColor(editor, "textColor_red")).toBe(true);
    expect(applyInlineColor(editor, "highlightColor_green")).toBe(true);
    type(editor, " red");
    type(editor, " green");
    applyInlineColor(editor, "highlightColor_none");
    type(editor, " red only");
    applyInlineColor(editor, "textColor_default");
    type(editor, " plain");
    const nodes = editor.state.doc.firstChild!.content.content;
    expect(nodes.map(node => node.text)).toEqual(["Plain", " red green", " red only", " plain"]);
    expect(nodes.map(node => node.marks.map(mark => mark.type.name))).toEqual([
      [], ["highlight", "textColor"], ["textColor"], [],
    ]);
    expect(makeEditor(save(editor)).getJSON()).toEqual(editor.getJSON());
  });

  it("can enable and disable the legacy highlight shortcut while typing", () => {
    const editor = makeEditor("Plain");
    editor.commands.setTextSelection(6);
    expect(editor.commands.toggleHighlight()).toBe(true);
    type(editor, " highlighted");
    expect(editor.commands.toggleHighlight()).toBe(true);
    type(editor, " plain");
    expect(save(editor)).toBe("Plain== highlighted== plain");
  });

  it("normalizes safe clipboard colors and validates menu commands", () => {
    expect(normalizeInlineColor("rgb(168, 50, 50)")).toBe("#a83232");
    expect(normalizeInlineColor("#abc")).toBe("#aabbcc");
    expect(normalizeInlineColor("rgb(999, 0, 0)")).toBeNull();
    expect(normalizeInlineColor("var(--something)")).toBeNull();
    expect(isInlineColorCommand("textColor_red")).toBe(true);
    expect(isInlineColorCommand("highlightColor_none")).toBe(true);
    expect(isInlineColorCommand("textColor_none")).toBe(false);
    expect(isInlineColorCommand("highlightColor_unrecognized")).toBe(false);
  });
});
