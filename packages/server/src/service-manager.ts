import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicWrite, execute, SERVICE_NAME, serviceUnitPath, systemctl, type ServiceInstallation } from './service-installation';
import { encodedPowerShell, psQuote, renderLaunchAgent, renderSystemdUnit, renderWindowsTask, windowsServerScript, serviceOwnerMarker, xml, type ServiceDefinitionInput } from './service-definitions';

export type ServiceManagerKind = 'systemd' | 'launchd' | 'windows-task';
export interface ServiceState { running: boolean; enabled: boolean; starting?: boolean; pid?: number }
export interface ServiceWorker { running(): Promise<boolean>; cleanup(): Promise<void> }
export interface ServiceManager {
  kind: ServiceManagerKind;
  location: string;
  startup: string;
  preflight(): Promise<void>;
  render(input: ServiceDefinitionInput): string;
  read(): Promise<string | null>;
  owns(definition: string): boolean;
  write(definition: string): Promise<void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
  remove(): Promise<void>;
  status(): Promise<ServiceState>;
  ownsProcess(): Promise<boolean>;
  launchWorker(node: string, entry: string): Promise<ServiceWorker>;
  cleanupWorker(id: string): Promise<void>;
}
async function fileOrNull(file: string): Promise<string | null> {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function writeDefinition(file: string, definition: string) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await atomicWrite(file, definition);
}
export function managerKind(platform = process.platform): ServiceManagerKind {
  if (platform === 'linux') return 'systemd';
  if (platform === 'darwin') return 'launchd';
  if (platform === 'win32') return 'windows-task';
  throw new Error('Managed CLI services support Linux, macOS, and Windows.');
}
export function assertManager(installation: ServiceInstallation, kind: ServiceManagerKind): void {
  // Schema 1 installations predating cross-platform support are Linux services.
  if ((installation.manager ?? 'systemd') !== kind) throw new Error('This service was installed for another operating system.');
}

