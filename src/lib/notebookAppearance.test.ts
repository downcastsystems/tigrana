import { exampleTheme } from "./themes.fixture";
import { describe, expect, it } from "vitest";
import type { NotebookAppearance } from "../types";
import { defaultWorkspaceMetadata } from "./notebookStorage";
import { adoptNotebookMetadata, notebookTheme, resolveNotebookAppearance } from "./notebookAppearance";
import { classicThemes, defaultTheme } from "./bundledThemes";

const defaults = {
  colorScheme: "system" as const,
  themePresetId: "default",
  colors: {
    light: { accentColor: "#111111", titlebarUseAccent: true },
    dark: { accentColor: "#eeeeee", titlebarUseAccent: true },
  },
  accentTitlebar: false,
  navigationStyle: "section-view" as const,
  appFontFamily: "Inter",
  appFontSize: 14,
  editorFontFamily: "Inter",
  editorFontSize: 17,
};

describe("Notebook appearance", () => {
  it('uses Tigrana Blue for the new default while preserving explicit presets and invalid snapshots', () => {
    expect(notebookTheme(undefined, defaultTheme.id)).toEqual(defaultTheme);
    expect(notebookTheme(null, 'default')).toBeNull();
    expect(notebookTheme(null, 'nord')).toBeNull();
    expect(notebookTheme({ schemaVersion: 99 }, defaultTheme.id)).toBeNull();
    const snapshot = { ...defaultTheme, name: 'Older theme name', defaultColorVariantId: 'gray' };
    const rendered = notebookTheme(snapshot, 'default')!;
    expect(rendered.name).toBe('Tigrana');
    expect(rendered.defaultColorVariantId).toBe('gray');
    expect(rendered.dark.accent).toBe('#393939');
    expect(snapshot.name).toBe('Older theme name');
  });
  it('repairs old built-in Catppuccin popup colors without changing customized palettes', () => {
    const snapshot = structuredClone(defaultTheme);
    snapshot.defaultColorVariantId = 'catppuccin-latte';
    for (const variant of snapshot.colorVariants!) {
      if (variant.id.startsWith('catppuccin-')) variant.light.surfaceStrong = '#ccd0da';
    }
    const before = JSON.stringify(snapshot);
    const repaired = notebookTheme(snapshot, defaultTheme.id)!;
    expect(repaired.light.surfaceStrong).toBe('#eff1f5');
    for (const variant of repaired.colorVariants!.filter(v => v.id.startsWith('catppuccin-'))) {
      expect(variant.light.surfaceStrong).toBe('#eff1f5');
      expect(variant.dark).toEqual(snapshot.colorVariants!.find(v => v.id === variant.id)!.dark);
    }
    expect(JSON.stringify(snapshot)).toBe(before);
    const customized = structuredClone(snapshot);
    customized.colorVariants!.find(v => v.id === 'catppuccin-latte')!.light.surfaceStrong = '#ffffff';
    expect(notebookTheme(customized, defaultTheme.id)!.light.surfaceStrong).toBe('#ffffff');
    const classic = { ...classicThemes.find(t => t.id === 'catppuccin-latte')! };
    classic.light = { ...classic.light, surfaceStrong: '#ccd0da' };
    expect(notebookTheme(classic, classic.id)!.light.surfaceStrong).toBe('#eff1f5');
    expect(notebookTheme({ ...classic, id: 'my-custom-theme' }, classic.id)!.light.surfaceStrong).toBe('#ccd0da');
  });
  it('brightens previous built-in selection pairs and preserves custom choices', () => {
    const snapshot = structuredClone(defaultTheme);
    const blue = snapshot.colorVariants!.find(v => v.id === 'blue')!;
    blue.dark.selectionBackground = '#032042';
    blue.dark.selectionText = '#6da7ec';
    expect(notebookTheme(snapshot, defaultTheme.id)!.dark).toMatchObject({
      selectionBackground: '#103969', selectionText: '#9fc9ff',
    });
    blue.light.selectionBackground = '#e1edfc';
    blue.light.selectionText = '#20558e';
    expect(notebookTheme(snapshot, defaultTheme.id)!.light).toMatchObject({
      selectionBackground: '#c2dcff', selectionText: '#084f9e',
    });
    blue.light.selectionText = '#111111';
    expect(notebookTheme(snapshot, defaultTheme.id)!.light.selectionText).toBe('#111111');
    blue.dark.selectionText = '#ffffff';
    expect(notebookTheme(snapshot, defaultTheme.id)!.dark).toMatchObject({
      selectionBackground: '#032042', selectionText: '#ffffff',
    });
  });
  it.each([
    ['atom', '#3d74f6'], ['catppuccin-frappe', '#40a02b'], ['everforest', '#f85552'],
  ])('updates saved %s navigation colors without changing text selection or dark mode', (id, oldAccent) => {
    const current = classicThemes.find(t => t.id === id)!;
    const old = { ...current, light: { ...current.light, accent: oldAccent,
      selectedText: '#000000', menuSelectedBackground: oldAccent, menuSelectedText: '#000000' } };
    const result = notebookTheme(old, id)!;
    expect(result.light.accent).toBe(current.light.accent);
    expect(result.light.selectedText).toBe('#ffffff');
    expect(result.light.selectionBackground).toBe(old.light.selectionBackground);
    expect(result.light.selectionText).toBe(old.light.selectionText);
    expect(result.dark).toEqual(old.dark);
    expect(notebookTheme({ ...old, light: { ...old.light, selectedText: '#eeeeee' } }, id)!.light.accent).toBe(oldAccent);
    const preset = resolveNotebookAppearance({ themePresetId: id, colors: { light: { accentColor: oldAccent } } }, defaults, [id]);
    expect(preset.colors.light.accentColor).toBe(current.light.accent);
    const snapshot = structuredClone(defaultTheme);
    snapshot.colorVariants!.find(v => v.id === id)!.light = old.light;
    snapshot.defaultColorVariantId = id;
    expect(notebookTheme(snapshot, defaultTheme.id)!.light.selectedText).toBe('#ffffff');
  });
  it("recovers a broken notebook snapshot without changing its saved data", () => {
    const appearance = { customTheme: { ...exampleTheme(), schemaVersion: 99 }, appFontSize: 30, navigationStyle: "single-pane" as const, colorScheme: "dark" as const };
    const before = JSON.stringify(appearance);
    const resolved = resolveNotebookAppearance(appearance as unknown as NotebookAppearance, defaults, ["default"]);
    expect(resolved.appFontSize).toBe(14);
    expect(resolved.navigationStyle).toBe("section-view");
    expect(resolved.colorScheme).toBe("dark");
    expect(JSON.stringify(appearance)).toBe(before);
  });
  it("uses all snapshot settings even if legacy appearance mirrors are absent or different", () => {
    const theme = exampleTheme();
    const appearance = { customTheme: theme, editorFontFamily: "Old font", accentTitlebar: false };
    const resolved = resolveNotebookAppearance(appearance, defaults, ["default"]);
    expect(resolved.editorFontFamily).toBe(theme.editorFontFamily);
    expect(resolved.editorFontSize).toBe(theme.editorFontSize);
    expect(resolved.accentTitlebar).toBe(true);
    expect(resolved.colors.dark.accentColor).toBe(theme.dark.accent);
    expect(appearance.editorFontFamily).toBe("Old font");
  });
  it("resolves an authoritative appearance without inheriting the previous Notebook", () => {
    const appearance: NotebookAppearance = {
      colorScheme: "dark",
      themePresetId: "nord",
      colors: {
        dark: { accentColor: "#88c0d0", titlebarColor: "#2e3440", titlebarUseAccent: false },
      },
      accentTitlebar: true,
      navigationStyle: "dual-pane",
      appFontFamily: "Avenir",
      appFontSize: 15,
      editorFontFamily: "Literata",
      editorFontSize: 19,
    };

    expect(resolveNotebookAppearance(appearance, defaults, ["default", "nord"])).toEqual({
      colorScheme: "dark",
      themePresetId: "nord",
      colors: {
        light: { accentColor: "#111111", titlebarUseAccent: true },
        dark: { accentColor: "#88c0d0", titlebarColor: "#2e3440", titlebarUseAccent: false },
      },
      accentTitlebar: true,
      navigationStyle: "dual-pane",
      appFontFamily: "Avenir",
      appFontSize: 15,
      editorFontFamily: "Literata",
      editorFontSize: 19,
    });
  });

  it("uses explicit defaults for missing or obsolete appearance values", () => {
    const appearance = {
      themePresetId: "removed-theme",
      accentColor: "#ff00ff",
      navigationStyle: "onenote",
    } as unknown as NotebookAppearance;

    expect(resolveNotebookAppearance(appearance, defaults, ["default", "nord"])).toEqual({
      ...defaults,
      colors: {
        light: { ...defaults.colors.light, accentColor: "#ff00ff" },
        dark: { ...defaults.colors.dark, accentColor: "#ff00ff" },
      },
      navigationStyle: "section-view",
    });
  });

  it("resets every value when a Notebook has no appearance metadata", () => {
    expect(resolveNotebookAppearance(undefined, defaults, ["default", "nord"])).toEqual(defaults);
  });

  it("rejects an invalid persisted navigation style", () => {
    const appearance = { navigationStyle: "removed-layout" } as unknown as NotebookAppearance;

    expect(resolveNotebookAppearance(appearance, defaults, ["default"]).navigationStyle).toBe("section-view");
  });

  it("adopts authoritative metadata and all of its mirrored appearance state together", () => {
    const metadata = {
      ...defaultWorkspaceMetadata(),
      appearance: { colorScheme: "dark" as const, editorFontSize: 20 },
    };
    const adoptedMetadata: typeof metadata[] = [];
    const adoptedAppearance: ReturnType<typeof resolveNotebookAppearance>[] = [];

    adoptNotebookMetadata(metadata, defaults, ["default"], {
      metadata: (next) => adoptedMetadata.push(next as typeof metadata),
      appearance: (next) => adoptedAppearance.push(next),
    });

    expect(adoptedMetadata).toEqual([metadata]);
    expect(adoptedAppearance).toEqual([{
      ...defaults,
      colorScheme: "dark",
      editorFontSize: 20,
    }]);
  });

  it("does not use the previous Notebook as the fallback for partial appearance", () => {
    const notebookA = resolveNotebookAppearance({
      colorScheme: "dark",
      themePresetId: "nord",
      colors: { dark: { accentColor: "#88c0d0" } },
    }, defaults, ["default", "nord"]);
    const notebookB = resolveNotebookAppearance({ editorFontSize: 20 }, defaults, ["default", "nord"]);

    expect(notebookA.themePresetId).toBe("nord");
    expect(notebookB).toEqual({ ...defaults, editorFontSize: 20 });
  });
});

