// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { printDocument } from "./printDocument";
import { printCurrentWebview } from "./desktop";
vi.mock("./desktop", () => ({ printCurrentWebview: vi.fn().mockResolvedValue(undefined) }));

afterEach(() => { window.dispatchEvent(new Event("afterprint")); vi.clearAllMocks(); });

describe("isolated printing", () => {
  it("prints prepared content without replacing the editor and waits for afterprint to clean up", async () => {
    const editor = document.createElement("main");
    editor.textContent = "Editor stays intact";
    document.body.append(editor);
    await printDocument('<html><head><style>body { color: black; }</style></head><body><h1>Printed note</h1></body></html>');
    const host = document.getElementById("tigrana-print-document")!;
    expect(host.shadowRoot?.textContent).toContain("Printed note");
    expect(host.style.display).toBe("none");
    expect(printCurrentWebview).toHaveBeenCalledOnce();
    expect(editor.textContent).toBe("Editor stays intact");
    window.dispatchEvent(new Event("afterprint"));
    expect(document.getElementById("tigrana-print-document")).toBeNull();
    expect(editor.isConnected).toBe(true);
    editor.remove();
  });

  it("removes prepared content if native printing fails", async () => {
    vi.mocked(printCurrentWebview).mockRejectedValueOnce(new Error("Printer unavailable"));
    await expect(printDocument('<html><body>Note</body></html>')).rejects.toThrow("Printer unavailable");
    expect(document.getElementById("tigrana-print-document")).toBeNull();
  });
});
