import { parseTypography, parseControls, type ThemeTypography, type ThemeControl } from "./themeOptions";
import { parseThemeSurfaces, type ThemeSurfaces } from "./themeSurfaces";
import { parseThemeDesign, type ThemeDesign } from "./themeDesign";
import { compileThemeCss } from "./themeCss";
import type { NotebookAppearance } from "../types";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./desktop";

export const paletteKeys = [
  "background",
  "surface",
  "surfaceSoft",
  "surfaceStrong",
  "surfaceMuted",
  "border",
  "text",
  "textMuted",
  "accent",
  "titlebar",
] as const;
export const optionalPaletteKeys = ["editorText", "selectedText", "highlightText", "highlightBackground", "menuSelectedBackground", "menuSelectedText", "hoverBackground", "hoverText"] as const;
export type ThemePalette = Record<(typeof paletteKeys)[number], string> & Partial<Record<(typeof optionalPaletteKeys)[number], string>>;
export type PlasmaSettings = {
  ambientDrops?: boolean;
  flow?: number;
  enabled: boolean;
  frost: number;
  backgroundBlur: number;
};
export const defaultPlasmaSettings: PlasmaSettings = {
  enabled: false,
  frost: 80,
  backgroundBlur: 0,
};
export function parsePlasma(value: unknown): PlasmaSettings {
  const p = value as PlasmaSettings | null;
  if (
    !p ||
    typeof p.enabled !== "boolean" ||
    typeof p.frost !== "number" ||
    !Number.isFinite(p.frost) ||
    p.frost < 0 ||
    p.frost > 100 ||
    typeof p.backgroundBlur !== "number" ||
    !Number.isFinite(p.backgroundBlur) ||
    p.backgroundBlur < 0 ||
    p.backgroundBlur > 40 ||
    (p.ambientDrops !== undefined && typeof p.ambientDrops !== "boolean") ||
    (p.flow !== undefined && (typeof p.flow !== "number" || !Number.isFinite(p.flow) || p.flow < 0 || p.flow > 100))
  )
    throw new Error("Invalid Plasma settings.");
  return {
    enabled: p.enabled,
    frost: p.frost,
    backgroundBlur: p.backgroundBlur,
    ...(p.flow === undefined ? {} : { flow: p.flow }),
    ...(p.ambientDrops === undefined ? {} : { ambientDrops: p.ambientDrops }),
  };
}
export type ThemeDocument = {
  typography?: ThemeTypography;
  controls?: ThemeControl[];
  baseThemeSnapshot?: ThemeDocument;
  baseThemeId?: string;
  rightSidebarOpen?: boolean;
  wordCountVisible?: boolean;
  editorWidthMode?: "comfortable" | "narrow" | "full";
  noteAlignment?: "left" | "center";
  navigationStyle?: "dual-pane" | "single-pane" | "section-view";
  plasma?: PlasmaSettings;
  surfaces?: ThemeSurfaces;
  schemaVersion: 1 | 2;
  design?: ThemeDesign;
  id: string;
  name: string;
  light: ThemePalette;
  dark: ThemePalette;
  appFontFamily: string;
  appFontSize: number;
  editorFontFamily: string;
  editorFontSize: number;
  accentTitlebar: boolean;
};

