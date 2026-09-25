// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { compileThemeCss } from "./themeCss";
import { defaultThemeDesign, parseThemeDesign } from "./themeDesign";
import { encodeThemePackage, decodeThemePackage } from "./themePackage";
import { parseTheme, saveTheme, listThemes, themeAppearance } from "./themes";
import { exampleTheme } from "./themes.fixture";
import { themeStylesheet, themeVariables } from "./themeRuntime";
const design = {
  ...defaultThemeDesign,
  author: "A creator",
  css: ":scope { --tigrana-radius: 12px; } .ProseMirror h2:hover { color: red; }",
};
describe("theme foundation", () => {
  it("round trips a full package through JSON, ZIP, shared library and notebook mirrors", async () => {
    localStorage.clear();
    const theme = parseTheme({
      ...exampleTheme(),
      schemaVersion: 2,
      design,
      plasma: { enabled: true, frost: 60, backgroundBlur: 12 },
    });
    const imported = decodeThemePackage(encodeThemePackage(theme));
    expect(imported).toEqual(theme);
    expect(decodeThemePackage(strToU8(JSON.stringify(theme)))).toEqual(theme);
    expect(decodeThemePackage(encodeThemePackage(exampleTheme()))).toEqual(
      exampleTheme(),
    );
    await saveTheme(imported, null);
    expect((await listThemes()).themes).toEqual([theme]);
    expect(themeAppearance(imported).customTheme).toEqual(theme);
    expect(themeStylesheet(theme, "dark", "notebook")).toContain(
      "--tigrana-radius:12px",
    );
  });
  it("scopes every selector including root rules and media blocks", () => {
    const css = compileThemeCss(
      {
        ...design,
        css: ':scope{--tigrana-radius:0px}.app-titlebar,.ProseMirror h1:hover{color:red}@media(min-width:600px){button::before{content:"hello"}}',
      },
      "preview",
    );
    expect(css).toContain('[data-theme-region="preview"].app-titlebar');
    expect(css).toContain(
      '[data-theme-region="preview"] .ProseMirror h1:hover',
    );
    expect(css).toContain('[data-theme-region="preview"] button::before');
    expect(css).not.toContain("notebook");
  });
  it.each([
    '@import "https://example.com/a.css";',
    "@font-face{font-family:bad;src:url(https://example.com/font)}",
    ".a{background:url(https://example.com/secret)}",
    ".a{background:u\\72l(https://example.com/secret)}",
    '.a{background:image-set("https://example.com/image" 1x)}',
    ".a{background:var(--tigrana-url);--tigrana-url:url(https://example.com)}",
    ".a{background:attr(data-secret url)}",
    ":scope + .settings-window{display:none}",
    ".a:has(input){color:red}",
    ".a{color:red!important}",
    "@keyframes spin{to{transform:rotate(360deg)}}",
    ".a{animation:spin 1s infinite}",
    ".a{filter:blur(100px)}",
    ".a{-webkit-filter:blur(100px)}",
    ".a{-webkit-animation:spin 1s infinite}",
    ".a{.b{color:red}}",
    ".a{color:{{bad}}}",
  ])("rejects unsupported or escaping CSS: %s", (css) => {
    expect(() => compileThemeCss({ ...design, css }, "notebook")).toThrow();
  });
  it("rejects incompatible versions and malformed metrics", () => {
    expect(() => parseThemeDesign({ ...design, apiVersion: 2 })).toThrow();
    expect(() =>
      parseThemeDesign({
        ...design,
        metrics: { ...design.metrics, spacing: 500 },
      }),
    ).toThrow();
    expect(() => parseTheme({ ...exampleTheme(), schemaVersion: 2 })).toThrow();
    expect(
      themeAppearance(
        parseTheme({
          ...exampleTheme(),
          schemaVersion: 2,
          design: { ...design, supportsPlasma: false },
          plasma: { enabled: true, frost: 60, backgroundBlur: 0 },
        }),
      ).plasma?.enabled,
    ).toBe(false);
  });
  it("rejects package paths, unexpected files, and oversized expansion", () => {
    expect(() =>
      decodeThemePackage(zipSync({ "../theme.json": strToU8("{}") })),
    ).toThrow();
    expect(() =>
      decodeThemePackage(
        zipSync({ "theme.json": strToU8("{}"), "run.js": strToU8("alert(1)") }),
      ),
    ).toThrow();
    expect(() =>
      decodeThemePackage(zipSync({ "theme.css": new Uint8Array(2_200_000) })),
    ).toThrow();
  });
  it("validates local assets and rewrites only packaged URLs", () => {
    const png = { mime: "image/png", data: btoa("\x89PNG\r\n\x1a\n") };
    const d = parseThemeDesign({
      ...design,
      css: ".folder-pane{background-image:url(assets/paper.png)}",
      assets: { "assets/paper.png": png },
    });
    expect(compileThemeCss(d, "notebook")).toContain("data:image/png;base64,");
    expect(() =>
      parseThemeDesign({ ...d, assets: { "../paper.png": png } }),
    ).toThrow();
    expect(() =>
      parseThemeDesign({
        ...d,
        assets: { "assets/paper.png": { ...png, data: btoa("<svg/>") } },
      }),
    ).toThrow();
    const theme = parseTheme({
      ...exampleTheme(),
      schemaVersion: 2,
      design: d,
    });
    expect(decodeThemePackage(encodeThemePackage(theme))).toEqual(theme);
  });
});
it("imports a source folder compressed by a creator", () => {
  const theme = {
    ...exampleTheme(),
    schemaVersion: 2,
    design: { ...design, css: "" },
  };
  const archive = zipSync({
    "Example/": new Uint8Array(),
    "Example/assets/": new Uint8Array(),
    "Example/theme.json": strToU8(JSON.stringify(theme)),
    "Example/theme.css": strToU8(design.css),
  });
  expect(decodeThemePackage(archive).design?.css).toBe(design.css);
});

