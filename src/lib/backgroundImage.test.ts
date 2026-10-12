// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { backgroundImageExtension, readBackgroundImage } from './backgroundImage';

const fileWithBytes = (name: string, bytes: number[]) => {
  const file = new File([new Uint8Array(bytes)], name);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes).buffer });
  return file;
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  ['small.PNG', 'image/png', [137, 80, 78, 71, 13, 10, 26, 10]],
  ['small.jpeg', 'image/jpeg', [255, 216, 255]],
  ['small.webp', 'image/webp', [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]],
] as const)('keeps small %s bytes intact', async (name, mime, bytes) => {
  const asset = await readBackgroundImage(fileWithBytes(name, [...bytes]));
  expect(asset).toEqual({ mime, data: btoa(String.fromCharCode(...bytes)) });
});

function largeImage(width = 1920, height = 1076, decode = true) {
  const file = fileWithBytes('large.webp', []);
  Object.defineProperty(file, 'size', { value: 3_258_585 });
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:background'), revokeObjectURL: revoke });
  vi.stubGlobal('Image', class {
    naturalWidth = width;
    naturalHeight = height;
    onload?: () => void;
    onerror?: () => void;
    set src(_value: string) { queueMicrotask(() => decode ? this.onload?.() : this.onerror?.()); }
  });
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob');
  return { file, revoke, draw, encode };
}

it('retries oversized encodings and uses the actual MIME when WebKit falls back to PNG', async () => {
  const { file, revoke, draw, encode } = largeImage();
  encode.mockImplementationOnce(callback => callback(new Blob([new Uint8Array(2_200_000)], { type: 'image/png' })));
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  Object.defineProperty(blob, 'arrayBuffer', { value: async () => new Uint8Array([137, 80, 78, 71]).buffer });
  encode.mockImplementationOnce(callback => callback(blob));
  const asset = await readBackgroundImage(file);
  expect(asset.mime).toBe('image/png');
  expect(backgroundImageExtension(asset)).toBe('png');
  expect(draw.mock.calls.map(call => call.slice(1))).toEqual([[0, 0, 1632, 915], [0, 0, 1387, 777]]);
  expect(revoke).toHaveBeenCalledWith('blob:background');
});

it('releases the source URL on decode failure', async () => {
  const { file, revoke } = largeImage(1920, 1076, false);
  await expect(readBackgroundImage(file)).rejects.toThrow('could not be read');
  expect(revoke).toHaveBeenCalledOnce();
});

it('rejects excessive decoded dimensions before allocating a canvas', async () => {
  const { file, draw, revoke } = largeImage(10000, 10000);
  await expect(readBackgroundImage(file)).rejects.toThrow('40 megapixels');
  expect(draw).not.toHaveBeenCalled();
  expect(revoke).toHaveBeenCalledOnce();
});

it('reports encoding failures and releases the source URL', async () => {
  const { file, revoke, encode } = largeImage();
  encode.mockImplementationOnce(callback => callback(null));
  await expect(readBackgroundImage(file)).rejects.toThrow('could not be resized');
  expect(revoke).toHaveBeenCalledOnce();
});

it('bounds resize attempts when the browser cannot fit the stored asset budget', async () => {
  const { file, revoke, encode } = largeImage();
  encode.mockImplementation(callback => callback(new Blob([new Uint8Array(2_200_000)], { type: 'image/png' })));
  await expect(readBackgroundImage(file)).rejects.toThrow('could not be resized enough');
  expect(encode).toHaveBeenCalledTimes(8);
  expect(revoke).toHaveBeenCalledOnce();
});
