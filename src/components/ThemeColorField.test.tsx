// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { expect, it } from "vitest";
import { ThemeColorField } from "./ThemeColorField";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("accepts pasted hex, expands shorthand on commit, and preserves the last valid color", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  function Example() {
    const [value, setValue] = useState("#112233");
    return <ThemeColorField label="Accent" name="dark Accent" value={value} onChange={setValue} />;
  }
  try {
    await act(async () => root.render(<Example />));
    const hex = host.querySelector<HTMLInputElement>('input[type="text"]')!;
    const swatch = host.querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(hex.value).toBe("#112233");
    await act(async () => { hex.value = " E8B674 "; Simulate.change(hex); });
    expect(swatch.value).toBe("#e8b674");
    await act(async () => { hex.value = "#abc"; Simulate.change(hex); });
    expect(swatch.value).toBe("#e8b674");
    await act(async () => Simulate.blur(hex));
    expect(hex.value).toBe("#aabbcc");
    expect(swatch.value).toBe("#aabbcc");
    await act(async () => { hex.value = "not a color"; Simulate.change(hex); });
    await act(async () => Simulate.blur(hex));
    expect(hex.value).toBe("#aabbcc");
    await act(async () => { swatch.value = "#8040cc"; Simulate.change(swatch); });
    expect(hex.value).toBe("#8040cc");
  } finally { await act(async () => root.unmount()); }
});
