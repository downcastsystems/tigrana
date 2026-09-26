import { describe, it, expect, vi } from 'vitest';
import { runDocumentWorker } from './documentOperation';
describe('document worker cancellation', () => {
  it('terminates conversion and rejects without returning bytes to save', async () => {
    const controller = new AbortController();
    const worker = { terminate: vi.fn(), postMessage: vi.fn(), onmessage: null, onerror: null };
    const progress = vi.fn(async () => {});
    const task = runDocumentWorker(worker as unknown as Worker, {}, { signal: controller.signal, progress, commit: progress });
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('does not start a worker when cancellation already happened', async () => {
    const controller = new AbortController(); controller.abort();
    const worker = { terminate: vi.fn(), postMessage: vi.fn() };
    const progress = vi.fn(async () => {});
    await expect(runDocumentWorker(worker as unknown as Worker, {}, { signal: controller.signal, progress, commit: progress })).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
