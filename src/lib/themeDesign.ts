/** Portable optional authoring data. CSS is validated again before every application. */
export const themeApiVersion = 1;
export const themePackageLimit = 8 * 1024 * 1024;
export type ThemeAsset = { mime: string; data: string };
export type ThemeDesign = {
  apiVersion: 1;
  author: string;
  version: string;
  license: string;
  supportsPlasma: boolean;
  css: string;
  assets: Record<string, ThemeAsset>;
  metrics: { radius: number; spacing: number; lineHeight: number };
};
export const defaultThemeDesign: ThemeDesign = {
  apiVersion: 1,
  author: "Anonymous Creator",
  version: "1.0.0",
  license: "CC0-1.0\nhttps://creativecommons.org/publicdomain/zero/1.0/",
  supportsPlasma: true,
  css: "",
  assets: {},
  metrics: { radius: 8, spacing: 1, lineHeight: 1.6 },
};
export function parseThemeDesign(value: unknown): ThemeDesign {
  if (!value || typeof value !== "object")
    throw new Error("Missing theme design.");
  const v = value as Record<string, unknown>;
  if (v.apiVersion !== themeApiVersion)
    throw new Error("This theme needs a newer theme API.");
  const text = (key: string, max: number) => {
    if (typeof v[key] !== "string" || v[key].length > max)
      throw new Error(`Invalid theme ${key}.`);
    return v[key] as string;
  };
  const version = text("version", 40);
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Theme version must be major.minor.patch.");
  if (typeof v.supportsPlasma !== "boolean")
    throw new Error("Invalid Plasma support setting.");
  const m = v.metrics as Record<string, unknown> | undefined;
  const metric = (key: string, min: number, max: number) => {
    const n = m?.[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
      throw new Error(`Invalid theme ${key}.`);
    return n;
  };
  if (!v.assets || typeof v.assets !== "object" || Array.isArray(v.assets))
    throw new Error("Invalid theme assets.");
  const entries = Object.entries(v.assets);
  if (entries.length > 32)
    throw new Error("A theme can contain at most 32 assets.");
  let total = 0;
  const assets: Record<string, ThemeAsset> = {};
  for (const [path, asset] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|woff2)$/.test(path))
      throw new Error(`Invalid asset path: ${path}`);
    const a = asset as ThemeAsset;
    const expected = path.endsWith(".png")
      ? "image/png"
      : /\.jpe?g$/.test(path)
        ? "image/jpeg"
        : path.endsWith(".webp")
          ? "image/webp"
          : "font/woff2";
    if (
      !a ||
      a.mime !== expected ||
      typeof a.data !== "string" ||
      a.data.length > 2_800_000 ||
      a.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)
    )
      throw new Error(`Invalid asset: ${path}`);
    total += a.data.length;
    if (a.data.length > 2_800_000 || total > 6_000_000)
      throw new Error("Theme assets exceed the size limit.");
    const bytes = atob(a.data);
    const valid =
      expected === "image/png"
        ? bytes.startsWith("\x89PNG\r\n\x1a\n")
        : expected === "image/jpeg"
          ? bytes.startsWith("\xff\xd8\xff")
          : expected === "image/webp"
            ? bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP"
            : bytes.startsWith("wOF2");
    if (!valid) throw new Error(`Asset contents do not match ${path}.`);
    assets[path] = { mime: a.mime, data: a.data };
  }
  return {
    apiVersion: 1,
    author: text("author", 100),
    version,
    license: text("license", 20_000),
    supportsPlasma: v.supportsPlasma,
    css: text("css", 100_000),
    assets,
    metrics: {
      radius: metric("radius", 0, 24),
      spacing: metric("spacing", 0.75, 1.5),
      lineHeight: metric("lineHeight", 1.2, 2.2),
    },
  };
}
