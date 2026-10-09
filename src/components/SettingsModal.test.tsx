// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultBulletMethodStatuses } from "../lib/bulletMethod";
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
      changeFolding = vi.fn(),
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
            bulletMethodStatuses={defaultBulletMethodStatuses} onBulletMethodStatusesChange={vi.fn()}
            newNoteWritingStyle="last-used" lastWritingStyle="notes" onNewNoteWritingStyleChange={vi.fn()}
            editorWidthMode="comfortable"
            onEditorWidthModeChange={vi.fn()}
            noteAlignment="center"
            onNoteAlignmentChange={vi.fn()}
            navigationStyle="section-view"
            onNavigationStyleChange={vi.fn()}
            wordCountVisible
            onWordCountVisibleChange={changeWordCount}
            spellcheckEnabled
            onListFoldingEnabledChange={changeFolding}
            onSpellcheckEnabledChange={vi.fn()}
            onClose={vi.fn()}
            onResetTheme={resetAppearance}
            themeContent={
              <ThemeBuilder current={theme} seed={theme} onApply={apply} />
            }
          />,
        ),
      );
      expect(host.querySelector('[aria-label="Navigation style"]')).not.toBeNull();
      expect(host.textContent).not.toContain("Restore default appearance");
      expect(host.querySelector('[aria-label="Date format"]')).not.toBeNull();
      const generalLabels = [...host.querySelectorAll(".setting-row")].filter(row => !row.querySelector('[aria-label="Date format"]'));
      expect(generalLabels.map((label) => label.textContent?.trim())).toEqual([
        "Navigation styleDual paneDual pane with sections (recommended)Single pane", "Editor widthComfortable WidthNarrow WidthFull Width", "Editor AlignmentAlign leftAlign center", "New Note Writing StyleFor this notebookLast used writing style (Notes)NotesStory", "Bullet foldingCollapse sub-bullets in Notes style", "Check spelling while typing", "Show word count",
      ]);
      const folding = generalLabels[4].querySelector<HTMLInputElement>("input")!;
      expect(folding.checked).toBe(true);
      await act(async () => folding.click());
      expect(changeFolding).toHaveBeenCalledWith(false);
      const wordCount = generalLabels[6].querySelector<HTMLInputElement>("input")!;
      expect(wordCount.checked).toBe(true);
      await act(async () => wordCount.click());
      expect(changeWordCount).toHaveBeenCalledWith(false);
      await click("Appearance");
      expect(host.querySelector('[aria-label="Navigation style"]')).toBeNull();
      expect(host.textContent).not.toContain("Show word count");
      await click("Restore default appearance");
      expect(resetAppearance).toHaveBeenCalledOnce();
      expect(host.textContent).not.toContain("Plasma glass panes");
      await click(action);
      expect(host.textContent).toContain("Enable Plasma UI");
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

it("drags from the header, stays within the window, and keeps controls independent", async () => {
  vi.stubGlobal("innerWidth", 1200);
  vi.stubGlobal("innerHeight", 900);
  const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { left: 300 + (parseFloat(this.style.left) || 0), top: 150 + (parseFloat(this.style.top) || 0), width: 600, height: 500 } as DOMRect;
  });
  const host = document.createElement("div"), root = createRoot(host), close = vi.fn();
  const pointer = async (target: EventTarget, type: string, x: number, y: number, pointerId = 1, button = 0) => act(async () => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    target.dispatchEvent(event);
  });
  try {
    await act(async () => root.render(<SettingsModal
      bulletMethodStatuses={defaultBulletMethodStatuses} onBulletMethodStatusesChange={vi.fn()}
      newNoteWritingStyle="notes" lastWritingStyle="notes" onNewNoteWritingStyleChange={vi.fn()}
      editorWidthMode="comfortable" onEditorWidthModeChange={vi.fn()}
      noteAlignment="center" onNoteAlignmentChange={vi.fn()}
      navigationStyle="section-view" onNavigationStyleChange={vi.fn()}
      wordCountVisible onWordCountVisibleChange={vi.fn()}
      spellcheckEnabled onSpellcheckEnabledChange={vi.fn()} onClose={close} themeContent={null}
    />));
    const dialog = host.querySelector<HTMLElement>(".settings-window")!;
    const header = host.querySelector(".settings-content-header h2")!;
    const position = () => [dialog.style.left, dialog.style.top];
    await pointer(header, "pointerdown", 400, 200);
    await pointer(window, "pointermove", 475, 240, 2);
    expect(position()).toEqual(["0px", "0px"]);
    await pointer(window, "pointermove", 475, 240);
    expect(position()).toEqual(["75px", "40px"]);
    await pointer(window, "pointerup", 475, 240);
    await pointer(window, "pointermove", 500, 260);
    expect(position()).toEqual(["75px", "40px"]);
    expect(close).not.toHaveBeenCalled();
    await pointer(header, "pointerdown", 400, 200);
    await pointer(window, "pointermove", -1000, -1000);
    expect(position()).toEqual(["-292px", "-142px"]);
    await pointer(window, "pointermove", 3000, 3000);
    expect(position()).toEqual(["292px", "242px"]);
    await pointer(window, "pointercancel", 3000, 3000);
    expect(dialog.classList.contains("is-dragging")).toBe(false);
    vi.stubGlobal("innerWidth", 700);
    vi.stubGlobal("innerHeight", 600);
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(position()).toEqual(["-208px", "-58px"]);
    const maximize = host.querySelector<HTMLButtonElement>('[aria-label="Maximize settings"]')!;
    await pointer(maximize.querySelector("svg")!, "pointerdown", 400, 200);
    expect(dialog.classList.contains("is-dragging")).toBe(false);
    await act(async () => maximize.click());
    expect(position()).toEqual(["0px", "0px"]);
    await pointer(header, "pointerdown", 400, 200);
    await pointer(window, "pointermove", 475, 240);
    expect(position()).toEqual(["0px", "0px"]);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Restore settings size"]')!.click());
    // The restored dialog is clamped to the smaller viewport.
    expect(position()).toEqual(["-208px", "-58px"]);
    await pointer(host.querySelector(".settings-title")!, "pointerdown", 400, 200);
    expect(dialog.classList.contains("is-dragging")).toBe(true);
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(dialog.classList.contains("is-dragging")).toBe(false);
    await pointer(header, "pointerdown", 400, 200, 1, 2);
    expect(dialog.classList.contains("is-dragging")).toBe(false);
    await pointer(host.querySelector(".settings-scroll")!, "pointerdown", 400, 200);
    expect(dialog.classList.contains("is-dragging")).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!.click());
    expect(close).toHaveBeenCalledOnce();
    await pointer(header, "pointerdown", 400, 200);
    await act(async () => root.unmount());
    expect(dialog.classList.contains("is-dragging")).toBe(false);
    await pointer(window, "pointermove", 475, 240);
    expect(position()).toEqual(["-208px", "-58px"]);
  } finally {
    await act(async () => root.unmount());
    geometry.mockRestore();
  }
});
