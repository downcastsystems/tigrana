import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { escapeImportText as esc, nearestImportColor, type ImportedDocument } from './documentImport';
import { cancelled, type DocumentControl } from './documentOperation';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function importPdf(data: ArrayBuffer, control: DocumentControl): Promise<ImportedDocument> {
  cancelled(control.signal);
  const loading = pdfjs.getDocument({ data, fontExtraProperties: true, useSystemFonts: true, cMapUrl: new URL('/pdfjs/cmaps/', location.href).href, cMapPacked: true, wasmUrl: new URL('/pdfjs/wasm/', location.href).href });
  const abort = () => { void loading.destroy(); };
  control.signal.addEventListener('abort', abort, { once: true });
  const result: ImportedDocument = { html: '', assets: [], warnings: [] };
  try {
    const pdf = await loading.promise;
    let normal = Infinity;
    let assetBytes = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      await control.progress(`Reading PDF page ${number} of ${pdf.numPages}…`, number - 1, pdf.numPages);
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: Math.min(1.5, 1800 / Math.max(...page.view.slice(2))) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Could not render this PDF.');
      const rendering = page.render({ canvas, canvasContext: context, viewport });
      const stop = () => rendering.cancel();
      control.signal.addEventListener('abort', stop, { once: true });
      try { await rendering.promise; } finally { control.signal.removeEventListener('abort', stop); }
      const text = await page.getTextContent();
      const items = text.items.filter(item => 'str' in item).filter(item => item.str.trim());
      const capture = async (x: number, y: number, width: number, height: number) => {
        x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
        width = Math.min(canvas.width - x, Math.ceil(width)); height = Math.min(canvas.height - y, Math.ceil(height));
        if (width < 4 || height < 4) return '';
        const crop = document.createElement('canvas'); crop.width = width; crop.height = height;
        crop.getContext('2d')!.drawImage(canvas, x, y, width, height, 0, 0, width, height);
        const blob = await new Promise<Blob | null>(resolve => crop.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Could not preserve a PDF image.');
        cancelled(control.signal);
        const token = `tigrana-import-${crypto.randomUUID()}`;
        assetBytes += blob.size;
        if (assetBytes > 200 * 1024 * 1024) throw new Error('The extracted images exceed the 200 MB import limit.');
        result.assets.push({ token, name: `pdf-page-${number}-${result.assets.length + 1}.png`, mime: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()) });
        return `<p><img src="${token}" alt="Image from PDF page ${number}"></p>`;
      }
      if (!items.length) {
        result.html += await capture(0, 0, canvas.width, canvas.height);
        if (!result.warnings.length) result.warnings.push('Pages without selectable text were preserved as images. Text recognition (OCR) is not included.');
      } else {
        const sizes = new Map<number, number>();
        for (const item of items) {
          const size = Math.round(Math.hypot(item.transform[2], item.transform[3]) * 10) / 10;
          if (size) sizes.set(size, (sizes.get(size) ?? 0) + item.str.length);
        }
        const commonSize = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] || 12;
        normal = Math.min(normal, commonSize);
        type Line = { y: number; height: number; parts: { x: number; width: number; html: string }[] };
        const lines: Line[] = [];
        for (const [itemIndex, item] of items.entries()) {
          if (itemIndex % 100 === 0) await control.progress(`Reading PDF page ${number} of ${pdf.numPages}…`, number - 1, pdf.numPages);
          const matrix = pdfjs.Util.transform(viewport.transform, item.transform);
          const height = Math.hypot(matrix[2], matrix[3]);
          const x = matrix[4], y = matrix[5];
          let line = lines.find(l => Math.abs(l.y - y) < Math.max(2, height * .25));
          if (!line) { line = { y, height, parts: [] }; lines.push(line); }
          line.height = Math.max(line.height, height);
          let value = esc(item.str);
          const font = (page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName)?.name : '') || text.styles[item.fontName]?.fontFamily || item.fontName;
          if (/bold/i.test(font)) value = `<strong>${value}</strong>`;
          if (/italic|oblique/i.test(font)) value = `<em>${value}</em>`;
          const sx = Math.max(0, Math.floor(x)), sy = Math.max(0, Math.floor(y - height));
          const sw = Math.min(canvas.width - sx, Math.ceil(item.width * viewport.scale)), sh = Math.min(canvas.height - sy, Math.ceil(height));
          if (sw > 0 && sh > 0) {
            const pixels = context.getImageData(sx, sy, sw, sh).data;
            let best = 40, color = '', coloredPixels = 0, inkPixels = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
              if (Math.min(...rgb) < 180) inkPixels++;
              const saturation = Math.max(...rgb) - Math.min(...rgb);
              if (saturation > 40 && Math.min(...rgb) < 180) coloredPixels++;
              if (saturation > best) { best = saturation; color = '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join(''); }
            }
            const mapped = coloredPixels > inkPixels * .3 ? nearestImportColor(color) : null;
            if (mapped) value = `<span style="color: ${mapped}">${value}</span>`;
          }
          line.parts.push({ x, width: item.width * viewport.scale, html: value });
        }
        lines.sort((a, b) => a.y - b.y);
        let table = false;
        for (const line of lines) {
          line.parts.sort((a, b) => a.x - b.x);
          const cells: string[] = [];
          for (const [index, part] of line.parts.entries()) {
            const previous = line.parts[index - 1];
            if (!previous || part.x - previous.x - previous.width > normal * viewport.scale * .8) cells.push(part.html);
            else cells[cells.length - 1] += ' ' + part.html;
          }
          if (cells.length > 1) {
            if (!table) result.html += '<table>';
            table = true; result.html += '<tr>' + cells.map(cell => `<td>${cell}</td>`).join('') + '</tr>';
          } else {
            if (table) { result.html += '</table>'; table = false; }
            const ratio = line.height / viewport.scale / normal;
            const tag = ratio > 1.65 ? 'h1' : ratio > 1.3 ? 'h2' : 'p';
            result.html += `<${tag}>${cells.join(' ')}</${tag}>`;
          }
        }
        if (table) result.html += '</table>';
        const ops = await page.getOperatorList();
        let transform = viewport.transform;
        const stack: number[][] = [];
        for (let i = 0; i < ops.fnArray.length; i++) {
          const op = ops.fnArray[i], args = ops.argsArray[i];
          if (op === pdfjs.OPS.save) stack.push([...transform]);
          else if (op === pdfjs.OPS.restore) transform = stack.pop() ?? viewport.transform;
          else if (op === pdfjs.OPS.transform) transform = pdfjs.Util.transform(transform, args);
          else if (op === pdfjs.OPS.paintImageXObject || op === pdfjs.OPS.paintInlineImageXObject) {
            const points = [[0, 0], [1, 0], [0, 1], [1, 1]].map(p => { pdfjs.Util.applyTransform(p, transform); return p; });
            const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
            result.html += await capture(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
          }
        }
      }
      canvas.width = canvas.height = 0;
      page.cleanup();
      cancelled(control.signal);
    }
    return result;
  } finally {
    control.signal.removeEventListener('abort', abort);
    await loading.destroy();
  }
}
