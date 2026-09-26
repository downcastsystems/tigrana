import { DOMParser as Parser, Node, Element } from 'linkedom';
/** Linkedom requires an explicit body for HTML fragments used by the PDF writer. */
class PortableDOMParser {
  parseFromString(html: string, type: "text/html" | "text/xml" | "image/svg+xml") {
    return new Parser().parseFromString(type === 'text/html' && !/<html[\s>]/i.test(html)
      ? `<!doctype html><html><head></head><body>${html}</body></html>` : html, type);
  }
}
export function installWorkerDom() {
  Object.assign(globalThis, { DOMParser: PortableDOMParser, Node, Element, window: { DOMParser: PortableDOMParser } });
}
