// @vitest-environment jsdom
import { bulletCelebrationKey } from "./bulletCelebration";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, expect, it } from "vitest";
import { BulletMethodMarkers, bulletMethodMarkersKey } from "./bulletMethodMarkers";
import { statusShortcut, defaultBulletMethodStatuses, validateBulletMethodStatuses, readBulletMethodStatuses, writeBulletMethodStatuses, readBulletMethodDisplay, writeBulletMethodDisplay, bulletMethodSettingsKey, bulletMethodDisplayKey } from "../lib/bulletMethod";
import { TextColor } from "./inlineColorMarks";
import { htmlToMarkdown } from "../lib/markdown";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function create(content: string, enabled = true) {
  const editor = new Editor({ extensions: [StarterKit, BulletMethodMarkers], content });
  editors.push(editor);
  editor.view.dispatch(editor.state.tr.setMeta("bulletMethodDisplay", { enabled, replaceBullets: true, dimCompleted: true }));
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return editor;
}
function type(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp("handleTextInput", handler => handler(editor.view, from, to, text, () => editor.state.tr.insertText(text, from, to)));
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to));
}
it.each([["::", "TODO"], [".:", "IN PROGRESS"], ["?:", "QUESTION"]])("converts %s after a space and persists the expanded status", (shortcut, status) => {
  const editor = create(`<p>${shortcut}</p>`);
  type(editor, " ");
  expect(editor.state.doc.firstChild?.type.name).toBe("bulletList");
  expect(editor.state.doc.textContent).toBe(`${status}: `);
  expect(htmlToMarkdown(editor.getHTML())).toContain(`- **${status}:**`);
  expect(editor.commands.undoInputRule()).toBe(true);
  expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
  expect(editor.state.doc.textContent).toBe(`${shortcut} `);
});
it.each(["<p>text ::</p>", "<h2>::</h2>", "<pre><code>::</code></pre>", "<blockquote><p>::</p></blockquote>"])("leaves ordinary or non-paragraph content alone: %s", content => {
  const editor = create(content);
  type(editor, " ");
  expect(editor.state.doc.textContent).not.toContain("TODO");
});
it("requires the space and supports disabled shortcuts", () => {
  const editor = create("<p>:</p>");
  type(editor, ":");
  expect(editor.state.doc.textContent).toBe("::");
  editor.view.dispatch(editor.state.tr.setMeta("bulletMethodDisplay", { enabled: true, shortcutsEnabled: false }));
  type(editor, " ");
  expect(editor.state.doc.textContent).toBe(":: ");
  const disabled = create("<p>::</p>", false);
  type(disabled, " ");
  expect(disabled.state.doc.textContent).toBe(":: ");
});
it("uses live custom shortcuts and names without rebuilding the editor", () => {
  const editor = create("<p>go:</p>");
  const statuses = defaultBulletMethodStatuses.map(row => row.id === "todo" ? { ...row, prefix: "NEXT", shortcut: "go:" } : row);
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses));
  type(editor, " ");
  expect(editor.state.doc.textContent).toBe("NEXT: ");
});
it.each([":q", "q:q", "q:", "-:q", ":12345678"])("accepts and expands custom shortcut %s with a colon anywhere", shortcut => {
  const statuses = defaultBulletMethodStatuses.map(row => row.id === "todo" ? { ...row, prefix: "NEXT", shortcut } : row);
  expect(validateBulletMethodStatuses(statuses)).toBeNull();
  const editor = create(`<p>${shortcut}</p>`);
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses));
  type(editor, " ");
  expect(editor.state.doc.firstChild?.type.name).toBe("bulletList");
  expect(editor.state.doc.textContent).toBe("NEXT: ");
  expect(htmlToMarkdown(editor.getHTML())).toContain("- **NEXT:**");
  expect(editor.commands.undoInputRule()).toBe(true);
  expect(editor.state.doc.textContent).toBe(`${shortcut} `);
});
it.each(["q", ":", "has space:", ":123456789", "-:"])("rejects invalid custom shortcut %s", shortcut => {
  expect(validateBulletMethodStatuses(defaultBulletMethodStatuses.map(row => row.id === "todo" ? { ...row, shortcut } : row))).not.toBeNull();
});
it("converts inside an empty bullet without nesting another list", () => {
  const editor = create("<ul><li><p>::</p></li></ul>");
  editor.commands.setTextSelection(5);
  type(editor, " ");
  expect(editor.state.doc.textContent).toBe("TODO: ");
  expect(editor.view.dom.querySelectorAll("ul")).toHaveLength(1);
});
it("converts a prefix before existing text and restores it on immediate Backspace", () => {
  const editor = create("<p>:: following</p>");
  editor.commands.setTextSelection(3);
  type(editor, " ");
  expect(editor.state.doc.textContent).toBe("TODO:  following");
  expect(editor.state.doc.firstChild?.type.name).toBe("bulletList");
  expect(editor.commands.undoInputRule()).toBe(true);
  expect(editor.state.doc.textContent).toBe("::  following");
});
it("does not convert pasted shortcuts", () => {
  const pasted = create("<p></p>");
  pasted.view.pasteText(":: ", new Event("paste") as ClipboardEvent);
  expect(pasted.state.doc.textContent).toContain("::");
});
it("rejects duplicate shortcuts and allows clearing one", () => {
  expect(validateBulletMethodStatuses(defaultBulletMethodStatuses.map(row => row.id === "done" ? { ...row, shortcut: "::" } : row))).toBe("Each shortcut must be unique.");
  expect(validateBulletMethodStatuses(defaultBulletMethodStatuses.map(row => ({ ...row, shortcut: "" })))).toBeNull();
});
it("persists custom and cleared shortcuts and the global switch", () => {
  try {
    const statuses = defaultBulletMethodStatuses.map(row => ({ ...row, shortcut: row.id === "todo" ? "next:" : "" }));
    writeBulletMethodStatuses(statuses);
    expect(readBulletMethodStatuses()).toEqual(statuses);
    writeBulletMethodDisplay({ enabled: true, shortcutsEnabled: false, replaceBullets: true, dimCompleted: true });
    expect(readBulletMethodDisplay().shortcutsEnabled).toBe(false);
    const editor = create("<p>::</p>");
    editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, readBulletMethodStatuses()));
    type(editor, " ");
    expect(editor.state.doc.textContent).toBe(":: ");
  } finally {
    localStorage.removeItem(bulletMethodSettingsKey);
    localStorage.removeItem(bulletMethodDisplayKey);
  }
});
it.each(["x:", "*:", ">:", ":::"])("keeps unassigned shortcut %s as ordinary text", shortcut => {
  const editor = create(`<p>${shortcut}</p>`);
  type(editor, " ");
  expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
  expect(editor.state.doc.textContent).toBe(`${shortcut} `);
});
it("starts from the bottom of the current order and follows renaming", () => {
  const editor = create("<p>-:</p>");
  type(editor, " ");
  expect(editor.state.doc.textContent).toBe("QUESTION: ");
  editor.commands.undoInputRule();
  editor.commands.setContent("<p>-:</p>");
  editor.commands.setTextSelection(3);
  const statuses = [...defaultBulletMethodStatuses].reverse().filter(row => row.prefix !== null);
  const closedIndex = statuses.findIndex(row => row.id === "closed");
  statuses[closedIndex] = { ...statuses[closedIndex], prefix: "WORKING" };
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses));
  type(editor, " ");
  expect(editor.state.doc.textContent).toBe("WORKING: ");
});
it("ignores No status at the bottom of the order and respects the global switch", () => {
  const editor = create("<p>-:</p>");
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, defaultBulletMethodStatuses));
  type(editor, " ");
  expect(editor.state.doc.firstChild?.type.name).toBe("bulletList");
  expect(editor.state.doc.textContent).toBe("QUESTION: ");
  expect(editor.commands.undoInputRule()).toBe(true);
  expect(editor.state.doc.textContent).toBe("-: ");
  const disabled = create("<p>-:</p>");
  disabled.view.dispatch(disabled.state.tr.setMeta("bulletMethodDisplay", { enabled: true, shortcutsEnabled: false }));
  type(disabled, " ");
  expect(disabled.state.doc.textContent).toBe("-: ");
});
it("reserves the fixed shortcut and preserves other settings when migrating an old assignment", () => {
  const statuses = defaultBulletMethodStatuses.map(row => row.id === "done" ? { ...row, prefix: "FINISHED", shortcut: "-:" } : row);
  expect(validateBulletMethodStatuses(statuses)).toContain("reserved");
  try {
    localStorage.setItem(bulletMethodSettingsKey, JSON.stringify(statuses));
    expect(readBulletMethodStatuses().find(row => row.id === "done")).toMatchObject({ prefix: "FINISHED", shortcut: "" });
  } finally { localStorage.removeItem(bulletMethodSettingsKey); }
});
it("starts with TODO when QUESTION has been removed", () => {
  const editor = create("<p>-:</p>");
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, defaultBulletMethodStatuses.filter(row => row.id !== "question")));
  type(editor, " ");
  expect(editor.state.doc.textContent).toBe("TODO: ");
});
it("skips excluded starting statuses but keeps their explicit shortcuts available", () => {
  const statuses = defaultBulletMethodStatuses.map(s => ({ ...s, cycle: s.id !== "question" }));
  for (const [shortcut, expected] of [["-:", "TODO: "], ["::", "TODO: "], ["-TODO:", "TODO: "]]) {
    const editor = create(`<p>${shortcut}</p>`);
    editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses));
    type(editor, " ");
    expect(editor.state.doc.textContent).toBe(expected);
  }
  const editor = create("<p>-:</p>");
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses.map(s => ({ ...s, cycle: false }))));
  type(editor, " ");
  expect(editor.state.doc.textContent).toBe("-: ");
  expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
});
it.each(["TODO", "IN PROGRESS", "DONE", "CLOSED", "QUESTION", "todo"])("converts the automatic named shortcut -%s: and supports immediate reversal", name => {
  const editor = create(`<p>-${name}:</p>`);
  type(editor, " ");
  expect(editor.state.doc.firstChild?.type.name).toBe("bulletList");
  expect(editor.state.doc.textContent).toBe(`${name.toUpperCase()}: `);
  expect(htmlToMarkdown(editor.getHTML())).toContain(`- **${name.toUpperCase()}:**`);
  expect(editor.commands.undoInputRule()).toBe(true);
  expect(editor.state.doc.textContent).toBe(`-${name}: `);
});
it("uses configured names, including long names and punctuation, without requiring a shortcut assignment", () => {
  const editor = create("<p>-Waiting (on review):</p>");
  const statuses = defaultBulletMethodStatuses.map(row => row.id === "todo" ? { ...row, prefix: "Waiting (on review)", shortcut: "" } : row);
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses));
  type(editor, " ");
  expect(editor.state.doc.textContent).toBe("Waiting (on review): ");
  editor.commands.setContent("<p>-TODO:</p>");
  editor.commands.setTextSelection(7);
  type(editor, " ");
  expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
  expect(editor.state.doc.textContent).toBe("-TODO: ");
});
it.each(["-UNKNOWN:", "text -TODO:", "- TODO:"])("leaves nonmatching named shortcut %s alone", text => {
  const editor = create(`<p>${text}</p>`);
  type(editor, " ");
  expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
  expect(editor.state.doc.textContent).toBe(`${text} `);
});
it("requires trailing Space and respects disabled named shortcuts", () => {
  const editor = create("<p>-TODO</p>");
  type(editor, ":");
  expect(editor.state.doc.textContent).toBe("-TODO:");
  editor.view.dispatch(editor.state.tr.setMeta("bulletMethodDisplay", { enabled: true, shortcutsEnabled: false }));
  type(editor, " ");
  expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
  expect(editor.state.doc.textContent).toBe("-TODO: ");
});
it.each(["-", "::", ".:", "-:", "-TODO:"])("joins %s to the preceding bullet list like the regular dash rule", shortcut => {
  const editor = create(`<ul><li><p>DONE: Existing</p></li></ul><p>${shortcut}</p>`);
  type(editor, " ");
  expect(editor.view.dom.querySelectorAll('ul')).toHaveLength(1);
  expect(editor.state.doc.firstChild?.childCount).toBe(2);
  expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  if (shortcut !== "-") {
    expect(editor.commands.undoInputRule()).toBe(true);
    expect(editor.state.doc.firstChild?.childCount).toBe(1);
    expect(editor.state.doc.child(1).textContent).toBe(`${shortcut} `);
  }
});
it("preserves intentional paragraph separators and different list types", () => {
  const separated = create('<ul><li><p>DONE: Existing</p></li></ul><p></p><p>::</p>');
  type(separated, " ");
  expect(separated.view.dom.querySelectorAll('ul')).toHaveLength(2);
  expect(separated.state.doc.child(1).type.name).toBe('paragraph');
  const numbered = create('<ol><li><p>Existing</p></li></ol><p>::</p>');
  type(numbered, " ");
  expect(numbered.view.dom.querySelectorAll('ol')).toHaveLength(1);
  expect(numbered.view.dom.querySelectorAll('ul')).toHaveLength(1);
});
it("serializes a joined status bullet without a blank line between items", () => {
  const editor = create('<ul><li><p>DONE: Existing</p></li></ul><p>::</p>');
  type(editor, " ");
  expect(htmlToMarkdown(editor.getHTML()).trim()).toBe('- DONE: Existing\n- **TODO:**');
});

