import { useEffect, useState } from "react";
import { resolveThemeVariant, type ThemeDocument } from "../lib/themes";

export function ThemeVariantsEditor({ theme, selected, onSelect, onChange, onPendingChange }: {
  onPendingChange?: (pending: boolean) => void;
  theme: ThemeDocument; selected?: string; onSelect: (id: string) => void; onChange: (theme: ThemeDocument) => void;
}) {
  const [action, setAction] = useState<"add" | "rename" | "delete" | null>(null);
  useEffect(() => {
    onPendingChange?.(action !== null);
    return () => onPendingChange?.(false);
  }, [action, onPendingChange]);
  const [name, setName] = useState("");
  const [original, setOriginal] = useState("Original");
  const [error, setError] = useState("");
  const variants = theme.colorVariants;
  const current = variants?.find(v => v.id === selected) ?? variants?.find(v => v.id === theme.defaultColorVariantId);
  function submit() {
    const label = name.trim();
    if (!label || label.length > 100 || variants?.some(v => v.name.toLowerCase() === label.toLowerCase() && (action !== "rename" || v.id !== current?.id))) {
      setError("Use a unique name with 1–100 characters."); return;
    }
    if (!variants && (!original.trim() || original.length > 100 || original.trim().toLowerCase() === label.toLowerCase())) {
      setError("Give the current colors a different name with 1–100 characters."); return;
    }
    if (action === "rename") onChange({ ...theme, colorVariants: variants!.map(v => v.id === current!.id ? { ...v, name: label } : v) });
    else {
      const base = resolveThemeVariant(theme, current?.id);
      const first = { id: crypto.randomUUID(), name: original.trim(), light: theme.light, dark: theme.dark };
      const next = { id: crypto.randomUUID(), name: label, light: { ...base.light }, dark: { ...base.dark } };
      onChange({ ...theme, defaultColorVariantId: theme.defaultColorVariantId ?? first.id, colorVariants: [...(variants ?? [first]), next] });
      onSelect(next.id);
    }
    setAction(null); setError("");
  }
  return <section className="theme-variants-editor" aria-label="Color variants">
    {variants && <label>Colors <select className="settings-select" aria-label="Editing color variant" value={current?.id} onChange={e => onSelect(e.target.value)}>
      {variants.map(v => <option key={v.id} value={v.id}>{v.name}{v.id === theme.defaultColorVariantId ? " (default)" : ""}</option>)}
    </select></label>}
    <div className="theme-actions">
      <button type="button" className="toolbar-button" disabled={(variants?.length ?? 0) >= 32} onClick={() => { setAction("add"); setName(""); setError(""); }}>Add color variant</button>
      {current && <>
        <button type="button" className="toolbar-button" onClick={() => { setAction("rename"); setName(current.name); setError(""); }}>Rename</button>
        <button type="button" className="toolbar-button" disabled={variants!.length >= 32} onClick={() => { setAction("add"); setName(`${current.name} copy`); setError(""); }}>Duplicate</button>
        <button type="button" className="toolbar-button" disabled={current.id === theme.defaultColorVariantId} onClick={() => onChange({ ...theme, defaultColorVariantId: current.id, light: current.light, dark: current.dark })}>Make default</button>
        <button type="button" className="toolbar-button" disabled={variants!.length === 1} onClick={() => setAction("delete")}>Delete</button>
      </>}
    </div>
    {action && <div role="group" aria-label={action === "delete" ? "Delete color variant" : "Name color variant"}>
      {action === "delete" ? <><p>Delete {current?.name}? This removes both its light and dark colors from the draft.</p><button type="button" className="toolbar-button" onClick={() => {
        const remaining = variants!.filter(v => v.id !== current!.id);
        const nextDefault = remaining.find(v => v.id === theme.defaultColorVariantId) ?? remaining[0];
        onChange({ ...theme, colorVariants: remaining, defaultColorVariantId: nextDefault.id, light: nextDefault.light, dark: nextDefault.dark });
        onSelect(nextDefault.id); setAction(null);
      }}>Delete variant</button></> : <>
        {!variants && <label>Current colors name <input className={!original.trim() ? "theme-variant-pending-name" : undefined} aria-invalid={!original.trim()} value={original} maxLength={100} onChange={e => setOriginal(e.target.value)} /></label>}
        <label>{action === "rename" ? "Color variant name" : "New colors name"} <input className="theme-variant-pending-name" aria-invalid="true" value={name} maxLength={100} onChange={e => setName(e.target.value)} /></label>
        <p>Finish creating or renaming this variant, or cancel, before saving the theme.</p>
        {error && <p role="alert">{error}</p>}
        <button type="button" className="toolbar-button" onClick={submit}>{action === "rename" ? "Save name" : "Create variant"}</button>
      </>}
      <button type="button" className="toolbar-button" onClick={() => setAction(null)}>Cancel</button>
    </div>}
    {current && <p>Editing colors for {current.name}. Each variant includes light and dark mode.</p>}
  </section>;
}
