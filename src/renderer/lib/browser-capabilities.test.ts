import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileCutTransferId, openExternalUrl, readClipboardText, writeClipboardText, writeFileTransfer } from './browser-capabilities';

afterEach(() => vi.unstubAllGlobals());

describe('browser capabilities', () => {
  it('uses the browser text clipboard without preload IPC', async () => {
    const readText = vi.fn(async () => 'copied');
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { readText, writeText } });

    await expect(readClipboardText()).resolves.toBe('copied');
    await writeClipboardText('next');

    expect(readText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('next');
  });

  it('retains cut intent only for the matching file transfer', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await writeFileTransfer(['C:\\repo\\one.txt'], 'transfer-id');
    expect(fileCutTransferId(['C:\\repo\\one.txt'])).toBe('transfer-id');
    expect(fileCutTransferId(['C:\\repo\\other.txt'])).toBeNull();

    await writeFileTransfer(['C:\\repo\\one.txt'], 'next-transfer');
    await writeClipboardText('C:\\repo\\one.txt');
    expect(fileCutTransferId(['C:\\repo\\one.txt'])).toBeNull();
  });

  it('opens only canonical web or mail URLs through window interception', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    openExternalUrl('//example.com/pull/1');
    expect(open).toHaveBeenCalledWith('https://example.com/pull/1', '_blank', 'noopener,noreferrer');
    expect(() => openExternalUrl('file:///secret')).toThrow('Only web or mail links can be opened.');
    expect(open).toHaveBeenCalledOnce();
  });
});
