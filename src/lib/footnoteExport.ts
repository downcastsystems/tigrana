import { footnoteKey, parseFootnotes } from "./footnotes";

/** Replace editor controls with portable, numbered endnotes and real link targets. */
export function exportFootnotes(html: string, prefix: string) {
  if (!html.includes('data-type="footnote')) return html;
  const document = new DOMParser().parseFromString(html, "text/html");
  const definitions = new Map<string, Element>();
  document.querySelectorAll('[data-type="footnoteDefinition"]').forEach(node => {
    const key = footnoteKey(node.getAttribute("data-label") ?? "");
    if (!definitions.has(key)) definitions.set(key, node);
  });
  const entries = new Map<string, { id: string; number: string; references: string[] }>();
  document.querySelectorAll('[data-type="footnoteReference"]').forEach((node, index) => {
    const key = footnoteKey(node.getAttribute("data-label") ?? "");
    if (!entries.has(key)) entries.set(key, { id: `${prefix}_fn_${entries.size + 1}`, number: String(entries.size + 1), references: [] });
    const entry = entries.get(key)!;
    const id = `${prefix}_ref_${index + 1}`;
    entry.references.push(id);
    const sup = document.createElement("sup");
    sup.className = "export-footnote-reference";
    const link = document.createElement("a");
    link.id = id;
    link.href = `#${entry.id}`;
    link.textContent = entry.number;
    link.setAttribute("aria-label", `Footnote ${entry.number}`);
    link.style.textDecoration = "none";
    link.setAttribute("data-pdfmake", JSON.stringify({ decoration: [], sup: true }));
    sup.append(link);
    node.replaceWith(sup);
  });
  for (const key of definitions.keys()) {
    if (!entries.has(key)) entries.set(key, { id: `${prefix}_fn_${entries.size + 1}`, number: "–", references: [] });
  }
  if (!entries.size) return html;
  const section = document.createElement("section");
  section.className = "export-footnotes";
  const heading = document.createElement("h2");
  heading.textContent = "Footnotes";
  heading.style.fontSize = "12pt";
  section.append(heading);
  const table = document.createElement("table");
  table.className = "export-footnote-table";
  table.setAttribute("role", "presentation");
  table.setAttribute("data-pdfmake", JSON.stringify({ layout: "noBorders", widths: [20, "*"], dontBreakRows: false }));
  const tbody = document.createElement("tbody");
  table.append(tbody);
  section.append(table);
  for (const [key, entry] of entries) {
    const row = document.createElement("tr");
    const marker = document.createElement("td");
    marker.className = "export-footnote-number";
    const number = document.createElement(entry.references.length ? "a" : "span");
    number.id = entry.id;
    number.textContent = entry.number;
    if (entry.references.length) number.setAttribute("href", `#${entry.references[0]}`);
    number.style.textDecoration = "none";
    number.setAttribute("data-pdfmake", JSON.stringify({ decoration: [] }));
    const markerParagraph = document.createElement("p");
    markerParagraph.style.margin = "0";
    markerParagraph.append(number);
    marker.append(markerParagraph);
    const content = document.createElement("td");
    const definition = definitions.get(key);
    content.innerHTML = definition?.querySelector(":scope > .footnote-content")?.innerHTML ?? "<p>Footnote text is missing.</p>";
    for (const cell of [marker, content]) {
      cell.style.border = "none";
      cell.style.fontSize = "10pt";
      cell.style.verticalAlign = "top";
    }
    content.querySelectorAll<HTMLElement>("p").forEach(p => { p.style.margin = "0 0 4pt"; });
    row.append(marker, content);
    tbody.append(row);
  }
  document.querySelectorAll('[data-type="footnoteDefinition"]').forEach(node => node.remove());
  document.body.append(section);
  return document.body.innerHTML;
}

export const exportFootnoteCss = `
  .export-footnote-reference { font-size: .75em; line-height: 0; vertical-align: super; }
  .export-footnote-reference a, .export-footnote-number a { text-decoration: none; }
  .export-footnotes { margin-top: 1.5em; border-top: 1px solid #d0d7de; padding-top: .5em; }
  .export-footnotes h2 { margin: 0 0 .5em; break-after: avoid; }
  .export-footnote-table { margin: 0; table-layout: fixed; }
  .export-footnote-table > tbody > tr > td { border: none; padding: 0 0 .5em; overflow-wrap: anywhere; }
  .export-footnote-table .export-footnote-number { width: 2em; }
  .export-footnote-table > tbody > tr { break-inside: auto; }
  .export-footnotes p { orphans: 2; widows: 2; }
`;

/** Combined Markdown documents need unique labels even when source notes reuse [^1]. */
export function namespaceFootnoteMarkdown(markdown: string, prefix: string) {
  const { references, definitions } = parseFootnotes(markdown);
  const labels = new Map<string, string>();
  const replacement = (label: string) => {
    const key = footnoteKey(label);
    if (!labels.has(key)) labels.set(key, `${prefix}-${labels.size + 1}`);
    return `[^${labels.get(key)}]`;
  };
  const edits = [
    ...references.map(ref => ({ from: ref.from, to: ref.to, text: replacement(ref.label) })),
    ...definitions.map(def => ({ from: def.from, to: def.from + def.label.length + 3, text: replacement(def.label) })),
  ].sort((a, b) => b.from - a.from);
  for (const edit of edits) markdown = markdown.slice(0, edit.from) + edit.text + markdown.slice(edit.to);
  return markdown;
}
