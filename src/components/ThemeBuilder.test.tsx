import { bundledThemes, classicThemes } from "../lib/bundledThemes";
// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import type { ThemeDifferenceAcknowledgement } from "../types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeBuilder, ThemeReconciliation } from "./ThemeBuilder";
import { defaultThemeDesign } from "../lib/themeDesign";
import { exampleTheme } from "../lib/themes.fixture";
import {
  listThemes,
  saveTheme,
  themeDifferenceFingerprint,
} from "../lib/themes";
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("./PlasmaTheme", () => ({
  default: (props: {
    theme: string;
    accentColor: string;
    frost: number;
    backgroundBlur: number;
    preview?: boolean;
    ambientDrops?: boolean;
  }) => (
    <div
      data-testid="plasma-renderer"
      data-mode={props.theme}
      data-accent={props.accentColor}
      data-frost={props.frost}
      data-blur={props.backgroundBlur}
      data-ambient={String(props.ambientDrops ?? false)}
      data-preview={String(props.preview)}
    />
  ),
}));
beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function button(host: HTMLElement, text: string) {
  return [...host.querySelectorAll("button")].find(
    (b) => (b.querySelector(".theme-choice-label")?.textContent ?? b.textContent) === text,
  )!;
}
it.each(classicThemes)("does not ask to publish built-in $name after restoring its snapshot", async (theme) => {
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<ThemeReconciliation current={theme} onApply={vi.fn()} />));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect((await listThemes()).themes).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps draft edits local until save and lets the user cancel", async () => {
  const host = document.createElement("div"),
    root = createRoot(host),
    apply = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ThemeBuilder current={null} seed={exampleTheme()} onApply={apply} />,
      ),
    );
    await act(async () => button(host, "Create theme").click());
    expect(
      host.querySelector('[aria-label="dark full theme preview"]'),
    ).not.toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Advanced surfaces");
    expect(host.querySelector('input[aria-label="Editor opacity"]')).not.toBeNull();
    expect(host.querySelectorAll('[aria-label="Generated visual CSS"]')).toHaveLength(0);
    const preview = host.querySelector('[aria-label="dark full theme preview"]')!.shadowRoot!;
    const layout = host.querySelector<HTMLSelectElement>('[aria-label="Preview navigation"]')!;
    await act(async () => { layout.value = "single-pane"; layout.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(preview.querySelector('.unified-tree-pane')).not.toBeNull();
    expect(preview.querySelector('.notes-pane')).toBeNull();
    await act(async () => { layout.value = "dual-pane"; layout.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(preview.querySelector('.notes-pane')).not.toBeNull();
    expect(preview.querySelector('.section-view-folder-pane')).toBeNull();
    await act(async () => button(host, "Theme defaults").click());
    await act(async () => button(host, "Expand preview").click());
    expect(host.querySelector('.theme-editor-preview.is-expanded')).not.toBeNull();
    await act(async () => button(host, "Collapse preview").click());
    const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    await act(async () => tabs[1].click());
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe(tabs[1].id);
    expect(button(host, "CSS reference and examples")).toBeDefined();
    const generated = host.querySelector<HTMLTextAreaElement>('[aria-label="Generated visual CSS"]')!;
    expect(generated.readOnly).toBe(true);
    expect(generated.value).toContain(':scope.theme-light');
    expect(generated.value).toContain(':scope.theme-dark');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Theme CSS"]')!.readOnly).toBe(false);
    await act(async () => tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('select[aria-label="Theme"]')).toBeNull();
    expect(host.querySelector('select[aria-label="Color scheme"]')).toBeNull();
    expect(button(host, "Create theme")).toBeUndefined();
    await act(async () => button(host, "Cancel").click());
    expect(host.querySelector('select[aria-label="Theme"]')).not.toBeNull();
    expect((await listThemes()).themes).toHaveLength(0);
    await act(async () => button(host, "Create theme").click());
    await act(async () => button(host, "Save and use").click());
    await act(async () => button(host, "Confirm and save").click());
    expect(apply).toHaveBeenCalledOnce();
    expect((await listThemes()).themes).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
  }
});
it("keeps differing notebook appearance until shared copy is explicitly chosen", async () => {
  const local = exampleTheme(),
    shared = { ...local, name: "Shared", editorFontSize: 22 };
  await saveTheme(shared, null);
  const host = document.createElement("div"),
    root = createRoot(host),
    apply = vi.fn();
  try {
    await act(async () =>
      root.render(<ThemeReconciliation current={local} onApply={apply} />),
    );
    expect(host.textContent).toContain("Theme copies differ");
    expect(apply).not.toHaveBeenCalled();
    await act(async () =>
      button(host, "Replace this notebook's theme with the app-wide version").click(),
    );
    expect(apply).toHaveBeenCalledWith(shared);
  } finally {
    await act(async () => root.unmount());
  }
});
it("can replace the shared copy with the notebook snapshot", async () => {
  const local = exampleTheme();
  await saveTheme({ ...local, name: "Shared" }, null);
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(<ThemeReconciliation current={local} onApply={vi.fn()} />),
    );
    const recommended = button(host, "Replace the app-wide theme with this notebook's version");
    expect(recommended.classList.contains("is-recommended")).toBe(true);
    expect(recommended.textContent).toContain("(Recommended)");
    expect(host.querySelector(".theme-actions button")).toBe(recommended);
    await act(async () =>
      button(host, "Replace the app-wide theme with this notebook's version").click(),
    );
    expect((await listThemes()).themes).toEqual([local]);
  } finally {
    await act(async () => root.unmount());
  }
});
it("does not prompt for matching themes and offers to register a missing theme", async () => {
  const local = exampleTheme();
  await saveTheme(local, null);
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(<ThemeReconciliation current={local} onApply={vi.fn()} />),
    );
    expect(host.textContent).toBe("");
    await act(async () =>
      root.render(
        <ThemeReconciliation
          current={{ ...local, id: "new" }}
          onApply={vi.fn()}
        />,
      ),
    );
    expect(host.textContent).toContain("Make this theme available app-wide?");
    await act(async () =>
      button(host, "Make theme available app-wide").click(),
    );
    expect((await listThemes()).themes).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
  }
});

