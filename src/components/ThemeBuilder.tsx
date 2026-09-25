import { mixAccentColor } from "../lib/quickAppearance";
import { ThemeVariantsEditor } from "./ThemeVariantsEditor";
import { resolveThemeVariant } from "../lib/themes";
import { themeFamilies, themeFamily, rememberedThemeColor } from "../lib/themeFamilies";
import { ThemeDefaultsMenu } from "./ThemeDefaultsMenu";
import type { ThemeDefaultsScope } from "../lib/themeDefaults";
import { hasCurrentThemeChanges } from "../lib/currentThemeSettings";
import { readableThemeText, selectionBackgroundOpacity } from "../lib/themeRuntime";
import { authoringOriginal, originalSnapshot, updateDerivedTheme } from "../lib/themeDerivation";
import { ThemeTypographyEditor } from "./ThemeTypographyEditor";
import { ThemeControlsEditor } from "./ThemeControlsEditor";
import { ThemeHealthCheck } from "./ThemeHealthCheck";
import { allBuiltInThemes, bundledThemes } from "../lib/bundledThemes";
import { ThemeDeleteDialog } from "./ThemeDeleteDialog";
import { visualCssHints } from "../lib/themeVisualCss";
import { ThemeSurfacesEditor } from "./ThemeSurfacesEditor";
import { ThemeVerificationDialog } from "./ThemeVerificationDialog";
import type { ThemeDifferenceAcknowledgement } from "../types";
import { ThemeWorkbenchPreview } from "./ThemeWorkbenchPreview";
import { ThemeDesignEditor } from "./ThemeDesignEditor";
import { defaultThemeDesign, themePackageLimit } from "../lib/themeDesign";
import { decodeThemePackage, encodeThemePackage } from "../lib/themePackage";
import { ThemePreviewPanel } from "./ThemePreviewHost";
import { ChevronLeft, ChevronRight, FileText, Plus, X } from "lucide-react";
import { defaultPlasmaSettings } from "../lib/themes";
import PlasmaTheme from "./PlasmaTheme";
import { ThemeColorField } from "./ThemeColorField";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { exportThemePackageFile } from "../lib/desktop";
import {
  listThemes,
  uniqueThemeName,
  themeDisplayNames,
  optionalPaletteKeys,
  parseTheme,
  saveTheme,
  deleteTheme,
  themesMatch,
  themeDifferenceFingerprint,
  type ThemeDocument,
} from "../lib/themes";

const labels = {
  linkColor: "Links", selectionBackground: "Text selection background", selectionText: "Text selection text",
  menuSelectedBackground: "Selected menu background", menuSelectedText: "Selected menu text", hoverBackground: "Hovered item background", hoverText: "Hovered item text",
  background: "Editor background",
  surface: "Sidebar",
  surfaceSoft: "Soft surface",
  surfaceStrong: "Raised surface",
  surfaceMuted: "Muted surface",
  border: "Borders",
  text: "Interface text",
  editorText: "Editor text",
  selectedText: "Selected item text",
  highlightText: "Highlighted text",
  highlightBackground: "Highlight background",
  textMuted: "Secondary text",
  accent: "Accent",
  titlebar: "Title bar (if colored)",
};

const colorGroups = [
  { title: "Editor", keys: ["background", "editorText", "linkColor", "highlightBackground", "highlightText"] },
  { title: "Interface", keys: ["surface", "text", "surfaceMuted", "textMuted", "surfaceSoft", "surfaceStrong", "border", "titlebar"] },
  { title: "Selection and hover", keys: ["accent", "selectedText", "selectionBackground", "selectionText", "menuSelectedBackground", "menuSelectedText", "hoverBackground", "hoverText"] },
] as const;