it("preserves separate text colors through packages and rejects invalid optional colors", () => {
  const theme = exampleTheme();
  theme.light = { ...theme.light, editorText: "#334455", selectedText: "#ffffff", highlightText: "#112244", highlightBackground: "#ffccaa" };
  expect(decodeThemePackage(encodeThemePackage(theme))).toEqual(theme);
  const tokens = themeVariables(theme, "light");
  expect(tokens["--tigrana-editor-text"]).toBe("#334455");
  expect(tokens["--tigrana-selected-text"]).toBe("#ffffff");
  expect(tokens["--tigrana-highlight-text"]).toBe("#112244");
  expect(tokens["--tigrana-highlight-background"]).toBe("#ffccaa");
  for (const key of ["editorText", "selectedText", "highlightText", "highlightBackground"]) {
    expect(() => parseTheme({ ...theme, light: { ...theme.light, [key]: "url(evil)" } })).toThrow();
    expect(() => parseTheme({ ...theme, light: { ...theme.light, [key]: null } })).toThrow();
  }
  const legacy = exampleTheme();
  expect(parseTheme(legacy)).toEqual(legacy);
  const fallback = themeVariables(legacy, "light");
  expect(fallback["--tigrana-editor-text"]).toBe("var(--tigrana-text)");
  expect(fallback["--tigrana-selected-text"]).toBe("#ffffff");
  expect(fallback["--tigrana-highlight-text"]).toBe("#000000");
  expect(fallback["--tigrana-highlight-background"]).toBe("#ffff00");
});

it('round trips panel opacity and rejects unsafe surface settings', () => {
  const theme = parseTheme({ ...exampleTheme(), surfaces: { background: '#112233', navigation: 20, editor: 75, outline: 0, titlebar: 100 } });
  expect(decodeThemePackage(encodeThemePackage(theme))).toEqual(theme);
  const css = themeStylesheet(theme, 'dark', 'notebook');
  expect(css).toContain('var(--app-bg) 75%,transparent');
  expect(css).not.toContain('opacity:0.75');
  for (const invalid of [null, { ...theme.surfaces, editor: -1 }, { ...theme.surfaces, outline: 101 }, { ...theme.surfaces, background: 'url(evil)' }, { ...theme.surfaces, image: 'https://example.com/a.png' }]) {
    expect(() => parseTheme({ ...theme, surfaces: invalid })).toThrow();
  }
  expect(parseTheme(exampleTheme()).surfaces).toBeUndefined();
});

it('renders explicit selection colors without WebKit darkening their opaque backgrounds', () => {
  const source = exampleTheme();
  const theme = { ...source, dark: { ...source.dark, selectionBackground: '#f45b4e', selectionText: '#000000' } };
  const css = themeStylesheet(theme, 'dark', 'notebook');
  expect(css).toContain('background-color: rgba(244, 91, 78, 0.99); color: #000000;');
  for (const selector of ['.ProseMirror::selection', '.ProseMirror *::selection', '.note-title-input::selection', '.raw-markdown-input::selection']) {
    expect(css).toContain(selector);
  }
});