it("does not repeat a deferred conflict when unrelated notebook metadata is adopted", async () => {
  const local = exampleTheme();
  await saveTheme({ ...local, name: "Shared" }, null);
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(<ThemeReconciliation current={local} onApply={vi.fn()} />),
    );
    await act(async () => button(host, "Keep both versions unchanged").click());
    await act(async () =>
      root.render(
        <ThemeReconciliation current={{ ...local }} onApply={vi.fn()} />,
      ),
    );
    expect(host.textContent).toBe("");
  } finally {
    await act(async () => root.unmount());
  }
});

it("uses one selector for built-in and saved themes, including overlapping IDs", async () => {
  const theme = exampleTheme();
  await saveTheme(theme, null);
  const host = document.createElement("div"),
    root = createRoot(host);
  const apply = vi.fn(),
    builtIn = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ThemeBuilder
          current={theme}
          seed={theme}
          onApply={apply}
          builtInThemes={[{ id: theme.id, name: "Bundled" }]}
          builtInThemeId={theme.id}
          onBuiltInChange={builtIn}
        />,
      ),
    );
    const picker = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Theme"]',
    )!;
    expect(picker.value).toBe(`saved:${theme.id}`);
    expect(picker.options).toHaveLength(2 + bundledThemes.length);
    await act(async () => {
      picker.value = `builtin:${theme.id}`;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(builtIn).toHaveBeenCalledWith(theme.id);
    expect(apply).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

it("previews Plasma locally and saves its settings with the theme", async () => {
  const host = document.createElement("div"),
    root = createRoot(host),
    apply = vi.fn();
  const theme = exampleTheme();
  try {
    await act(async () =>
      root.render(
        <ThemeBuilder
          current={null}
          seed={{
            ...theme,
            plasma: { enabled: false, frost: 60, backgroundBlur: 12 },
          }}
          onApply={apply}
        />,
      ),
    );
    await act(async () => button(host, "Create theme").click());
    const toggle = [
      ...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((input) => input.parentElement?.textContent?.includes("Plasma UI"))!;
    expect(
      host
        .querySelector(".theme-workbench-preview")
        ?.shadowRoot?.querySelector('[data-testid="plasma-renderer"]'),
    ).toBeNull();
    expect(toggle.closest(".theme-advanced-surfaces")).not.toBeNull();
    await act(async () => toggle.click());
    const renderer = host
      .querySelector(".theme-workbench-preview")!
      .shadowRoot!.querySelector('[data-testid="plasma-renderer"]')!;
    const previewRoot = host.querySelector(".theme-workbench-preview")!.shadowRoot!;
    expect(previewRoot.querySelector(".main-pane > .topbar .sidebar-toggle")).not.toBeNull();
    expect(previewRoot.querySelector(".main-pane > .pane-header")).toBeNull();
    expect(previewRoot.querySelector(".title-shell > .note-title-input")).not.toBeNull();
    expect(previewRoot.querySelector(".editor-shell > .editor-content > .ProseMirror")).not.toBeNull();
    expect(previewRoot.querySelector(".section-view-folder-pane .pane-header strong")?.textContent).toBe("Sections");
    expect(previewRoot.querySelectorAll(".folder-select")).toHaveLength(3);
    expect(renderer.getAttribute("data-preview")).toBe("undefined");
    expect(renderer.getAttribute("data-frost")).toBe("0.6");
    expect(renderer.getAttribute("data-blur")).toBe("12");
    expect(renderer.getAttribute("data-accent")).toBe(theme.dark.accent);
    const bubbles = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find(input => input.parentElement?.textContent?.includes("Ambient bubbles"))!;
    expect(bubbles.checked).toBe(false);
    await act(async () => bubbles.click());
    expect(renderer.getAttribute("data-ambient")).toBe("true");
    expect(
      host
        .querySelector(".theme-workbench-preview")
        ?.shadowRoot?.querySelector('.app-shell[data-plasma="true"]'),
    ).not.toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect((await listThemes()).themes).toHaveLength(0);
    await act(async () => toggle.click());
    expect(
      host
        .querySelector(".theme-workbench-preview")
        ?.shadowRoot?.querySelector('[data-testid="plasma-renderer"]'),
    ).toBeNull();
    await act(async () => toggle.click());
    await act(async () => button(host, "Save and use").click());
    await act(async () => button(host, "Confirm and save").click());
    expect(apply.mock.calls[0][0].plasma).toEqual({
      enabled: true,
      frost: 60,
      backgroundBlur: 12,
      ambientDrops: true,
    });
    expect((await listThemes()).themes[0].plasma).toEqual({
      enabled: true,
      frost: 60,
      backgroundBlur: 12,
      ambientDrops: true,
    });
  } finally {
    await act(async () => root.unmount());
  }
});

it("saves edits to the existing app-wide theme while retaining author credit", async () => {
  const original = {
    ...exampleTheme(),
    schemaVersion: 2 as const,
    design: { ...defaultThemeDesign, author: "Theme creator" },
  };
  await saveTheme(original, null);
  const host = document.createElement("div"),
    root = createRoot(host),
    apply = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ThemeBuilder current={{ ...original, editorFontSize: 22 }} seed={original} onApply={apply} />,
      ),
    );
    await act(async () => button(host, "Edit theme").click());
    await act(async () => button(host, "Save and use").click());
    await act(async () => button(host, "Confirm and save").click());
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0].id).toBe(original.id);
    expect(apply.mock.calls[0][0].design.author).toBe("Theme creator");
    const library = (await listThemes()).themes;
    expect(library).toHaveLength(1);
    expect(library.find((t) => t.id === original.id)).toMatchObject({ ...original, editorFontSize: 22 });
  } finally {
    await act(async () => root.unmount());
  }
});

