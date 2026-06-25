import { markdownToHtml } from "./markdown";

export function noteExportFileStem(title: string) {
  return (title.trim() || "Untitled")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Untitled";
}

export async function buildNoteExportHtml(
  title: string,
  markdown: string,
  options: { resolveImageSrc?: (src: string) => string | Promise<string> } = {},
) {
  const imageSources = await collectResolvedImageSources(markdown, options.resolveImageSrc);
  const body = markdownToHtml(markdown, {
    resolveImageSrc: (src) => imageSources.get(src) ?? src,
  });
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title || "Untitled")}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 48px auto;
      max-width: 760px;
      padding: 0 32px;
      color: #1f2328;
      background: #ffffff;
      font: 17px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.45em; }
    h1.note-title { margin-top: 0; font-size: 2.25rem; }
    p { margin: 0.5em 0; }
    a { color: #0969da; }
    img { max-width: 100%; height: auto; }
    blockquote { margin-left: 0; padding-left: 1em; border-left: 3px solid #d0d7de; color: #57606a; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    :not(pre) > code { padding: 0.12em 0.28em; background: #f6f8fa; border-radius: 4px; }
    pre { overflow-x: auto; padding: 1em; background: #f6f8fa; border-radius: 6px; }
    ul, ol { padding-left: 1.35em; }
    li { margin: 0.25em 0; }
    li > p { margin: 0; }
    li[data-separator-after="true"] { margin-bottom: 0.6em; }
    ul[data-type="taskList"] { padding-left: 0; list-style: none; }
    ul[data-type="taskList"] > li {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr);
      column-gap: 10px;
      align-items: start;
      list-style: none;
      margin: 0.35em 0;
    }
    ul[data-type="taskList"] > li::marker,
    ul[data-type="taskList"] > li::before { content: none; }
    ul[data-type="taskList"] > li > label {
      display: inline-flex;
      align-items: center;
      justify-content: flex-start;
      width: 22px;
      height: 1.65em;
      margin: 0;
      padding: 0;
    }
    ul[data-type="taskList"] > li > label > input[type="checkbox"] {
      width: 18px;
      height: 18px;
      margin: 0;
      accent-color: #0969da;
      flex: 0 0 18px;
    }
    ul[data-type="taskList"] > li > label > span { display: none; }
    ul[data-type="taskList"] > li > div { min-width: 0; }
    ul[data-type="taskList"] > li > div > p { margin: 0; }
    ul[data-type="taskList"] > li[data-checked="true"] > div > p {
      opacity: 0.62;
      text-decoration: line-through;
    }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #d0d7de; padding: 0.45em 0.6em; }
    mark { background: #fff2a8; }
    @media print {
      body { margin: 0; max-width: none; padding: 0; }
    }
  </style>
</head>
<body>
  <h1 class="note-title">${escapeHtml(title || "Untitled")}</h1>
  <main>
${body}
  </main>
</body>
</html>`;
}

async function collectResolvedImageSources(
  markdown: string,
  resolveImageSrc?: (src: string) => string | Promise<string>,
) {
  const sources = new Set<string>();
  markdown.replace(/!\[[^\]]*]\(([^)]+)\)/g, (_match, src: string) => {
    sources.add(src);
    return _match;
  });
  markdown.replace(/<img\s[^>]*\bsrc="([^"]+)"/gi, (_match, src: string) => {
    sources.add(src.replace(/&quot;/g, '"'));
    return _match;
  });

  const resolved = new Map<string, string>();
  await Promise.all(Array.from(sources).map(async (src) => {
    try {
      resolved.set(src, resolveImageSrc ? await resolveImageSrc(src) : src);
    } catch {
      resolved.set(src, src);
    }
  }));
  return resolved;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
