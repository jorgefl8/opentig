import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ClipboardItem } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { parseClipboardPathText, readClipboardFilePaths } from './ClipboardFileTransfer';

function item(text: string, types = ['text/uri-list']) {
  return { types, getType: vi.fn(async () => new Blob([text])) } as unknown as ClipboardItem;
}

describe('clipboard file transfer parsing', () => {
  it('parses quoted paths and file URIs while ignoring arbitrary text', () => {
    expect(parseClipboardPathText('"C:\\work\\file.txt"\nfile:///C:/work/image.png\nhello', 'win32')).toEqual([
      'C:\\work\\file.txt',
      'C:\\work\\image.png',
    ]);
  });

  it('parses Linux file URIs and absolute paths', () => {
    expect(parseClipboardPathText('/tmp/file.txt\nfile:///tmp/an%20image.png\nhello', 'linux')).toEqual(['/tmp/file.txt', '/tmp/an image.png']);
  });

  it('parses encoded native file URIs on Windows and macOS', () => {
    expect(parseClipboardPathText('file:///C:/work/an%20image.png\r\nfile://server/share/a.txt', 'win32')).toEqual(['C:\\work\\an image.png', '\\\\server\\share\\a.txt']);
    expect(parseClipboardPathText('file:///Users/example/an%20image.png', 'darwin')).toEqual(['/Users/example/an image.png']);
  });

  it('reads all asynchronous URI items and text, retaining only unique existing files and folders', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-clipboard-test-'));
    try {
      const file = path.join(root, 'an image ü.png');
      const folder = path.join(root, 'folder');
      await writeFile(file, 'fixture');
      await mkdir(folder);
      const ignored = item(path.join(root, 'missing'), ['text/html']);
      const first = item(`# copied files\r\n${pathToFileURL(file).href}\r\nhttps://example.com/file`);
      const second = item(pathToFileURL(folder).href);
      const clipboard = { read: vi.fn(async () => [ignored, first, second]), readText: vi.fn(async () => `"${file}"\n${path.join(root, 'missing')}\nrelative.txt`) };
      expect(await readClipboardFilePaths(clipboard)).toEqual([file, folder]);
      expect(ignored.getType).not.toHaveBeenCalled();
      expect(first.getType).toHaveBeenCalledWith('text/uri-list');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('keeps the text fallback when an advertised URI payload disappears', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-clipboard-test-'));
    try {
      const file = path.join(root, 'fixture.txt');
      await writeFile(file, 'fixture');
      const unavailable = item('');
      vi.mocked(unavailable.getType).mockRejectedValueOnce(new Error('Clipboard owner closed'));
      expect(await readClipboardFilePaths({ read: async () => [unavailable], readText: async () => file })).toEqual([file]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('returns no files for an empty clipboard and surfaces read failures', async () => {
    expect(await readClipboardFilePaths({ read: async () => [], readText: async () => 'hello' })).toEqual([]);
    await expect(readClipboardFilePaths({ read: async () => { throw new Error('Clipboard unavailable'); }, readText: async () => '' })).rejects.toThrow('Clipboard unavailable');
  });
});
