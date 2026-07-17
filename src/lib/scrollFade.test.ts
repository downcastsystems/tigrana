import { describe, expect, it } from "vitest";
import { getScrollFadeVisibility } from "./scrollFade";

describe("scroll fade visibility", () => {
  it("hides both fades when all content fits", () => {
    expect(getScrollFadeVisibility({ scrollTop: 0, scrollHeight: 600, clientHeight: 600 })).toEqual({
      top: false,
      bottom: false,
    });
  });

  it("shows only the bottom fade at the start of overflowing content", () => {
    expect(getScrollFadeVisibility({ scrollTop: 0, scrollHeight: 900, clientHeight: 600 })).toEqual({
      top: false,
      bottom: true,
    });
  });

  it("shows both fades while positioned between the scroll boundaries", () => {
    expect(getScrollFadeVisibility({ scrollTop: 150, scrollHeight: 900, clientHeight: 600 })).toEqual({
      top: true,
      bottom: true,
    });
  });

  it("shows only the top fade at the end of overflowing content", () => {
    expect(getScrollFadeVisibility({ scrollTop: 300, scrollHeight: 900, clientHeight: 600 })).toEqual({
      top: true,
      bottom: false,
    });
  });
});
