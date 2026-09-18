import { useEffect, useMemo, useRef, useState } from "react";
import { defaultPlasmaSettings, type ThemeDocument } from "../lib/themes";
import { ThemeWorkbenchPreview } from "./ThemeWorkbenchPreview";

export function ThemeVerificationDialog({ theme, busy, error, onConfirm, onCancel }: {
  theme: ThemeDocument;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [plasma, setPlasma] = useState(theme.plasma?.enabled ?? false);
  const preview = useMemo(() => ({
    ...theme,
    plasma: { ...(theme.plasma ?? defaultPlasmaSettings), enabled: plasma },
  }), [theme, plasma]);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog ref={dialog} className="theme-verification" aria-labelledby="theme-verification-title"
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) onCancel();
        }
      }}
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
      <header>
        <h2 id="theme-verification-title">Verify your theme</h2>
        <p>Check light and dark mode before saving.</p>
        <label>
          <input type="checkbox" checked={plasma} disabled={theme.design?.supportsPlasma === false || busy}
            onChange={(event) => setPlasma(event.target.checked)} />
          Plasma preview
        </label>
        <p className="settings-description">This toggle only changes these previews, not your theme’s saved Plasma setting.</p>
      </header>
      <div className="theme-verification-previews">
        {(["light", "dark"] as const).map((mode) => (
          <section key={mode} aria-label={`${mode === "light" ? "Light" : "Dark"} mode preview`}>
            <h3>{mode === "light" ? "Light mode" : "Dark mode"}</h3>
            <ThemeWorkbenchPreview theme={preview} mode={mode} />
          </section>
        ))}
      </div>
      <footer>
        {error ? <p role="alert">{error}</p> : null}
        <div className="theme-actions">
          <button type="button" className="toolbar-button" disabled={busy} onClick={onConfirm}>{busy ? "Saving…" : "Confirm and save"}</button>
          <button type="button" className="toolbar-button" disabled={busy} onClick={onCancel}>Back to editing</button>
        </div>
      </footer>
    </dialog>
  );
}
