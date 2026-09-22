import { expect, it } from 'vitest';
import { generatedVisualCss, visualCssHints } from './themeVisualCss';
import { exampleTheme } from './themes.fixture';
import { defaultThemeDesign } from './themeDesign';
it('reflects Visual changes without mutating custom CSS or embedding asset payloads', () => {
  const theme = { ...exampleTheme(), design: { ...defaultThemeDesign, css: '.ProseMirror h2 { color: red; }' } };
  theme.light.accent = '#112244';
  theme.dark.accent = '#778899';
  const css = generatedVisualCss(theme);
  expect(css).toContain(':scope.theme-light');
  expect(css).toContain('--tigrana-accent: #112244');
  expect(css).toContain('--tigrana-accent: #778899');
  expect(css).not.toContain('color: red');
  theme.light.accent = '#abcdef';
  expect(generatedVisualCss(theme)).toContain('--tigrana-accent: #abcdef');
  expect(theme.design.css).toBe('.ProseMirror h2 { color: red; }');
});
it('identifies fixed component colors and token overrides for the selected mode', () => {
  const css = '.theme-dark .ProseMirror h2 { color: #ff0000; } .theme-light .ProseMirror h2 { color: var(--tigrana-editor-text); } :scope { --tigrana-border: blue; }';
  expect(visualCssHints(css,'dark').editorText).toContain('.ProseMirror h2');
  expect(visualCssHints(css,'light').editorText).toBeUndefined();
  expect(visualCssHints(css,'light').border).toBeDefined();
  expect(visualCssHints('.ProseMirror { color:var(--tigrana-editor-text); }','dark')).toEqual({});
  expect(visualCssHints('.ProseMirror {font-family:serif}','dark').editorFontFamily).toBeDefined();
});
