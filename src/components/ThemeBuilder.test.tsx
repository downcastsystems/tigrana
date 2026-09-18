// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { ThemeBuilder, ThemeReconciliation } from "./ThemeBuilder";
import { exampleTheme } from "../lib/themes.fixture";
import { listThemes, saveTheme } from "../lib/themes";
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
  }) => (
    <div
      data-testid="plasma-renderer"
      data-mode={props.theme}
      data-accent={props.accentColor}
      data-frost={props.frost}
      data-blur={props.backgroundBlur}
      data-preview={String(props.preview)}
    />
  ),
}));
beforeEach(() => localStorage.clear());
function button(host: HTMLElement, text: string) {
  return [...host.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  )!;
}
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
      host.querySelector('[aria-label="dark theme preview"]'),
    ).not.toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(host.querySelector('select[aria-label="Theme"]')).toBeNull();
    expect(host.querySelector('select[aria-label="Color scheme"]')).toBeNull();
    expect(button(host, "Create theme")).toBeUndefined();
    await act(async () => button(host, "Cancel").click());
    expect(host.querySelector('select[aria-label="Theme"]')).not.toBeNull();
    expect((await listThemes()).themes).toHaveLength(0);
    await act(async () => button(host, "Create theme").click());
    await act(async () => button(host, "Save and use").click());
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
    await act(async () => button(host, "Use shared in notebook").click());
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
    await act(async () => button(host, "Replace shared with notebook").click());
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
    expect(host.textContent).toContain("Add this theme");
    await act(async () => button(host, "Add to shared library").click());
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
    await act(async () => button(host, "Keep notebook for now").click());
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
    expect(picker.options).toHaveLength(2);
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
    expect(host.querySelector('[data-testid="plasma-renderer"]')).toBeNull();
    await act(async () => toggle.click());
    const renderer = host.querySelector('[data-testid="plasma-renderer"]')!;
    expect(renderer.getAttribute("data-preview")).toBe("true");
    expect(renderer.getAttribute("data-frost")).toBe("0.6");
    expect(renderer.getAttribute("data-blur")).toBe("12");
    expect(renderer.getAttribute("data-accent")).toBe(theme.dark.accent);
    expect(
      host.querySelector('.theme-preview[data-plasma-preview="true"]'),
    ).not.toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect((await listThemes()).themes).toHaveLength(0);
    await act(async () => toggle.click());
    expect(host.querySelector('[data-testid="plasma-renderer"]')).toBeNull();
    await act(async () => toggle.click());
    await act(async () => button(host, "Save and use").click());
    expect(apply.mock.calls[0][0].plasma).toEqual({
      enabled: true,
      frost: 60,
      backgroundBlur: 12,
    });
    expect((await listThemes()).themes[0].plasma).toEqual({
      enabled: true,
      frost: 60,
      backgroundBlur: 12,
    });
  } finally {
    await act(async () => root.unmount());
  }
});
