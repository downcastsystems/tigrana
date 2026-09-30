import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Editor, Range } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { useDateFormat } from "../lib/useDateFormat";
import { dateInsertEvent, formatInsertedDate, shiftCalendarMonth } from "./dateInsertion";

export function DatePickerDialog({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [request, setRequest] = useState<Range | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      if (disabled || !editor.isEditable) return;
      setRequest((event as CustomEvent<Range>).detail);
    };
    const dom = editor.view.dom;
    dom.addEventListener(dateInsertEvent, open);
    return () => { dom.removeEventListener(dateInsertEvent, open); };
  }, [editor, disabled]);
  useEffect(() => {
    if (!request) return;
    // A reload or any concurrent edit invalidates the captured slash range.
    const changed = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) setRequest(null);
    };
    editor.on("transaction", changed);
    return () => { editor.off("transaction", changed); };
  }, [editor, request]);
  useEffect(() => { if (disabled) setRequest(null); }, [disabled]);
  if (!request || disabled) return null;
  return <DatePickerForm
    portalTarget={editor.view.dom.closest('[data-theme-region]') ?? document.body}
    onDismiss={() => { setRequest(null); if (!editor.isDestroyed) editor.view.focus(); }}
    onInsert={text => {
      if (editor.isDestroyed || !editor.isEditable) return;
      editor.chain().focus().command(({ tr }) => { closeHistory(tr); return true; })
        .insertContentAt(request, { type: "text", text }).run();
      setRequest(null);
    }}
  />;
}

export function DatePickerForm({ portalTarget, onDismiss, onInsert }: {
  portalTarget: Element;
  onDismiss: () => void;
  onInsert: (text: string) => void;
}) {
  const dateFormat = useDateFormat();
  const [today] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const panel = useRef<HTMLDivElement>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);
  const month = selected.getMonth();
  const year = selected.getFullYear();
  const leadingDays = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthTitle = new Intl.DateTimeFormat(undefined, { calendar: "gregory", month: "long", year: "numeric" }).format(selected);
  const dayLabel = new Intl.DateTimeFormat(undefined, { calendar: "gregory", dateStyle: "full" });
  const weekdayLabel = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  useLayoutEffect(() => { selectedButton.current?.focus(); }, [selected]);
  const dismiss = onDismiss;
  const insert = () => onInsert(formatInsertedDate(selected, undefined, dateFormat));
  const moveDays = (amount: number) => setSelected(new Date(year, month, selected.getDate() + amount));

  return createPortal(<div className="dialog-backdrop date-picker-backdrop" onMouseDown={event => {
    event.stopPropagation();
    if (event.target === event.currentTarget) dismiss();
  }} onClick={event => event.stopPropagation()}>
    <div className="date-picker" role="dialog" aria-modal="true" aria-label="Insert date" ref={panel}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); dismiss(); }
        if (event.key === "Tab") {
          const items = [...panel.current!.querySelectorAll<HTMLButtonElement>('button:not([tabindex="-1"])')];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === items.length - 1)) {
            event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0]?.focus();
          }
        }
      }}>
      <header className="date-picker-header"><h2>Insert date</h2>
        <button type="button" className="icon-button" aria-label="Cancel date insertion" onClick={dismiss}><X size={16} /></button>
      </header>
      <div className="date-picker-month">
        <button type="button" className="icon-button" aria-label="Previous month" onClick={() => setSelected(shiftCalendarMonth(selected, -1))}><ChevronLeft size={16} /></button>
        <strong aria-live="polite">{monthTitle}</strong>
        <button type="button" className="icon-button" aria-label="Next month" onClick={() => setSelected(shiftCalendarMonth(selected, 1))}><ChevronRight size={16} /></button>
      </div>
      <div className="date-picker-weekdays" aria-hidden="true">
        {Array.from({ length: 7 }, (_, day) => <span key={day}>{weekdayLabel.format(new Date(2026, 0, 4 + day))}</span>)}
      </div>
      <div className="date-picker-days" role="group" aria-label="Choose a date" onKeyDown={event => {
        const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
        if (offset !== undefined) { event.preventDefault(); moveDays(offset); }
        if (event.key === "Home") { event.preventDefault(); moveDays(-selected.getDay()); }
        if (event.key === "End") { event.preventDefault(); moveDays(6 - selected.getDay()); }
        if (event.key === "PageUp" || event.key === "PageDown") {
          event.preventDefault(); setSelected(shiftCalendarMonth(selected, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1)));
        }
        if (event.key === "Enter") { event.preventDefault(); insert(); }
      }}>
        {Array.from({ length: leadingDays }, (_, i) => <span key={`blank-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const isSelected = day === selected.getDate();
          const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
          return <button key={day} type="button" className="date-picker-day" ref={isSelected ? selectedButton : undefined}
            tabIndex={isSelected ? 0 : -1} aria-pressed={isSelected} aria-current={isToday ? "date" : undefined}
            aria-label={dayLabel.format(new Date(year, month, day))} onClick={() => setSelected(new Date(year, month, day))}>{day}</button>;
        })}
      </div>
      <div className="date-picker-footer">
        <button type="button" onClick={() => setSelected(new Date(today.getFullYear(), today.getMonth(), today.getDate()))}>Today</button>
        <button type="button" className="date-picker-insert" onClick={insert}>Insert {formatInsertedDate(selected, undefined, dateFormat)}</button>
      </div>
    </div>
  </div>, portalTarget);
}
