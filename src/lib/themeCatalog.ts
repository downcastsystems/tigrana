import { parseTheme, type ThemeDocument } from './themes';

// Independent of theme packages and custom CSS: always enough to open the app.
export const recoveryTheme: ThemeDocument = {
  schemaVersion: 1, id: 'default', name: 'Default', appFontFamily: 'Inter, system-ui, sans-serif',
  editorFontFamily: 'Inter, system-ui, sans-serif', appFontSize: 14, editorFontSize: 17,
  accentTitlebar: false, navigationStyle: 'section-view', rightSidebarOpen: true,
  light: { background: '#ffffff', surface: '#f4f5f7', surfaceSoft: '#eceff3', surfaceStrong: '#ffffff', surfaceMuted: '#e2e6ed', border: '#ced4df', text: '#202734', textMuted: '#536174', accent: '#245fa5', titlebar: '#001428' },
  dark: { background: '#202124', surface: '#191b20', surfaceSoft: '#272b32', surfaceStrong: '#30353e', surfaceMuted: '#171a20', border: '#404857', text: '#f0f2f6', textMuted: '#b0bac8', accent: '#285b99', titlebar: '#001428' },
};
export function loadThemeCatalog(documents: unknown[]) {
  const themes: ThemeDocument[] = [], warnings: string[] = [];
  for (const document of documents) {
    try {
      const theme = parseTheme(document);
      if (themes.some(t => t.id === theme.id)) throw new Error('Duplicate theme ID');
      themes.push(theme);
    } catch (error) {
      const name = document && typeof document === 'object' && 'name' in document && typeof document.name === 'string' ? document.name : 'Unnamed theme';
      warnings.push(`${name} could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { themes, warnings };
}
