import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { browserCommand, openSystemBrowser } from './browser';

describe('OpenTig browser launcher', () => {
  it('uses argument arrays and platform-native launchers', () => {
    const url = 'http://127.0.0.1:6767/pair#token=value&safe=true';
    expect(browserCommand(url, 'win32')).toEqual({ executable: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] });
    expect(browserCommand(url, 'darwin')).toEqual({ executable: 'open', args: [url] });
    expect(browserCommand(url, 'linux')).toEqual({ executable: 'xdg-open', args: [url] });
  });

  it('reports launch failures without invoking a shell', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const launch = vi.fn(() => child);
    const opened = openSystemBrowser('http://127.0.0.1:6767', launch as never, 'linux');
    child.emit('error', new Error('missing'));
    await expect(opened).rejects.toThrow('missing');
    expect(launch).toHaveBeenCalledWith('xdg-open', ['http://127.0.0.1:6767'], expect.objectContaining({ shell: false }));
  });
});