it('keeps notebook Plasma overrides separate from the selected theme default', () => {
  const theme = { ...exampleTheme(), plasma: { enabled: true, frost: 60, backgroundBlur: 12 } };
  const manual = { enabled: false, frost: 70, backgroundBlur: 8 };
  expect(resolveNotebookAppearance({ customTheme: theme, plasma: manual }, defaults, ['default']).plasma).toEqual(manual);
  expect(resolveNotebookAppearance({ customTheme: theme }, defaults, ['default']).plasma).toEqual(theme.plasma);
  expect(theme.plasma.enabled).toBe(true);
  const standard = { ...theme, plasma: { ...theme.plasma, enabled: false } };
  expect(resolveNotebookAppearance({ customTheme: standard, plasma: { ...manual, enabled: true } }, defaults, ['default']).plasma?.enabled).toBe(true);
});


it("preserves manual sidebar visibility over the theme default on metadata adoption", () => {
  const theme = { ...exampleTheme(), rightSidebarOpen: false };
  expect(resolveNotebookAppearance({ customTheme: theme }, defaults, ["default"]).rightSidebarOpen).toBe(false);
  expect(resolveNotebookAppearance({ customTheme: theme, rightSidebarOpen: true }, defaults, ["default"]).rightSidebarOpen).toBe(true);
  expect(resolveNotebookAppearance({ customTheme: { ...theme, rightSidebarOpen: true }, rightSidebarOpen: false }, defaults, ["default"]).rightSidebarOpen).toBe(false);
});
