import { unzipSync, strFromU8 } from "fflate";
import { DOMParser } from "linkedom";
import { escapeImportText as esc, nearestImportColor, type ImportedDocument, type ImportedAsset } from "./documentImport";

const local = (node: Element) => node.localName.split(":").pop()!;
const children = (node: Element | null, name: string) => node ? Array.from(node.children).filter(child => local(child) === name) : [];
const child = (node: Element | null, name: string) => children(node, name)[0] ?? null;
const descendants = (node: Element | Document, name: string) => Array.from(node.querySelectorAll("*")).filter(el => local(el) === name);
const attr = (node: Element | null, name: string) => node?.getAttribute(`w:${name}`) ?? node?.getAttribute(`r:${name}`) ?? node?.getAttribute(name) ?? "";
const value = (node: Element | null, name: string) => attr(child(node, name), "val");

export function importWord(bytes: Uint8Array): ImportedDocument {
  let expanded = 0;
  const files = unzipSync(bytes, { filter: file => {
    const include = /^word\/(document\.xml|styles\.xml|numbering\.xml|theme\/theme\d+\.xml|_rels\/document\.xml\.rels|media\/[^/]+)$/.test(file.name);
    if (include) {
      expanded += file.originalSize;
      if (expanded > 200 * 1024 * 1024) throw new Error("This Word document expands beyond the 200 MB import limit.");
    }
    return include;
  } });
  if (!files["word/document.xml"]) throw new Error("This is not a supported Word document. Save it as .docx and try again.");
  const parse = (path: string) => new DOMParser().parseFromString(files[path] ? strFromU8(files[path]) : "<empty/>", "text/xml") as unknown as Document;
  const document = parse("word/document.xml");
  const body = descendants(document, "body")[0];
  if (!body) throw new Error("The Word document has no readable body.");
  const stylesDocument = parse("word/styles.xml");
  const defaultRun = descendants(stylesDocument, "rPrDefault")[0];
  const styles = new Map(descendants(stylesDocument, "style").map(style => [attr(style, "styleId"), style]));
  const theme = new Map<string, string>();
  const scheme = descendants(parse("word/theme/theme1.xml"), "clrScheme")[0];
  for (const color of Array.from(scheme?.children ?? [])) {
    const entry = color.firstElementChild;
    theme.set(local(color), attr(entry, "lastClr") || attr(entry, "val"));
  }
  const relationships = new Map(descendants(parse("word/_rels/document.xml.rels"), "Relationship").map(rel => [attr(rel, "Id"), rel]));
  const numbering = parse("word/numbering.xml");
  const numbers = new Map(descendants(numbering, "num").map(num => [attr(num, "numId"), value(num, "abstractNumId")]));
  const abstractNumbers = new Map(descendants(numbering, "abstractNum").map(num => [attr(num, "abstractNumId"), num]));
  const assets: ImportedAsset[] = [];
  const warnings = new Set<string>();
  const imageTokens = new Map<string, string>();
  function styleChain(id: string, seen = new Set<string>()): Element[] {
    if (!id || seen.has(id) || seen.size > 20) return [];
    seen.add(id);
    const style = styles.get(id);
    return style ? [...styleChain(value(style, "basedOn"), seen), style] : [];
  }
  function properties(nodes: (Element | null)[]) {
    const map = new Map<string, Element>();
    for (const node of nodes) for (const property of Array.from(node?.children ?? [])) map.set(local(property), property);
    return map;
  }
  function image(node: Element) {
    const blip = descendants(node, "blip")[0] ?? descendants(node, "imagedata")[0];
    const id = attr(blip, "embed") || attr(blip, "id");
    const rel = relationships.get(id);
    const altNode = descendants(node, "docPr")[0];
    const alt = attr(altNode, "descr") || attr(altNode, "name") || "Imported image";
    if (!rel || attr(rel, "TargetMode") === "External") {
      warnings.add("Some linked images were unavailable and were not downloaded."); return esc(`[${alt}]`);
    }
    const target = attr(rel, "Target").replace(/^\/?word\//, "");
    const path = `word/${target}`;
    const extension = path.split(".").pop()!.toLowerCase();
    const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", tif: "image/tiff", tiff: "image/tiff" } as Record<string, string>)[extension];
    if (!files[path] || !mime) { warnings.add("Some images used unsupported formats and were replaced with their descriptions."); return esc(`[${alt}]`); }
    let token = imageTokens.get(path);
    if (!token) {
      token = `tigrana-import-${crypto.randomUUID()}`;
      imageTokens.set(path, token);
      assets.push({ token, name: `imported-${assets.length + 1}.${extension}`, mime, bytes: files[path] });
    }
    const extent = descendants(node, "extent")[0];
    const width = Math.round(Number(attr(extent ?? null, "cx")) / 9525);
    return `<img src="${token}" alt="${esc(alt)}"${width > 0 ? ` width="${Math.min(1200, width)}"` : ""}>`;
  }
  function run(node: Element, inherited: Element[], heading: boolean): string {
    const props = properties([...inherited, ...styleChain(value(child(node, "rPr"), "rStyle")).map(s => child(s, "rPr")), child(node, "rPr")]);
    let text = Array.from(node.children).map(part => {
      switch (local(part)) {
        case "t": return esc(part.textContent ?? "");
        case "tab": return " ";
        case "br": return attr(part, "type") === "page" ? " " : "<br>";
        case "cr": return "<br>";
        case "drawing": case "pict": {
          const boxes = descendants(part, "txbxContent");
          return boxes.length ? boxes.map(box => blocks(box)).join("") : image(part);
        }
        case "noBreakHyphen": return "-";
        default: return "";
      }
    }).join("");
    const enabled = (key: string) => props.has(key) && !["0", "false", "off", "none"].includes(attr(props.get(key)!, "val"));
    if (enabled("b")) text = `<strong>${text}</strong>`;
    if (enabled("i")) text = `<em>${text}</em>`;
    if (enabled("strike") || enabled("dstrike")) text = `<s>${text}</s>`;
    if (enabled("u")) text = `<u>${text}</u>`;
    if (!heading) {
      const color = props.get("color");
      const raw = attr(color ?? null, "val");
      const hex = raw && raw !== "auto" ? raw : theme.get(attr(color ?? null, "themeColor"));
      const foreground = hex ? nearestImportColor(`#${hex}`) : null;
      const fill = attr(props.get("shd") ?? null, "fill");
      const background = nearestImportColor(attr(props.get("highlight") ?? null, "val") || (fill && fill !== "auto" ? `#${fill}` : ""), true);
      const css = [foreground && `color: ${foreground}`, background && `background-color: ${background}`].filter(Boolean).join("; ");
      if (css) text = `<span style="${css}">${text}</span>`;
    }
    return text;
  }
  function inline(node: Element, inherited: Element[], heading: boolean): string {
    return Array.from(node.children).map(part => {
      const tag = local(part);
      if (tag === "r") return run(part, inherited, heading);
      if (tag === "hyperlink") {
        const target = attr(relationships.get(attr(part, "id")) ?? null, "Target");
        const text = inline(part, inherited, heading);
        return /^(https?:|mailto:)/i.test(target) ? `<a href="${esc(target)}">${text}</a>` : text;
      }
      if (["ins", "smartTag", "sdt", "sdtContent"].includes(tag)) return inline(part, inherited, heading);
      return "";
    }).join("");
  }
  function blocks(parent: Element): string {
    let html = "";
    const lists: { tag: string; id: string }[] = [];
    const close = () => { while (lists.length) html += `</li></${lists.pop()!.tag}>`; };
    for (const block of Array.from(parent.children)) {
      const tag = local(block);
      if (tag === "p") {
        const direct = child(block, "pPr");
        const chain = styleChain(value(direct, "pStyle") || Array.from(styles.values()).find(style => attr(style, "type") === "paragraph" && attr(style, "default") === "1")?.getAttribute("w:styleId") || "");
        const pProps = properties([...chain.map(s => child(s, "pPr")), direct]);
        const outline = attr(pProps.get("outlineLvl") ?? null, "val");
        const headingName = chain.map(s => `${attr(s, "styleId")} ${value(s, "name")}`).join(" ").match(/heading\s*([1-9])/i);
        const heading = outline && Number(outline) < 9 ? Math.min(3, Number(outline) + 1) : headingName ? Math.min(3, Number(headingName[1])) : 0;
        const text = inline(block, [child(defaultRun ?? null, "rPr"), ...chain.map(s => child(s, "rPr"))].filter((s): s is Element => Boolean(s)), Boolean(heading));
        const number = pProps.get("numPr") ?? null;
        const id = value(number, "numId");
        if (id && id !== "0" && !heading) {
          const level = Math.min(8, Number(value(number, "ilvl")) || 0);
          const format = children(abstractNumbers.get(numbers.get(id) ?? "") ?? null, "lvl").find(l => attr(l, "ilvl") === String(level));
          const listTag = value(format ?? null, "numFmt") === "bullet" ? "ul" : "ol";
          if (lists.length && lists[Math.min(level, lists.length - 1)].id !== id) close();
          while (lists.length > level + 1) html += `</li></${lists.pop()!.tag}>`;
          if (lists.length === level + 1) html += "</li><li>";
          else { while (lists.length <= level) { lists.push({ tag: listTag, id }); html += `<${listTag}><li>`; } }
          html += `<p>${text}</p>`;
        } else { close(); html += `<${heading ? `h${heading}` : "p"}>${text}</${heading ? `h${heading}` : "p"}>`; }
      } else if (tag === "tbl") {
        close();
        html += "<table>";
        // Expand vertical merges to ordinary cells; retain all visible cell content.
        for (const row of children(block, "tr")) {
          html += "<tr>";
          for (const cell of children(row, "tc")) {
            const span = Math.min(100, Math.max(1, Number(value(child(cell, "tcPr"), "gridSpan")) || 1));
            html += `<td colspan="${span}">${blocks(cell)}</td>`;
          }
          html += "</tr>";
        }
        html += "</table>";
      } else if (["sdt", "sdtContent", "ins"].includes(tag)) { close(); html += blocks(block); }
    }
    close(); return html;
  }
  return { html: blocks(body), assets, warnings: [...warnings] };
}
