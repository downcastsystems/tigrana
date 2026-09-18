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
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it.each(["Create theme", "Edit theme"])(
  "discards %s when leaving Appearance and returns to the picker",
  async (action) => {
    const theme = exampleTheme();
    await saveTheme(theme, null);
    const host = document.createElement("div"),
      root = createRoot(host),
      apply = vi.fn(),
      changeWordCount = vi.fn(),
      resetAppearance = vi.fn();
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
            wordCountVisible
            onWordCountVisibleChange={changeWordCount}
            spellcheckEnabled
            onSpellcheckEnabledChange={vi.fn()}
            plasmaEnabled={false}
            onPlasmaEnabledChange={vi.fn()}
            plasmaFrost={50}
            onPlasmaFrostChange={vi.fn()}
            plasmaBackgroundBlur={10}
            onPlasmaBackgroundBlurChange={vi.fn()}
            onClose={vi.fn()}
            onResetTheme={resetAppearance}
            themeContent={
              <ThemeBuilder current={theme} seed={theme} onApply={apply} />
            }
          />,
        ),
      );
      expect(host.querySelector('[aria-label="Navigation style"]')).toBeNull();
      expect(host.textContent).not.toContain("Restore default appearance");
      const generalLabels = [...host.querySelectorAll(".setting-row")];
      expect(generalLabels.map((label) => label.textContent?.trim())).toEqual([
        "Check spelling while typing", "Show word count",
      ]);
      const wordCount = generalLabels[1].querySelector<HTMLInputElement>("input")!;
      expect(wordCount.checked).toBe(true);
      await act(async () => wordCount.click());
      expect(changeWordCount).toHaveBeenCalledWith(false);
      await click("Appearance");
      expect(host.querySelector('[aria-label="Navigation style"]')).not.toBeNull();
      expect(host.textContent).not.toContain("Show word count");
      await click("Restore default appearance");
      expect(resetAppearance).toHaveBeenCalledOnce();
      await click(action);
      expect(host.querySelector('[aria-label="Theme name"]')).not.toBeNull();
      expect(
        host.querySelector(".settings-preview-host .theme-workbench-preview"),
      ).not.toBeNull();
      expect(
        host.querySelector(".settings-scroll .theme-workbench-preview"),
      ).toBeNull();
      const draftInput = host.querySelector('[aria-label="Theme name"]');
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Maximize settings"]')!.click());
      expect(host.querySelector('.settings-window')?.classList.contains('is-maximized')).toBe(true);
      expect(host.querySelector('[aria-label="Theme name"]')).toBe(draftInput);
      expect(host.querySelector('[aria-label="Restore settings size"]')?.getAttribute('aria-pressed')).toBe('true');
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Restore settings size"]')!.click());
      expect(host.querySelector('.settings-window')?.classList.contains('is-maximized')).toBe(false);
      expect(host.querySelector('[aria-label="Theme name"]')).toBe(draftInput);
      await click("General");
      expect(
        host.querySelector(".settings-preview-host")?.childElementCount,
      ).toBe(0);
      expect(host.querySelector('[aria-label="Theme name"]')).toBeNull();
      await click("Appearance");
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
