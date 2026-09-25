import { joinBackward } from "@tiptap/pm/commands";
import { DOMSerializer, Fragment as ProseMirrorFragment, type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import { liftListItem } from "@tiptap/pm/schema-list";
import { EditorState, NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { type EditorProps, type EditorView } from "@tiptap/pm/view";
import { type Editor } from "@tiptap/react";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdown";
import { normalizeNoteMarkdown } from "../lib/noteDocument";

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

export function resetEditorHistory(editor: Editor) {
  // Tiptap has no public command for clearing the history plugin. Recreating
  // state at a Note boundary keeps the loaded document and selection while
  // reinitializing history (and other document-scoped plugin state).
  editor.view.updateState(EditorState.create({
    doc: editor.state.doc,
    selection: editor.state.selection,
    plugins: editor.state.plugins,
  }));
}

type CachedNoteEditorState = {
  markdown: string;
  state: EditorState;
};

export class BoundedNoteStateCache {
  private readonly entries = new Map<string, CachedNoteEditorState>();

  constructor(private readonly limit: number) {}

  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, entry: CachedNoteEditorState) {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.limit) {
      const oldestKey = this.entries.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.entries.delete(oldestKey);
    }
  }

  delete(key: string) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }
}

export function cacheCurrentNoteEditorState(cache: BoundedNoteStateCache, key: string, editor: Editor) {
  cache.set(key, {
    markdown: htmlToMarkdown(editor.getHTML()),
    state: editor.state,
  });
}

export function restoreCachedNoteEditorState(
  cache: BoundedNoteStateCache,
  key: string,
  markdown: string,
  editor: Editor,
) {
  const cached = cache.get(key);
  if (!cached) return false;
  if (normalizeNoteMarkdown(cached.markdown) !== normalizeNoteMarkdown(markdown)) {
    cache.delete(key);
    return false;
  }
  editor.view.updateState(cached.state);
  return true;
}

type EditorDocumentLoadAction = "load" | "preserve" | "unchanged";

export function getEditorDocumentLoadAction({
  currentHistoryKey,
  currentPath,
  nextHistoryKey,
  nextPath,
  requestedReload,
}: {
  currentHistoryKey: string | null;
  currentPath: string | null;
  nextHistoryKey: string | null;
  nextPath: string | null;
  requestedReload: boolean;
}): EditorDocumentLoadAction {
  if (requestedReload) return "load";
  if (currentPath === nextPath) return "unchanged";
  if (currentHistoryKey && nextHistoryKey && currentHistoryKey === nextHistoryKey) return "preserve";
  return "load";
}

export function isFormattingSelection(selection: Selection) {
  return !selection.empty
    && !(selection instanceof NodeSelection)
    && selection.$from.doc.textBetween(selection.from, selection.to, "").length > 0;
}

export function collapseBoundarySelectionAt(view: EditorView, position: number) {
  const { selection, doc } = view.state;
  if (!(selection instanceof TextSelection)
    || selection.empty
    || doc.textBetween(selection.from, selection.to, "").length > 0) return false;

  const safePosition = Math.min(Math.max(0, position), doc.content.size);
  const $position = doc.resolve(safePosition);
  const caret = $position.parent.inlineContent
    ? TextSelection.create(doc, safePosition)
    : Selection.near($position, -1);
  view.dispatch(view.state.tr.setSelection(caret).setMeta("pointer", true));
  return true;
}

