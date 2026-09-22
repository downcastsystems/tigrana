import { generate, parse, walk } from 'css-tree';
import type { ThemeDocument } from './themes';
import { themeVariables, surfaceStyles } from './themeRuntime';

/** A readable view of the same values used by the runtime, never editable state. */
export function generatedVisualCss(theme: ThemeDocument): string {
  const palettes = (['light', 'dark'] as const).map(mode =>
    `:scope.theme-${mode} {\n${Object.entries(themeVariables(theme, mode)).map(([key,value]) => `  ${key}: ${value};`).join('\n')}\n}`,
  );
  return '/* Generated from Visual settings. Edit those settings to change these values.\n   Custom CSS below takes precedence; use var(--tigrana-accent), etc. to follow Visual. */\n\n'
    + palettes.join('\n\n')
    + (theme.surfaces ? '\n\n/* Panel surfaces */\n' + surfaceStyles(theme, 'visual-reference', false).split('[data-theme-region="visual-reference"]').join(':scope') : '')
    + `\n\n/* Plasma: ${theme.plasma?.enabled ? 'on' : 'off'}; frost ${theme.plasma?.frost ?? 80}%; blur ${theme.plasma?.backgroundBlur ?? 0}px.\n   Plasma effects are rendered by the app, not by custom CSS. */`;
}

const colorTokens: Record<string, string[]> = {
  appFontFamily: ['--app-font-family'], editorFontFamily: ['--editor-font-family'],
  appFontSize: ['--app-font-size'], editorFontSize: ['--editor-font-size'],
  background: ['--tigrana-background','--app-bg'], surface: ['--tigrana-surface','--surface'],
  surfaceSoft: ['--surface-soft'], surfaceStrong: ['--surface-strong'], surfaceMuted: ['--surface-muted'],
  border: ['--tigrana-border','--border'], text: ['--tigrana-text','--text'], textMuted: ['--tigrana-muted','--text-muted','--muted'],
  accent: ['--tigrana-accent','--accent'], titlebar: ['--titlebar-bg'], editorText: ['--tigrana-editor-text'],
  selectedText: ['--tigrana-selected-text','--accent-contrast'], highlightText: ['--tigrana-highlight-text'], highlightBackground: ['--tigrana-highlight-background'],
};
/** Conservative authoring hints, not a replacement for the browser's cascade. */
export function visualCssHints(css: string, mode: 'light' | 'dark'): Record<string, string> {
  const hints: Record<string, Set<string>> = {};
  const note = (key: string, selector: string) => (hints[key] ??= new Set()).add(selector);
  try {
    const ast = parse(css, { parseCustomProperty: true });
    walk(ast, node => {
      if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;
      const selectors = node.prelude.children.toArray().map(selector => generate(selector)).filter(selector => !selector.includes(`.theme-${mode === 'light' ? 'dark' : 'light'}`));
      if (!selectors.length) return;
      node.block.children.forEach(decl => {
        if (decl.type !== 'Declaration') return;
        const value = generate(decl.value);
        for (const [key,tokens] of Object.entries(colorTokens)) {
          if (tokens.includes(decl.property)) selectors.forEach(selector => note(key, selector));
        }
        for (const selector of selectors) {
          let key: string | undefined;
          if (['font-family','font-size','font'].includes(decl.property)) {
            const prefix = /ProseMirror|note-title-input|raw-markdown-input/.test(selector) ? 'editor' : 'app';
            key = prefix + (decl.property === 'font-size' ? 'FontSize' : 'FontFamily');
          } else if (decl.property === 'color') {
            key = selector.includes('mark') ? 'highlightText' : selector.includes('.is-active') ? 'selectedText' : /ProseMirror|note-title-input|raw-markdown-input/.test(selector) ? 'editorText' : 'text';
          } else if (['background','background-color','background-image'].includes(decl.property)) {
            key = selector.includes('mark') ? 'highlightBackground' : selector.includes('.app-titlebar') ? 'titlebar' : selector.includes('.is-active') ? 'accent' : /folder-pane|notes-pane|unified-tree-pane|right-sidebar/.test(selector) ? 'surface' : /main-pane|note-surface|ProseMirror/.test(selector) ? 'background' : undefined;
          } else if (decl.property.startsWith('border') && !/^(none|0)$/.test(value)) key = 'border';
          if (key && !colorTokens[key].some(token => value.includes(`var(${token})`))) note(key, selector);
        }
      });
    });
  } catch { /* The CSS editor displays parse errors separately. */ }
  return Object.fromEntries(Object.entries(hints).map(([key, selectors]) => [key, `Custom CSS also styles this setting (${[...selectors].join(', ')}). It may override Visual for those elements. Use theme variables there to follow Visual settings.`]));
}
