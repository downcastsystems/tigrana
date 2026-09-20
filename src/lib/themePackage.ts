import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { parseTheme, type ThemeDocument } from "./themes";
import { themePackageLimit, type ThemeAsset } from "./themeDesign";
export function encodeThemePackage(theme: ThemeDocument): Uint8Array {
  const clean = parseTheme(theme);
  const { design, ...base } = clean;
  const files: Record<string, Uint8Array> = {
    "theme.json": strToU8(
      JSON.stringify(
        {
          ...base,
          ...(design
            ? { design: { ...design, css: "", assets: {}, license: "" } }
            : {}),
        },
        null,
        2,
      ),
    ),
  };
  if (design) {
    files["theme.css"] = strToU8(design.css);
    files["LICENSE"] = strToU8(design.license);
    for (const [path, asset] of Object.entries(design.assets))
      files[path] = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0));
  }
  // Never export an archive that our importer would reject (including snapshots).
  const bytes = zipSync(files);
  decodeThemePackage(bytes);
  return bytes;
}
export function decodeThemePackage(bytes: Uint8Array): ThemeDocument {
  if (bytes.length > themePackageLimit)
    throw new Error("Theme packages must be smaller than 8 MB.");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    return parseTheme(JSON.parse(strFromU8(bytes)));
  let total = 0;
  const names = new Set<string>();
  const archive = unzipSync(bytes, {
    filter: (file) => {
      if (names.has(file.name))
        throw new Error("Duplicate file in theme package.");
      names.add(file.name);
      if (
        names.size > 40 ||
        file.name.includes("..") ||
        file.name.includes("\\") ||
        file.name.startsWith("/")
      )
        throw new Error(`Unexpected package file: ${file.name}`);
      total += file.originalSize;
      if (file.originalSize > (/(^|\/)theme\.json$/.test(file.name) ? themePackageLimit : 2_100_000) || total > themePackageLimit)
        throw new Error("Expanded theme package exceeds the size limit.");
      if (file.name.endsWith("/")) {
        if (file.originalSize !== 0)
          throw new Error("Invalid directory entry.");
        return false;
      }
      return true;
    },
  });
  const manifests = Object.keys(archive).filter(
    (name) => name === "theme.json" || /^[^/]+\/theme\.json$/.test(name),
  );
  if (manifests.length !== 1)
    throw new Error("Package must contain exactly one theme.json.");
  const prefix = manifests[0].slice(0, -"theme.json".length);
  const files: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(archive)) {
    if (!name.startsWith(prefix))
      throw new Error("Files must belong to one theme folder.");
    const path = name.slice(prefix.length);
    if (
      !/^(theme\.json|theme\.css|LICENSE|assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|woff2))$/.test(
        path,
      )
    )
      throw new Error(`Unexpected package file: ${path}`);
    files[path] = data;
  }
  if (!files["theme.json"])
    throw new Error("Theme package is missing theme.json.");
  const theme = JSON.parse(strFromU8(files["theme.json"]));
  if (theme.schemaVersion === 2 && theme.design) {
    const assets: Record<string, ThemeAsset> = {};
    for (const [path, data] of Object.entries(files))
      if (path.startsWith("assets/")) {
        const mime = path.endsWith(".png")
          ? "image/png"
          : /\.jpe?g$/.test(path)
            ? "image/jpeg"
            : path.endsWith(".webp")
              ? "image/webp"
              : "font/woff2";
        let binary = "";
        for (let i = 0; i < data.length; i += 8192)
          binary += String.fromCharCode(...data.subarray(i, i + 8192));
        assets[path] = { mime, data: btoa(binary) };
      }
    theme.design = {
      ...theme.design,
      css: files["theme.css"] ? strFromU8(files["theme.css"]) : "",
      license: files.LICENSE ? strFromU8(files.LICENSE) : "",
      assets,
    };
  }
  return parseTheme(theme);
}