export function handleNestedListBoundaryDelete(view: EditorView, event: KeyboardEvent) {
  if ((event.key !== "Backspace" && event.key !== "Delete")
    || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;

  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty || !selection.$cursor) return false;

  const boundary = event.key === "Delete"
    ? findForwardNestedListBoundary(selection.$cursor)
    : findBackwardNestedListBoundary(selection.$cursor);
  if (!boundary) return false;

  const {
    parentItem,
    parentItemFrom,
    parentParagraphIndex,
    nestedListIndex,
    childItem,
    nestedList,
  } = boundary;
  const parentParagraph = parentItem.child(parentParagraphIndex);
  const childParagraph = childItem.firstChild;
  if (!childParagraph?.isTextblock) return false;
  let joinPosition = parentItemFrom + 2 + parentParagraph.content.size;
  for (let index = 0; index < parentParagraphIndex; index += 1) {
    joinPosition += parentItem.child(index).nodeSize;
  }

  const mergedParagraph = parentParagraph.copy(parentParagraph.content.append(childParagraph.content));
  const replacementChildren: ProseMirrorNode[] = [];
  for (let index = 0; index < nestedListIndex; index += 1) {
    replacementChildren.push(index === parentParagraphIndex ? mergedParagraph : parentItem.child(index));
  }

  const childBlocks = Array.from({ length: childItem.childCount - 1 }, (_, index) => childItem.child(index + 1));
  const remainingSiblings = Array.from({ length: nestedList.childCount - 1 }, (_, index) => nestedList.child(index + 1));
  const lastChildBlock = childBlocks.at(-1);
  if (remainingSiblings.length > 0 && lastChildBlock?.type === nestedList.type) {
    childBlocks[childBlocks.length - 1] = lastChildBlock.copy(
      lastChildBlock.content.append(ProseMirrorFragment.fromArray(remainingSiblings)),
    );
  } else if (remainingSiblings.length > 0) {
    childBlocks.push(nestedList.copy(ProseMirrorFragment.fromArray(remainingSiblings)));
  }
  replacementChildren.push(...childBlocks);
  for (let index = nestedListIndex + 1; index < parentItem.childCount; index += 1) {
    replacementChildren.push(parentItem.child(index));
  }

  event.preventDefault();
  const replacement = parentItem.copy(ProseMirrorFragment.fromArray(replacementChildren));
  const tr = view.state.tr.replaceWith(parentItemFrom, parentItemFrom + parentItem.nodeSize, replacement);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, joinPosition)).scrollIntoView());
  return true;
}

type NestedListBoundary = {
  childItem: ProseMirrorNode;
  nestedList: ProseMirrorNode;
  nestedListIndex: number;
  parentItem: ProseMirrorNode;
  parentItemFrom: number;
  parentParagraphIndex: number;
};

function findForwardNestedListBoundary($cursor: ResolvedPos): NestedListBoundary | null {
  if ($cursor.parentOffset !== $cursor.parent.content.size) return null;
  const item = findListItemAtSelection($cursor);
  if (!item) return null;
  const paragraphIndex = $cursor.index(item.depth);
  const nestedListIndex = paragraphIndex + 1;
  const nestedList = item.node.maybeChild(nestedListIndex);
  const childItem = nestedList?.firstChild;
  if (!$cursor.parent.isTextblock || !isListNode(nestedList) || !isListItemNode(childItem)) return null;
  return {
    childItem,
    nestedList,
    nestedListIndex,
    parentItem: item.node,
    parentItemFrom: item.from,
    parentParagraphIndex: paragraphIndex,
  };
}

function findBackwardNestedListBoundary($cursor: ResolvedPos): NestedListBoundary | null {
  if ($cursor.parentOffset !== 0) return null;
  const child = findListItemAtSelection($cursor);
  if (!child || $cursor.index(child.depth) !== 0 || $cursor.index(child.parentDepth) !== 0) return null;
  const parentItemDepth = child.parentDepth - 1;
  if (parentItemDepth < 1) return null;
  const parentItem = $cursor.node(parentItemDepth);
  if (!isListItemNode(parentItem)) return null;
  const nestedListIndex = $cursor.index(parentItemDepth);
  const parentParagraphIndex = nestedListIndex - 1;
  const parentParagraph = parentItem.maybeChild(parentParagraphIndex);
  if (!parentParagraph?.isTextblock || parentItem.child(nestedListIndex) !== child.parentNode) return null;
  return {
    childItem: child.node,
    nestedList: child.parentNode,
    nestedListIndex,
    parentItem,
    parentItemFrom: $cursor.before(parentItemDepth),
    parentParagraphIndex,
  };
}

function isListNode(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return node?.type.name === "bulletList" || node?.type.name === "orderedList" || node?.type.name === "taskList";
}

