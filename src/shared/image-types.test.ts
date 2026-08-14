import { describe, expect, it } from 'vitest';
import {
  detectRasterImageMime,
  isKnownImagePath,
  isRasterImagePath,
  isSvgPath,
} from './image-types';

const ascii = (value: string) => [...value].map((character) => character.charCodeAt(0));

describe('image path detection', () => {
  it.each([
    'asset.png',
    'PHOTO.JPEG',
    'animation.APNG',
    'icons/app.ico',
    String.raw`icons\pointer.CUR`,
    'photo.pjpeg',
    'graphic.avif',
  ])('recognizes raster image path %s', (filePath) => {
    expect(isRasterImagePath(filePath)).toBe(true);
  });

  it('separates SVG from raster formats', () => {
    expect(isSvgPath('diagram.SVG')).toBe(true);
    expect(isRasterImagePath('diagram.svg')).toBe(false);
  });

  it.each(['scan.tiff', 'photo.HEIC', 'design.psd', 'camera.nef', 'art.xcf'])(
    'recognizes known unsupported image path %s',
    (filePath) => {
      expect(isKnownImagePath(filePath)).toBe(true);
      expect(isRasterImagePath(filePath)).toBe(false);
    },
  );

  it.each(['README.md', 'archive.zip', 'png', '.gitignore'])('rejects non-image path %s', (filePath) => {
    expect(isKnownImagePath(filePath)).toBe(false);
    expect(isSvgPath(filePath)).toBe(false);
  });
});

describe('detectRasterImageMime', () => {
  it.each([
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
    ['JPEG', [0xff, 0xd8, 0xff, 0xe0], 'image/jpeg'],
    ['GIF87a', ascii('GIF87a'), 'image/gif'],
    ['GIF89a', ascii('GIF89a'), 'image/gif'],
    ['WebP', [...ascii('RIFF'), 12, 0, 0, 0, ...ascii('WEBP')], 'image/webp'],
    ['BMP', ascii('BM'), 'image/bmp'],
    ['ICO', [0, 0, 1, 0], 'image/x-icon'],
    ['CUR', [0, 0, 2, 0], 'image/x-icon'],
    ['AVIF major brand', [0, 0, 0, 24, ...ascii('ftyp'), ...ascii('avif'), 0, 0, 0, 0, ...ascii('mif1')], 'image/avif'],
    ['AVIF compatible brand', [0, 0, 0, 24, ...ascii('ftyp'), ...ascii('mif1'), 0, 0, 0, 0, ...ascii('avif')], 'image/avif'],
    ['AVIF sequence brand', [0, 0, 0, 24, ...ascii('ftyp'), ...ascii('avis'), 0, 0, 0, 0, ...ascii('mif1')], 'image/avif'],
  ])('detects %s', (_name, bytes, expected) => {
    expect(detectRasterImageMime(Uint8Array.from(bytes as number[]))).toBe(expected);
  });

  it.each([
    [[]],
    [[0x89, 0x50, 0x4e]],
    [ascii('RIFFxxxxNOPE')],
    [[0, 0, 0, 16, ...ascii('ftyp'), ...ascii('mp42'), 0, 0, 0, 0]],
    [ascii('<html>')],
    [[0x50, 0x4b, 0x03, 0x04]],
  ])('rejects truncated or unrelated bytes', (bytes) => {
    expect(detectRasterImageMime(Uint8Array.from(bytes))).toBeNull();
  });
});