export function ThemePreview({
  theme,
  mode,
  plasma = theme.plasma?.enabled ?? false,
  frost = theme.plasma?.frost ?? 80,
  backgroundBlur = theme.plasma?.backgroundBlur ?? 0,
}: {
  theme: ThemeDocument;
  mode: "light" | "dark";
  plasma?: boolean;
  frost?: number;
  backgroundBlur?: number;
}) {
  const p = theme[mode];
  return (
    <div
      className="theme-preview"
      data-plasma-preview={plasma || undefined}
      aria-label={`${mode} theme preview`}
      style={
        {
          background: p.background,
          color: p.text,
          borderColor: p.border,
          fontFamily: theme.appFontFamily,
          fontSize: theme.appFontSize,
          "--preview-accent": p.accent,
          "--preview-background": p.background,
          "--plasma-titlebar-fill": `color-mix(in srgb, ${theme.accentTitlebar ? p.titlebar : p.surface} ${theme.accentTitlebar ? 80 : 55}%, transparent)`,
          "--link-color": `color-mix(in srgb, ${p.accent} 45%, ${p.text} 55%)`,
        } as CSSProperties
      }
    >
      {plasma ? (
        <PlasmaTheme
          ambientDrops={theme.plasma?.ambientDrops}
          flow={(theme.plasma?.flow ?? 0) / 100}
          preview
          theme={mode}
          accentColor={p.accent}
          frost={frost / 100}
          backgroundBlur={backgroundBlur}
          layoutKey="theme-preview"
        />
      ) : null}
      <div
        className="theme-preview-title"
        style={{
          background: plasma
            ? "var(--plasma-titlebar-fill)"
            : theme.accentTitlebar
              ? p.titlebar
              : p.surface,
          color: theme.accentTitlebar ? readableThemeText(p.titlebar) : p.text,
          borderColor: theme.accentTitlebar
            ? `color-mix(in srgb, ${p.titlebar} 70%, black)`
            : p.border,
        }}
        aria-label="Title bar preview"
      >
        <span className="theme-preview-history" aria-hidden="true">
          <ChevronLeft size={16} />
          <ChevronRight size={16} />
        </span>
        <div className="theme-preview-tabs" aria-label="Note tabs preview">
          <span
            className="theme-preview-tab is-active"
            style={{ background: p.accent, color: p.selectedText ?? readableThemeText(p.accent) }}
          >
            <FileText size={16} aria-hidden="true" />
            <span>Notes</span>
            <X size={14} aria-hidden="true" />
          </span>
          <span
            className="theme-preview-tab"
            style={{
              color: theme.accentTitlebar ? readableThemeText(p.titlebar) : p.textMuted,
            }}
          >
            <FileText size={16} aria-hidden="true" />
            <span>Ideas</span>
          </span>
        </div>
        <Plus size={16} aria-hidden="true" />
      </div>
      <div className="theme-preview-body">
        <aside
          style={{
            background: plasma
              ? `color-mix(in srgb, ${p.surface} ${frost * 0.9}%, transparent)`
              : p.surface,
            borderColor: plasma
              ? `color-mix(in srgb, ${p.text} 14%, transparent)`
              : p.border,
          }}
        >
          <strong>My notebook</strong>
          <p style={{ color: p.textMuted }}>Notes</p>
          <div
            style={{
              background: p.accent,
              color: p.selectedText ?? readableThemeText(p.accent),
              padding: 8,
              borderRadius: 5,
            }}
          >
            Notes
          </div>
          <p>Ideas</p>
        </aside>
        <article
          style={{
            background: plasma
              ? `color-mix(in srgb, ${p.background} ${Math.min(95, frost * 1.1)}%, transparent)`
              : p.background,
            borderColor: plasma
              ? `color-mix(in srgb, ${p.text} 14%, transparent)`
              : p.border,
            color: p.editorText ?? p.text,
            fontFamily: theme.editorFontFamily,
            fontSize: theme.editorFontSize,
          }}
        >
          <h2>Notes</h2>
          <p>A quiet space to think, write, and explore.</p>
          <p className="theme-preview-link">A link to another idea</p>
          <blockquote
            style={{
              borderLeft: `3px solid ${p.accent}`,
              margin: "12px 0",
              padding: 10,
              background: p.surfaceSoft,
            }}
          >
            Make room for a new thought.
          </blockquote>
          <div
            style={{
              background: p.surfaceMuted,
              border: `1px solid ${p.border}`,
              padding: 8,
            }}
          >
            A small code example
          </div>
          <p style={{ color: p.textMuted }}>Edited just now</p>
        </article>
      </div>
    </div>
  );
}


