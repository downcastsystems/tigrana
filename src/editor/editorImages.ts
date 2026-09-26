import { convertFileSrc } from "@tauri-apps/api/core";
import { Image } from "@tiptap/extension-image";
import type { EditorView } from "@tiptap/pm/view";
import { ReactNodeViewRenderer, type Editor } from "@tiptap/react";
import { ResizableImageNodeView } from "./ResizableImageNodeView";
import { isTauri } from "../lib/desktop";
import { notebookStorage } from "../lib/notebookStorage";
const { saveAsset, saveClipboardImageAsset, readAssetDataUrl } = notebookStorage;

const notebookImagePreviewCache = new Map<string, string>();

export const MarkdownImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      markdownSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-markdown-src"),
        renderHTML: (attributes) => (attributes.markdownSrc ? { "data-markdown-src": attributes.markdownSrc } : {}),
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const w = element.getAttribute("width");
          return w ? Number(w) : null;
        },
        renderHTML: (attributes) => (attributes.width ? { width: String(attributes.width) } : {}),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageNodeView);
  },
});

export function resolveNotebookImageSrc(workspace: string, src: string) {
  if (!workspace || !isTauri() || isExternalImageSrc(src) || src.startsWith("data:")) return src;
  const relative = src.replace(/^\.?\//, "");
  return convertFileSrc(`${workspace}/${relative}`);
}

function isExternalImageSrc(src: string) {
  return /^(https?:|asset:|blob:|file:)/i.test(src);
}

export function isRenderableImageType(type: string) {
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(type);
}

export function getClipboardImageFile(data: DataTransfer | null) {
  const files = Array.from(data?.files ?? []).filter((file) => file.type.startsWith("image/"));
  const file = files.find((entry) => isRenderableImageType(entry.type)) ?? files[0];
  if (file) return file;

  const items = Array.from(data?.items ?? []).filter((item) => item.type.startsWith("image/"));
  const item = items.find((entry) => isRenderableImageType(entry.type)) ?? items[0];
  return item?.getAsFile() ?? null;
}

export function getClipboardImageFromHtml(data: DataTransfer | null) {
  const html = data?.getData("text/html");
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const src = doc.querySelector("img")?.getAttribute("src") ?? "";
  if (!src.startsWith("data:image/")) return null;
  return dataUrlToFile(src);
}

export function mayContainAsyncClipboardImage(data: DataTransfer | null) {
  return Array.from(data?.types ?? []).some((type) => type.startsWith("image/"));
}

function dataUrlToFile(dataUrl: string) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1] || "image/png";
  const encoded = match[3] || "";
  const binary = match[2] ? atob(encoded) : decodeURIComponent(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], `pasted-image.${extensionForImageType(mimeType)}`, { type: mimeType });
}

export function blobToFile(blob: Blob, type: string) {
  return new File([blob], `pasted-image.${extensionForImageType(type)}`, { type });
}

function extensionForImageType(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/svg+xml") return "svg";
  return type.split("/").at(1)?.replace(/\W+/g, "-") || "png";
}

export async function insertImageFile(
  view: EditorView,
  workspace: string,
  file: File,
  expectedNotePath: string | null,
  getCurrentNotePath: () => string | null,
) {
  const src = await saveAsset(workspace, file);
  const previewSrc = await previewSrcForNotebookImage(workspace, src);
  if (getCurrentNotePath() !== expectedNotePath) return;
  insertSavedImage(view, previewSrc, src, file.name || "Pasted image");
}

export async function insertNativeClipboardImage(
  view: EditorView,
  workspace: string,
  expectedNotePath: string | null,
  getCurrentNotePath: () => string | null,
) {
  const src = await saveClipboardImageAsset(workspace);
  const previewSrc = await previewSrcForNotebookImage(workspace, src);
  if (getCurrentNotePath() !== expectedNotePath) return;
  insertSavedImage(view, previewSrc, src, "Pasted image");
}

function insertSavedImage(view: EditorView, previewSrc: string, markdownSrc: string, name: string) {
  const imageType = view.state.schema.nodes.image;
  if (!imageType) return;
  const node = imageType.create({
    src: previewSrc,
    alt: name,
    markdownSrc,
  });
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  view.focus();
}

async function previewSrcForNotebookImage(workspace: string, src: string) {
  if (!workspace || !isTauri() || isExternalImageSrc(src) || src.startsWith("data:")) return src;
  const cacheKey = `${workspace}\0${src}`;
  const cached = notebookImagePreviewCache.get(cacheKey);
  if (cached) return cached;

  const dataUrl = await readAssetDataUrl(workspace, src);
  const file = dataUrlToFile(dataUrl);
  if (!file) return dataUrl;
  const objectUrl = URL.createObjectURL(file);
  notebookImagePreviewCache.set(cacheKey, objectUrl);
  return objectUrl;
}

export async function hydrateNotebookImageNodes(
  editor: Editor,
  workspace: string,
  expectedNotePath: string | null,
  getCurrentNotePath: () => string | null,
) {
  if (!workspace || !isTauri()) return;
  const pending: Array<{ attrs: Record<string, unknown>; pos: number; src: string }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "image") return;
    const markdownSrc = typeof node.attrs.markdownSrc === "string" ? node.attrs.markdownSrc : "";
    if (!markdownSrc || isExternalImageSrc(markdownSrc) || markdownSrc.startsWith("data:")) return;
    if (typeof node.attrs.src === "string" && node.attrs.src.startsWith("data:")) return;
    pending.push({ attrs: node.attrs, pos, src: markdownSrc });
  });

  if (!pending.length) return;

  const resolved = await Promise.all(
    pending.map(async (item) => ({
      ...item,
      previewSrc: await previewSrcForNotebookImage(workspace, item.src).catch(() => null),
    })),
  );

  if (getCurrentNotePath() !== expectedNotePath) return;
  const tr = editor.state.tr.setMeta("addToHistory", false);
  let changed = false;
  for (const item of resolved) {
    if (getCurrentNotePath() !== expectedNotePath) return;
    if (!item.previewSrc) continue;
    const node = tr.doc.nodeAt(item.pos);
    if (!node || node.type.name !== "image") continue;
    if (node.attrs.src === item.previewSrc && node.attrs.markdownSrc === item.src) continue;
    tr.setNodeMarkup(item.pos, undefined, { ...item.attrs, src: item.previewSrc, markdownSrc: item.src });
    changed = true;
  }
  if (changed) editor.view.dispatch(tr);
}
