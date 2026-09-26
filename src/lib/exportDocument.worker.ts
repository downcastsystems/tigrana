import { installWorkerDom } from "./workerDom";
installWorkerDom();
self.onmessage = async event => {
  try {
    const { createPdf, createWordDocument } = await import('./exportFormats');
    const { html, title, format } = event.data;
    const result = await (format === 'pdf' ? createPdf(html, title, true) : createWordDocument(html, title, true));
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
