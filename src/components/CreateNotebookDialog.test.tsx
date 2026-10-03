// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { CreateNotebookDialog } from "./CreateNotebookDialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.resetAllMocks(); });

async function setup() {
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host), close = vi.fn(), created = vi.fn();
  await act(async () => root.render(<CreateNotebookDialog onClose={close} onCreated={created} />));
  const click = async (label: string) => act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!.click());
  const name = async (value: string) => act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return { host, close, created, click, name, cleanup: async () => { await act(async () => root.unmount()); host.remove(); } };
}

it("shows the exact nested destination and allows correction before the only filesystem write", async () => {
  vi.mocked(open).mockResolvedValueOnce("/Notes/My Notes").mockResolvedValueOnce("/Notes");
  vi.mocked(invoke).mockResolvedValue("/Notes/Personal");
  const ui = await setup();
  try {
    expect(document.activeElement).toBe(ui.host.querySelector("input"));
    await ui.name("My Notes");
    await ui.click("Choose location");
    expect(ui.host.querySelectorAll(".create-notebook-path")).toHaveLength(1);
    expect(ui.host.querySelector(".create-notebook-destination")!.textContent).toContain("/Notes/My Notes/My Notes");
    expect(ui.host.querySelector('[role="status"]')!.textContent).toContain("same name");
    expect(invoke).not.toHaveBeenCalled();
    await ui.click("Change location");
    expect(ui.host.querySelector(".create-notebook-destination")!.textContent).toContain("/Notes/My Notes");
    expect(ui.host.querySelector('[role="status"]')).toBeNull();
    await ui.name("Personal");
    expect(ui.host.querySelector(".create-notebook-destination")!.textContent).toContain("/Notes/Personal");
    await ui.click("Create");
    expect(invoke).toHaveBeenCalledWith("create_notebook", { parent: "/Notes", name: "Personal", content: expect.stringContaining("Tigrana"), appearance: expect.objectContaining({ themePresetId: "builtin-baseline", themeColorPreferences: { "builtin-baseline": "blue" } }) });
    expect(ui.created).toHaveBeenCalledWith("/Notes/Personal");
  } finally { await ui.cleanup(); }
});

it("keeps canceled folder picks and canceled confirmation free of filesystem writes", async () => {
  vi.mocked(open).mockResolvedValueOnce(null).mockResolvedValueOnce("C:\\Notes");
  const ui = await setup();
  try {
    await ui.name("Personal");
    await ui.click("Choose location");
    expect(ui.host.querySelector(".create-notebook-destination")).toBeNull();
    await ui.click("Choose location");
    expect(ui.host.textContent).toContain("C:\\Notes\\Personal");
    await ui.click("Cancel");
    expect(ui.close).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
  } finally { await ui.cleanup(); }
});

it("shows creation failures without closing or changing the chosen destination", async () => {
  vi.mocked(open).mockResolvedValue("/Notes");
  vi.mocked(invoke).mockRejectedValue(new Error("A folder already exists"));
  const ui = await setup();
  try {
    await ui.name("My Notes"); await ui.click("Choose location"); await ui.click("Create");
    expect(ui.host.querySelector('[role="alert"]')!.textContent).toContain("already exists");
    expect(ui.created).not.toHaveBeenCalled();
    expect(ui.close).not.toHaveBeenCalled();
    expect(ui.host.querySelector("input")!.disabled).toBe(false);
  } finally { await ui.cleanup(); }
});