function isListItemNode(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return node?.type.name === "listItem" || node?.type.name === "taskItem";
}

export function handleSameLevelListItemBackspace(view: EditorView, event: KeyboardEvent) {
  if (!isPlainDeleteKey(event, "Backspace")) return false;

  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty || !selection.$cursor) return false;

  const { $cursor } = selection;
  if ($cursor.parentOffset !== 0 || !$cursor.parent.isTextblock || !$cursor.parent.textContent.trim()) return false;

  const item = findListItemAtSelection($cursor);
  if (!item || $cursor.index(item.depth) !== 0) return false;

  const itemIndex = $cursor.index(item.parentDepth);
  if (itemIndex < 1) return false;

  const previousItem = item.parentNode.child(itemIndex - 1);
  const previousParagraph = previousItem.firstChild;
  const currentParagraph = item.node.firstChild;
  if (!isListItemNode(previousItem) || !previousParagraph?.isTextblock || !currentParagraph?.isTextblock) return false;

  const previousBlocks = Array.from(
    { length: previousItem.childCount - 1 },
    (_, index) => previousItem.child(index + 1),
  );
  const currentBlocks = Array.from(
    { length: item.node.childCount - 1 },
    (_, index) => item.node.child(index + 1),
  );
  const previousLastBlock = previousBlocks.at(-1);
  const currentFirstBlock = currentBlocks[0];
  if (isListNode(previousLastBlock) && currentFirstBlock?.type === previousLastBlock.type) {
    previousBlocks[previousBlocks.length - 1] = previousLastBlock.copy(
      previousLastBlock.content.append(currentFirstBlock.content),
    );
    currentBlocks.shift();
  }

  const mergedParagraph = previousParagraph.copy(
    previousParagraph.content.append(currentParagraph.content),
  );
  const mergedItem = previousItem.type.create(
    {
      ...previousItem.attrs,
      separatorAfter: item.node.attrs.separatorAfter,
    },
    ProseMirrorFragment.fromArray([mergedParagraph, ...previousBlocks, ...currentBlocks]),
    previousItem.marks,
  );
  const previousItemFrom = item.from - previousItem.nodeSize;
  const joinPosition = previousItemFrom + 2 + previousParagraph.content.size;
  const tr = view.state.tr.replaceWith(previousItemFrom, item.from + item.node.nodeSize, mergedItem);
  tr.setSelection(TextSelection.create(tr.doc, joinPosition)).scrollIntoView();

  event.preventDefault();
  view.dispatch(tr);
  return true;
}

export function handleOutermostListItemBackspace(view: EditorView, event: KeyboardEvent) {
  if (!isPlainDeleteKey(event, "Backspace")) return false;

  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty || !selection.$cursor) return false;

  const { $cursor } = selection;
  if ($cursor.parentOffset !== 0 || !$cursor.parent.isTextblock || !$cursor.parent.textContent.trim()) return false;

  const item = findListItemAtSelection($cursor);
  if (!item || $cursor.index(item.depth) !== 0 || $cursor.index(item.parentDepth) !== 0) return false;

  for (let depth = item.parentDepth - 1; depth > 0; depth -= 1) {
    if (isListItemNode($cursor.node(depth))) return false;
  }

  if (joinBackward(view.state)) return false;

  const handled = liftListItem(item.node.type)(view.state, (transaction) => view.dispatch(transaction));
  if (handled) event.preventDefault();
  return handled;
}

export function handleEmptyListItemBackspace(view: EditorView, event: KeyboardEvent) {
  if (!isPlainDeleteKey(event, "Backspace")) return false;
  const { selection } = view.state;
  if (!selection.empty) return false;

  const item = findListItemAtSelection(selection.$from);
  if (!item || item.node.textContent.trim()) return false;

  // Keep normal list-exit behavior for a trailing empty bullet. In the middle
  // of a list, though, lifting the empty item splits one list into two with an
  // empty paragraph between them. Remove that structural item instead.
  const itemIndex = selection.$from.index(item.parentDepth);
  const isMiddleListItem = itemIndex < item.parentNode.childCount - 1;
  if (item.node.type.name !== "taskItem" && !isMiddleListItem) return false;

  event.preventDefault();
  deleteEmptyListItem(view, item, -1);
  return true;
}