/** Optional identity is only for isolated native integration tests, never CLI input. */
export async function createServiceManager(home: string, identity?: string): Promise<ServiceManager> {
  if (identity && !/^[a-zA-Z0-9.-]+$/.test(identity)) throw new Error('Invalid service identity.');
  switch (managerKind()) {
    case 'systemd': return linuxManager(home, identity);
    case 'launchd': return macManager(home, identity);
    case 'windows-task': return windowsManager(home, identity);
  }
}
function linuxManager(home: string, identity?: string): ServiceManager {
  const name = identity ? `${identity}.service` : SERVICE_NAME;
  const file = identity ? path.join(path.dirname(serviceUnitPath()), name) : serviceUnitPath();
  const status = async (): Promise<ServiceState> => {
    const properties = await systemctl('show', name, '--property=MainPID,ActiveState,UnitFileState');
    const values = Object.fromEntries(properties.split('\n').map(line => line.split('=')));
    return { running: values.ActiveState === 'active', enabled: values.UnitFileState === 'enabled', pid: Number(values.MainPID) };
  };
  return {
    kind: 'systemd', location: file, startup: 'Starts at boot and continues after logout (systemd user service with lingering).',
    preflight: async () => {
      await systemctl('show-environment');
      try { await execute('loginctl', ['enable-linger'], { timeout: 15_000 }); }
      catch { throw new Error('Lingering is required. Ask an administrator to run: sudo loginctl enable-linger <your-user>. Then retry service install as your normal user.'); }
    },
    render: renderSystemdUnit,
    read: () => fileOrNull(file),
    owns: definition => definition.includes(`WorkingDirectory=${home.replaceAll('%', '%%')}/\n`),
    write: definition => writeDefinition(file, definition),
    restart: async () => { await systemctl('daemon-reload'); await systemctl('enable', name); await systemctl('restart', name); },
    stop: async () => { await systemctl('disable', '--now', name); },
    remove: async () => { await rm(file, { force: true }); await systemctl('daemon-reload'); },
    status,
    ownsProcess: async () => Boolean(process.env.INVOCATION_ID)
      && await systemctl('show', name, '--property=FragmentPath', '--value') === file
      && (await status()).pid === process.pid,
    launchWorker: async (node, entry) => {
      const unit = `opentig-update-${randomUUID()}`;
      await execute('systemd-run', ['--user', '--collect', '--unit', unit, '--property=Type=exec', node, entry, home], { timeout: 15_000 });
      return { running: async () => ['active', 'activating', 'deactivating'].includes(await systemctl('show', unit, '--property=ActiveState', '--value').catch(() => 'inactive')), cleanup: async () => undefined };
    },
    cleanupWorker: async () => undefined,
  };
}
function macManager(home: string, identity?: string): ServiceManager {
  const label = identity ?? 'com.opentig.cli';
  const domain = `gui/${process.getuid!()}`;
  const job = `${domain}/${label}`;
  const file = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
  const launchctl = async (...args: string[]) => (await execute('/bin/launchctl', args, { timeout: 30_000 })).stdout;
  const inspect = async (target: string) => {
    try { return await launchctl('print', target); }
    catch (error) {
      // launchctl uses exit 113 for a missing service/domain.
      if ((error as { code?: number }).code === 113) return null;
      throw error;
    }
  };
  const stop = async () => {
    const info = await inspect(job);
    if (info === null) return;
    const pid = Number(info.match(/\bpid = (\d+)/)?.[1]);
    await launchctl('bootout', job);
    // bootout can return before launchd has reaped the process and released the
    // label. Reusing the label immediately can fail with bootstrap error 5.
    for (let i = 0; i < 150; i++) {
      let alive = false;
      if (pid > 0) {
        try { process.kill(pid, 0); alive = true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      }
      if (!alive && await inspect(job) === null) return;
      await delay(100);
    }
    throw new Error('The macOS service did not finish stopping.');
  };
  return {
    kind: 'launchd', location: file, startup: 'Starts at macOS login and stops at logout. Keep the user signed in and the Mac awake for remote access.',
    preflight: async () => {
      try { await launchctl('print', domain); }
      catch { throw new Error('No macOS login session is available. Sign in on the Mac, then run service install as that user.'); }
    },
    render: input => renderLaunchAgent(input, label),
    read: () => fileOrNull(file),
    owns: definition => definition.includes(`<key>OPENTIG_SERVICE_HOME</key><string>${xml(home)}</string>`),
    write: definition => writeDefinition(file, definition),
    restart: async () => { await stop(); await launchctl('enable', job); await launchctl('bootstrap', domain, file); },
    stop,
    remove: () => rm(file, { force: true }),
    status: async () => {
      const info = await inspect(job);
      const disabled = await launchctl('print-disabled', domain);
      return { running: /state = running/.test(info ?? ''), pid: Number(info?.match(/\bpid = (\d+)/)?.[1]), enabled: !disabled.includes(`"${label}" => true`) && await fileOrNull(file) !== null };
    },
    ownsProcess: async () => process.env.OPENTIG_SERVICE_HOME === home && Number((await inspect(job))?.match(/\bpid = (\d+)/)?.[1]) === process.pid,
    launchWorker: async (node, entry) => {
      const id = `com.opentig.update.${randomUUID()}`;
      await launchctl('submit', '-l', id, '--', node, entry, home, id);
      return { running: async () => /state = running/.test(await inspect(`${domain}/${id}`) ?? ''), cleanup: async () => { if (await inspect(`${domain}/${id}`) !== null) await launchctl('bootout', `${domain}/${id}`); } };
    },
    cleanupWorker: async id => { if (/^com\.opentig\.update\.[a-f0-9-]+$/.test(id)) await launchctl('bootout', `${domain}/${id}`); },
  };
}
async function windowsManager(home: string, identity?: string): Promise<ServiceManager> {
  const powershell = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const ps = async (script: string) => (await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(`$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ${script}`)], { timeout: 30_000, windowsHide: true, maxBuffer: 2_000_000 })).stdout.trim();
  const sid = await ps('[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
  if (!/^S-1-[\d-]+$/.test(sid)) throw new Error('Could not determine the Windows service owner.');
  const name = identity ?? `OpenTig CLI ${sid}`;
  const connection = "$scheduler = New-Object -ComObject 'Schedule.Service'; $scheduler.Connect(); $folder = $scheduler.GetFolder('\\'); ";
  const task = (taskName: string) => `${connection} $task = $null; try { $task = $folder.GetTask(${psQuote(taskName)}) } catch { $e = $_.Exception; while ($null -ne $e.InnerException) { $e = $e.InnerException }; if ($e.HResult -ne -2147024894) { throw } }; `;
  const register = async (taskName: string, definition: string) => {
    const file = path.join(home, 'service', `.task-${randomUUID()}.xml`);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      await writeFile(file, definition, { encoding: 'utf16le', mode: 0o600 });
      await ps(`${connection} $xml = [IO.File]::ReadAllText(${psQuote(file)}, [Text.Encoding]::Unicode); $null = $folder.RegisterTask(${psQuote(taskName)}, $xml, 6, ${psQuote(sid)}, $null, 3, $null)`);
    } finally { await rm(file, { force: true }); }
  };
  const stopTask = async (taskName: string) => {
    await ps(`${task(taskName)}
if ($null -ne $task) {
  $task.Enabled = $false
  $action = $task.Definition.Actions.Item(1)
  $arguments = [string]$action.Arguments
  if ($arguments -notmatch '-EncodedCommand ([A-Za-z0-9+/=]+)$') { throw 'Unexpected OpenTig task action' }
  $encoded = $Matches[1]
  $pattern = '(?i)(?:^|\\s)-EncodedCommand\\s+"?' + [regex]::Escape($encoded) + '"?\\s*$'
  # Stop the PowerShell wrapper AND its descendants before Scheduler loses the
  # parent PID. Stop() alone can leave Node running and holding the data directory.
  $wrappers = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object {
    $_.ExecutablePath -eq $action.Path -and $_.CommandLine -match $pattern
  })
  foreach ($wrapper in $wrappers) {
    $owner = Invoke-CimMethod -InputObject $wrapper -MethodName GetOwnerSid
    if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne ${psQuote(sid)}) { throw 'Cannot verify OpenTig task process owner' }
    & "$env:SystemRoot\\System32\\taskkill.exe" /PID $wrapper.ProcessId /T /F | Out-Null
    if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $wrapper.ProcessId -ErrorAction SilentlyContinue)) { throw 'OpenTig process tree did not stop' }
  }
  $task.Stop(0)
  for ($i = 0; $i -lt 100 -and $task.State -in @(2, 4); $i++) {
    Start-Sleep -Milliseconds 100
    $task = $folder.GetTask(${psQuote(taskName)})
  }
  if ($task.State -in @(2, 4)) { throw 'OpenTig task did not stop' }
}`);
  };
  const removeTask = async (taskName: string) => { await ps(`${task(taskName)} if ($null -ne $task) { $folder.DeleteTask(${psQuote(taskName)}, 0) }`); };
  const startTask = async (taskName: string) => { await ps(`${task(taskName)} if ($null -eq $task) { throw 'OpenTig task is missing' }; $task.Enabled = $true; $null = $task.Run($null)`); };
  const state = async (taskName: string): Promise<ServiceState> => JSON.parse(await ps(`${task(taskName)} @{ running = ($null -ne $task -and $task.State -eq 4); enabled = ($null -ne $task -and $task.Enabled); starting = ($null -ne $task -and $task.State -eq 2) } | ConvertTo-Json -Compress`));
  return {
    kind: 'windows-task', location: `Task Scheduler: ${name}`, startup: 'Starts at Windows login and stops at logout. Keep the user signed in and the PC awake for remote access.',
    preflight: async () => { await ps(connection); },
    render: input => renderWindowsTask({ name, sid, powershell, home, script: windowsServerScript(input) }),
    read: async () => await ps(`${task(name)} if ($null -ne $task) { $task.Xml }`) || null,
    owns: definition => definition.includes(`<Description>${serviceOwnerMarker(home)}</Description>`),
    // Stop using the OLD action before overwriting its identifying arguments.
    write: async definition => { await stopTask(name); await register(name, definition); },
    restart: async () => { await stopTask(name); await startTask(name); },
    stop: () => stopTask(name),
    remove: () => removeTask(name),
    status: () => state(name),
    ownsProcess: async () => process.env.OPENTIG_SERVICE_HOME === home && (await state(name)).running,
    launchWorker: async (node, entry) => {
      const id = `OpenTig Update ${randomUUID()}`;
      const script = `& ${[node, entry, home, id].map(psQuote).join(' ')}; exit $LASTEXITCODE`;
      await register(id, renderWindowsTask({ name: id, sid, powershell, script, home, worker: true }));
      try { await startTask(id); } catch (error) { await removeTask(id); throw error; }
      return { running: async () => { const current = await state(id); return current.running || current.starting === true; }, cleanup: async () => { await stopTask(id); await removeTask(id); } };
    },
    cleanupWorker: async id => { if (/^OpenTig Update [a-f0-9-]+$/.test(id)) await removeTask(id); },
  };
}
