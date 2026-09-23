import { useCallback, useSyncExternalStore, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Paintbrush, Check } from "lucide-react";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { inlineColors, inlineColorVariables, type InlineColorCommand } from "../lib/inlineColors";
import { applyInlineColor } from "./inlineColorMarks";

// Notify React only when formatting changes, not on every typing transaction.
function useColorState(editor: Editor) {
  const snapshot = useCallback(() => JSON.stringify([
    editor.getAttributes("textColor").color ?? null,
    editor.getAttributes("highlight").color ?? null,
    editor.isActive("highlight"),
  ]), [editor]);
  const subscribe = useCallback((notify: () => void) => {
    let previous = snapshot();
    const changed = () => {
      const next = snapshot();
      if (next !== previous) { previous = next; notify(); }
    };
    editor.on("transaction", changed);
    return () => { editor.off("transaction", changed); };
  }, [editor, snapshot]);
  return JSON.parse(useSyncExternalStore(subscribe, snapshot)) as [string | null, string | null, boolean];
}

export function EditorColorControls({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  return <div className="editor-color-controls" role="group" aria-label="Text formatting">
    <InlineColorPicker editor={editor} toolbar disabled={disabled} />
  </div>;
}

export function InlineColorPicker({ editor, toolbar = false, disabled = false }: { editor: Editor; toolbar?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const mode = editor.view.dom.closest(".theme-dark") ? "dark" : "light";
  const [textColor, highlightColor, highlighted] = useColorState(editor);
  const label = "Text and highlight colors";
  const active = !!textColor || highlighted;
  const editorStyles = getComputedStyle(editor.view.dom);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    const changed = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) close();
    };
    document.addEventListener("mousedown", dismiss);
    editor.on("selectionUpdate", close);
    editor.on("transaction", changed);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      editor.off("selectionUpdate", close);
      editor.off("transaction", changed);
    };
  }, [open, editor]);

  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const panel = menu.current;
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - panel.offsetHeight - 8))}px`;
    panel.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [open]);

  const choose = (command: InlineColorCommand) => {
    applyInlineColor(editor, command);
    setOpen(false);
  };
  const option = (command: InlineColorCommand, label: string, active: boolean, color?: string, background?: string) => (
    <button key={command} type="button" role="menuitemradio" aria-checked={active}
      onMouseDown={event => event.preventDefault()} onClick={() => choose(command)}>
      <span className="inline-color-swatch" aria-hidden="true" style={{ color, backgroundColor: background }}>A</span>
      <span>{label}</span>{active && <Check size={13} aria-hidden="true" />}
    </button>
  );
  return <>
    <button ref={trigger} disabled={disabled} type="button" title={label} aria-label={label}
      aria-haspopup="menu" aria-expanded={open} className={`${toolbar ? "icon-button" : ""} ${active ? "is-active" : ""}`}
      onMouseDown={event => event.preventDefault()} onClick={() => {
        if (open) editor.view.focus();
        setOpen(value => !value);
      }}>
      <Paintbrush size={toolbar ? 17 : 15} />
    </button>
    {open && !disabled && createPortal(<div ref={menu} role="menu" aria-label={label}
      className={`format-bubble inline-color-palette theme-${mode}`}
      style={inlineColorVariables(mode) as CSSProperties}
      onKeyDown={event => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault(); event.stopPropagation(); setOpen(false); editor.view.focus(); return;
        }
        const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>("button")];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next: number | undefined;
        if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % buttons.length;
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = buttons.length - 1;
        if (next !== undefined) { event.preventDefault(); event.stopPropagation(); buttons[next].focus(); }
      }}>
      <div role="group" aria-label="Text color">
        <div className="inline-color-heading">Text color</div>
        {option("textColor_default", "Automatic", !textColor)}
        {inlineColors.map(color => option(`textColor_${color.id}`, color.label, textColor === color.text.light, color.text[mode]))}
      </div>
      <div role="group" aria-label="Highlight color">
        <div className="inline-color-heading">Highlight</div>
        {option("highlightColor_none", "No highlight", !highlighted)}
        {option("highlightColor_default", "Theme default", highlighted && !highlightColor,
          editorStyles.getPropertyValue("--tigrana-highlight-text") || "#292722",
          editorStyles.getPropertyValue("--tigrana-highlight-background") || "#e6d68d")}
        {inlineColors.map(color => option(`highlightColor_${color.id}`, color.label, highlighted && highlightColor === color.highlight.light, mode === "dark" ? "#eeeae2" : "#292722", color.highlight[mode]))}
      </div>
    </div>, document.body)}
  </>;
}
