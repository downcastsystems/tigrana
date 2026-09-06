const RELEASE_API = "https://api.github.com/repos/downcastsystems/tigrana/releases/latest";
export const RELEASE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
export const RELEASE_CACHE_KEY = "tigrana-release-check";
export const RELEASE_DISMISSED_KEY = "tigrana-dismissed-release";

export type ReleaseUpdate = { version: string; url: string };
type StorageLike = Pick<Storage, "getItem" | "setItem">;

function versionParts(value: string) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function isNewerRelease(version: string, installed: string) {
  const next = versionParts(version);
  const current = versionParts(installed.replace(/[+-].*$/, ""));
  if (!next || !current) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== current[index]) return next[index] > current[index];
  }
  return installed.includes("-");
}

function releaseFromTag(tag: unknown): ReleaseUpdate | null {
  if (typeof tag !== "string" || !versionParts(tag)) return null;
  return {
    version: tag.replace(/^v/, ""),
    // Never open a URL supplied by the API or local cache.
    url: `https://github.com/downcastsystems/tigrana/releases/tag/${encodeURIComponent(tag)}`,
  };
}

export function readUpdatePreference(key: string, storage?: StorageLike) {
  try { return (storage ?? globalThis.localStorage).getItem(key); } catch { return null; }
}

export function writeUpdatePreference(key: string, value: string, storage?: StorageLike) {
  try { (storage ?? globalThis.localStorage).setItem(key, value); } catch { /* Updates also work without local storage. */ }
}

export async function checkForRelease(installed: string, {
  storage,
  fetcher = fetch,
  now = Date.now(),
}: { storage?: StorageLike; fetcher?: typeof fetch; now?: number } = {}): Promise<ReleaseUpdate | null> {
  let cachedTag: string | null = null;
  let checkedAt = 0;
  try {
    const cache = JSON.parse(readUpdatePreference(RELEASE_CACHE_KEY, storage) || "null");
    if (cache && (cache.tag === null || releaseFromTag(cache.tag))) {
      cachedTag = cache.tag;
      if (typeof cache.checkedAt === "number" && Number.isFinite(cache.checkedAt)) checkedAt = cache.checkedAt;
    }
  } catch { /* Ignore a malformed cache. */ }

  const candidate = () => {
    const release = releaseFromTag(cachedTag);
    return release && isNewerRelease(release.version, installed) ? release : null;
  };
  if (checkedAt > 0 && now >= checkedAt && now - checkedAt < RELEASE_CHECK_INTERVAL) return candidate();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let nextCheckAt = now;
  try {
    const response = await fetcher(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
      credentials: "omit",
    });
    if (response.status === 404) {
      cachedTag = null;
    } else {
      if (!response.ok) throw new Error(`Release check: ${response.status}`);
      const release: unknown = await response.json();
      if (!release || typeof release !== "object") throw new Error("Invalid release response");
      const data = release as Record<string, unknown>;
      cachedTag = data.draft === false && data.prerelease === false && releaseFromTag(data.tag_name)
        ? data.tag_name as string : null;
    }
  } catch {
    // Keep any known update, and retry failures after one hour instead of daily.
    nextCheckAt = now - RELEASE_CHECK_INTERVAL + 60 * 60 * 1000;
  } finally {
    clearTimeout(timeout);
  }
  writeUpdatePreference(RELEASE_CACHE_KEY, JSON.stringify({ checkedAt: nextCheckAt, tag: cachedTag }), storage);
  return candidate();
}