it.each([true, false])("celebrates a completion shortcut only when enabled (%s)", celebrate => {
  const editor = create('<p>-DONE:</p>');
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, defaultBulletMethodStatuses.map(s => s.id === 'done' ? { ...s, celebrate } : s)));
  type(editor, ' ');
  const position = bulletCelebrationKey.getState(editor.state)!.position;
  if (celebrate) expect(editor.state.doc.nodeAt(position!)?.textContent).toBe('DONE: ');
  else expect(position).toBeNull();
});

it.each(defaultBulletMethodStatuses.map(status => ({ ...status, shortcut: statusShortcut(status) })).filter(status => status.shortcut))(
  "expands $shortcut before existing formatted bullet text", status => {
    const editor = create(`<ul><li><p>${status.shortcut}<strong>Existing text</strong></p></li></ul>`);
    editor.commands.setTextSelection(3 + status.shortcut!.length);
    type(editor, " ");
    expect(editor.state.doc.textContent).toBe(`${status.prefix ? `${status.prefix}: ` : ""}Existing text`);
    expect(editor.getHTML()).toContain("<strong>Existing text</strong>");
    expect(editor.view.dom.querySelectorAll("ul")).toHaveLength(1);
    expect(editor.commands.undoInputRule()).toBe(true);
    expect(editor.state.doc.textContent).toBe(`${status.shortcut} Existing text`);
  },
);

