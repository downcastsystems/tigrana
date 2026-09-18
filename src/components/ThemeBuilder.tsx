import { ThemePreviewPanel } from "./ThemePreviewHost";
import { ChevronLeft, ChevronRight, FileText, Plus, X } from "lucide-react";
import { defaultPlasmaSettings } from "../lib/themes";
import PlasmaTheme from "./PlasmaTheme";
import { ThemeColorField } from "./ThemeColorField";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { exportTextFile } from "../lib/desktop";
import {
  listThemes,
  paletteKeys,
  parseTheme,
  saveTheme,
  themesMatch,
  type ThemeDocument,
} from "../lib/themes";

const labels = {
  background: "Editor background",
  surface: "Sidebar",
  surfaceSoft: "Soft surface",
  surfaceStrong: "Raised surface",
  surfaceMuted: "Muted surface",
  border: "Borders",
  text: "Text",
  textMuted: "Secondary text",
  accent: "Accent",
  titlebar: "Title bar (if colored)",
};

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
          color: theme.accentTitlebar ? contrast(p.titlebar) : p.text,
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
            style={{ background: p.accent, color: contrast(p.accent) }}
          >
            <FileText size={16} aria-hidden="true" />
            <span>Field notes</span>
            <X size={14} aria-hidden="true" />
          </span>
          <span
            className="theme-preview-tab"
            style={{
              color: theme.accentTitlebar ? contrast(p.titlebar) : p.textMuted,
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
              color: contrast(p.accent),
              padding: 8,
              borderRadius: 5,
            }}
          >
            Field notes
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
            fontFamily: theme.editorFontFamily,
            fontSize: theme.editorFontSize,
          }}
        >
          <h2>Field notes</h2>
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
function contrast(hex: string) {
  const channels = [1, 3, 5].map((i) => {
    const value = parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.54 ? "#192d2b" : "#ffffff";
}

export function ThemeBuilder({
  current,
  seed,
  onApply,
  builtInThemes = [],
  builtInThemeId = "default",
  onBuiltInChange,
  colorScheme = "system",
  onColorSchemeChange,
}: {
  current: ThemeDocument | null;
  seed: ThemeDocument;
  onApply: (theme: ThemeDocument) => void;
  builtInThemes?: { id: string; name: string }[];
  builtInThemeId?: string;
  onBuiltInChange?: (id: string) => void;
  colorScheme?: "system" | "light" | "dark";
  onColorSchemeChange?: (scheme: "system" | "light" | "dark") => void;
}) {
  const importInput = useRef<HTMLInputElement>(null);
  const [themes, setThemes] = useState<ThemeDocument[]>([]);
  const [draft, setDraft] = useState<ThemeDocument | null>(null);
  const [expected, setExpected] = useState<ThemeDocument | null>(null);
  const [mode, setMode] = useState<"light" | "dark">("dark");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function reload() {
    try {
      const result = await listThemes();
      setThemes(result.themes);
      setError(result.warnings.join(" "));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void reload();
  }, []);
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
  function create() {
    setExpected(null);
    setDraft({
      ...(current ?? seed),
      plasma: current?.plasma ?? seed.plasma ?? defaultPlasmaSettings,
      id: crypto.randomUUID(),
      name: `${current?.name ?? "My"} theme`,
    });
  }
  const update = (patch: Partial<ThemeDocument>) =>
    setDraft(draft ? { ...draft, ...patch } : null);
  return (
    <div className="theme-builder">
      {!draft ? (
        <>
          <div className="setting-row">
            <span>
              <strong>Color scheme</strong>
              <small>Use light, dark, or follow this computer.</small>
            </span>
            <select
              className="settings-select"
              aria-label="Color scheme"
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
          <div className="setting-row">
            <span>
              <strong>Theme</strong>
              <small>The selected theme travels with this notebook.</small>
            </span>
            <select
              className="settings-select"
              aria-label="Theme"
              disabled={busy}
              value={
                current ? `saved:${current.id}` : `builtin:${builtInThemeId}`
              }
              onChange={(e) => {
                const value = e.target.value;
                if (value.startsWith("builtin:"))
                  onBuiltInChange?.(value.slice(8));
                else {
                  const theme = themes.find((t) => `saved:${t.id}` === value);
                  if (theme) onApply(theme);
                }
              }}
            >
              <optgroup label="Built-in">
                {builtInThemes.map((t) => (
                  <option key={t.id} value={`builtin:${t.id}`}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
              {current || themes.length ? (
                <optgroup label="Saved">
                  {current ? (
                    <option value={`saved:${current.id}`}>
                      {current.name}
                    </option>
                  ) : null}
                  {themes
                    .filter((t) => t.id !== current?.id)
                    .map((t) => (
                      <option key={t.id} value={`saved:${t.id}`}>
                        {t.name}
                      </option>
                    ))}
                </optgroup>
              ) : null}
            </select>
          </div>
          <div className="theme-actions">
            <button className="toolbar-button" onClick={create} disabled={busy}>
              Create theme
            </button>
            {current ? (
              <button
                className="toolbar-button"
                disabled={busy}
                onClick={() => {
                  setDraft({
                    ...current,
                    plasma:
                      current.plasma ?? seed.plasma ?? defaultPlasmaSettings,
                  });
                  setExpected(themes.find((t) => t.id === current.id) ?? null);
                }}
              >
                Edit theme
              </button>
            ) : null}
            <button
              className="toolbar-button"
              disabled={busy}
              onClick={() => importInput.current?.click()}
            >
              Import JSON
            </button>
            <input
              ref={importInput}
              aria-label="Import theme JSON"
              type="file"
              accept=".json,application/json"
              disabled={busy}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run(async () => {
                  if (file.size > 100_000)
                    throw new Error("Theme files must be smaller than 100 KB.");
                  const theme = parseTheme(JSON.parse(await file.text()));
                  const library = await listThemes();
                  const existing = library.themes.find(
                    (t) => t.id === theme.id,
                  );
                  // Preserve portable identity unless importing a different theme over an existing ID.
                  const duplicate = existing && !themesMatch(existing, theme);
                  setExpected(duplicate ? null : (existing ?? null));
                  setDraft(
                    duplicate
                      ? {
                          ...theme,
                          id: crypto.randomUUID(),
                          name: `${theme.name.slice(0, 95)} copy`,
                        }
                      : theme,
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
                    await exportTextFile(
                      `${current.name.replace(/[^a-zA-Z0-9_-]/g, "-")}.json`,
                      JSON.stringify(current, null, 2),
                      [{ name: "Tigrana theme", extensions: ["json"] }],
                    );
                  })
                }
              >
                Export JSON
              </button>
            ) : null}
            <button
              className="toolbar-button"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setExpected(null);
                void reload();
              }}
            >
              Reload library
            </button>
          </div>
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
            <label className="theme-preview-toggle">
              <input
                type="checkbox"
                checked={draft.plasma?.enabled ?? false}
                onChange={(event) =>
                  update({
                    plasma: {
                      ...(draft.plasma ?? defaultPlasmaSettings),
                      enabled: event.target.checked,
                    },
                  })
                }
              />
              Plasma UI
            </label>
            <p className="settings-description">
              Plasma settings are saved with this theme.
            </p>
            {draft.plasma?.enabled ? (
              <>
                <label className="setting-row">
                  Panel frostiness
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={draft.plasma.frost}
                    onChange={(e) =>
                      update({
                        plasma: {
                          ...draft.plasma!,
                          frost: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="setting-row">
                  Background blur
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={draft.plasma.backgroundBlur}
                    onChange={(e) =>
                      update({
                        plasma: {
                          ...draft.plasma!,
                          backgroundBlur: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              </>
            ) : null}
            <div className="theme-color-grid">
              {paletteKeys.map((key) => (
                <ThemeColorField
                  key={`${mode}:${key}`}
                  label={labels[key]}
                  name={`${mode} ${labels[key]}`}
                  value={draft[mode][key]}
                  onChange={(color) =>
                    update({ [mode]: { ...draft[mode], [key]: color } })
                  }
                />
              ))}
            </div>
            <div className="theme-font-grid">
              {(["app", "editor"] as const).map((part) => (
                <label key={part}>
                  {part === "app" ? "Interface font" : "Note font"}
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
                      update({ [`${part}FontSize`]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              <input
                type="checkbox"
                checked={draft.accentTitlebar}
                onChange={(e) => update({ accentTitlebar: e.target.checked })}
              />{" "}
              Colored title bar
            </label>
            <p>
              Save updates the shared library and this notebook. Other notebooks
              choose whether to adopt the changes when opened.
            </p>
            <div className="theme-actions">
              <button
                className="toolbar-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const theme = parseTheme(draft);
                    await saveTheme(theme, expected);
                    onApply(theme);
                    setDraft(null);
                    await reload();
                  })
                }
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
                    name: `${draft.name} copy`,
                  });
                  setExpected(null);
                }}
              >
                Make a copy
              </button>
              <button
                className="toolbar-button"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
            </div>
          </div>
          <ThemePreviewPanel>
            <div className="theme-editor-preview">
              <div className="theme-preview-heading">
                <h3>Preview</h3>
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
              <ThemePreview theme={draft} mode={mode} />
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
}: {
  current: ThemeDocument | null;
  onApply: (theme: ThemeDocument) => void;
}) {
  const [shared, setShared] = useState<ThemeDocument | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const snapshotJson = JSON.stringify(current);
  useEffect(() => {
    const snapshot: ThemeDocument | null = JSON.parse(snapshotJson);
    let cancelled = false;
    setShared(null);
    setMissing(false);
    setDismissed(false);
    setError("");
    if (snapshot)
      void listThemes()
        .then((result) => {
          if (cancelled) return;
          const match = result.themes.find((t) => t.id === snapshot.id);
          setShared(match && !themesMatch(snapshot, match) ? match : null);
          setMissing(!match);
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    return () => {
      cancelled = true;
    };
  }, [snapshotJson, refresh]);
  if (!current || dismissed || (!shared && !missing && !error)) return null;
  return (
    <div className="dialog-backdrop settings-backdrop">
      <section
        className="dialog theme-conflict"
        role="dialog"
        aria-modal="true"
        aria-label="Resolve theme difference"
      >
        <h2>
          {shared
            ? "Theme copies differ"
            : missing
              ? "Add this theme to your library?"
              : "Theme library unavailable"}
        </h2>
        <p>
          {shared
            ? `“${current.name}” differs from the shared copy. This notebook is still using its saved appearance.`
            : missing
              ? `“${current.name}” is saved in this notebook but is not in this computer's theme library.`
              : "The notebook's saved theme is still available."}
        </p>
        {shared ? (
          <div className="theme-conflict-previews">
            <div>
              <h3>Notebook</h3>
              <ThemePreview theme={current} mode="dark" />
            </div>
            <div>
              <h3>Shared library</h3>
              <ThemePreview theme={shared} mode="dark" />
            </div>
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <div className="theme-actions">
          {shared ? (
            <button
              className="toolbar-button"
              disabled={busy}
              onClick={() => {
                onApply(shared);
                setDismissed(true);
              }}
            >
              Use shared in notebook
            </button>
          ) : null}
          {shared || missing ? (
            <button
              className="toolbar-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void saveTheme(current, shared)
                  .then(() => setDismissed(true))
                  .catch((e) => setError(String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {shared
                ? "Replace shared with notebook"
                : "Add to shared library"}
            </button>
          ) : null}
          {error ? (
            <button
              className="toolbar-button"
              disabled={busy}
              onClick={() => setRefresh((n) => n + 1)}
            >
              Reload library
            </button>
          ) : null}
          <button
            className="toolbar-button"
            disabled={busy}
            onClick={() => setDismissed(true)}
          >
            Keep notebook for now
          </button>
        </div>
      </section>
    </div>
  );
}
