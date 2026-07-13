import { describe, expect, it } from "vitest";
import { markdownToHtml } from "./markdown";

describe("markdown emoji rendering", () => {
  it("renders known emoji shortcodes as plain emoji text", () => {
    const html = markdownToHtml("# :white_check_mark: SSA");

    expect(html).toContain("<h1>✅ SSA</h1>");
    expect(html).not.toContain('data-type="emoji"');
  });
});