/** Rebuild in canonical order, validating every field before using imported CSS values. */
export function parseTheme(value: unknown, allowBase = true): ThemeDocument {
  if (!value || typeof value !== "object")
    throw new Error("Theme must be a JSON object.");
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1 && v.schemaVersion !== 2)
    throw new Error("Unsupported theme version.");
  if (v.baseThemeSnapshot !== undefined && !allowBase) throw new Error("Nested original theme snapshots are not supported.");
  const base = v.baseThemeSnapshot === undefined ? undefined : parseTheme(v.baseThemeSnapshot, false);
  if (base && base.id !== v.baseThemeId) throw new Error("Original theme ID does not match the snapshot.");
  const design = v.schemaVersion === 2 ? parseThemeDesign(v.design) : undefined;
  if (design) compileThemeCss(design, "validation");
  if (typeof v.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(v.id))
    throw new Error("Invalid theme ID.");
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 100)
    throw new Error("Theme name must contain 1–100 characters.");
  const palette = (mode: "light" | "dark"): ThemePalette => {
    const input = v[mode] as Record<string, unknown> | undefined;
    return Object.fromEntries(
      [...paletteKeys, ...optionalPaletteKeys.filter((key) => input?.[key] !== undefined)].map((key) => {
        const color = input?.[key];
        if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))
          throw new Error(`Invalid ${mode} ${key} color. Use #RRGGBB.`);
        return [key, color.toLowerCase()];
      }),
    ) as ThemePalette;
  };
  const font = (key: string) => {
    const text = v[key];
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 200 ||
      /[;{}<>\\]/.test(text)
    )
      throw new Error(`Invalid ${key}.`);
    return text.trim();
  };
  const size = (key: string) => {
    const n = v[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 11 || n > 28)
      throw new Error("Font sizes must be between 11 and 28.");
    return n;
  };
  if (typeof v.accentTitlebar !== "boolean")
    throw new Error("Invalid title bar setting.");
  if (v.baseThemeId !== undefined && (typeof v.baseThemeId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(v.baseThemeId)))
    throw new Error("Invalid base theme ID.");
  if (v.rightSidebarOpen !== undefined && typeof v.rightSidebarOpen !== "boolean")
    throw new Error("Invalid right sidebar setting.");
  if (v.wordCountVisible !== undefined && typeof v.wordCountVisible !== "boolean")
    throw new Error("Invalid word count setting.");
  if (v.editorWidthMode !== undefined && !["comfortable", "narrow", "full"].includes(v.editorWidthMode as string))
    throw new Error("Invalid editor width setting.");
  if (v.noteAlignment !== undefined && !["left", "center"].includes(v.noteAlignment as string))
    throw new Error("Invalid note alignment setting.");
  if (v.navigationStyle !== undefined && v.navigationStyle !== "dual-pane" && v.navigationStyle !== "single-pane" && v.navigationStyle !== "section-view")
    throw new Error("Invalid navigation style.");
  const clean: ThemeDocument = {
    ...(v.typography === undefined ? {} : { typography: parseTypography(v.typography) }),
    ...(v.controls === undefined ? {} : { controls: parseControls(v.controls) }),
    ...(base ? { baseThemeSnapshot: base } : {}),
    ...(v.baseThemeId === undefined ? {} : { baseThemeId: v.baseThemeId }),
    ...(v.wordCountVisible === undefined ? {} : { wordCountVisible: v.wordCountVisible }),
    ...(v.rightSidebarOpen === undefined ? {} : { rightSidebarOpen: v.rightSidebarOpen }),
    ...(v.editorWidthMode === undefined ? {} : { editorWidthMode: v.editorWidthMode as ThemeDocument["editorWidthMode"] }),
    ...(v.noteAlignment === undefined ? {} : { noteAlignment: v.noteAlignment as ThemeDocument["noteAlignment"] }),
    ...(v.navigationStyle === undefined ? {} : { navigationStyle: v.navigationStyle }),
    schemaVersion: v.schemaVersion,
    ...(design ? { design } : {}),
    id: v.id,
    name: v.name.trim(),
    light: palette("light"),
    dark: palette("dark"),
    appFontFamily: font("appFontFamily"),
    appFontSize: size("appFontSize"),
    editorFontFamily: font("editorFontFamily"),
    editorFontSize: size("editorFontSize"),
    accentTitlebar: v.accentTitlebar,
    ...(v.plasma === undefined ? {} : { plasma: parsePlasma(v.plasma) }),
    ...(v.surfaces === undefined ? {} : { surfaces: parseThemeSurfaces(v.surfaces) }),
  };
  if (allowBase && new Blob([JSON.stringify(clean, null, 2) + "\n"]).size > 8 * 1024 * 1024)
    throw new Error("Theme including its original snapshot must be smaller than 8 MB.");
  return clean;
}
export function readTheme(value: unknown): ThemeDocument | null {
  try {
    return parseTheme(value);
  } catch {
    return null;
  }
}
function canonicalThemeJson(theme: ThemeDocument) {
  // Native JSON storage sorts object keys. Typography, assets, and original
  // snapshots must compare by value, while ordered control arrays stay ordered.
  return JSON.stringify(parseTheme(theme), (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
      : value);
}
export function themesMatch(a: ThemeDocument, b: ThemeDocument) {
  return canonicalThemeJson(a) === canonicalThemeJson(b);
}
/** Hash normalized content, including CSS/assets, rather than the creator's version label. */
export async function themeDifferenceFingerprint(
  notebook: ThemeDocument,
  appWide: ThemeDocument | null,
) {
  const fingerprint = async (theme: ThemeDocument) => {
    const bytes = new TextEncoder().encode(canonicalThemeJson(theme));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  };
  const [local, shared] = await Promise.all([
    fingerprint(notebook),
    appWide ? fingerprint(appWide) : Promise.resolve(null),
  ]);
  return { notebook: local, appWide: shared };
}
export const themeNameKey = (name: string) => name.trim().toLowerCase();
export function uniqueThemeName(name: string, themes: ThemeDocument[], exceptId?: string): string {
  const used = new Set(themes.filter(t => t.id !== exceptId).map(t => themeNameKey(t.name)));
  const base = name.trim().slice(0, 100) || "My theme";
  if (!used.has(themeNameKey(base))) return base;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = base.slice(0, 100 - suffix.length) + suffix;
    if (!used.has(themeNameKey(candidate))) return candidate;
  }
}
/** Give legacy duplicates stable distinct labels without changing notebook snapshots. */
export function themeDisplayNames(themes: ThemeDocument[]): Record<string, string> {
  const result: Record<string, string> = {};
  const allocated: ThemeDocument[] = [];
  for (const theme of [...themes].sort((a,b) => a.id.localeCompare(b.id))) {
    const name = uniqueThemeName(theme.name, [...themes.filter(t => themeNameKey(t.name) !== themeNameKey(theme.name)), ...allocated]);
    result[theme.id] = name;
    allocated.push({ ...theme, name });
  }
  return result;
}
const libraryKey = "tigrana-shared-themes-v1";
export async function listThemes(): Promise<{
  themes: ThemeDocument[];
  warnings: string[];
}> {
  const files: { name: string; contents: string }[] = isTauri()
    ? await invoke("list_themes")
    : JSON.parse(localStorage.getItem(libraryKey) || "[]");
  const themes: ThemeDocument[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    try {
      const theme = parseTheme(JSON.parse(file.contents));
      if (file.name !== `${theme.id}.json`)
        throw new Error("Theme filename must match its ID.");
      // Older releases could register Default as a custom theme. Keep the file,
      // but never let a library entry shadow the protected built-in.
      if (theme.id === "default") continue;
      themes.push(theme);
    } catch {
      warnings.push(
        `Could not read ${file.name}. Fix or remove that file in the theme library.`,
      );
    }
  }
  return { themes, warnings };
}
/** expected is a compare-and-swap token. A stale editor never silently overwrites another window. */
export async function saveTheme(
  theme: ThemeDocument,
  expected: ThemeDocument | null,
): Promise<void> {
  const clean = parseTheme(theme);
  if (clean.id === "default") throw new Error("Default is a protected built-in theme. Save your changes as a new theme.");
  if (isTauri()) {
    await invoke("save_theme", { theme: clean, expected });
    return;
  }
  const files: { name: string; contents: string }[] = JSON.parse(
    localStorage.getItem(libraryKey) || "[]",
  );
  for (const file of files) {
    let other: ThemeDocument | null = null;
    try { other = readTheme(JSON.parse(file.contents)); } catch { /* Ignore malformed unrelated files. */ }
    if (other && other.id !== clean.id && themeNameKey(other.name) === themeNameKey(clean.name))
      throw new Error("A theme with this name already exists. Choose a different name.");
  }
  const name = `${clean.id}.json`;
  const old = files.find((file) => file.name === name);
  if (
    old
      ? !expected ||
        !themesMatch(parseTheme(JSON.parse(old.contents)), expected)
      : expected !== null
  )
    throw new Error(
      "The shared theme changed. Reload the library and try again.",
    );
  localStorage.setItem(
    libraryKey,
    JSON.stringify([
      ...files.filter((file) => file.name !== name),
      { name, contents: JSON.stringify(clean, null, 2) },
    ]),
  );
}

