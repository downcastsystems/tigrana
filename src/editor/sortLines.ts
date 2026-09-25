import { bulletMethodRank, defaultBulletMethodStatuses, type BulletMethodStatus } from "../lib/bulletMethod";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

export const sortCommands = ["sort_az", "sort_za", "sort_az_case", "sort_za_case", "sort_bullet_method"] as const;
export type SortCommand = typeof sortCommands[number];
export function isSortCommand(command: string): command is SortCommand {
  return sortCommands.some((value) => value === command);
}

/** Sort touched sibling units, retaining their marks, attributes and descendants. */
export function sortSelectedLines(state: EditorState, command: SortCommand, statuses: readonly BulletMethodStatus[] = defaultBulletMethodStatuses): Transaction | null {
  const { selection } = state;
  if (selection.empty) return null;
  // CellSelection.from/to describe just its primary cell, not the rectangle.
  // Its range envelope covers all selected rows, including reverse selections.
  const from = selection.ranges.reduce((start, range) => Math.min(start, range.$from.pos), selection.from);
  const to = selection.ranges.reduce((end, range) => Math.max(end, range.$to.pos), selection.to);
  const cellSelection = selection instanceof CellSelection ? selection : null;
  const tableStart = cellSelection?.$anchorCell.start(-1);
  const table = cellSelection?.$anchorCell.node(-1);
  const tableMap = table ? TableMap.get(table) : null;
  const anchorCell = cellSelection && tableMap
    ? tableMap.findCell(cellSelection.$anchorCell.pos - tableStart!) : null;
  const headCell = cellSelection && tableMap
    ? tableMap.findCell(cellSelection.$headCell.pos - tableStart!) : null;
  const bulletMethod = command === "sort_bullet_method";
  const sensitive = command.endsWith("_case");
  const direction = command.startsWith("sort_za") ? -1 : 1;
  const compare = (a: string, b: string) => {
    if (bulletMethod) return bulletMethodRank(a, statuses) - bulletMethodRank(b, statuses);
    const left = sensitive ? a : a.toLowerCase();
    const right = sensitive ? b : b.toLowerCase();
    return direction * (left < right ? -1 : left > right ? 1 : 0);
  };
  const touches = (start: number, end: number) => from < end && to > start;
  let selectedFrom = from;
  let selectedTo = to;
  const includeSortedRange = (start: number, end: number) => {
    selectedFrom = Math.min(selectedFrom, start);
    selectedTo = Math.max(selectedTo, end);
  };
  const listNames = new Set(["bulletList", "orderedList", "taskList"]);

  function visit(node: ProseMirrorNode, pos: number): ProseMirrorNode {
    if (!touches(pos, pos + node.nodeSize)) return node;
    if (node.type.name === "table") {
      let merged = false;
      node.descendants((child) => {
        if (child.type.name === "tableCell" || child.type.name === "tableHeader") {
          if (child.attrs.colspan > 1 || child.attrs.rowspan > 1) merged = true;
        }
      });
      if (merged) return node;
    }
    if (node.isTextblock) {
      // Soft line breaks and code-block newlines are lines too. Keep inline marks.
      const lines: { content: ProseMirrorNode[]; start: number; end: number }[] = [];
      let start = pos + 1;
      let content: ProseMirrorNode[] = [];
      const separators: ProseMirrorNode[] = [];
      node.forEach((child, offset) => {
        const childPos = pos + 1 + offset;
        if (child.type.name === "hardBreak") {
          separators.push(child);
          lines.push({ content, start, end: childPos });
          content = [];
          start = childPos + 1;
        } else if (child.isText && child.text!.includes("\n")) {
          let local = 0;
          const parts = child.text!.split("\n");
          parts.forEach((part, index) => {
            if (part) content.push(child.cut(local, local + part.length));
            local += part.length;
            if (index < parts.length - 1) {
              separators.push(node.type.schema.text("\n", child.marks));
              lines.push({ content, start, end: childPos + local });
              content = [];
              start = childPos + ++local;
            }
          });
        } else content.push(child);
      });
      lines.push({ content, start, end: pos + node.nodeSize - 1 });
      const selected = lines.map((line, index) => touches(line.start, line.end + 1) ? index : -1).filter((index) => index >= 0);
      if (selected.length < 2 || !separators.length) return node;
      includeSortedRange(lines[selected[0]].start, lines[selected[selected.length - 1]].end);
      const sorted = selected.map((index) => lines[index]).sort((a, b) => compare(a.content.map((n) => n.textContent).join(""), b.content.map((n) => n.textContent).join("")));
      selected.forEach((index, i) => { lines[index] = sorted[i]; });
      const result: ProseMirrorNode[] = [];
      lines.forEach((line, index) => {
        if (index) result.push(separators[index - 1]);
        result.push(...line.content);
      });
      return node.copy(Fragment.fromArray(result));
    }
    // When sorting sibling tasks, their entire contents travel untouched.
    // A selection inside one item can still sort its nested list independently.
    let selectedItems = 0;
    if (bulletMethod && listNames.has(node.type.name)) {
      node.forEach((child, offset) => {
        const start = pos + 1 + offset;
        if (touches(start + 1, start + child.nodeSize - 1)) selectedItems++;
      });
    }
    const children: { node: ProseMirrorNode; selected: boolean; group: string | null; start: number; end: number }[] = [];
    node.forEach((child, offset) => {
      const childPos = pos + 1 + offset;
      const selected = touches(childPos + 1, childPos + child.nodeSize - 1);
      let group: string | null = null;
      if (listNames.has(node.type.name)) group = "item";
      else if (node.type.name === "table") {
        let header = false;
        child.forEach((cell) => { if (cell.type.name === "tableHeader") header = true; });
        if (!header) group = "row";
      } else if (child.type.name === "paragraph" || (!bulletMethod && child.type.name === "heading")) group = child.type.name;
      // A table row is atomic; do not rearrange paragraphs within its cells.
      children.push({ node: node.type.name === "table" || selectedItems > 1 ? child : visit(child, childPos), selected, group, start: childPos + 1, end: childPos + child.nodeSize - 1 });
    });
    for (let i = 0; i < children.length;) {
      const first = children[i];
      if (!first.selected || !first.group) { i++; continue; }
      let end = i + 1;
      while (end < children.length && children[end].selected && children[end].group === first.group) end++;
      if (end - i > 1) includeSortedRange(first.start, children[end - 1].end);
      const key = (child: ProseMirrorNode) => first.group === "item" || first.group === "row" ? child.firstChild?.textContent ?? "" : child.textContent;
      const sorted = children.slice(i, end).sort((a, b) => compare(key(a.node), key(b.node)));
      children.splice(i, end - i, ...sorted);
      i = end;
    }
    return node.copy(Fragment.fromArray(children.map((child) => child.node)));
  }
  const doc = visit(state.doc, -1);
  if (doc.eq(state.doc)) return null;
  const tr = closeHistory(state.tr).replaceWith(0, state.doc.content.size, doc.content);
  if (cellSelection && anchorCell && headCell && tableStart !== undefined) {
    // Row lengths can differ. Restore the rectangle by coordinates, not offsets.
    const sortedTable = tr.doc.nodeAt(tableStart - 1)!;
    const sortedMap = TableMap.get(sortedTable);
    tr.setSelection(CellSelection.create(
      tr.doc,
      tableStart + sortedMap.positionAt(anchorCell.top, anchorCell.left, sortedTable),
      tableStart + sortedMap.positionAt(headCell.top, headCell.left, sortedTable),
    ));
  } else {
    // Sorting moves whole touched lines, including partially selected edge
    // lines. Keep that entire range selected rather than reusing offsets that
    // may now land in a different, longer line. Preserve drag direction too.
    const reverse = selection.anchor > selection.head;
    tr.setSelection(TextSelection.between(
      tr.doc.resolve(reverse ? selectedTo : selectedFrom),
      tr.doc.resolve(reverse ? selectedFrom : selectedTo),
    ));
  }
  return tr.scrollIntoView();
}
