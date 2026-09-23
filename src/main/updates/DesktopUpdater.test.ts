import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdater } from 'electron-updater';
import { DesktopUpdater } from './DesktopUpdater';
import { installedUpdateRepository, type UpdateInstallation } from './update-eligibility';

function fixture() {
  const engine = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: { version: '0.2.0' } })),
    downloadUpdate: vi.fn(async () => { engine.emit('update-downloaded', { version: '0.2.0' }); return []; }),
    quitAndInstall: vi.fn(), autoDownload: true, autoInstallOnAppQuit: true, allowPrerelease: true, allowDowngrade: true,
  });
  const close = vi.fn();
  const service = new DesktopUpdater(engine as unknown as AppUpdater, '0.1.0', 'jorgefl8/opentig', close);
  return { engine, service, close };
}
afterEach(() => vi.useRealTimers());

describe('desktop update lifecycle', () => {
  it('requires explicit download and install, drains the app separately, and never installs on ordinary quit', async () => {
    const { engine, service, close } = fixture();
    expect(engine.autoDownload).toBe(false);
    expect(engine.autoInstallOnAppQuit).toBe(false);
    expect(engine.allowPrerelease).toBe(false);
    expect(engine.allowDowngrade).toBe(false);
    await service.install();
    expect(close).not.toHaveBeenCalled();
    await service.check();
    expect(service.getStatus().phase).toBe('available');
    expect(engine.downloadUpdate).not.toHaveBeenCalled();
    await service.download();
    expect(service.getStatus().phase).toBe('ready');
    await service.install();
    expect(close).toHaveBeenCalledOnce();
    expect(engine.quitAndInstall).not.toHaveBeenCalled();
    service.cancelInstall();
    expect(service.getStatus().phase).toBe('ready');
    expect(service.installRequested).toBe(false);
    await service.install();
    service.stop();
    service.finishInstall();
    expect(engine.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true);
    service.finishInstall();
    expect(engine.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('coalesces overlapping checks and keeps a downloaded update ready', async () => {
    const { engine, service } = fixture();
    await Promise.all([service.check(), service.check(), service.check()]);
    expect(engine.checkForUpdates).toHaveBeenCalledOnce();
    await service.download();
    await service.check();
    expect(service.getStatus().phase).toBe('ready');
    expect(engine.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('handles missing releases/network/signature failures without ever installing and can retry', async () => {
    const { engine, service } = fixture();
    engine.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    expect((await service.check()).phase).toBe('error');
    await service.check();
    engine.downloadUpdate.mockImplementationOnce(async () => { engine.emit('error', new Error('invalid signature')); throw new Error('invalid signature'); });
    expect((await service.download()).phase).toBe('error');
    await service.install();
    expect(engine.quitAndInstall).not.toHaveBeenCalled();
    await service.check();
    await service.download();
    expect(service.getStatus().phase).toBe('ready');
  });

  it('checks on focus after 30 minutes, throttles repeated focus, and reschedules polling', async () => {
    vi.useFakeTimers();
    const { engine, service } = fixture();
    engine.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false, updateInfo: { version: '0.1.0' } });
    service.start();
    service.checkIfDue();
    expect(engine.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    service.checkIfDue();
    expect(engine.checkForUpdates).toHaveBeenCalledOnce();
    // Simulate a suspended machine: wall time advances before overdue timers run.
    vi.setSystemTime(Date.now() + 31 * 60 * 1_000);
    service.checkIfDue();
    service.checkIfDue();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29 * 60 * 1_000);
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60 * 1_000);
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(3);
    service.stop();
    vi.setSystemTime(Date.now() + 31 * 60 * 1_000);
    service.checkIfDue();
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(3);
  });

  it('starts once and checks periodically; stopping and unavailable builds never check', async () => {
    vi.useFakeTimers();
    const { engine, service } = fixture();
    engine.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false, updateInfo: { version: '0.1.0' } });
    service.start(); service.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.checkForUpdates).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000);
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(2);
    service.stop();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000);
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(2);
    const disabled = new DesktopUpdater(null, '0.1.0', null, vi.fn());
    disabled.start();
    expect((await disabled.check()).phase).toBe('unavailable');
    expect((await disabled.download()).phase).toBe('unavailable');
    expect((await disabled.install()).phase).toBe('unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });
});

const installed: UpdateInstallation = {
  profile: 'production', packaged: true, platform: 'win32', version: '0.1.0',
  executable: 'C:\\Users\\test\\AppData\\Local\\Programs\\OpenTig\\OpenTig.exe',
  registeredDirectory: 'C:\\Users\\test\\AppData\\Local\\Programs\\OpenTig',
  manifest: { version: '0.1.0', profile: 'production', platform: 'win32', arch: 'x64', distribution: 'installer', release: true, signedRelease: false, updateRepository: 'jorgefl8/opentig' },
};
describe('update installation eligibility', () => {
  it('allows only the actual installed Windows release, whether unsigned or signed', () => {
    expect(installedUpdateRepository(installed)).toBe('jorgefl8/opentig');
    expect(installedUpdateRepository({ ...installed, manifest: { ...(installed.manifest as object), signedRelease: true } })).toBe('jorgefl8/opentig');
    expect(installedUpdateRepository({ ...installed, registeredDirectory: installed.registeredDirectory!.toUpperCase() + '\\' })).toBe('jorgefl8/opentig');
    for (const override of [
      { profile: 'dev' }, { packaged: false }, { platform: 'linux' }, { registeredDirectory: null },
      { executable: 'D:\\copied-app\\OpenTig.exe' }, { version: '0.2.0' }, { manifest: null },
    ]) expect(installedUpdateRepository({ ...installed, ...override })).toBeNull();
    for (const override of [{ distribution: 'zip' }, { release: false }, { release: undefined }, { signedRelease: undefined }, { updateRepository: 'https://example.com' }, { profile: 'dev' }, { arch: 'arm64' }]) {
      expect(installedUpdateRepository({ ...installed, manifest: { ...(installed.manifest as object), ...override } })).toBeNull();
    }
  });
});
