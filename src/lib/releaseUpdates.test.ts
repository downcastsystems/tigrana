import { describe, expect, it, vi } from "vitest";
import { checkForRelease, isNewerRelease, RELEASE_CACHE_KEY, RELEASE_CHECK_INTERVAL } from "./releaseUpdates";

const now = 100 * RELEASE_CHECK_INTERVAL;
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function response(tag = "v1.10.0", extra = {}) {
  return new Response(JSON.stringify({ tag_name: tag, draft: false, prerelease: false, ...extra }));
}

describe("GitHub release notices", () => {
  it("compares version numbers numerically and ignores older or invalid versions", () => {
    expect(isNewerRelease("1.10.0", "1.9.9")).toBe(true);
    expect(isNewerRelease("2.0.0", "1.99.99")).toBe(true);
    expect(isNewerRelease("1.0.7", "1.0.7")).toBe(false);
    expect(isNewerRelease("1.0.6", "1.0.7")).toBe(false);
    expect(isNewerRelease("1.0.7", "1.0.7-beta.1")).toBe(true);
    expect(isNewerRelease("1.0.7-beta.1", "1.0.6")).toBe(false);
    expect(isNewerRelease("latest", "1.0.6")).toBe(false);
  });

  it("caches a release across checks and stops offering it after installation", async () => {
    const cache = storage();
    const fetcher = vi.fn().mockResolvedValue(response());
    const options = { storage: cache, fetcher, now };
    expect(await checkForRelease("1.9.0", options)).toEqual({
      version: "1.10.0", url: "https://github.com/downcastsystems/tigrana/releases/tag/v1.10.0",
    });
    expect(await checkForRelease("1.9.0", { ...options, now: now + 1000 })).not.toBeNull();
    expect(await checkForRelease("1.10.0", options)).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockResolvedValue(response("v1.11.0"));
    expect((await checkForRelease("1.9.0", { ...options, now: now + RELEASE_CHECK_INTERVAL }))?.version).toBe("1.11.0");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([{ draft: true }, { prerelease: true }, { tag_name: "v2.0.0-beta.1" }])("does not announce unpublished or preview releases: %j", async (extra) => {
    expect(await checkForRelease("1.0.0", { storage: storage(), fetcher: vi.fn().mockResolvedValue(response("v2.0.0", extra)), now })).toBeNull();
  });

  it("keeps cached notices during network failures and backs off retries", async () => {
    const cache = storage();
    cache.setItem(RELEASE_CACHE_KEY, JSON.stringify({ checkedAt: now - RELEASE_CHECK_INTERVAL, tag: "v2.0.0" }));
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    const options = { storage: cache, fetcher, now };
    expect((await checkForRelease("1.0.0", options))?.version).toBe("2.0.0");
    await checkForRelease("1.0.0", { ...options, now: now + 1000 });
    expect(fetcher).toHaveBeenCalledOnce();
    await checkForRelease("1.0.0", { ...options, now: now + 60 * 60 * 1000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("handles no releases, corrupt caches, and unavailable storage", async () => {
    const cache = storage();
    cache.setItem(RELEASE_CACHE_KEY, "broken");
    expect(await checkForRelease("1.0.0", { storage: cache, fetcher: vi.fn().mockResolvedValue(new Response(null, { status: 404 })), now })).toBeNull();
    const denied = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect((await checkForRelease("1.0.0", { storage: denied, fetcher: vi.fn().mockResolvedValue(response()), now }))?.version).toBe("1.10.0");
  });

  it("only opens this repository's release URLs", async () => {
    const update = await checkForRelease("1.0.0", { storage: storage(), fetcher: vi.fn().mockResolvedValue(response("v2.0.0", { html_url: "https://example.com/untrusted" })), now });
    expect(update?.url).toBe("https://github.com/downcastsystems/tigrana/releases/tag/v2.0.0");
  });
});
