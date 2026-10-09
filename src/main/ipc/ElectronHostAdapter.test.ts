import type { BrowserWindow, ClipboardItem } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  clipboard: { read: vi.fn<() => Promise<ClipboardItem[]>>() },
  nativeImage: { createFromBuffer: vi.fn() },
}));
vi.mock('electron', () => ({ ...electron, dialog: {}, shell: {} }));
import { createElectronHostAdapter } from './ElectronHostAdapter';

const host = () => createElectronHostAdapter({} as BrowserWindow);
const item = (type: string, value: string) => ({ types: [type], getType: vi.fn(async () => new Blob([value])) }) as unknown as ClipboardItem;

describe('Electron clipboard image adapter', () => {
  beforeEach(() => {
    electron.nativeImage.createFromBuffer.mockReset();
    electron.nativeImage.createFromBuffer.mockReturnValue({ isEmpty: () => false, toPNG: () => Buffer.from('normalized png') });
  });

  it('prefers PNG across clipboard items and awaits its bytes', async () => {
    const jpeg = item('image/jpeg', 'jpeg bytes');
    const png = item('image/png', 'png bytes');
    electron.clipboard.read.mockResolvedValue([jpeg, png]);
    expect(await host().readClipboardImagePng()).toEqual(Buffer.from('normalized png'));
    expect(electron.nativeImage.createFromBuffer).toHaveBeenCalledWith(Buffer.from('png bytes'));
    expect(jpeg.getType).not.toHaveBeenCalled();
  });

  it('normalizes JPEG-only clipboard images to PNG', async () => {
    electron.clipboard.read.mockResolvedValue([item('image/jpeg', 'jpeg bytes')]);
    expect(await host().readClipboardImagePng()).toEqual(Buffer.from('normalized png'));
    expect(electron.nativeImage.createFromBuffer).toHaveBeenCalledWith(Buffer.from('jpeg bytes'));
  });

  it('returns null for text-only and empty clipboards', async () => {
    electron.clipboard.read.mockResolvedValueOnce([item('text/plain', 'hello')]).mockResolvedValueOnce([]);
    expect(await host().readClipboardImagePng()).toBeNull();
    expect(await host().readClipboardImagePng()).toBeNull();
    expect(electron.nativeImage.createFromBuffer).not.toHaveBeenCalled();
  });

  it('ignores undecodable images and examines the next supported payload', async () => {
    electron.clipboard.read.mockResolvedValue([item('image/png', 'broken'), item('image/jpeg', 'valid')]);
    electron.nativeImage.createFromBuffer.mockReturnValueOnce({ isEmpty: () => true });
    expect(await host().readClipboardImagePng()).toEqual(Buffer.from('normalized png'));
    expect(electron.nativeImage.createFromBuffer).toHaveBeenLastCalledWith(Buffer.from('valid'));
  });

  it('surfaces asynchronous clipboard errors to the IPC boundary', async () => {
    electron.clipboard.read.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    await expect(host().readClipboardImagePng()).rejects.toThrow('Clipboard unavailable');
    const unavailable = item('image/png', '');
    vi.mocked(unavailable.getType).mockRejectedValueOnce(new Error('Image unavailable'));
    electron.clipboard.read.mockResolvedValueOnce([unavailable]);
    await expect(host().readClipboardImagePng()).rejects.toThrow('Image unavailable');
  });
});
