import { printCurrentWebview } from "./desktop";

let disposePrevious: (() => void) | undefined;

/** Keep prepared content until afterprint (or the next print), since native dialogs can return early. */
export async function printDocument(html: string) {
  disposePrevious?.();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const host = document.createElement("div");
  host.id = "tigrana-print-document";
  host.style.display = "none";
  const shadow = host.attachShadow({ mode: "open" });
  for (const style of parsed.head.querySelectorAll("style")) shadow.append(style.cloneNode(true));
  shadow.append(parsed.body);
  const isolation = document.createElement("style");
  isolation.textContent = `@media print {
    @page { margin: 18mm; }
    html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; background: white !important; }
    body > :not(#tigrana-print-document) { display: none !important; }
    #tigrana-print-document { display: block !important; color-scheme: light; }
  }`;
  document.head.append(isolation);
  document.body.append(host);
  const cleanup = () => {
    host.remove(); isolation.remove();
    window.removeEventListener("afterprint", cleanup);
    if (disposePrevious === cleanup) disposePrevious = undefined;
  };
  disposePrevious = cleanup;
  window.addEventListener("afterprint", cleanup, { once: true });
  try {
    await Promise.all(Array.from(shadow.querySelectorAll("img")).map(async image => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([image.decode(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("An image could not be loaded for printing. Try again when it is available.")), 15000);
        })]);
      } finally { clearTimeout(timer); }
    }));
    await document.fonts?.ready;
    await printCurrentWebview();
  } catch (error) {
    cleanup();
    throw error;
  }
}
