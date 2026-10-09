import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const loadModule = createRequire(import.meta.url);
const electron = loadModule('electron');
const execFileAsync = promisify(execFile);

// This check replaces the system clipboard. Run in a disposable desktop/CI
// session, not alongside a user's active clipboard contents.
if (typeof electron === 'string') {
  const { build } = await import('vite');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-clipboard-build-'));
  try {
    await build({
      configFile: false,
      publicDir: false,
      logLevel: 'error',
      build: {
        outDir: directory,
        ssr: fileURLToPath(new URL('../src/main/ipc/ElectronHostAdapter.ts', import.meta.url)),
        rollupOptions: { external: ['electron', /^node:/], output: { format: 'cjs', entryFileNames: 'host.cjs' } },
      },
    });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const flags = process.argv.slice(2);
    const result = spawnSync(electron, [...flags, fileURLToPath(import.meta.url), path.join(directory, 'host.cjs')], { env, stdio: 'inherit', timeout: 60_000 });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally { await rm(directory, { recursive: true, force: true }); }
} else {
  const { app, clipboard, ClipboardItem, nativeImage } = electron;
  app.whenReady().then(async () => {
    const { createElectronHostAdapter } = loadModule(process.argv.at(-1));
    const host = createElectronHostAdapter({});
    const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-clipboard-native-'));
    try {
      const file = path.join(directory, 'file with spaces ü.txt');
      const folder = path.join(directory, 'folder');
      await writeFile(file, 'fixture');
      await mkdir(folder);
      await clipboard.write([new ClipboardItem({ 'text/uri-list': [file, folder].map(value => pathToFileURL(value).href).join('\r\n') })]);
      assert.deepEqual(await host.readClipboardFilePaths(), [file, folder]);
      await clipboard.writeText(`"${file}"\n${file}\n${path.join(directory, 'missing.txt')}`);
      assert.deepEqual(await host.readClipboardFilePaths(), [file]);
      assert.equal(await host.readClipboardImagePng(), null);

      const image = nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 });
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })]);
      assertPng(await host.readClipboardImagePng(), nativeImage);

      if (process.platform === 'win32') {
        const env = { ...process.env, OPENTIG_CLIPBOARD_FILES: JSON.stringify([file, folder]) };
        await powershell('$files = New-Object System.Collections.Specialized.StringCollection; $files.AddRange([string[]] (ConvertFrom-Json $env:OPENTIG_CLIPBOARD_FILES)); [System.Windows.Forms.Clipboard]::SetFileDropList($files)', env);
        assert.deepEqual(await host.readClipboardFilePaths(), [file, folder]);
        const imagePath = path.join(directory, 'image.png');
        await writeFile(imagePath, image.toPNG());
        await powershell('$image = [System.Drawing.Image]::FromFile($env:OPENTIG_CLIPBOARD_IMAGE); try { [System.Windows.Forms.Clipboard]::SetImage($image) } finally { $image.Dispose() }', { ...process.env, OPENTIG_CLIPBOARD_IMAGE: imagePath });
        assertPng(await host.readClipboardImagePng(), nativeImage);
        process.stdout.write('WINDOWS_NATIVE_CLIPBOARD_OK\n');
      }
      clipboard.clear();
      assert.deepEqual(await host.readClipboardFilePaths(), []);
      assert.equal(await host.readClipboardImagePng(), null);
      process.stdout.write('ELECTRON_CLIPBOARD_SMOKE_OK\n');
    } finally {
      clipboard.clear();
      await rm(directory, { recursive: true, force: true });
    }
    app.exit(0);
  }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    app.exit(1);
  });
}

function assertPng(bytes, nativeImage) {
  assert.ok(Buffer.isBuffer(bytes));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(nativeImage.createFromBuffer(bytes).getSize(), { width: 1, height: 1 });
}

async function powershell(command, env) {
  const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; ${command}`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env, windowsHide: true, timeout: 15_000 });
}
