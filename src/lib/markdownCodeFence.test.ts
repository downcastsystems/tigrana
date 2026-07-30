import { describe, expect, it } from "vitest";
import {
  closesMarkdownCodeFence,
  markdownCodeFenceDelimiter,
  readMarkdownCodeFence,
} from "./markdownCodeFence";

describe("Markdown code fences", () => {
  it("reads CommonMark backtick and tilde opening fences", () => {
    expect(readMarkdownCodeFence("```ts")).toEqual({
      character: "`",
      info: "ts",
      length: 3,
    });
    expect(readMarkdownCodeFence("   ~~~~ js meta")).toEqual({
      character: "~",
      info: "js meta",
      length: 4,
    });
  });

  it("rejects indented and invalid backtick opening fences", () => {
    expect(readMarkdownCodeFence("    ```ts")).toBeNull();
    expect(readMarkdownCodeFence("``` `invalid`")).toBeNull();
  });

  it("closes only with the same character and at least the opening length", () => {
    const fence = readMarkdownCodeFence("````md");
    expect(fence).not.toBeNull();
    expect(closesMarkdownCodeFence("```", fence!)).toBe(false);
    expect(closesMarkdownCodeFence("~~~~", fence!)).toBe(false);
    expect(closesMarkdownCodeFence("```` trailing", fence!)).toBe(false);
    expect(closesMarkdownCodeFence("  `````", fence!)).toBe(true);
  });

  it("chooses a durable delimiter longer than backtick runs in the code", () => {
    expect(markdownCodeFenceDelimiter("const value = 1;")).toBe("```");
    expect(markdownCodeFenceDelimiter("```\n# Still code")).toBe("````");
  });
});
