import type { NavigationStyle, NotebookAppearance } from '../types';
import { defaultThemeDesign } from './themeDesign';
import { quickAppearanceStyles } from './quickAppearance';
import { readableThemeText, themeVariables } from './themeRuntime';
import { defaultPlasmaSettings, type PlasmaSettings, type ThemeDocument } from './themes';

type CurrentSettings = {
  quickAppearance: NotebookAppearance['quickAppearance'];
  navigationStyle: NavigationStyle;
  rightSidebarOpen: boolean;
  wordCountVisible?: boolean;
  editorWidthMode?: ThemeDocument['editorWidthMode'];
  noteAlignment?: ThemeDocument['noteAlignment'];
  plasma: PlasmaSettings;
  accentTitlebar: boolean;
};

/** Bake notebook overrides into a portable theme without changing the selected original. */
export function captureCurrentThemeSettings(theme: ThemeDocument, settings: CurrentSettings): ThemeDocument {
  const result = { ...theme, navigationStyle: settings.navigationStyle, rightSidebarOpen: settings.rightSidebarOpen,
    ...(settings.wordCountVisible === undefined ? {} : { wordCountVisible: settings.wordCountVisible }),
    ...(settings.editorWidthMode === undefined ? {} : { editorWidthMode: settings.editorWidthMode }),
    ...(settings.noteAlignment === undefined ? {} : { noteAlignment: settings.noteAlignment }),
    plasma: { ...settings.plasma }, accentTitlebar: settings.accentTitlebar };
  const titlebarRules: string[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const quick = settings.quickAppearance;
    const accent = quick?.accentColor ?? theme[mode].accent;
    const titlebar = theme.id === 'default' ? '#001428' : accent;
    result[mode] = { ...theme[mode], ...(quick?.accentColor ? { accent, selectedText: readableThemeText(accent) } : {}) };
    // Preserve an accent change on a theme-authored colored title bar.
    const style = quickAppearanceStyles(quick, settings.accentTitlebar, titlebar).titlebar;
    if (style.background) {
      result[mode].titlebar = titlebar;
      for (const plasma of [false, true]) {
        titlebarRules.push(`:scope.app-titlebar.theme-${mode}.theme-${plasma ? 'plasma' : 'standard'} { background: ${style.background}; color: ${style.color}; }`);
      }
    }
  }
  if (titlebarRules.length) {
    result.schemaVersion = 2;
    const design = theme.design ?? defaultThemeDesign;
    result.design = { ...design, css: `${design.css}\n/* Captured notebook accent on the title bar. */\n${titlebarRules.join('\n')}` };
  }
  return result;
}

/** Compare effective values, ignoring identity and optional defaults that mean "keep current". */
export function hasCurrentThemeChanges(original: ThemeDocument, current: ThemeDocument): boolean {
  const values = (theme: ThemeDocument) => ({
    light: themeVariables(theme, 'light'), dark: themeVariables(theme, 'dark'),
    accentTitlebar: theme.accentTitlebar,
    customCss: theme.design?.css ?? "",
    navigationStyle: theme.navigationStyle ?? current.navigationStyle,
    rightSidebarOpen: theme.rightSidebarOpen ?? current.rightSidebarOpen,
    wordCountVisible: theme.wordCountVisible ?? current.wordCountVisible,
    editorWidthMode: theme.editorWidthMode ?? current.editorWidthMode,
    noteAlignment: theme.noteAlignment ?? current.noteAlignment,
    plasma: { ...defaultPlasmaSettings, flow: 0, ...theme.plasma,
      enabled: (theme.plasma?.enabled ?? false) && theme.design?.supportsPlasma !== false },
  });
  return JSON.stringify(values(original)) !== JSON.stringify(values(current));
}
