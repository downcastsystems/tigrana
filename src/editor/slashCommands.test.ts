// @vitest-environment jsdom
import { expect, it } from "vitest";
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
const { filterSlashCommands, slashCommands } = await import("./slashCommands");

it("ranks Date before incidental substring matches for /d", () => {
  const matches = filterSlashCommands("d").map(command => command.id);
  expect(matches[0]).toBe("date");
  expect(matches.indexOf("divider")).toBeLessThan(matches.indexOf("lorem"));
});

it("prioritizes exact names and aliases while retaining partial keyword searches", () => {
  expect(filterSlashCommands("date")[0].id).toBe("date");
  expect(filterSlashCommands("today")[0].id).toBe("date");
  expect(filterSlashCommands("h2")[0].id).toBe("heading-2");
  expect(filterSlashCommands("p")[0].id).toBe("paragraph");
  expect(filterSlashCommands("place")[0].id).toBe("lorem");
  expect(filterSlashCommands("  Da  ")[0].id).toBe("date");
  expect(filterSlashCommands("not-a-command")).toEqual([]);
});

it("preserves the familiar command order before a query is typed", () => {
  expect(filterSlashCommands("")).toEqual(slashCommands);
  expect(filterSlashCommands("")[0].id).toBe("paragraph");
});
