import { describe, expect, it } from 'vitest';
import { parseClipboardPathText, parseFileClipboardBuffer } from './ClipboardFileTransfer';

describe('clipboard file transfer parsing', () => {
  it('parses Windows FileNameW data', () => {
    const buffer = Buffer.from('C:\\work\\image.png\0D:\\notes\\file.txt\0\0', 'utf16le');
    expect(parseFileClipboardBuffer('FileNameW', buffer)).toEqual([
      'C:\\work\\image.png',
      'D:\\notes\\file.txt',
    ]);
  });

  it('parses a wide CF_HDROP payload', () => {
    const paths = Buffer.from('C:\\one.txt\0C:\\two.png\0\0', 'utf16le');
    const buffer = Buffer.alloc(20 + paths.length);
    buffer.writeUInt32LE(20, 0);
    buffer.writeUInt32LE(1, 16);
    paths.copy(buffer, 20);
    expect(parseFileClipboardBuffer('CF_HDROP', buffer)).toEqual(['C:\\one.txt', 'C:\\two.png']);
  });

  it('parses quoted paths and file URIs while ignoring arbitrary text', () => {
    expect(parseClipboardPathText('"C:\\work\\file.txt"\nfile:///C:/work/image.png\nhello')).toEqual([
      'C:\\work\\file.txt',
      'C:\\work\\image.png',
    ]);
  });

  it('returns no paths for empty or unrelated buffers', () => {
    expect(parseFileClipboardBuffer('FileNameW', new Uint8Array())).toEqual([]);
    expect(parseFileClipboardBuffer('text/plain', Buffer.from('hello'))).toEqual([]);
  });
});
