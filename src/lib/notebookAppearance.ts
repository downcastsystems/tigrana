import type {
  NavigationStyle,
  NotebookAppearance,
  NotebookThemeColors,
  WorkspaceMetadata,
} from "../types";

export type ResolvedNotebookAppearance = {
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

export function adoptNotebookMetadata(
  metadata: WorkspaceMetadata,
  defaults: ResolvedNotebookAppearance,
  validThemePresetIds: readonly string[],
  targets: NotebookMetadataAdoptionTargets,
) {
  targets.metadata(metadata);
  targets.appearance(resolveNotebookAppearance(metadata.appearance, defaults, validThemePresetIds));
}

export function resolveNotebookAppearance(
  appearance: NotebookAppearance | undefined,
  defaults: ResolvedNotebookAppearance,
  validThemePresetIds: readonly string[],
): ResolvedNotebookAppearance {
  if (!appearance) return cloneResolvedAppearance(defaults);

  const navigationStyle = resolveNavigationStyle(
    appearance.navigationStyle as string | undefined,
    defaults.navigationStyle,
  );

  return {
    colorScheme: appearance.colorScheme ?? defaults.colorScheme,
    themePresetId: appearance.themePresetId && validThemePresetIds.includes(appearance.themePresetId)
      ? appearance.themePresetId
      : defaults.themePresetId,
    colors: {
      light: resolveThemeColors("light", appearance, defaults),
      dark: resolveThemeColors("dark", appearance, defaults),
    },
    accentTitlebar: typeof appearance.accentTitlebar === "boolean"
      ? appearance.accentTitlebar
      : defaults.accentTitlebar,
    navigationStyle,
    appFontFamily: appearance.appFontFamily || defaults.appFontFamily,
    appFontSize: resolveFontSize(appearance.appFontSize, defaults.appFontSize),
    editorFontFamily: appearance.editorFontFamily || defaults.editorFontFamily,
    editorFontSize: resolveFontSize(appearance.editorFontSize, defaults.editorFontSize),
  };
}

function resolveNavigationStyle(value: string | undefined, fallback: NavigationStyle): NavigationStyle {
  if (value === "onenote") return "section-view";
  return value === "dual-pane" || value === "single-pane" || value === "section-view"
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
    ...(!configured && appearance.accentColor ? { accentColor: appearance.accentColor } : {}),
  };
}

function resolveFontSize(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 11 && value <= 28
    ? value
    : fallback;
}

function cloneResolvedAppearance(appearance: ResolvedNotebookAppearance): ResolvedNotebookAppearance {
  return {
    ...appearance,
    colors: {
      light: { ...appearance.colors.light },
      dark: { ...appearance.colors.dark },
    },
  };
}
