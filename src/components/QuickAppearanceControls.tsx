import { useId } from "react";
import { RotateCcw } from "lucide-react";
import type { NotebookAppearance } from "../types";
import type { ThemeDocument } from "../lib/themes";
import { quickEditorFonts, themeFontLabel, type QuickAppearanceField } from "../lib/quickAppearance";
import { ThemeColorField } from "./ThemeColorField";

function ResetControl({ label, changed, onReset }: { label: string; changed: boolean; onReset: () => void }) {
  const title = `Reset ${label} to theme default`;
  return <span className="quick-appearance-reset-slot">
    {changed && <button type="button" className="icon-button quick-appearance-reset" title={title} aria-label={title}
      onClick={event => {
        // Return focus to the input before this button disappears.
        event.currentTarget.closest('.setting-row, .theme-color-field')
          ?.querySelector<HTMLElement>('select, input[type="text"], input[type="range"]')?.focus();
        onReset();
      }}><RotateCcw size={15} aria-hidden="true" /></button>}
  </span>;
}

export function QuickAppearanceControls({ theme, mode, current, quick, onChange, onReset }: {
  theme: ThemeDocument;
  mode: "light" | "dark";
  current: { accentColor: string; editorFontFamily: string; editorFontSize: number };
  quick: NotebookAppearance["quickAppearance"];
  onChange: (patch: NonNullable<NotebookAppearance["quickAppearance"]>) => void;
  onReset: (field: QuickAppearanceField) => void;
}) {
  const id = useId();
  const firstFamily = (family: string) => family.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
  return <section className="settings-quick-appearance" aria-label="Quick appearance">
    <h3>Quick appearance</h3>
    <p className="settings-description">These changes apply to this notebook. Choosing a theme resets them.</p>
    <ThemeColorField label="Accent color" name="Quick accent color" value={current.accentColor}
      onChange={accentColor => onChange({ accentColor })}
      trailingControl={<ResetControl label="accent color" changed={current.accentColor.toLowerCase() !== theme[mode].accent.toLowerCase()} onReset={() => onReset('accentColor')} />} />
    <div className="setting-row">
      <label htmlFor={`${id}-font`}>Editor font</label>
      <span className="quick-appearance-control">
        <select id={`${id}-font`} className="settings-select" aria-label="Quick editor font"
          value={quickEditorFonts.some(font => font.value === quick?.editorFontFamily) ? quick!.editorFontFamily : ""}
          onChange={event => onChange({ editorFontFamily: event.target.value || undefined })}>
          <option value="">Theme font ({themeFontLabel(theme.editorFontFamily)})</option>
          {quickEditorFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}
        </select>
        <ResetControl label="editor font" changed={firstFamily(current.editorFontFamily) !== firstFamily(theme.editorFontFamily)} onReset={() => onReset('editorFontFamily')} />
      </span>
    </div>
    <div className="setting-row">
      <label htmlFor={`${id}-size`}>Editor font size</label>
      <span className="quick-appearance-control">
        <span className="quick-font-size-control">
          <input id={`${id}-size`} aria-label="Quick editor font size" type="range" min={11} max={28} step={1} value={current.editorFontSize}
            onChange={event => onChange({ editorFontSize: Number(event.target.value) })} />
          <output>{current.editorFontSize}px</output>
        </span>
        <ResetControl label="editor font size" changed={current.editorFontSize !== theme.editorFontSize} onReset={() => onReset('editorFontSize')} />
      </span>
    </div>
  </section>;
}
