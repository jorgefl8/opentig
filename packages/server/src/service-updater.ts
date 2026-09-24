import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DESKTOP_UPDATE_CHECK_INTERVAL_MS, type DesktopUpdateStatus, type DesktopUpdatesApi } from '../../../src/shared/desktop-updates';
import { atomicWrite, execute, newerVersion, packageDirectory, readInstallation, SERVICE_NAME, serviceUnitPath, stableVersion, systemctl, type ServiceInstallation } from './service-installation';

const REPOSITORY = 'jorgefl8/opentig';
const REGISTRY = 'https://registry.npmjs.org';
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
export interface CliRelease { version: string; url: string; notes: string | null; tarball: string; integrity: string }
export interface ServiceUpdateBackend {
  release(): Promise<CliRelease | null>;
  stage(release: CliRelease, progress: (value: number) => void): Promise<void>;
  install(release: CliRelease): Promise<void>;
}
export class ServiceUpdater implements DesktopUpdatesApi {
  private status: DesktopUpdateStatus;
  private offered: CliRelease | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private work: Promise<void> | null = null;
  constructor(version: string, private readonly backend: ServiceUpdateBackend | null, failedUpdate = false) {
    this.status = { phase: backend ? (failedUpdate ? 'error' : 'idle') : 'unavailable', currentVersion: version, availableVersion: null,
      progress: null, checkedAt: null, releaseUrl: null, releaseNotes: null,
      message: backend ? (failedUpdate ? 'The new server could not start. The previous version was restored. Check for updates to retry.' : null) : 'Browser updates require an OpenTig Linux service. Install with opentig service install; temporary CLI and Dev instances are updated from the terminal.' };
  }
  getStatus = async () => ({ ...this.status });
  start() { if (this.backend && this.status.phase !== 'error') this.schedule(10_000); }
  async stop() { this.stopped = true; clearTimeout(this.timer); await this.work; }
  private schedule(delay = DESKTOP_UPDATE_CHECK_INTERVAL_MS) {
    clearTimeout(this.timer);
    if (!this.stopped) { this.timer = setTimeout(() => void this.check(), delay); this.timer.unref(); }
  }
  check = async (): Promise<DesktopUpdateStatus> => {
    if (!this.backend || this.stopped || !['idle', 'error'].includes(this.status.phase)) return this.getStatus();
    this.status = { ...this.status, phase: 'checking', message: null, progress: null };
    try {
      const release = await this.backend.release();
      this.offered = release && newerVersion(release.version, this.status.currentVersion) ? release : null;
      this.status = { ...this.status, phase: this.offered ? 'available' : 'idle', availableVersion: this.offered?.version ?? null,
        releaseUrl: this.offered?.url ?? null, releaseNotes: this.offered?.notes ?? null, checkedAt: new Date().toISOString() };
    } catch { this.fail('Could not check for updates. Check your connection and try again.'); }
    finally { this.schedule(); }
    return this.getStatus();
  };
  download = async (): Promise<DesktopUpdateStatus> => {
    if (!this.backend || !this.offered || this.stopped || this.status.phase !== 'available') return this.getStatus();
    this.status = { ...this.status, phase: 'downloading', progress: 0, message: null };
    this.work = this.backend.stage(this.offered, (progress) => { this.status.progress = progress; })
      .then(() => { this.status = { ...this.status, phase: 'ready', progress: 100 }; })
      .catch(() => this.fail('Could not prepare the update. The running service has not been replaced.'));
    // Downloads include dependency preparation; do not hold an HTTP request open.
    return this.getStatus();
  };
  install = async (): Promise<DesktopUpdateStatus> => {
    if (!this.backend || !this.offered || this.stopped || this.status.phase !== 'ready') return this.getStatus();
    this.status = { ...this.status, phase: 'installing', message: 'Restarting the server. This browser will reconnect shortly.' };
    // The external worker restarts this process. Never keep its shutdown waiting
    // for the worker to finish starting the replacement server.
    void this.backend.install(this.offered).catch(() => {
      this.fail('Could not apply the update. Check the service status and try again.');
    });
    return this.getStatus();
  };
  private fail(message: string) { this.status = { ...this.status, phase: 'error', progress: null, message }; }
}

