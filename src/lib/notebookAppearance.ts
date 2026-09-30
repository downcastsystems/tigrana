import { refreshSelectionColors } from "./selectionColors";
import { recoveryTheme } from "./themeCatalog";
import { classicThemes, defaultTheme, findBuiltInTheme } from "./bundledThemes";
import {
  readTheme,
  resolveThemeVariant,
  type ThemePalette,
  themeAppearance,
  parsePlasma,
  type PlasmaSettings,
} from "./themes";
import type {
  NavigationStyle,
  NotebookAppearance,
  NotebookThemeColors,
  WorkspaceMetadata,
} from "../types";

export type ResolvedNotebookAppearance = {
  editorWidthMode?: NotebookAppearance["editorWidthMode"];
  noteAlignment?: NotebookAppearance["noteAlignment"];
  rightSidebarOpen?: boolean;
  wordCountVisible?: boolean;
  plasma?: PlasmaSettings;
  colorScheme: "system" | "light" | "dark";
  themePresetId: string;
  colors: Record<"light" | "dark", NotebookThemeColors>;
  accentTitlebar: boolean;
  navigationStyle: NavigationStyle;
  appFontFamily: string;
  appFontSize: number;
  editorFontFamily: string;
  editorFontSize: number;
};

type NotebookMetadataAdoptionTargets = {
  metadata: (metadata: WorkspaceMetadata) => void;
  appearance: (appearance: ResolvedNotebookAppearance) => void;
};

/** A missing selection follows the app default; explicit legacy presets stay put.
 * Retained built-in snapshots adopt the current name and known palette corrections. */
export function notebookTheme(snapshot: unknown, presetId: string) {
  let theme = readTheme(snapshot);
  if (theme && findBuiltInTheme(theme.id)) {
    theme = resolveThemeVariant({
      ...theme,
      light: correctedLightSelectedItems(theme.id, refreshSelectionColors(theme.light, 'light')),
      dark: refreshSelectionColors(theme.dark, 'dark'),
      ...(theme.colorVariants ? { colorVariants: theme.colorVariants.map(variant => ({
        ...variant,
        light: correctedLightSelectedItems(variant.id, refreshSelectionColors(variant.light, 'light')),
        dark: refreshSelectionColors(variant.dark, 'dark'),
      })) } : {}),
    });
  }
  if (theme?.id === defaultTheme.id) {
    theme = resolveThemeVariant({
      ...theme,
      name: defaultTheme.name,
      colorVariants: theme.colorVariants?.map(variant => ({
        ...variant, light: correctedCatppuccinLight(variant.id, variant.light),
      })),
    });
  } else if (theme) {
    theme = { ...theme, light: correctedCatppuccinLight(theme.id, theme.light) };
  }
  return theme ?? (!snapshot && presetId === defaultTheme.id ? defaultTheme : null);
}

const previousItemAccents: Record<string, string> = {
  atom: '#3d74f6', 'catppuccin-frappe': '#40a02b', everforest: '#f85552',
};

function correctedLightSelectedItems(id: string, palette: ThemePalette): ThemePalette {
  const old = previousItemAccents[id];
  const current = old && classicThemes.find(theme => theme.id === id)?.light;
  if (!current || palette.accent !== old || palette.selectedText !== '#000000'
    || palette.menuSelectedBackground !== old || palette.menuSelectedText !== '#000000') return palette;
  return { ...palette, accent: current.accent, selectedText: current.selectedText,
    menuSelectedBackground: current.menuSelectedBackground, menuSelectedText: current.menuSelectedText,
    titlebar: palette.titlebar === old ? current.accent : palette.titlebar };
}

/** Only replace the shipped old palette, leaving user-edited colors intact. */
function correctedCatppuccinLight(id: string, palette: ThemePalette): ThemePalette {
  const current = id.startsWith('catppuccin-') ? classicThemes.find(theme => theme.id === id)?.light : undefined;
  if (!current || palette.surfaceStrong.toLowerCase() !== '#ccd0da') return palette;
  const old = { ...current, surfaceStrong: '#ccd0da' };
  return Object.entries(old).every(([key, value]) => palette[key as keyof ThemePalette]?.toLowerCase() === value.toLowerCase())
    ? { ...palette, surfaceStrong: current.surfaceStrong }
    : palette;
}

export function adoptNotebookMetadata(
  metadata: WorkspaceMetadata,
  defaults: ResolvedNotebookAppearance,
  validThemePresetIds: readonly string[],
  targets: NotebookMetadataAdoptionTargets,
) {
  targets.metadata(metadata);
  targets.appearance(
    resolveNotebookAppearance(
      metadata.appearance,
      defaults,
      validThemePresetIds,
    ),
  );
}