export function isPlainDeleteKey(event: KeyboardEvent, key: "Backspace" | "Delete") {
  return event.key === key && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

export type ListItemRange = {
  depth: number;
  from: number;
  node: ProseMirrorNode;
  parentDepth: number;
  parentFrom: number;
  parentNode: ProseMirrorNode;
};

export function findListItemAtSelection($from: ResolvedPos): ListItemRange | null {
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

export function deleteEmptyListItem(view: EditorView, item: ListItemRange, bias: -1 | 1) {
  const removeParentList = item.parentNode.childCount === 1;
  const deleteFrom = removeParentList ? item.parentFrom : item.from;
  const deleteTo = deleteFrom + (removeParentList ? item.parentNode.nodeSize : item.node.nodeSize);
  const tr = view.state.tr.delete(deleteFrom, deleteTo);
  const near = Math.min(deleteFrom, tr.doc.content.size);
  view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(near), bias)).scrollIntoView());
}

export function serializeEditorSelectionForClipboard(view: EditorView) {
  if (view.state.selection.empty) return null;
  const slice = view.state.selection.content();
  const clipboardFragment = isPartialSelectionWithinSingleListLine(view.state.selection)
    ? getSelectedTextblockFragment(slice.content)
    : trimUnselectedListAncestorShells(slice.content);
  const html = serializeClipboardHtmlFragment(view, clipboardFragment);
  const markdown = htmlToMarkdown(html).trimEnd();
  if (!markdown && !html) return null;

  return {
    plainText: markdown,
    html: html || markdownToHtml(markdown),
  };
}

function isPartialSelectionWithinSingleListLine(selection: Selection) {
  const startItem = findListItemAtSelection(selection.$from);
  const endItem = findListItemAtSelection(selection.$from.doc.resolve(Math.max(selection.from, selection.to - 1)));
  if (!startItem || !endItem || startItem.from !== endItem.from) return false;

  const startBlock = findTextblockRangeAtPos(selection.$from);
  const endBlock = findTextblockRangeAtPos(selection.$from.doc.resolve(Math.max(selection.from, selection.to - 1)));
  if (!startBlock || !endBlock || startBlock.from !== endBlock.from) return false;

  return selection.from > startBlock.from || selection.to < startBlock.to;
}

function findTextblockRangeAtPos($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (!node.isTextblock) continue;
    const from = $pos.before(depth) + 1;
    return { from, to: from + node.content.size };
  }
  return null;
}

function getSelectedTextblockFragment(fragment: ProseMirrorFragment) {
  const blocks: ProseMirrorNode[] = [];
  const collect = (node: ProseMirrorNode) => {
    if (node.isTextblock) {
      blocks.push(node);
      return;
    }
    node.forEach(collect);
  };
  fragment.forEach(collect);
  return blocks.length > 0 ? ProseMirrorFragment.fromArray(blocks) : fragment;
}

function trimUnselectedListAncestorShells(fragment: ProseMirrorFragment) {
  let current = fragment;
  while (current.childCount === 1) {
    const list = current.firstChild;
    if (!list || !isClipboardListNode(list) || list.childCount !== 1) break;

    const item = list.firstChild;
    if (!item || (item.type.name !== "listItem" && item.type.name !== "taskItem")) break;

    const nestedLists: ProseMirrorNode[] = [];
    let hasSelectedItemContent = false;
    item.forEach((child) => {
      if (isClipboardListNode(child)) nestedLists.push(child);
      else if (!child.isTextblock || child.textContent.trim()) hasSelectedItemContent = true;
    });
    if (hasSelectedItemContent || nestedLists.length !== 1) break;
    current = ProseMirrorFragment.from(nestedLists[0]);
  }
  return current;
}

function isClipboardListNode(node: ProseMirrorNode) {
  return node.type.name === "bulletList" || node.type.name === "orderedList" || node.type.name === "taskList";
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

export function normalizeTableClipboardHtml(html: string) {
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