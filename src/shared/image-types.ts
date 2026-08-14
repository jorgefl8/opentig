export type RasterImageMime =
  | 'image/png'
  | 'image/apng'
  | 'image/avif'
  | 'image/gif'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/bmp'
  | 'image/x-icon';

const RASTER_EXTENSIONS = new Set([
  'png',
  'apng',
  'avif',
  'gif',
  'jpg',
  'jpeg',
  'jfif',
  'pjpeg',
  'pjp',
  'webp',
  'bmp',
  'ico',
  'cur',
]);

const KNOWN_UNSUPPORTED_IMAGE_EXTENSIONS = new Set([
  'tif',
  'tiff',
  'heic',
  'heif',
  'psd',
  'raw',
  'dng',
  'cr2',
  'cr3',
  'nef',
  'arw',
  'orf',
  'rw2',
  'eps',
  'xcf',
]);

export function isRasterImagePath(filePath: string): boolean {
  return RASTER_EXTENSIONS.has(extensionOf(filePath));
}

export function isSvgPath(filePath: string): boolean {
  return extensionOf(filePath) === 'svg';
}

export function isKnownImagePath(filePath: string): boolean {
  const extension = extensionOf(filePath);
  return RASTER_EXTENSIONS.has(extension) || KNOWN_UNSUPPORTED_IMAGE_EXTENSIONS.has(extension);
}

export function detectRasterImageMime(bytes: Uint8Array): RasterImageMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a')) return 'image/gif';
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) return 'image/webp';
  if (isAvif(bytes)) return 'image/avif';
  if (asciiAt(bytes, 0, 'BM')) return 'image/bmp';
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00]) || startsWith(bytes, [0x00, 0x00, 0x02, 0x00])) return 'image/x-icon';
  return null;
}

function extensionOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  if (bytes.length < offset + value.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || !asciiAt(bytes, 4, 'ftyp')) return false;
  const boxSize = (
    (bytes[0]! * 0x1000000)
    + (bytes[1]! << 16)
    + (bytes[2]! << 8)
    + bytes[3]!
  );
  if (boxSize !== 0 && boxSize < 16) return false;
  const availableEnd = Math.min(bytes.length, boxSize === 0 ? bytes.length : boxSize, 256);
  for (let offset = 8; offset + 4 <= availableEnd; offset += 4) {
    if (asciiAt(bytes, offset, 'avif') || asciiAt(bytes, offset, 'avis')) return true;
  }
  return false;
}