async function json(url: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Release metadata request failed.');
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error('Release metadata is too large.');
  return JSON.parse(text);
}
export async function latestCliRelease(): Promise<CliRelease | null> {
  const release = await json(`https://api.github.com/repos/${REPOSITORY}/releases/latest`);
  if (!release || release.draft || release.prerelease || typeof release.tag_name !== 'string') return null;
  const version = release.tag_name.replace(/^v/, '');
  if (!stableVersion(version) || release.tag_name !== `v${version}`) return null;
  const pkg = await json(`${REGISTRY}/@opentig%2fcli/${version}`);
  // npm's publication scan can finish after GitHub publication; offer only installable versions.
  if (!pkg) return null;
  const dist = pkg.dist as { tarball?: unknown; integrity?: unknown } | undefined;
  const tarball = `${REGISTRY}/@opentig/cli/-/cli-${version}.tgz`;
  if (pkg.name !== '@opentig/cli' || pkg.version !== version || dist?.tarball !== tarball
    || typeof dist.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(dist.integrity)) throw new Error('Invalid CLI release metadata.');
  return { version, tarball, integrity: dist.integrity, url: `https://github.com/${REPOSITORY}/releases/tag/v${version}`,
    notes: typeof release.body === 'string' ? release.body.slice(0, 64_000) : null };
}
export function verifyTarball(bytes: Uint8Array, integrity: string): void {
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity) throw new Error('CLI download integrity mismatch.');
}
export async function stageCliRelease(home: string, release: CliRelease, progress: (value: number) => void): Promise<void> {
  if (!stableVersion(release.version)) throw new Error('Invalid update version.');
  const existing = path.join(home, 'service', `app-${release.version}`);
  try {
    const marker = JSON.parse(await readFile(path.join(existing, 'update-integrity.json'), 'utf8'));
    if (marker.version !== release.version || marker.integrity !== release.integrity) throw new Error('Existing candidate does not match the release.');
    progress(100); return;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = await mkdtemp(path.join(home, 'service/.download-'));
  try {
    const response = await fetch(release.tarball, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error('CLI download failed.');
    const total = Number(response.headers.get('content-length'));
    if (total > MAX_PACKAGE_BYTES) throw new Error('CLI package too large.');
    let size = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_PACKAGE_BYTES) throw new Error('CLI package too large.');
      chunks.push(chunk);
      progress(Number.isFinite(total) && total > 0 ? Math.min(85, size / total * 85) : 0);
    }
    const bytes = Buffer.concat(chunks);
    verifyTarball(bytes, release.integrity);
    const tarball = path.join(temporary, 'cli.tgz');
    await writeFile(tarball, bytes, { mode: 0o600 });
    const target = path.join(temporary, 'app');
    await mkdir(target);
    await execute('npm', ['install', '--prefix', target, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--registry', REGISTRY, tarball], { timeout: 180_000, maxBuffer: 2_000_000 });
    const pkgRoot = path.join(target, 'node_modules/@opentig/cli');
    const pkg = JSON.parse(await readFile(path.join(pkgRoot, 'package.json'), 'utf8'));
    if (pkg.name !== '@opentig/cli' || pkg.version !== release.version) throw new Error('Installed CLI identity mismatch.');
    const result = await execute(process.execPath, [path.join(pkgRoot, 'dist/bin.mjs'), '--version'], {
      timeout: 15_000, env: { ...process.env, OPENTIG_DELEGATED: '1' },
    });
    if (result.stdout.trim() !== release.version) throw new Error('New CLI cannot run.');
    await readFile(path.join(pkgRoot, 'dist/client/index.html'));
    await readFile(path.join(pkgRoot, 'dist/service-update.mjs'));
    progress(95);
    // The current version is never a download target. Existing candidates are immutable.
    const destination = path.join(home, 'service', `app-${release.version}`);
    await atomicWrite(path.join(target, 'update-integrity.json'), JSON.stringify({ version: release.version, integrity: release.integrity }));
    await rename(target, destination);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
export async function createServiceUpdater(home: string, version: string, profile: string, address: { host: string; port: number }): Promise<ServiceUpdater> {
  let installation: ServiceInstallation | null = null;
  try {
    if (profile === 'production' && process.platform === 'linux' && process.env.INVOCATION_ID) {
      installation = await readInstallation(home);
      if (!installation || installation.version !== version || installation.host !== address.host || installation.port !== address.port
        || await systemctl('show', SERVICE_NAME, '--property=FragmentPath', '--value') !== serviceUnitPath()
        || await realpath(process.argv[1]!) !== await realpath(path.join(packageDirectory(home, installation), 'dist/bin.mjs'))
        || await systemctl('show', SERVICE_NAME, '--property=MainPID', '--value') !== String(process.pid)) installation = null;
    }
  } catch { installation = null; }
  if (!installation) return new ServiceUpdater(version, null);
  const current = installation;
  let failedUpdate = false;
  try {
    const result = JSON.parse(await readFile(path.join(home, 'service/update-result.json'), 'utf8'));
    failedUpdate = result.success === false && result.version === version;
  } catch { /* No earlier update result. */ }
  const updater = new ServiceUpdater(version, {
    release: latestCliRelease,
    stage: (release, progress) => stageCliRelease(home, release, progress),
    install: async (release) => {
      const lock = path.join(home, 'service/update-lock');
      await mkdir(lock, { mode: 0o700 });
      const unit = `opentig-update-${randomUUID()}`;
      try {
        const next: ServiceInstallation = { ...current, version: release.version, layout: 'npm', environmentPath: process.env.PATH ?? current.environmentPath };
        const previousUnit = await readFile(serviceUnitPath(), 'utf8');
        await atomicWrite(path.join(lock, 'plan.json'), JSON.stringify({ home, current, next, previousUnit, integrity: release.integrity }));
        await execute('systemd-run', ['--user', '--collect', '--unit', unit, '--property=Type=exec',
          process.execPath, path.join(packageDirectory(home, current), 'dist/service-update.mjs'), home], { timeout: 15_000 });
      } catch (error) { await rm(lock, { recursive: true, force: true }); throw error; }
      // A successful restart terminates this old server (and this observer).
      // A worker that exits before restarting must not leave the UI locked.
      for (let attempt = 0; attempt < 120; attempt++) {
        await delay(1000);
        const state = await systemctl('show', unit, '--property=ActiveState', '--value').catch(() => 'inactive');
        if (!['active', 'activating', 'deactivating'].includes(state)) {
          await rm(lock, { recursive: true, force: true });
          throw new Error('Update worker exited without replacing the server.');
        }
      }
      throw new Error('Update worker did not restart the service.');
    },
  }, failedUpdate);
  return updater;
}
