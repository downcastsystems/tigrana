import type { ThemeAsset } from './themeDesign';

// Stored assets retain the theme package's existing budget. Larger source
// images are resized locally; the user's original file is never changed.
const storedImageLimit = 2_100_000;
const sourceImageLimit = 25 * 1024 * 1024;

export async function readBackgroundImage(file: File): Promise<ThemeAsset> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp'
    : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : null;
  if (!mime) throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (file.size > sourceImageLimit) throw new Error('Choose an image no larger than 25 MB.');

  let source: Blob = file;
  if (file.size > storedImageLimit) {
    const url = URL.createObjectURL(file);
    const canvas = document.createElement('canvas');
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('This image could not be read. Choose another PNG, JPEG, or WebP image.'));
        image.src = url;
      });
      const { naturalWidth: width, naturalHeight: height } = image;
      if (!width || !height || width * height > 40_000_000) {
        throw new Error('Choose a background image with no more than 40 megapixels.');
      }
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This image could not be resized. Choose a smaller image.');
      // Start below the original size and cap wallpaper dimensions. PNG keeps
      // its transparency; WebKit can return PNG when WebP encoding is absent.
      let scale = Math.min(0.85, 2560 / Math.max(width, height));
      for (let attempt = 0; attempt < 8; attempt++) {
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, 0.9));
        if (!blob) throw new Error('This image could not be resized. Choose a smaller image.');
        if (blob.size <= storedImageLimit) { source = blob; break; }
        scale *= Math.min(0.85, Math.sqrt(storedImageLimit / blob.size) * 0.95);
      }
      if (source === file) throw new Error('This image could not be resized enough. Choose a smaller image.');
    } finally {
      URL.revokeObjectURL(url);
      canvas.width = canvas.height = 0;
    }
  }

  const bytes = new Uint8Array(await source.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { mime: source === file ? mime : source.type, data: btoa(binary) };
}

export function backgroundImageExtension(asset: ThemeAsset) {
  return asset.mime === 'image/jpeg' ? 'jpg' : asset.mime === 'image/webp' ? 'webp' : 'png';
}