it.each(["::", ".:", "-:", "-TODO:"])("bolds only the status and colon for %s, preserving following typing and undo", shortcut => {
  const editor = create(`<p>${shortcut}</p>`);
  type(editor, " ");
  const label = editor.state.doc.firstChild!.firstChild!.firstChild!.firstChild!.text!;
  expect(label.endsWith(":")).toBe(true);
  expect(editor.getHTML()).toContain(`<strong>${label}</strong> `);
  expect(editor.state.storedMarks?.some(mark => mark.type.name === "bold") ?? false).toBe(false);
  expect(editor.commands.undoInputRule()).toBe(true);
  expect(editor.getHTML()).not.toContain("<strong>");
  editor.commands.setContent(`<p>${shortcut}</p>`);
  editor.commands.setTextSelection(shortcut.length + 1);
  type(editor, " ");
  type(editor, "Body");
  expect(editor.getHTML()).toContain(`<strong>${label}</strong> Body`);
});

it("uses the live bold switch without removing manually bold text or changing other marks", () => {
  const editor = create('<p><em>::</em></p>');
  editor.view.dispatch(editor.state.tr.setMeta("bulletMethodDisplay", { enabled: true, autoBoldStatus: false }));
  type(editor, " ");
  expect(editor.getHTML()).not.toContain("<strong>");
  expect(editor.state.doc.firstChild!.firstChild!.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(["italic"]);
  editor.commands.undoInputRule();
  editor.commands.setContent('<p><em>::</em></p>');
  editor.commands.setTextSelection(3);
  editor.view.dispatch(editor.state.tr.setMeta("bulletMethodDisplay", { enabled: true, autoBoldStatus: true }));
  type(editor, " ");
  type(editor, "Body");
  const paragraph = editor.state.doc.firstChild!.firstChild!.firstChild!;
  expect(paragraph.firstChild!.text).toBe("TODO:");
  expect(paragraph.firstChild!.marks.map(mark => mark.type.name)).toEqual(["bold", "italic"]);
  expect(paragraph.lastChild!.text).toBe(" Body");
  expect(paragraph.lastChild!.marks.map(mark => mark.type.name)).toEqual(["italic"]);
  editor.commands.setContent('<p><strong>::</strong></p>');
  editor.commands.setTextSelection(3);
  editor.view.dispatch(editor.state.tr.setMeta("bulletMethodDisplay", { enabled: true, autoBoldStatus: false }));
  type(editor, " ");
  expect(editor.getHTML()).toContain("<strong>TODO: </strong>");
});


it.each(["TODO", "IN PROGRESS", "DONE", "CLOSED", "QUESTION", "todo"])("bolds typed %s: immediately in a bullet, without bolding following text", prefix => {
  const editor = create('<ul><li><p></p></li></ul>');
  editor.commands.setTextSelection(3);
  for (const character of prefix) type(editor, character);
  expect(editor.getHTML()).not.toContain('<strong>');
  type(editor, ':');
  expect(editor.getHTML()).toContain(`<strong>${prefix}:</strong>`);
  expect(editor.commands.undoInputRule()).toBe(true);
  expect(editor.state.doc.textContent).toBe(`${prefix}:`);
  expect(editor.getHTML()).not.toContain('<strong>');
  editor.commands.setContent('<ul><li><p></p></li></ul>');
  editor.commands.setTextSelection(3);
  for (const character of `${prefix}: Body`) type(editor, character);
  expect(editor.getHTML()).toContain(`<strong>${prefix}:</strong> Body`);
  expect(htmlToMarkdown(editor.getHTML())).toContain(`- **${prefix}:** Body`);
});

it("uses live custom names and the bold switch independently of status shortcuts", () => {
  const editor = create('<ul><li><p></p><ul><li><p></p></li></ul></li></ul>');
  editor.commands.setTextSelection(7);
  const statuses = defaultBulletMethodStatuses.map(status => status.id === 'todo' ? { ...status, prefix: 'Waiting (on review)' } : status);
  editor.view.dispatch(editor.state.tr.setMeta(bulletMethodMarkersKey, statuses)
    .setMeta('bulletMethodDisplay', { enabled: true, shortcutsEnabled: false }));
  for (const character of 'Waiting (on review): Body') type(editor, character);
  expect(editor.getHTML()).toContain('<strong>Waiting (on review):</strong> Body');
  editor.commands.setContent('<ul><li><p>Waiting (on review)</p></li></ul>');
  editor.commands.setTextSelection(3 + 'Waiting (on review)'.length);
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, autoBoldStatus: false }));
  type(editor, ':');
  expect(editor.getHTML()).not.toContain('<strong>');
  editor.commands.undo();
  editor.commands.setContent('<ul><li><p>Waiting (on review)</p></li></ul>');
  editor.commands.setTextSelection(3 + 'Waiting (on review)'.length);
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true, autoBoldStatus: true }));
  type(editor, ':');
  expect(editor.getHTML()).toContain('<strong>Waiting (on review):</strong>');
});

