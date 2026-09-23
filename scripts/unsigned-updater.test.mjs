import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { NsisUpdater } from 'electron-updater/out/NsisUpdater.js';
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor.js';
import { NodeHttpExecutor } from 'builder-util/out/nodeHttpExecutor.js';

// Exercise the real NSIS updater and checksum pipeline; only substitute its
// Electron network transport so this test can also run under Node on Linux.
it('downloads unsigned updates, rejects altered bytes, and retains publisher verification in signed mode', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opentig-unsigned-updater-'));
  const bytes = Buffer.from('unsigned installer fixture; never executed');
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  let corrupt = false;
  const server = createServer((request, response) => {
    if (request.url.startsWith('/latest.yml')) {
      response.end(stringify({ version: '0.2.0', files: [{ url: 'Setup.exe', sha512, size: bytes.length }], path: 'Setup.exe', sha512 }));
    } else if (request.url.startsWith('/Setup.exe')) {
      response.end(corrupt ? Buffer.alloc(bytes.length) : bytes);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const mode of ['unsigned', 'corrupt', 'signed']) {
      corrupt = mode === 'corrupt';
      const config = path.join(root, `${mode}.yml`);
      await writeFile(config, stringify({ provider: 'generic', url, updaterCacheDirName: mode, ...(mode === 'signed' ? { publisherName: ['OpenTig Test'] } : {}) }));
      const app = { version: '0.1.0', name: 'OpenTig', isPackaged: true, appUpdateConfigPath: config,
        userDataPath: root, baseCachePath: root, whenReady: async () => {}, quit: vi.fn(), onQuit: vi.fn() };
      const updater = new NsisUpdater(null, app);
      updater.logger = null;
      const executor = new ElectronHttpExecutor(null);
      executor.createRequest = NodeHttpExecutor.prototype.createRequest;
      updater.httpExecutor = executor;
      updater._testOnlyOptions = { platform: 'win32' };
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.disableDifferentialDownload = true;
      updater.disableWebInstaller = true;
      const signature = vi.fn(async () => 'Unexpected signing publisher');
      updater.verifyUpdateCodeSignature = signature;
      const downloaded = vi.fn();
      updater.on('update-downloaded', downloaded);
      expect((await updater.checkForUpdates()).updateInfo.version).toBe('0.2.0');
      expect(downloaded).not.toHaveBeenCalled();
      if (mode === 'unsigned') {
        const [file] = await updater.downloadUpdate();
        expect(await readFile(file)).toEqual(bytes);
        expect(downloaded).toHaveBeenCalledOnce();
        expect(signature).not.toHaveBeenCalled();
      } else {
        await expect(updater.downloadUpdate()).rejects.toThrow(mode === 'corrupt' ? /checksum/i : /not signed by the application owner/);
        expect(downloaded).not.toHaveBeenCalled();
        if (mode === 'signed') expect(signature).toHaveBeenCalledOnce();
        else expect(signature).not.toHaveBeenCalled();
      }
      expect(app.quit).not.toHaveBeenCalled();
      expect(app.onQuit).not.toHaveBeenCalled();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