async function settleThemeCheck() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
it.each(["notebook", "app-wide"])(
  "remembers an accepted difference after remount and asks again when the %s theme changes",
  async (side) => {
    const local = exampleTheme(),
      shared = { ...local, name: "App-wide" };
    await saveTheme(shared, null);
    const host = document.createElement("div"),
      root = createRoot(host);
    let saved: ThemeDifferenceAcknowledgement | undefined;
    const keep = vi.fn((value: ThemeDifferenceAcknowledgement) => {
      saved = JSON.parse(JSON.stringify(value));
    });
    const apply = vi.fn();
    try {
      await act(async () =>
        root.render(
          <ThemeReconciliation
            current={local}
            onApply={apply}
            onKeepBoth={keep}
          />,
        ),
      );
      await act(async () =>
        button(host, "Keep both versions unchanged").click(),
      );
      await settleThemeCheck();
      expect(keep).toHaveBeenCalledOnce();
      expect(saved?.notebook).toMatch(/^[a-f0-9]{64}$/);
      expect(apply).not.toHaveBeenCalled();
      expect((await listThemes()).themes).toEqual([shared]);
      await act(async () => root.render(null));
      await act(async () =>
        root.render(
          <ThemeReconciliation
            current={{ ...local }}
            onApply={apply}
            acknowledgedDifference={saved}
            onKeepBoth={keep}
          />,
        ),
      );
      await settleThemeCheck();
      expect(host.textContent).toBe("");
      await act(async () => root.render(null));
      if (side === "app-wide")
        await saveTheme(
          { ...shared, editorFontSize: shared.editorFontSize + 1 },
          shared,
        );
      const nextLocal =
        side === "notebook"
          ? { ...local, editorFontSize: local.editorFontSize + 1 }
          : local;
      await act(async () =>
        root.render(
          <ThemeReconciliation
            current={nextLocal}
            onApply={apply}
            acknowledgedDifference={saved}
            onKeepBoth={keep}
          />,
        ),
      );
      await settleThemeCheck();
      expect(host.textContent).toContain("Theme copies differ");
    } finally {
      await act(async () => root.unmount());
    }
  },
);
it("remembers keeping a notebook-only theme and notices when an app-wide copy appears", async () => {
  const local = exampleTheme(),
    acknowledged = await themeDifferenceFingerprint(local, null);
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <ThemeReconciliation
          current={local}
          onApply={vi.fn()}
          acknowledgedDifference={acknowledged}
        />,
      ),
    );
    await settleThemeCheck();
    expect(host.textContent).toBe("");
    await act(async () => root.render(null));
    await saveTheme({ ...local, name: "New app-wide copy" }, null);
    await act(async () =>
      root.render(
        <ThemeReconciliation
          current={local}
          onApply={vi.fn()}
          acknowledgedDifference={acknowledged}
        />,
      ),
    );
    await settleThemeCheck();
    expect(host.textContent).toContain("Theme copies differ");
  } finally {
    await act(async () => root.unmount());
  }
});