export function ThemeBuilder({
  current,
  seed,
  onApply,
  onSaved,
  onUseThemeDefaults,
  onRestoreDefault,
  quickAppearanceControls,
  builtInThemes = [],
  builtInThemeId = "default",
  onBuiltInChange,
  onColorChange,
  onVariantChange,
  selectedVariantId,
  themeColorPreferences,
  colorScheme = "system",
  onColorSchemeChange,
}: {
  current: ThemeDocument | null;
  seed: ThemeDocument;
  onApply: (theme: ThemeDocument) => void;
  onSaved?: () => void;
  onUseThemeDefaults?: (theme: ThemeDocument, scope: ThemeDefaultsScope) => void;
  onRestoreDefault?: () => void;
  quickAppearanceControls?: React.ReactNode;
  builtInThemes?: { id: string; name: string }[];
  builtInThemeId?: string;
  onBuiltInChange?: (id: string) => void;
  onColorChange?: (id: string) => void;
  onVariantChange?: (id: string) => void;
  selectedVariantId?: string;
  themeColorPreferences?: Record<string, string>;
  colorScheme?: "system" | "light" | "dark";
  onColorSchemeChange?: (scheme: "system" | "light" | "dark") => void;
}) {
  const importInput = useRef<HTMLInputElement>(null);
  const [themes, setThemes] = useState<ThemeDocument[]>([]);
  const [variantPending, setVariantPending] = useState(false);
  const [draftVariantId, setDraftVariantId] = useState<string>();
  const [draft, setDraft] = useState<ThemeDocument | null>(null);
  const displayNames = themeDisplayNames([...themes.filter(t => t.id !== current?.id), ...(current ? [current] : [])]);
  const [expected, setExpected] = useState<ThemeDocument | null>(null);
  const [cssMode, setCssMode] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const editorId = useId();
  const [mode, setMode] = useState<"light" | "dark">("dark");
  const cssHints = useMemo(() => visualCssHints(draft?.design?.css ?? "", mode), [draft?.design?.css, mode]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ThemeDocument | null>(null);
  const [verifying, setVerifying] = useState(false);
  const libraryRequest = useRef({ version: 0 });
  const reload = useCallback(async () => {
    const request = ++libraryRequest.current.version;
    try {
      const result = await listThemes();
      if (request !== libraryRequest.current.version) return;
      setThemes(result.themes);
      setError(result.warnings.join(" "));
    } catch (e) {
      if (request === libraryRequest.current.version) setError(String(e));
    }
  }, []);
  useEffect(() => {
    const requests = libraryRequest.current;
    void reload();
    const refresh = () => { void reload(); };
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      requests.version++;
    };
  }, [reload]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const isDefault = current ? current.id === "default" : builtInThemeId === "default";
  const sourceTheme = (isDefault ? allBuiltInThemes.find(theme => theme.id === "default") : current)
    ?? allBuiltInThemes.find(theme => theme.id === builtInThemeId) ?? seed;
  const selectedVariant = sourceTheme.colorVariants?.find(variant => variant.id === selectedVariantId)
    ?? sourceTheme.colorVariants?.find(variant => variant.id === sourceTheme.defaultColorVariantId);
  const sourceFamily = themeFamily(sourceTheme.id);
  const sourceColor = sourceFamily?.colors.find(color => color.id === sourceTheme.id);
  const sourceThemeLabel = selectedVariant ? `${sourceTheme.name} (${selectedVariant.name})`
    : sourceFamily && sourceColor ? `${sourceFamily.name} (${sourceColor.name})` : sourceTheme.name;
  const settingsModified = hasCurrentThemeChanges(resolveThemeVariant(sourceTheme, selectedVariantId), seed);
  const defaultModified = isDefault && settingsModified;
  const layoutDiffers = sourceTheme.navigationStyle !== undefined && sourceTheme.navigationStyle !== seed.navigationStyle;
  const sourceOriginal = useMemo(() => authoringOriginal(sourceTheme, [...allBuiltInThemes, ...themes]), [sourceTheme, themes]);
  const sourceBuiltIn = allBuiltInThemes.find(theme => theme.id === sourceTheme.id);
  const draftOriginal = draft?.baseThemeSnapshot ?? allBuiltInThemes.find(theme => theme.id === (draft?.baseThemeId ?? draft?.id));
  const latestOriginal = [...allBuiltInThemes, ...themes].find(theme => theme.id === draft?.baseThemeId && theme.id !== draft?.id);
  const originalChanged = !!(draft?.baseThemeSnapshot && latestOriginal && !themesMatch(draft.baseThemeSnapshot, originalSnapshot(latestOriginal)));
  function create() {
    setDraftVariantId(selectedVariantId);
    setExpected(null);
    setDraft({
      ...seed,
      baseThemeId: sourceOriginal.id,
      baseThemeSnapshot: sourceOriginal,
      schemaVersion: 2,
      design: seed.design ?? defaultThemeDesign,
      plasma: seed.plasma ?? defaultPlasmaSettings,
      id: crypto.randomUUID(),
      name: uniqueThemeName(`${sourceTheme.name} copy`, themes),
    });
  }
  // A notebook can retain an older built-in snapshot. Its origin does not
  // change just because a newer release has different contents.
  const currentIsBuiltIn = !!current && allBuiltInThemes.some(theme => theme.id === current.id);
  const currentIsBundled = !!current && bundledThemes.some(theme => theme.id === current.id);
  const selectedFamily = themeFamily(sourceTheme.id);
  const builtInOptions = [
    ...themeFamilies.filter(family => builtInThemes.some(theme => family.colors.some(color => color.id === theme.id)))
      .map(family => ({ id: family.colors[0].id, name: family.name, value: `builtin:${family.colors[0].id}` })),
    ...builtInThemes.filter(theme => !themeFamily(theme.id)).map(theme => ({ ...theme, value: `builtin:${theme.id}` })),
    ...bundledThemes.map(theme => ({ ...theme, value: `bundled:${theme.id}` })),
  ].sort((a, b) => a.id === "default" ? -1 : b.id === "default" ? 1 : a.name.localeCompare(b.name));
  const savedOptions = [
    ...themes.filter(theme => theme.id !== current?.id),
    ...(current && !currentIsBuiltIn && !isDefault ? [current] : []),
  ].sort((a, b) => (displayNames[a.id] ?? a.name).localeCompare(displayNames[b.id] ?? b.name));
  const editingTheme = draft ? resolveThemeVariant(draft, draftVariantId) : null;
  const update = (patch: Partial<ThemeDocument>) => {
    if (!draft) return;
    if (draft.colorVariants && (patch.light || patch.dark)) {
      const id = draft.colorVariants.some(v => v.id === draftVariantId) ? draftVariantId : draft.defaultColorVariantId;
      const colorVariants = draft.colorVariants.map(v => v.id === id ? { ...v, ...(patch.light ? { light: patch.light } : {}), ...(patch.dark ? { dark: patch.dark } : {}) } : v);
      const initial = colorVariants.find(v => v.id === draft.defaultColorVariantId)!;
      setDraft({ ...draft, ...patch, colorVariants, light: initial.light, dark: initial.dark });
    } else setDraft({ ...draft, ...patch });
  };
  return (
    <div className="theme-builder">
      {deleting && <ThemeDeleteDialog
        name={displayNames[deleting.id] ?? deleting.name}
        busy={busy}
        error={error}
        onCancel={() => { setDeleting(null); setError(""); }}
        onDelete={() => void run(async () => {
          await deleteTheme(deleting);
          onBuiltInChange?.("default");
          setDeleting(null);
          await reload();
        })}
      />}

      {!draft ? (
        <>
          <div className="setting-row">
            <span>
              <strong>Mode</strong>
              <small>Use light, dark, or follow this computer.</small>
            </span>
            <select
              className="settings-select"
              aria-label="Mode"
              value={colorScheme}
              onChange={(e) =>
                onColorSchemeChange?.(
                  e.target.value as "system" | "light" | "dark",
                )
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <hr className="settings-appearance-divider" />
          <section className="settings-theme-section" aria-label="Theme selection and management">
          <div className="setting-row">
            <span>
              <strong>Theme</strong>
              <small>The selected theme travels with this notebook.</small>
            </span>
            <div className="theme-picker-controls">
              <select
                className="settings-select"
                aria-label="Theme"
                disabled={busy}
                value={
                  isDefault ? (defaultModified ? "modified:default" : "builtin:default")
                    : selectedFamily ? `builtin:${selectedFamily.colors[0].id}` : current ? `${currentIsBundled ? "bundled" : currentIsBuiltIn ? "builtin" : "saved"}:${current.id}` : `builtin:${builtInThemeId}`
                }
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "modified:default") return;
                  if (value === "builtin:default" && defaultModified && onRestoreDefault) {
                    onRestoreDefault();
                  } else if (value.startsWith("builtin:")) {
                    const id = value.slice(8);
                    const family = themeFamily(id);
                    onBuiltInChange?.(family ? rememberedThemeColor(family.id, themeColorPreferences) ?? id : id);
                  }
                  else if (value.startsWith("bundled:")) {
                    const theme = bundledThemes.find((t) => `bundled:${t.id}` === value);
                    if (theme) onApply(theme);
                  } else {
                    const theme = themes.find((t) => `saved:${t.id}` === value);
                    if (theme) onApply(theme);
                  }
                }}
              >
                <optgroup label="Built-in">
                  {builtInOptions.map((t) => (
                    <option key={t.id} value={t.value}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
                {defaultModified && <optgroup label="This notebook"><option value="modified:default">Classic (modified)</option></optgroup>}
                {savedOptions.length ? (
                  <optgroup label="Custom">
                    {savedOptions.map((t) => (
                        <option key={t.id} value={`saved:${t.id}`}>
                          {displayNames[t.id] ?? t.name}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
          </div>
          {selectedFamily && <div className="setting-row theme-color-presets">
            <span><strong>Colors</strong><small>Keep this theme’s styling and change its palette.</small></span>
            <select className="settings-select" aria-label="Colors" value={sourceTheme.id} disabled={busy}
              onChange={event => (onColorChange ?? onBuiltInChange)?.(event.target.value)}>
              {selectedFamily.colors.map(color => <option key={color.id} value={color.id}>{color.name}</option>)}
            </select>
          </div>}
          {selectedFamily?.id === 'catppuccin' && <p className="settings-description">Light mode uses Latte. In dark mode, Latte uses Frappe; the other colors use their named dark palette.</p>}
          {sourceTheme.colorVariants && <div className="setting-row theme-color-presets">
            <strong>Colors</strong><select className="settings-select" aria-label="Colors" value={sourceTheme.colorVariants.some(v => v.id === selectedVariantId) ? selectedVariantId : sourceTheme.defaultColorVariantId} onChange={e => onVariantChange?.(e.target.value)}>
              {sourceTheme.colorVariants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>}
          {quickAppearanceControls}
          {themes.some(t => displayNames[t.id] !== t.name) && <p className="settings-description">Some older themes share a name. Numbered labels distinguish them here; editing and saving one gives it a unique name.</p>}
          {(settingsModified || (onUseThemeDefaults && layoutDiffers)) && <div className="theme-current-settings">
            <p className="settings-description" role="status"><strong>{`Current settings differ from ${sourceThemeLabel}.`}</strong></p>
            <div className="theme-actions">
              {settingsModified && <button type="button" className="toolbar-button" disabled={busy} onClick={create}>Save current settings as new theme</button>}
              {onUseThemeDefaults && <ThemeDefaultsMenu disabled={busy} onSelect={scope => { onUseThemeDefaults(sourceTheme, scope); }} />}
            </div>
          </div>}
          <div className="theme-actions">
            <button className="toolbar-button" onClick={create} disabled={busy}>
              Create theme
            </button>
            {sourceTheme.id !== "default" ? (
              <button
                className="toolbar-button"
                disabled={busy}
                onClick={() => {
                  setDraftVariantId(selectedVariantId);
                  setDraft({
                    ...sourceTheme,
                    baseThemeId: sourceOriginal.id,
                    baseThemeSnapshot: sourceOriginal,
                    id: sourceBuiltIn ? crypto.randomUUID() : sourceTheme.id,
                    name: uniqueThemeName(sourceBuiltIn ? `${sourceTheme.name} copy` : sourceTheme.name, themes, sourceBuiltIn ? undefined : sourceTheme.id),
                    plasma:
                      sourceTheme.plasma ?? seed.plasma ?? defaultPlasmaSettings,
                  });
                  setExpected(sourceBuiltIn ? null : themes.find((t) => t.id === sourceTheme.id) ?? null);
                }}
              >
                Edit theme
              </button>
            ) : null}
            {current && onBuiltInChange && themes.some(t => t.id === current.id) ? (
              <button className="toolbar-button" disabled={busy} onClick={() => {
                setError("");
                setDeleting(themes.find(t => t.id === current.id) ?? null);
              }}>Delete theme</button>
            ) : null}
            <button
              className="toolbar-button"
              disabled={busy}
              onClick={() => importInput.current?.click()}
            >
              Import theme
            </button>
            <input
              ref={importInput}
              aria-label="Import theme package or JSON"
              type="file"
              accept=".json,.zip,.tigrana-theme,application/json,application/zip"
              disabled={busy}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run(async () => {
                  if (file.size > themePackageLimit)
                    throw new Error(
                      "Theme packages must be smaller than 8 MB.",
                    );
                  const theme = decodeThemePackage(
                    new Uint8Array(await file.arrayBuffer()),
                  );
                  const library = await listThemes();
                  const existing = library.themes.find(
                    (t) => t.id === theme.id,
                  );
                  // Preserve portable identity unless importing a different theme over an existing ID.
                  const duplicate = theme.id === "default" || (existing && !themesMatch(existing, theme));
                  setExpected(duplicate ? null : (existing ?? null));
                  setDraft(
                    duplicate
                      ? {
                          ...theme,
                          id: crypto.randomUUID(),
                          name: uniqueThemeName(`${theme.name.slice(0, 95)} copy`, library.themes),
                        }
                      : { ...theme, name: uniqueThemeName(theme.name, library.themes, theme.id) },
                  );
                });
              }}
            />
            {current ? (
              <button
                className="toolbar-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await exportThemePackageFile(
                      `${current.name.replace(/[^a-zA-Z0-9_-]/g, "-")}.tigrana-theme`,
                      encodeThemePackage(current),
                    );
                  })
                }
              >
                Export theme
              </button>
            ) : null}
          </div>
          </section>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {draft ? (
        <div className="theme-editor">
          <div className="theme-editor-controls">
            <div className="setting-row theme-name-row">
              <label>
                Theme name{" "}
                <input
                  className="settings-text-input"
                  aria-label="Theme name"
                  maxLength={100}
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </label>
            </div>
            <div
              className="theme-mode-tabs"
              role="tablist"
              aria-label="Theme editor mode"
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? false
                    : event.key === "End"
                      ? true
                      : !cssMode;
                setCssMode(next);
                const tabs = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                tabs[next ? 1 : 0]?.focus();
              }}
            >
              <button
                type="button"
                role="tab"
                id={`${editorId}-visual`}
                aria-controls={`${editorId}-panel`}
                aria-selected={!cssMode}
                tabIndex={cssMode ? -1 : 0}
                onClick={() => setCssMode(false)}
              >
                Visual
              </button>
              <button
                type="button"
                role="tab"
                id={`${editorId}-css`}
                aria-controls={`${editorId}-panel`}
                aria-selected={cssMode}
                tabIndex={cssMode ? 0 : -1}
                onClick={() => setCssMode(true)}
              >
                Advanced CSS
              </button>
            </div>
            <div
              role="tabpanel"
              id={`${editorId}-panel`}
              aria-labelledby={`${editorId}-${cssMode ? "css" : "visual"}`}
            >
              <div hidden={cssMode}>
                {originalChanged && <div className="theme-update-original"><p>A newer original theme is available. Apply its changes while keeping your customizations. Conflicting custom values take precedence.</p>
                  <button className="toolbar-button" type="button" onClick={() => {
                    try { setDraft(updateDerivedTheme(draft, latestOriginal!)); setError(''); } catch (e) { setError(`The update could not be applied. Your theme is unchanged. ${String(e)}`); }
                  }}>Update original, keep my changes</button></div>}

                <ThemeVariantsEditor theme={draft} selected={draftVariantId} onSelect={setDraftVariantId} onChange={setDraft} onPendingChange={setVariantPending} />
                {colorGroups.map((group) => (
                  <fieldset className="theme-color-group" key={group.title}>
                    <legend>{group.title}</legend>
                    <div className="theme-color-grid">
                      {group.keys.map((key) => (
                        <ThemeColorField
                          key={`${mode}:${key}`}
                          label={labels[key]}
                          name={`${mode} ${labels[key]}`}
                          cssHint={cssHints[key]}
                          onReset={optionalPaletteKeys.includes(key as typeof optionalPaletteKeys[number]) && editingTheme![mode][key] !== undefined ? () => {
                            const palette = { ...editingTheme![mode] }; delete (palette as Partial<typeof palette>)[key]; update({ [mode]: palette });
                          } : undefined}
                          value={editingTheme![mode][key] ?? (key === "linkColor" ? mixAccentColor(editingTheme![mode].accent, editingTheme![mode].editorText ?? editingTheme![mode].text, 0.45) : key === "selectionBackground" || key === "menuSelectedBackground" || key === "hoverBackground" ? editingTheme![mode].accent : key === "menuSelectedText" ? (editingTheme![mode].menuSelectedBackground ? readableThemeText(editingTheme![mode].menuSelectedBackground!) : editingTheme![mode].selectedText ?? readableThemeText(editingTheme![mode].accent)) : key === "hoverText" ? (editingTheme![mode].hoverBackground ? readableThemeText(editingTheme![mode].hoverBackground!) : editingTheme![mode].selectedText ?? readableThemeText(editingTheme![mode].accent)) : key === "selectionText" ? readableThemeText(editingTheme![mode].selectionBackground ?? editingTheme![mode].accent, selectionBackgroundOpacity) : key === "selectedText" ? readableThemeText(editingTheme![mode].accent) : key === "highlightText" ? "#000000" : key === "highlightBackground" ? "#ffff00" : editingTheme![mode].text)}
                          onChange={(color) =>
                            update({ [mode]: { ...editingTheme![mode], [key]: color } })
                          }
                        />
                      ))}
                    </div>
                  </fieldset>
                ))}
                <label className="setting-row">
                  Default navigation style
                  <select
                    className="settings-select"
                    value={draft.navigationStyle ?? ""}
                    onChange={(event) => update({ navigationStyle: event.target.value === "dual-pane" ? "dual-pane" : event.target.value === "single-pane" ? "single-pane" : event.target.value === "section-view" ? "section-view" : undefined })}
                  >
                    <option value="">Keep current</option>
                    <option value="dual-pane">Dual pane</option>
                    <option value="section-view">Dual pane with sections</option>
                    <option value="single-pane">Single pane</option>
                  </select>
                </label>
                <p className="settings-description">Applied when you choose Use theme default layout options or Use all theme defaults. Switching themes keeps your current navigation.</p>
                <label className="setting-row">
                  Default right sidebar
                  <select className="settings-select" value={draft.rightSidebarOpen === undefined ? "" : draft.rightSidebarOpen ? "open" : "closed"}
                    onChange={event => update({ rightSidebarOpen: event.target.value === "" ? undefined : event.target.value === "open" })}>
                    <option value="">Keep current</option>
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <p className="settings-description">Applied when you choose Use theme default layout options or Use all theme defaults. Switching themes keeps your current sidebar visibility.</p>
                <label className="setting-row">
                  Default editor width
                  <select className="settings-select" value={draft.editorWidthMode ?? ""}
                    onChange={event => update({ editorWidthMode: (event.target.value || undefined) as ThemeDocument["editorWidthMode"] })}>
                    <option value="">Keep current</option>
                    <option value="comfortable">Comfortable Width</option>
                    <option value="narrow">Narrow Width</option>
                    <option value="full">Full Width</option>
                  </select>
                </label>
                <label className="setting-row">
                  Default Editor Alignment
                  <select className="settings-select" value={draft.noteAlignment ?? ""}
                    onChange={event => update({ noteAlignment: (event.target.value || undefined) as ThemeDocument["noteAlignment"] })}>
                    <option value="">Keep current</option>
                    <option value="left">Align left</option>
                    <option value="center">Align center</option>
                  </select>
                </label>
                <p className="settings-description">Applied when you choose this theme. Adjust them afterward in View or the editor options menu.</p>
                <label className="setting-row">
                  Default word count
                  <select className="settings-select" value={draft.wordCountVisible === undefined ? "" : String(draft.wordCountVisible)}
                    onChange={event => update({ wordCountVisible: event.target.value === "" ? undefined : event.target.value === "true" })}>
                    <option value="">Keep current</option>
                    <option value="true">Shown</option>
                    <option value="false">Hidden</option>
                  </select>
                </label>
                <p className="settings-description">Applied when you choose this theme. You can toggle word count afterward in View or General settings.</p>
                <p className="settings-description">Layout, typography, surfaces, effects, and CSS apply to all color variants.</p>
                <ThemeSurfacesEditor theme={draft} mode={mode} change={update} />
                <div className="theme-font-grid">
                  {(["app", "editor"] as const).map((part) => (
                    <label key={part}>
                      {part === "app" ? "Interface font" : "Note font"}
                      {(cssHints[`${part}FontFamily`] || cssHints[`${part}FontSize`]) && <span className="theme-css-hint" title={cssHints[`${part}FontFamily`] || cssHints[`${part}FontSize`]}>Custom CSS</span>}
                      <input
                        className="settings-text-input"
                        aria-label={`${part} theme font`}
                        value={draft[`${part}FontFamily`]}
                        onChange={(e) =>
                          update({ [`${part}FontFamily`]: e.target.value })
                        }
                      />
                      <input
                        aria-label={`${part} theme font size`}
                        type="number"
                        min={11}
                        max={28}
                        value={draft[`${part}FontSize`]}
                        onChange={(e) =>
                          update({
                            [`${part}FontSize`]: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <ThemeTypographyEditor theme={draft} change={update} />
                <ThemeControlsEditor theme={draft} change={update} />
                <label>
                  <input
                    type="checkbox"
                    checked={draft.accentTitlebar}
                    onChange={(e) =>
                      update({ accentTitlebar: e.target.checked })
                    }
                  />{" "}
                  Colored title bar
                </label>
              </div>
              <ThemeDesignEditor
                theme={draft}
                onChange={update}
                cssMode={cssMode}
              />
            </div>
            <ThemeHealthCheck theme={editingTheme!} />
            <p>
              Save updates the shared library and this notebook. Other notebooks
              choose whether to adopt the changes when opened.
            </p>
          </div>
          <div className="theme-actions theme-editor-actions">
            <button
              className="toolbar-button"
              disabled={busy || variantPending}
              title={variantPending ? "Finish or cancel the color variant action before saving." : undefined}
              onClick={() => {
                if (variantPending) return;
                setError("");
                try {
                  parseTheme(draft);
                  setVerifying(true);
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              {busy ? "Saving…" : "Save and use"}
            </button>
            <button
              className="toolbar-button"
              disabled={busy}
              onClick={() => {
                setDraft({
                  ...draft,
                  id: crypto.randomUUID(),
                  name: uniqueThemeName(`${draft.name.slice(0, 95)} copy`, themes),
                });
                setExpected(null);
              }}
            >
              Make a copy
            </button>
            {draftOriginal ? <button className="toolbar-button" disabled={busy} onClick={() => {
              setDraft({ ...draftOriginal, id: draft.id, name: draft.name, baseThemeId: draftOriginal.id, baseThemeSnapshot: originalSnapshot(draftOriginal) });
              setError("");
            }}>Revert to defaults</button> : null}
            <button
              className="toolbar-button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
          </div>
          {verifying ? (
            <ThemeVerificationDialog theme={editingTheme!} busy={busy} error={error}
              onCancel={() => { setVerifying(false); setError(""); }}
              onConfirm={() => void run(async () => {
                const theme = parseTheme(draft);
                await saveTheme(theme, expected);
                onApply(theme);
                setVerifying(false);
                setDraft(null);
                await reload();
                onSaved?.();
              })}
            />
          ) : null}
          <ThemePreviewPanel>
            <div className={`theme-editor-preview${previewExpanded ? " is-expanded" : ""}`}>
              <div className="theme-preview-heading">
                <h3>Preview</h3>
                <button type="button" className="toolbar-button" aria-expanded={previewExpanded} onClick={() => setPreviewExpanded(value => !value)}>{previewExpanded ? "Collapse preview" : "Expand preview"}</button>
                <select
                  className="settings-select"
                  aria-label="Preview color scheme"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "light" | "dark")}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
              <ThemeWorkbenchPreview theme={editingTheme!} mode={mode} />
            </div>
          </ThemePreviewPanel>
        </div>
      ) : null}
    </div>
  );
}

/** Mount per notebook. The local snapshot remains authoritative until the user resolves a difference. */
export function ThemeReconciliation({
  current,
  onApply,
  acknowledgedDifference,
  onKeepBoth,
}: {
  current: ThemeDocument | null;
  onApply: (theme: ThemeDocument) => void;
  acknowledgedDifference?: ThemeDifferenceAcknowledgement;
  onKeepBoth?: (difference: ThemeDifferenceAcknowledgement) => void;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const acknowledgedNotebook = acknowledgedDifference?.notebook;
  const acknowledgedAppWide = acknowledgedDifference?.appWide;
  const [shared, setShared] = useState<ThemeDocument | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const snapshotJson = JSON.stringify(current);
  const applyRef = useRef(onApply);
  applyRef.current = onApply;
  const builtInUpdate = shared && allBuiltInThemes.some(theme => theme.id === shared.id);
  useEffect(() => {
    const snapshot: ThemeDocument | null = JSON.parse(snapshotJson);
    let cancelled = false;
    setShared(null);
    setMissing(false);
    setDismissed(false);
    setError("");
    // Restoring defaults stores a snapshot even for classic built-in presets.
    // Those themes already ship with the app; they need no library registration.
    const builtIn = allBuiltInThemes.find((theme) => theme.id === snapshot?.id);
    if (snapshot && snapshot.id !== "default" && !(builtIn && themesMatch(snapshot, builtIn)))
      void listThemes()
        .then(async (result) => {
          if (cancelled) return;
          const match = builtIn ?? result.themes.find((t) => t.id === snapshot.id);
          if (builtIn && localStorage.getItem(`tigrana-theme-update:${builtIn.id}`)) {
            const release = await themeDifferenceFingerprint(builtIn, null);
            if (cancelled) return;
            if (localStorage.getItem(`tigrana-theme-update:${builtIn.id}`) === release.notebook) {
              applyRef.current(builtIn);
              return;
            }
          }
          if (acknowledgedNotebook) {
            const difference = await themeDifferenceFingerprint(
              snapshot,
              match ?? null,
            );
            if (cancelled) return;
            if (
              difference.notebook === acknowledgedNotebook &&
              difference.appWide === acknowledgedAppWide
            )
              return;
          }
          setShared(match && !themesMatch(snapshot, match) ? match : null);
          setMissing(!match);
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    return () => {
      cancelled = true;
    };
  }, [snapshotJson, refresh, acknowledgedNotebook, acknowledgedAppWide]);
  if (!current || current.id === "default" || dismissed || (!shared && !missing && !error)) return null;
  return (
    <div className="dialog-backdrop settings-backdrop">
      <section
        className="dialog theme-conflict"
        role="dialog"
        aria-modal="true"
        aria-label="Resolve theme difference"
      >
        <h2>
          {builtInUpdate ? "A newer built-in theme is available" : shared
            ? "Theme copies differ"
            : missing
              ? "Make this theme available app-wide?"
              : "App-wide themes unavailable"}
        </h2>
        <p>
          {builtInUpdate ? `Use the latest “${shared!.name}” in this notebook and in other notebooks using this built-in theme when you open them. Notebooks using other themes will stay unchanged.` : shared
            ? `“${current.name}” differs from the app-wide theme available to other notebooks on this computer. This notebook is still using its saved appearance.`
            : missing
              ? `“${current.name}” is saved in this notebook but is not yet available to other notebooks on this computer.`
              : "The notebook's saved theme is still available."}
        </p>
        {shared ? (
          <div className="theme-conflict-previews">
            <div>
              <h3>This notebook</h3>
              <ThemePreview theme={current} mode="dark" />
            </div>
            <div>
              <h3>App-wide theme</h3>
              <ThemePreview theme={shared} mode="dark" />
            </div>
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <div className="theme-actions">
          {builtInUpdate ? (
            <button className="toolbar-button is-recommended" disabled={busy} onClick={() => {
              setBusy(true);
              void themeDifferenceFingerprint(shared!, null).then(release => {
                localStorage.setItem(`tigrana-theme-update:${shared!.id}`, release.notebook);
                onApply(shared!);
                setDismissed(true);
              }).catch(e => setError(String(e))).finally(() => setBusy(false));
            }}>
              <span className="theme-choice-label">Use the latest version everywhere</span>
              <span className="theme-recommendation">(Recommended)</span>
              <small>Update other notebooks using this theme when you open them on this computer.</small>
            </button>
          ) : shared || missing ? (
            <button
              className="toolbar-button is-recommended"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void (async () => {
                  const library = await listThemes();
                  const registered = { ...current, name: uniqueThemeName(current.name, library.themes, current.id) };
                  await saveTheme(registered, shared);
                  if (registered.name !== current.name) onApply(registered);
                  setDismissed(true);
                })()
                  .catch((e) => setError(String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {shared ? (
                <>
                  <span className="theme-choice-label">
                    Replace the app-wide theme with this notebook's version
                  </span>
                  <span className="theme-recommendation">(Recommended)</span>
                  <small>Available to all notebooks on this computer.</small>
                </>
              ) : (
                "Make theme available app-wide"
              )}
            </button>
          ) : null}
          {shared ? (
            <button
              className="toolbar-button"
              disabled={busy}
              onClick={() => {
                onApply(shared);
                setDismissed(true);
              }}
            >
              {builtInUpdate ? "Use the latest version in this notebook only" : "Replace this notebook's theme with the app-wide version"}
            </button>
          ) : null}
          {error ? (
            <button
              className="toolbar-button"
              disabled={busy}
              onClick={() => setRefresh((n) => n + 1)}
            >
              Reload app-wide themes
            </button>
          ) : null}
          <button
            className="toolbar-button"
            disabled={busy}
            onClick={() => {
              if (!onKeepBoth || error) {
                setDismissed(true);
                return;
              }
              setBusy(true);
              void themeDifferenceFingerprint(current, shared)
                .then((difference) => {
                  if (!mounted.current) return;
                  onKeepBoth(difference);
                  setDismissed(true);
                })
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            {builtInUpdate ? "Keep this notebook’s current version" : shared
              ? "Keep both versions unchanged"
              : "Keep theme in this notebook only"}
          </button>
        </div>
      </section>
    </div>
  );
}