export function resolveNotebookAppearance(
  appearance: NotebookAppearance | undefined,
  defaults: ResolvedNotebookAppearance,
  validThemePresetIds: readonly string[],
): ResolvedNotebookAppearance {
  if (!appearance) return cloneResolvedAppearance(defaults);
  const theme = appearance.customTheme ? notebookTheme(appearance.customTheme, appearance.themePresetId ?? "") : null;
  if (appearance.customTheme && !theme) {
    // Recovery is in-memory only: never overwrite a damaged portable snapshot.
    return resolveNotebookAppearance({ ...themeAppearance(recoveryTheme), colorScheme: appearance.colorScheme }, defaults, validThemePresetIds);
  }
  if (theme) {
    const selected = themeAppearance(theme);
    // Manual notebook choices survive reloads without changing the theme defaults.
    appearance = { ...appearance, ...selected, plasma: appearance.plasma ?? selected.plasma, navigationStyle: appearance.navigationStyle ?? selected.navigationStyle, rightSidebarOpen: appearance.rightSidebarOpen ?? selected.rightSidebarOpen,
      wordCountVisible: appearance.wordCountVisible ?? selected.wordCountVisible,
      editorWidthMode: appearance.editorWidthMode ?? selected.editorWidthMode,
      noteAlignment: appearance.noteAlignment ?? selected.noteAlignment };
  }

  const presetId = appearance.themePresetId ?? '';
  const oldAccent = previousItemAccents[presetId];
  if (!theme && oldAccent && appearance.colors?.light?.accentColor === oldAccent) {
    const current = classicThemes.find(candidate => candidate.id === presetId)!.light;
    appearance = { ...appearance, colors: { ...appearance.colors, light: {
      ...appearance.colors.light, accentColor: current.accent,
      ...(appearance.colors.light.titlebarColor === oldAccent ? { titlebarColor: current.titlebar } : {}),
    } } };
  }

  const navigationStyle = resolveNavigationStyle(
    appearance.navigationStyle as string | undefined,
    defaults.navigationStyle,
  );

  return {
    editorWidthMode: appearance.editorWidthMode === "comfortable" || appearance.editorWidthMode === "narrow" || appearance.editorWidthMode === "full" ? appearance.editorWidthMode : defaults.editorWidthMode,
    noteAlignment: appearance.noteAlignment === "left" || appearance.noteAlignment === "center" ? appearance.noteAlignment : defaults.noteAlignment,
    wordCountVisible: typeof appearance.wordCountVisible === "boolean" ? appearance.wordCountVisible : defaults.wordCountVisible,
    rightSidebarOpen: appearance.rightSidebarOpen ?? defaults.rightSidebarOpen,
    plasma: resolvePlasma(appearance.plasma, defaults.plasma),
    colorScheme: appearance.colorScheme ?? defaults.colorScheme,
    themePresetId:
      appearance.themePresetId &&
      validThemePresetIds.includes(appearance.themePresetId)
        ? appearance.themePresetId
        : defaults.themePresetId,
    colors: {
      light: resolveThemeColors("light", appearance, defaults),
      dark: resolveThemeColors("dark", appearance, defaults),
    },
    accentTitlebar:
      typeof appearance.accentTitlebar === "boolean"
        ? appearance.accentTitlebar
        : defaults.accentTitlebar,
    navigationStyle,
    appFontFamily: appearance.appFontFamily || defaults.appFontFamily,
    appFontSize: resolveFontSize(appearance.appFontSize, defaults.appFontSize),
    editorFontFamily: appearance.editorFontFamily || defaults.editorFontFamily,
    editorFontSize: resolveFontSize(
      appearance.editorFontSize,
      defaults.editorFontSize,
    ),
  };
}

function resolveNavigationStyle(
  value: string | undefined,
  fallback: NavigationStyle,
): NavigationStyle {
  if (value === "onenote") return "section-view";
  return value === "dual-pane" ||
    value === "single-pane" ||
    value === "section-view"
    ? value
    : fallback;
}

function resolveThemeColors(
  mode: "light" | "dark",
  appearance: NotebookAppearance,
  defaults: ResolvedNotebookAppearance,
) {
  const configured = appearance.colors?.[mode];
  return {
    ...defaults.colors[mode],
    ...(configured ?? {}),
    ...(!configured && appearance.accentColor
      ? { accentColor: appearance.accentColor }
      : {}),
  };
}

function resolveFontSize(value: number | undefined, fallback: number) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 11 &&
    value <= 28
    ? value
    : fallback;
}

function cloneResolvedAppearance(
  appearance: ResolvedNotebookAppearance,
): ResolvedNotebookAppearance {
  return {
    ...appearance,
    colors: {
      light: { ...appearance.colors.light },
      dark: { ...appearance.colors.dark },
    },
  };
}

function resolvePlasma(value: unknown, fallback: PlasmaSettings | undefined) {
  try {
    return parsePlasma(value);
  } catch {
    return fallback;
  }
}