it("reviews both modes before saving and returns to the untouched draft on cancel", async () => {
  const host = document.createElement("div"), root = createRoot(host), apply = vi.fn(), saved = vi.fn();
  const seed = { ...exampleTheme(), plasma: { enabled: false, frost: 60, backgroundBlur: 12 } };
  try {
    await act(async () => root.render(<ThemeBuilder current={null} seed={seed} onApply={apply} onSaved={saved} />));
    await act(async () => button(host, "Create theme").click());
    const name = host.querySelector<HTMLInputElement>('[aria-label="Theme name"]')!.value;
    await act(async () => button(host, "Save and use").click());
    const dialog = host.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[aria-label="light full theme preview"]')).not.toBeNull();
    expect(dialog.querySelector('[aria-label="dark full theme preview"]')).not.toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    expect((await listThemes()).themes).toHaveLength(0);
    await act(async () => dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    for (const preview of dialog.querySelectorAll(".theme-workbench-preview")) {
      expect(preview.shadowRoot!.querySelector('[data-testid="plasma-renderer"]')).not.toBeNull();
    }
    await act(async () => button(host, "Back to editing").click());
    expect(host.querySelector("dialog")).toBeNull();
    expect(host.querySelector<HTMLInputElement>('[aria-label="Theme name"]')!.value).toBe(name);
    expect(apply).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    await act(async () => button(host, "Save and use").click());
    expect(host.querySelector<HTMLInputElement>('dialog input[type="checkbox"]')!.checked).toBe(false);
    await act(async () => button(host, "Confirm and save").click());
    expect(apply).toHaveBeenCalledOnce();
    expect(saved).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0].plasma).toEqual(seed.plasma);
    expect(host.querySelector("dialog")).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("requires confirmation to delete a saved theme and switches to Default", async () => {
  const theme = exampleTheme();
  await saveTheme(theme, null);
  const host = document.createElement("div"), root = createRoot(host), switchTheme = vi.fn();
  try {
    await act(async () => root.render(<ThemeBuilder current={theme} seed={theme} onApply={vi.fn()} onBuiltInChange={switchTheme}/>));
    await act(async () => button(host, "Delete theme").click());
    expect(host.textContent).toContain("Other notebooks keep their saved copies");
    expect(host.querySelector("dialog")?.open).toBe(true);
    expect((await listThemes()).themes).toHaveLength(1);
    await act(async () => button(host, "Cancel").click());
    expect(host.querySelector("dialog")).toBeNull();
    expect(switchTheme).not.toHaveBeenCalled();
    await act(async () => button(host, "Delete theme").click());
    await act(async () => host.querySelector("dialog")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector("dialog")).toBeNull();
    expect((await listThemes()).themes).toHaveLength(1);
    await act(async () => button(host, "Delete theme").click());
    await act(async () => button(host, "Delete saved theme").click());
    expect((await listThemes()).themes).toHaveLength(0);
    expect(switchTheme).toHaveBeenCalledWith("default");
  } finally { await act(async () => root.unmount()); }
});

it("offers bundled Starfall, keeps its assets portable, and edits a personal copy", async () => {
  const starfall = bundledThemes.find(t => t.id === "builtin-starfall-studio")!;
  const host = document.createElement("div"), root = createRoot(host), apply = vi.fn();
  try {
    await act(async () => root.render(<ThemeBuilder current={null} seed={exampleTheme()} onApply={apply}/>));
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Theme"]')!;
    const option = select.querySelector<HTMLOptionElement>(`option[value="bundled:${starfall.id}"]`)!;
    expect(option.parentElement?.getAttribute("label")).toBe("Built-in");
    await act(async () => {
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(apply).toHaveBeenCalledWith(starfall);
    expect(starfall.plasma?.enabled).toBe(true);
    expect(starfall.light.selectedText).toBe("#241533");
    expect(Object.keys(starfall.design!.assets)).toHaveLength(2);
    await act(async () => root.render(<ThemeBuilder current={starfall} seed={starfall} onApply={apply}/>));
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Theme"]')!.value).toBe(`bundled:${starfall.id}`);
    expect([...host.querySelectorAll("button")].some(b => b.textContent === "Delete theme")).toBe(false);
    await act(async () => button(host, "Edit theme").click());
    expect(host.querySelector<HTMLInputElement>('[aria-label="Theme name"]')!.value).toBe("Starfall copy");
    await act(async () => button(host, "Save and use").click());
    await act(async () => button(host, "Confirm and save").click());
    const saved = (await listThemes()).themes[0];
    expect(saved.id).not.toBe(starfall.id);
    expect(saved.design?.assets).toEqual(starfall.design?.assets);
    expect(saved.plasma?.enabled).toBe(true);
  } finally { await act(async () => root.unmount()); }
});

it("keeps an older built-in under Built-in without saving it to the library", async () => {
  const latest = bundledThemes.find(theme => theme.id === "builtin-typewriter")!;
  const old = { ...latest, design: { ...latest.design!, version: "0.9.0", css: ".topbar { border-bottom: 1px solid red; }" } };
  const host = document.createElement("div"), root = createRoot(host), apply = vi.fn();
  try {
    await act(async () => root.render(<ThemeBuilder current={old} seed={old} onApply={apply} />));
    const picker = host.querySelector<HTMLSelectElement>('[aria-label="Theme"]')!;
    expect(picker.value).toBe(`bundled:${latest.id}`);
    expect(picker.selectedOptions[0].parentElement?.getAttribute("label")).toBe("Built-in");
    expect(host.querySelector('optgroup[label="Saved"]')).toBeNull();
    expect((await listThemes()).themes).toHaveLength(0);
    await act(async () => button(host, "Edit theme").click());
    expect(host.querySelector<HTMLInputElement>('[aria-label="Theme name"]')!.value).toBe("Typewriter copy");
  } finally { await act(async () => root.unmount()); }
});

it("edits Typewriter writing defaults and reflects them in the preview", async () => {
  const theme = bundledThemes.find(theme => theme.id === "builtin-typewriter")!;
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<ThemeBuilder current={theme} seed={theme} onApply={vi.fn()} />));
    await act(async () => button(host, "Edit theme").click());
    const width = [...host.querySelectorAll('label')].find(label => label.textContent?.includes('Default editor width'))!.querySelector('select')!;
    const alignment = [...host.querySelectorAll('label')].find(label => label.textContent?.includes('Default note alignment'))!.querySelector('select')!;
    expect(width.value).toBe('comfortable');
    expect(alignment.value).toBe('center');
    const preview = host.querySelector('[aria-label="dark full theme preview"]')!.shadowRoot!;
    expect(preview.querySelector('.note-surface.is-comfortable-width.is-center-aligned')).not.toBeNull();
    await act(async () => { width.value = 'full'; width.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { alignment.value = 'left'; alignment.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(preview.querySelector('.note-surface.is-full-width.is-left-aligned')).not.toBeNull();
    const wordCount = [...host.querySelectorAll('label')].find(label => label.textContent?.includes('Default word count'))!.querySelector('select')!;
    expect(wordCount.value).toBe('true');
    expect(preview.querySelector('.note-status-bar')).not.toBeNull();
    await act(async () => { wordCount.value = 'false'; wordCount.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(preview.querySelector('.note-status-bar')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("recognizes Typewriter after native storage reorders its JSON fields", async () => {
  const latest = bundledThemes.find(theme => theme.id === "builtin-typewriter")!;
  const stored = JSON.parse(JSON.stringify(latest, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value));
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<ThemeReconciliation current={stored} onApply={vi.fn()} />));
    expect(host.textContent).toBe("");
    const hashes = await themeDifferenceFingerprint(latest, stored);
    expect(hashes.notebook).toBe(hashes.appWide);
    expect((await listThemes()).themes).toHaveLength(0);
  } finally { await act(async () => root.unmount()); }
});

it("does not ask to register an unchanged built-in theme in the shared library", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<ThemeReconciliation current={bundledThemes[0]} onApply={vi.fn()}/>));
    expect(host.textContent).toBe("");
    expect((await listThemes()).themes).toHaveLength(0);
  } finally { await act(async () => root.unmount()); }
});

it.each([false, true])("never offers to publish a Default notebook snapshot (modified: %s)", async modified => {
  const original = classicThemes.find(theme => theme.id === 'default')!;
  const current = modified ? { ...original, editorFontSize: 23 } : original;
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<ThemeReconciliation current={current} onApply={vi.fn()} />));
    expect(host.textContent).toBe('');
  } finally { await act(async () => root.unmount()); }
});