/** Remove only the shared copy that the user reviewed, never a newer update. */
export async function deleteTheme(expected: ThemeDocument): Promise<void> {
  const clean = parseTheme(expected);
  if (isTauri()) { await invoke("delete_theme", { expected: clean }); return; }
  const files: { name: string; contents: string }[] = JSON.parse(localStorage.getItem(libraryKey) || "[]");
  const filename = `${clean.id}.json`;
  const current = files.find(file => file.name === filename);
  if (!current || !themesMatch(parseTheme(JSON.parse(current.contents)), clean))
    throw new Error("The shared theme changed or was removed. Reload the library and try again.");
  // Keep a recovery snapshot outside the active library, matching native trash behavior.
  const trashKey = `${libraryKey}-trash`;
  localStorage.setItem(trashKey, JSON.stringify([...JSON.parse(localStorage.getItem(trashKey) || "[]"), current]));
  localStorage.setItem(libraryKey, JSON.stringify(files.filter(file => file.name !== filename)));
}

/** Flatten legacy translucent tokens against their background without losing their appearance. */
export function opaqueThemeColor(value: string, background: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const rgba = value.match(
    /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/,
  );
  if (!rgba) return background;
  const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
  return (
    "#" +
    [0, 1, 2]
      .map((i) =>
        Math.round(
          Number(rgba[i + 1]) * alpha +
            parseInt(background.slice(i * 2 + 1, i * 2 + 3), 16) * (1 - alpha),
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** Keep legacy mirrors for older app versions, but derive them from the selected snapshot. */
export function themeAppearance(theme: ThemeDocument): NotebookAppearance {
  return {
    customTheme: theme,
    ...(theme.editorWidthMode === undefined ? {} : { editorWidthMode: theme.editorWidthMode }),
    ...(theme.noteAlignment === undefined ? {} : { noteAlignment: theme.noteAlignment }),
    ...(theme.wordCountVisible === undefined ? {} : { wordCountVisible: theme.wordCountVisible }),
    ...(theme.rightSidebarOpen === undefined ? {} : { rightSidebarOpen: theme.rightSidebarOpen }),
    ...(theme.navigationStyle === undefined ? {} : { navigationStyle: theme.navigationStyle }),
    plasma: {
      ...(theme.plasma ?? defaultPlasmaSettings),
      enabled: (theme.plasma?.enabled ?? false) && theme.design?.supportsPlasma !== false,
    },
    appFontFamily: theme.appFontFamily,
    appFontSize: theme.appFontSize,
    editorFontFamily: theme.editorFontFamily,
    editorFontSize: theme.editorFontSize,
    accentTitlebar: theme.accentTitlebar,
    colors: {
      light: {
        accentColor: theme.light.accent,
        titlebarColor: theme.light.titlebar,
        titlebarUseAccent: false,
      },
      dark: {
        accentColor: theme.dark.accent,
        titlebarColor: theme.dark.titlebar,
        titlebarUseAccent: false,
      },
    },
  };
}
