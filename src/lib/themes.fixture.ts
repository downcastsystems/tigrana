import { paletteKeys, type ThemeDocument, type ThemePalette } from "./themes";
export function exampleTheme(): ThemeDocument {
  const palette = Object.fromEntries(
    paletteKeys.map((k) => [k, "#112233"]),
  ) as ThemePalette;
  return {
    schemaVersion: 1,
    id: "example",
    name: "Example",
    light: { ...palette },
    dark: { ...palette },
    appFontFamily: "system-ui",
    appFontSize: 14,
    editorFontFamily: "serif",
    editorFontSize: 18,
    accentTitlebar: true,
  };
}