it.each([false, true])("labels local Default changes without replacing the built-in (legacy snapshot: %s)", async legacy => {
  const original = classicThemes.find(theme => theme.id === 'default')!;
  const changed = { ...original, editorFontSize: 23 };
  const restore = vi.fn();
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<ThemeBuilder current={legacy ? changed : null} seed={changed}
      builtInThemes={[{ id: 'default', name: 'Default' }]} onApply={vi.fn()} onRestoreDefault={restore} />));
    const picker = host.querySelector<HTMLSelectElement>('[aria-label="Theme"]')!;
    expect(picker.value).toBe('modified:default');
    expect(picker.querySelector('option[value="builtin:default"]')?.textContent).toBe('Default');
    expect(picker.querySelector('option[value="modified:default"]')?.textContent).toBe('Default (modified)');
    expect(picker.querySelector('option[value="saved:default"]')).toBeNull();
    expect(button(host, 'Edit theme')).toBeUndefined();
    expect(button(host, 'Return to Default')).toBeUndefined();
    await act(async () => { picker.value = 'builtin:default'; picker.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(restore).toHaveBeenCalledTimes(1);
    await act(async () => button(host, 'Save current settings as new theme').click());
    expect(host.querySelector<HTMLInputElement>('[aria-label="Theme name"]')?.value).toBe('Default copy');
  } finally { await act(async () => root.unmount()); }
});

