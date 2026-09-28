import { expect, it } from "vitest";
import { buildDemoLinkIndex } from "../lib/demoLinkIndex";
import { noteLinkRows } from "./NoteLinksPane";
import type { NoteEntry } from "../types";
it("separates and deduplicates incoming and outgoing links, including missing targets", () => {
  const notes = ["A", "B", "C"].map(title => ({ title, path: `${title}.md`, parent_path: "", created_at: null, updated_at: null })) as NoteEntry[];
  const index = buildDemoLinkIndex(new Map([
    ["A.md", "[B](B.md) [B again](B.md#part) [missing](Missing.md) [web](https://example.com)"],
    ["B.md", "[C](C.md)"], ["C.md", "[A](A.md)"],
  ]), notes);
  expect(noteLinkRows(index, "A.md")).toEqual({
    incoming: [{ path: "C.md", title: "C", broken: false }],
    outgoing: [{ path: "B.md", title: "B", broken: false }, { path: "Missing.md", title: "Missing.md", broken: true }],
  });
  expect(noteLinkRows(index, "None.md")).toEqual({ incoming: [], outgoing: [] });
});
