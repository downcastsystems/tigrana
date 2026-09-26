import { cancelled, type DocumentControl } from "./documentOperation";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

/** Normalize browser-only elements before handing the document to portable format writers. */
export function portableDocument(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll('li[data-type="taskItem"]').forEach(item => {
    item.querySelector(":scope > label")?.remove();
    const paragraph = item.querySelector(":scope > div > p, :scope > p");
    const marker = document.createTextNode(item.getAttribute("data-checked") === "true" ? "[x] " : "[ ] ");
    (paragraph ?? item).prepend(marker);
  });
  document.querySelectorAll<HTMLElement>('ul[data-type="taskList"]').forEach(list => { list.style.listStyleType = "none"; });
  document.querySelectorAll<HTMLElement>("li p").forEach(paragraph => { paragraph.style.margin = "0"; });
  // Keep equations readable in formats whose renderers do not implement MathML.
  document.querySelectorAll("math").forEach(math => {
    math.replaceWith(document.createTextNode(math.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? math.textContent ?? ""));
  });
  document.querySelectorAll("pre, code").forEach(code => { (code as HTMLElement).style.fontFamily = "Roboto"; });
  document.querySelectorAll<HTMLElement>('[data-writing-style="story"] main > p').forEach(paragraph => {
    paragraph.style.margin = "0";
    if (paragraph.getAttribute("data-story-indent") === "indent" ||
      (paragraph.getAttribute("data-story-indent") !== "none" && paragraph.previousElementSibling?.tagName === "P")) {
      paragraph.style.textIndent = "18pt";
    }
  });
  document.querySelectorAll("main, section, ul, ol, table, thead, tbody, tr").forEach(element => {
    Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()).forEach(node => node.remove());
  });
  return document;
}

