import { Table, TableCell, TableHeader } from "@tiptap/extension-table";
import { DOMSerializer, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  CellSelection,
  deleteColumn,
  deleteRow,
  TableMap,
} from "@tiptap/pm/tables";
import type { EditorView, NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { htmlToMarkdown } from "../lib/markdown";
import { writeRichClipboard } from "../lib/richClipboard";
import { normalizeTableClipboardHtml } from "./notesEditorBehavior";

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

export const TableWithControls = Table.extend({
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

export const TigranaTableCell = TableCell.extend({
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

export const TigranaTableHeader = TableHeader.extend({
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

export function isTableChromeTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest(".table-axis-handle, .table-edge-add, .table-context-menu, .table-column-resize-handle") != null
  );
}
