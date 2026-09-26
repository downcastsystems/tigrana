import { installWorkerDom } from './workerDom';
installWorkerDom();
self.onmessage = async event => {
  try {
    const { htmlToMarkdown } = await import('./markdown');
    self.postMessage({ result: htmlToMarkdown(event.data) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
