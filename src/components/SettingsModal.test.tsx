// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SettingsModal from "./SettingsModal";
import { ThemeBuilder } from "./ThemeBuilder";
import { exampleTheme } from "../lib/themes.fixture";
import { listThemes, saveTheme } from "../lib/themes";
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { vi.unstubAllGlobals(); });

it.each(["Create theme", "Edit theme"])(
  "discards %s when leaving Themes and returns to the picker",
  async (action) => {
    const theme = exampleTheme();
    await saveTheme(theme, null);
    const host = document.createElement("div"),
      root = createRoot(host),
      apply = vi.fn();
    const click = async (name: string) =>
      act(async () => {
        const button = [...host.querySelectorAll("button")].find(
          (b) => b.textContent === name,
        );
        expect(button).toBeDefined();
        button!.click();
      });
    try {
      await act(async () =>
        root.render(
          <SettingsModal
            navigationStyle="section-view"
            onNavigationStyleChange={vi.fn()}
            spellcheckEnabled
            onSpellcheckEnabledChange={vi.fn()}
            plasmaEnabled={false}
            onPlasmaEnabledChange={vi.fn()}
            plasmaFrost={50}
            onPlasmaFrostChange={vi.fn()}
            plasmaBackgroundBlur={10}
            onPlasmaBackgroundBlurChange={vi.fn()}
            onClose={vi.fn()}
            themeContent={
              <ThemeBuilder current={theme} seed={theme} onApply={apply} />
            }
          />,
        ),
      );
      await click("Themes");
      await click(action);
      expect(host.querySelector('[aria-label="Theme name"]')).not.toBeNull();
      expect(host.querySelector(".settings-preview-host .theme-preview")).not.toBeNull();
      expect(host.querySelector(".settings-scroll .theme-preview")).toBeNull();
      await click("General");
      expect(host.querySelector(".settings-preview-host")?.childElementCount).toBe(0);
      expect(host.querySelector('[aria-label="Theme name"]')).toBeNull();
      await click("Themes");
      expect(host.querySelector('[aria-label="Theme name"]')).toBeNull();
      expect(
        host.querySelector<HTMLSelectElement>('[aria-label="Theme"]')?.value,
      ).toBe(`saved:${theme.id}`);
      expect(apply).not.toHaveBeenCalled();
      expect((await listThemes()).themes).toEqual([theme]);
    } finally {
      await act(async () => root.unmount());
    }
  },
);
