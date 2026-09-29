// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { dateFormatStorageKey, formatDate, readDateFormat, writeDateFormat } from "./dateFormat";

afterEach(() => localStorage.clear());

it("defaults to the system locale and uses unpadded US dates", () => {
  const date = new Date(2026, 8, 6, 23, 30);
  expect(readDateFormat()).toBe("locale");
  expect(formatDate(date, "locale", "en-US")).toBe("9/6/2026");
  expect(formatDate(date, "locale", "en-GB")).toBe("06/09/2026");
  expect(formatDate(date, "locale", "ja-JP")).toBe("2026/9/6");
});

it("formats explicit choices using the local calendar day", () => {
  const date = new Date(2026, 8, 6, 23, 30);
  expect(formatDate(date, "m/d/yyyy", "en-GB")).toBe("9/6/2026");
  expect(formatDate(date, "mm/dd/yyyy")).toBe("09/06/2026");
  expect(formatDate(date, "d/m/yyyy")).toBe("6/9/2026");
  expect(formatDate(date, "dd/mm/yyyy")).toBe("06/09/2026");
  expect(formatDate(date, "yyyy-mm-dd")).toBe("2026-09-06");
  expect(formatDate(date, "yyyy/mm/dd")).toBe("2026/09/06");
});

it("persists the choice app-wide and falls back for an unsupported stored value", () => {
  writeDateFormat("yyyy-mm-dd");
  expect(readDateFormat()).toBe("yyyy-mm-dd");
  localStorage.setItem(dateFormatStorageKey, "invalid");
  expect(readDateFormat()).toBe("locale");
});