it("imports a Default snapshot as a new named copy", async () => {
  const original = classicThemes.find(theme => theme.id === 'default')!;
  const host = document.createElement('div'), root = createRoot(host), apply = vi.fn();
  try {
    await act(async () => root.render(<ThemeBuilder current={null} seed={original} onApply={apply} />));
    const input = host.querySelector<HTMLInputElement>('[aria-label="Import theme package or JSON"]')!;
    const file = new File([JSON.stringify(original)], 'default.json', { type: 'application/json' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(JSON.stringify(original)).buffer });
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(host.querySelector<HTMLInputElement>('[aria-label="Theme name"]')!.value).toBe('Default copy');
    await act(async () => button(host, 'Save and use').click());
    await act(async () => button(host, 'Confirm and save').click());
    const saved = (await listThemes()).themes;
    expect(saved).toHaveLength(1);
    expect(saved[0].id).not.toBe('default');
    expect(saved[0].name).toBe('Default copy');
    expect(apply).toHaveBeenCalledWith(saved[0]);
  } finally { await act(async () => root.unmount()); }
});


it("keeps the theme editor open when saving fails", async () => {
  const theme = exampleTheme();
  await saveTheme(theme, null);
  const host = document.createElement("div"), root = createRoot(host), saved = vi.fn(), apply = vi.fn();
  try {
    await act(async () => root.render(<ThemeBuilder current={theme} seed={theme} onApply={apply} onSaved={saved}/>));
    await act(async () => button(host, "Edit theme").click());
    await saveTheme({ ...theme, editorFontSize: 24 }, theme);
    await act(async () => button(host, "Save and use").click());
    await act(async () => button(host, "Confirm and save").click());
    expect(saved).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(host.querySelector("dialog")?.open).toBe(true);
    expect(host.querySelector('dialog [role="alert"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("recognizes an older built-in and adopts its approved update across notebooks", async () => {
  const latest = bundledThemes.find(theme => theme.id === "builtin-old-basement-pc")!;
  const old = { ...latest, name: "Older Basement", navigationStyle: undefined };
  const host = document.createElement("div");
  const root = createRoot(host);
  const apply = vi.fn();
  try {
    await act(async () => root.render(<ThemeReconciliation current={old} onApply={apply} />));
    expect(host.textContent).toContain("A newer built-in theme is available");
    expect(host.textContent).not.toContain("Make this theme available app-wide?");
    await act(async () => button(host, "Use the latest version everywhere").click());
    for (let i = 0; i < 50 && !apply.mock.calls.length; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(apply).toHaveBeenLastCalledWith(latest);
    expect((await listThemes()).themes).toHaveLength(0);
    apply.mockClear();
    await act(async () => root.render(<ThemeReconciliation key="other-notebook" current={old} onApply={apply} />));
    for (let i = 0; i < 50 && !apply.mock.calls.length; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(apply).toHaveBeenCalledWith(latest);
    expect(host.textContent).toBe("");
    apply.mockClear();
    await act(async () => root.render(<ThemeReconciliation key="unrelated" current={exampleTheme()} onApply={apply} />));
    expect(apply).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

it("keeps Default read-only and lets legacy presets revert after saving", async () => {
  const { classicThemes } = await import("../lib/bundledThemes");
  const nord = classicThemes.find(t => t.id === "nord")!;
  const host = document.createElement("div"), root = createRoot(host), apply = vi.fn();
  try {
    await act(async () => root.render(<ThemeBuilder current={null} seed={exampleTheme()} onApply={apply} builtInThemeId="default" />));
    expect([...host.querySelectorAll("button")].some(b => b.textContent === "Edit theme")).toBe(false);
    await act(async () => root.render(<ThemeBuilder current={null} seed={nord} onApply={apply} builtInThemeId="nord" />));
    await act(async () => button(host, "Edit theme").click());
    await act(async () => button(host, "Save and use").click());
    await act(async () => button(host, "Confirm and save").click());
    const saved = (await listThemes()).themes[0];
    expect(saved.baseThemeId).toBe("nord");
    expect(saved.id).not.toBe(nord.id);
    const changed = { ...saved, light: { ...saved.light, accent: "#ff0000" }, rightSidebarOpen: false, navigationStyle: "single-pane" as const };
    await saveTheme(changed, saved);
    await act(async () => root.render(<ThemeBuilder key="reopened" current={changed} seed={changed} onApply={apply} />));
    await act(async () => button(host, "Edit theme").click());
    await act(async () => button(host, "Revert to defaults").click());
    await act(async () => button(host, "Save and use").click());
    await act(async () => button(host, "Confirm and save").click());
    expect(apply).toHaveBeenLastCalledWith({ ...nord, id: saved.id, name: saved.name, baseThemeId: "nord", baseThemeSnapshot: nord });
  } finally { await act(async () => root.unmount()); }
});

it("offers to save modified notebook settings in a separate theme and retains the original", async () => {
  const { captureCurrentThemeSettings } = await import('../lib/currentThemeSettings');
  const original = bundledThemes.find(t => t.id === 'builtin-starfall-studio')!;
  const before = JSON.stringify(original);
  const seed = captureCurrentThemeSettings(original, { quickAppearance: { accentColor: '#336699' },
    navigationStyle: 'dual-pane', rightSidebarOpen: false, accentTitlebar: false,
    plasma: { enabled: false, frost: 25, flow: 12, backgroundBlur: 5 } });
  const host = document.createElement('div'), root = createRoot(host), apply = vi.fn();
  try {
    await act(async () => root.render(<ThemeBuilder current={original} seed={original} onApply={apply} />));
    expect(button(host, 'Save current settings as new theme')).toBeUndefined();
    await act(async () => root.render(<ThemeBuilder current={original} seed={seed} onApply={apply} />));
    await act(async () => button(host, 'Save current settings as new theme').click());
    expect(apply).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLInputElement>('[aria-label="dark Accent hex"]')!.value).toBe('#336699');
    await act(async () => button(host, 'Save and use').click());
    await act(async () => button(host, 'Confirm and save').click());
    const saved = (await listThemes()).themes[0];
    expect(saved.id).not.toBe(original.id);
    expect(saved.name).toBe('Starfall copy');
    expect(saved.light.accent).toBe('#336699');
    expect(saved.dark.accent).toBe('#336699');
    expect(saved.navigationStyle).toBe('dual-pane');
    expect(saved.rightSidebarOpen).toBe(false);
    expect(saved.plasma).toEqual(seed.plasma);
    expect(saved.baseThemeSnapshot).toEqual(original);
    expect(apply).toHaveBeenCalledWith(saved);
    expect(JSON.stringify(original)).toBe(before);
  } finally { await act(async () => root.unmount()); }
});

it("offers the author's layout separately and only when explicit defaults differ", async () => {
  const host = document.createElement('div'), root = createRoot(host);
  const theme = { ...exampleTheme(), navigationStyle: 'single-pane' as const, rightSidebarOpen: false };
  const seed = { ...theme, navigationStyle: 'dual-pane' as const, rightSidebarOpen: true };
  const apply = vi.fn(), useLayout = vi.fn();
  try {
    await act(async () => root.render(<ThemeBuilder current={theme} seed={seed} onApply={apply} onUseThemeDefaults={useLayout} />));
    await act(async () => button(host, "Use theme defaults").click());
    await act(async () => button(host, "Use theme default layout options").click());
    expect(useLayout).toHaveBeenCalledWith(theme, "layout");
    expect(apply).not.toHaveBeenCalled();
    await act(async () => root.render(<ThemeBuilder current={theme} seed={theme} onApply={apply} onUseThemeDefaults={useLayout} />));
    expect(button(host, "Use theme defaults")).toBeUndefined();
    await act(async () => root.render(<ThemeBuilder current={{ ...theme, navigationStyle: undefined, rightSidebarOpen: undefined }} seed={seed} onApply={apply} onUseThemeDefaults={useLayout} />));
    expect(button(host, "Use theme defaults")).toBeUndefined();
  } finally { await act(async () => root.unmount()); }
});

it("refreshes saved themes on opening and window focus without applying them", async () => {
  const host = document.createElement("div"), root = createRoot(host), apply = vi.fn();
  const original = { ...exampleTheme(), name: "Available before opening" };
  await saveTheme(original, null);
  try {
    await act(async () => root.render(<ThemeBuilder current={null} seed={exampleTheme()} onApply={apply} />));
    expect(host.querySelector('[aria-label="Refresh themes"]')).toBeNull();
    expect(host.querySelector('select[aria-label="Theme"]')?.textContent).toContain(original.name);
    const updated = { ...original, name: "Updated in another window" };
    await saveTheme(updated, original);
    expect(host.textContent).not.toContain(updated.name);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelector('select[aria-label="Theme"]')?.textContent).toContain(updated.name);
    expect(host.querySelector('select[aria-label="Theme"]')?.textContent).not.toContain(original.name);
    expect(apply).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

it("preserves an open theme draft when refreshing after window focus", async () => {
  const host = document.createElement("div"), root = createRoot(host), apply = vi.fn();
  try {
    await act(async () => root.render(<ThemeBuilder current={null} seed={exampleTheme()} onApply={apply} />));
    await act(async () => button(host, "Create theme").click());
    const name = host.querySelector<HTMLInputElement>('[aria-label="Theme name"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "My unfinished draft");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await saveTheme({ ...exampleTheme(), name: "Saved elsewhere" }, null);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelector<HTMLInputElement>('[aria-label="Theme name"]')?.value).toBe("My unfinished draft");
    expect(apply).not.toHaveBeenCalled();
    await act(async () => button(host, "Cancel").click());
    expect(host.querySelector('select[aria-label="Theme"]')?.textContent).toContain("Saved elsewhere");
  } finally { await act(async () => root.unmount()); }
});

it("alphabetizes built-in and saved themes, keeping Default first", async () => {
  const alpha = { ...exampleTheme(), id: crypto.randomUUID(), name: "Alpha" };
  const zulu = { ...exampleTheme(), id: crypto.randomUUID(), name: "Zulu" };
  const current = { ...exampleTheme(), id: crypto.randomUUID(), name: "Middle" };
  await saveTheme(zulu, null);
  await saveTheme(alpha, null);
  const host = document.createElement("div"), root = createRoot(host), apply = vi.fn();
  const builtIns = [{ id: "nord", name: "Nord" }, { id: "default", name: "Default" }, { id: "atom", name: "Atom" }];
  try {
    await act(async () => root.render(<ThemeBuilder current={current} seed={current} builtInThemes={builtIns} onApply={apply} />));
    const picker = host.querySelector<HTMLSelectElement>('select[aria-label="Theme"]')!;
    const builtInNames = [...picker.querySelectorAll('optgroup[label="Built-in"] option')].map(option => option.textContent!);
    expect(builtInNames).toEqual(['Default', ...['Nord', 'Atom', ...bundledThemes.map(theme => theme.name)].sort((a, b) => a.localeCompare(b))]);
    expect(builtInNames).toContain('Quest');
    expect(builtInNames).not.toContain('Adventure Quest');
    expect([...picker.querySelectorAll('optgroup[label="Saved"] option')].map(option => option.textContent)).toEqual(['Alpha', 'Middle', 'Zulu']);
    expect(picker.value).toBe(`saved:${current.id}`);
    await act(async () => { picker.value = 'bundled:builtin-8-bit-adventure'; picker.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: 'builtin-8-bit-adventure', name: 'Quest' }));
    expect(builtIns.map(theme => theme.name)).toEqual(['Nord', 'Default', 'Atom']);
  } finally { await act(async () => root.unmount()); }
});
