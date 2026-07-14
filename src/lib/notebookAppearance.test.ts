import { describe, expect, it } from "vitest";
import type { NotebookAppearance } from "../types";
import { defaultWorkspaceMetadata } from "./notebookStorage";
import { adoptNotebookMetadata, resolveNotebookAppearance } from "./notebookAppearance";

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