async function prepareImages(document: Document, control?: DocumentControl) {
  for (const image of document.querySelectorAll("img")) {
    if (control) await control.progress("Preparing images…");
    // Canvas normalizes all browser-supported image types, including WebP and SVG, to PNG.
    const response = await fetch(image.src, { signal: control?.signal ?? AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Could not load image: ${image.getAttribute("alt") || image.src}`);
    const url = URL.createObjectURL(await response.blob());
    try {
      const loaded = new Image();
      loaded.src = url;
      const decodeController = new AbortController();
      const stopDecoding = () => decodeController.abort();
      control?.signal.addEventListener("abort", stopDecoding, { once: true });
      const timeout = setTimeout(stopDecoding, 15000);
      try {
        await Promise.race([
          loaded.decode(),
          new Promise<never>((_, reject) => decodeController.signal.addEventListener("abort", () => reject(new Error("Image preparation was cancelled or timed out.")), { once: true })),
        ]);
      } finally { clearTimeout(timeout); control?.signal.removeEventListener("abort", stopDecoding); }
      if (control) cancelled(control.signal);
      const width = Math.min(Number(image.getAttribute("width")) || loaded.naturalWidth, 600);
      const height = width * loaded.naturalHeight / loaded.naturalWidth;
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 2400 / Math.max(loaded.naturalWidth, loaded.naturalHeight));
      canvas.width = Math.max(1, Math.round(loaded.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(loaded.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare an image for export.");
      context.drawImage(loaded, 0, 0, canvas.width, canvas.height);
      image.src = canvas.toDataURL("image/png");
      const fit = Math.min(1, 800 / height);
      image.width = Math.round(width * fit);
      image.height = Math.round(height * fit);
    } finally { URL.revokeObjectURL(url); }
  }
}

export async function createPdfDefinition(html: string, title: string, prepared = false): Promise<TDocumentDefinitions> {
  const { default: htmlToPdfmake } = await import("html-to-pdfmake");
  const document = prepared ? new DOMParser().parseFromString(html, "text/html") : portableDocument(html);
  if (!prepared) await prepareImages(document);
  const content: Content[] = Array.from(document.querySelectorAll(".export-note")).map((note, index) => ({
    stack: [htmlToPdfmake(note.innerHTML, { window: window as unknown as NonNullable<Parameters<typeof htmlToPdfmake>[1]>["window"], removeExtraBlanks: true, defaultStyles: {
      p: { margin: [0, 0, 0, 8] }, ul: { margin: [0, 0, 0, 10] }, ol: { margin: [0, 0, 0, 10] }, li: { margin: [0, 0, 0, 3] },
      code: { font: "Roboto" }, pre: { font: "Roboto", margin: [0, 4, 0, 10] }, blockquote: { italics: true, margin: [14, 4, 0, 10] },
    } })],
    ...(index ? { pageBreak: "before" as const } : {}),
  }));
  return { info: { title }, pageSize: "A4", pageMargins: [50, 50, 50, 50], defaultStyle: { font: "Roboto", fontSize: 11, lineHeight: 1.25 }, content };
}

export async function createPdf(html: string, title: string, prepared = false): Promise<Uint8Array> {
  const [{ default: pdfMake }, { default: fonts }, definition] = await Promise.all([
    import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts"), createPdfDefinition(html, title, prepared),
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  return new Uint8Array(await pdfMake.createPdf(definition).getBuffer());
}

export async function createWordDocument(html: string, title: string, prepared = false): Promise<Uint8Array> {
  const { Document: WordDocument, Packer, Paragraph, TextRun, ExternalHyperlink, ImageRun, Table, TableRow, TableCell, HeadingLevel, WidthType, BorderStyle, SectionType } = await import("docx");
  const document = prepared ? new DOMParser().parseFromString(html, "text/html") : portableDocument(html);
  if (!prepared) await prepareImages(document);
  type Run = InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink> | InstanceType<typeof ImageRun>;
  type Block = InstanceType<typeof Paragraph> | InstanceType<typeof Table>;
  type Format = { color?: string; bold?: boolean; italics?: boolean; strike?: boolean; font?: string; highlight?: "yellow"; underline?: { type: "single" } };
  function inline(node: Node, format: Format = {}): Run[] {
    if (node.nodeType === Node.TEXT_NODE) return [new TextRun({ text: node.textContent ?? "", ...format })];
    if (!(node instanceof Element)) return [];
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return [new TextRun({ break: 1 })];
    if (tag === "img") {
      const image = node as HTMLImageElement;
      return [new ImageRun({ type: "png", data: image.src, transformation: { width: Number(image.getAttribute("width")), height: Number(image.getAttribute("height")) }, altText: { title: image.alt, description: image.alt, name: image.alt || "Image" } })];
    }
    const next = { ...format };
    const color = (node as HTMLElement).style?.color;
    if (color) {
      if (/^#[a-f0-9]{6}$/i.test(color)) next.color = color.slice(1);
      const channels = color.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\)$/);
      if (channels) next.color = channels.slice(1).map(value => Number(value).toString(16).padStart(2, "0")).join("");
    }
    if (["strong", "b", "th"].includes(tag)) next.bold = true;
    if (["em", "i"].includes(tag)) next.italics = true;
    if (["s", "del"].includes(tag)) next.strike = true;
    if (tag === "u") next.underline = { type: "single" };
    if (tag === "code") next.font = "Courier New";
    if (tag === "mark") next.highlight = "yellow";
    const children = Array.from(node.childNodes).flatMap(child => inline(child, next));
    const href = node.getAttribute("href");
    if (tag === "a" && href && /^(https?:|mailto:)/i.test(href)) return [new ExternalHyperlink({ link: href, children })];
    if (tag === "p" && node.previousElementSibling?.tagName === "P") children.unshift(new TextRun({ break: 1 }));
    return children;
  }
  function blocks(parent: Element, depth = 0, quoted = false): Block[] {
    const result: Block[] = [];
    for (const node of parent.childNodes) {
      if (!(node instanceof Element)) {
        if (node.textContent?.trim()) result.push(new Paragraph({ children: inline(node, { bold: parent.tagName === "TH", italics: quoted }) }));
        continue;
      }
      const tag = node.tagName.toLowerCase();
      if (tag === "table") {
        const rows = Array.from(node.querySelectorAll(":scope > tbody > tr, :scope > thead > tr, :scope > tr"));
        result.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map(row => new TableRow({
          children: Array.from(row.children).map(cell => {
            const content = blocks(cell);
            return new TableCell({
              columnSpan: Number(cell.getAttribute("colspan")) || 1,
              rowSpan: Number(cell.getAttribute("rowspan")) || 1,
              children: content.length ? content : [new Paragraph({ children: inline(cell) })],
            });
          }),
        })) }));
      } else if (tag === "ul" || tag === "ol") {
        let index = 1;
        for (const item of node.children) {
          const copy = item.cloneNode(true) as Element;
          copy.querySelectorAll("ul, ol").forEach(list => list.remove());
          const task = node.getAttribute("data-type") === "taskList";
          result.push(new Paragraph({
            children: [new TextRun(task ? "" : tag === "ol" ? `${index++}. ` : "• "), ...inline(copy)],
            indent: { left: (depth + 1) * 360, hanging: 240 }, spacing: { after: 80 },
          }));
          for (const list of item.querySelectorAll(":scope > ul, :scope > ol, :scope > div > ul, :scope > div > ol")) {
            const wrapper = document.createElement("div"); wrapper.append(list.cloneNode(true));
            result.push(...blocks(wrapper, depth + 1));
          }
        }
      } else if (["main", "section", "div", "blockquote"].includes(tag)) {
        result.push(...blocks(node, depth, quoted || tag === "blockquote"));
      } else {
        const heading = ({ h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3 } as Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]>)[tag];
        const storyParagraph = tag === "p" && node.parentElement?.tagName === "MAIN" && Boolean(node.closest('[data-writing-style="story"]'));
        const storyIndent = storyParagraph &&
          (node.getAttribute("data-story-indent") === "indent" || (node.getAttribute("data-story-indent") !== "none" && node.previousElementSibling?.tagName === "P"));
        result.push(new Paragraph({
          children: tag === "pre"
            ? (node.textContent ?? "").split("\n").map((text, index) => new TextRun({ text, font: "Courier New", ...(index ? { break: 1 } : {}) }))
            : tag === "img" ? inline(node) : Array.from(node.childNodes).flatMap(child => inline(child, { bold: Boolean(node.closest("th")), italics: quoted })),
          ...(quoted ? { indent: { left: 360 } } : {}),
          heading, spacing: { after: storyParagraph ? 0 : 140 }, ...(storyIndent ? { indent: { firstLine: 360 } } : {}),
          ...(tag === "hr" ? { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } } } : {}),
        }));
      }
    }
    return result;
  }
  const sections = Array.from(document.querySelectorAll(".export-note")).map(note => ({ properties: { type: SectionType.NEXT_PAGE }, children: blocks(note) }));
  const word = new WordDocument({ title, sections });
  return new Uint8Array(await Packer.toArrayBuffer(word));
}

export async function prepareExportHtml(html: string, control: DocumentControl) {
  const document = portableDocument(html);
  await prepareImages(document, control);
  return document.documentElement.outerHTML;
}