it.each([
  '<p>TODO</p>', '<h2>TODO</h2>', '<pre><code>TODO</code></pre>',
  '<ol><li><p>TODO</p></li></ol>', '<ul><li><p>Discuss TODO</p></li></ul>',
  '<ul><li><p>UNKNOWN</p></li></ul>', '<ul><li><p><code>TODO</code></p></li></ul>',
  '<ul><li><p>Parent</p><p>TODO</p></li></ul>',
])("leaves typed status-like text outside a recognized bullet prefix unchanged: %s", content => {
  const editor = create(content);
  type(editor, ':');
  expect(editor.getHTML()).not.toContain('<strong>');
});

it("does not bold typed statuses when Bullet Statuses is disabled", () => {
  const editor = create('<ul><li><p>TODO</p></li></ul>', false);
  type(editor, ':');
  expect(editor.getHTML()).not.toContain('<strong>');
});

it("preserves split label formatting and explicit colors when typing the colon", () => {
  const editor = new Editor({ extensions: [StarterKit, BulletMethodMarkers, TextColor],
    content: '<ul><li><p><em>TO</em><span style="color: #ff0000">DO</span></p></li></ul>' });
  editors.push(editor);
  editor.view.dispatch(editor.state.tr.setMeta('bulletMethodDisplay', { enabled: true }));
  editor.commands.setTextSelection(7);
  type(editor, ':');
  const paragraph = editor.state.doc.firstChild!.firstChild!.firstChild!;
  expect(paragraph.firstChild!.text).toBe('TO');
  expect(paragraph.firstChild!.marks.map(mark => mark.type.name)).toEqual(['bold', 'italic']);
  expect(paragraph.lastChild!.text).toBe('DO:');
  expect(paragraph.lastChild!.marks.map(mark => mark.type.name)).toEqual(['bold', 'textColor']);
  type(editor, ' Body');
  expect(editor.state.doc.firstChild!.firstChild!.firstChild!.lastChild!.marks.map(mark => mark.type.name)).toEqual(['textColor']);
});
