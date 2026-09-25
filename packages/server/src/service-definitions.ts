import path from 'node:path';

export function renderSystemdUnit(input: {
  nodeExecutable: string;
  cliEntrypoint: string;
  host: string;
  port: number;
  home: string;
  environmentPath?: string | undefined;
}): string {
  const args = [
    input.nodeExecutable,
    input.cliEntrypoint,
    'serve',
    '--host', input.host,
    '--port', String(input.port),
    '--home', input.home,
  ];
  return `[Unit]
Description=OpenTig browser Git client
After=network.target

[Service]
Type=simple
WorkingDirectory=${systemdWorkingDirectory(input.home)}
ExecStart=${args.map(arg => systemdQuote(arg.replaceAll('$', () => '$$'))).join(' ')}
Environment=NODE_ENV=production
${input.environmentPath === undefined ? '' : `Environment=${systemdQuote(`PATH=${input.environmentPath}`)}\n`}Restart=on-failure
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=10

[Install]
WantedBy=default.target
`;
}

function systemdQuote(value: string): string {
  if (value.includes('\0') || value.includes('\r') || value.includes('\n')) throw new Error('Service paths and arguments cannot contain control characters.');
  return `"${value.replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function systemdWorkingDirectory(value: string): string {
  if (!path.isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error('Service home must be an absolute single-line path.');
  // Unlike ExecStart, this setting is a literal path, not a list of quoted
  // arguments. A final slash also protects trailing spaces/backslashes from
  // the unit file's whitespace trimming and line continuation handling.
  return `${value.replaceAll('%', '%%')}/`;
}

export type ServiceDefinitionInput = Parameters<typeof renderSystemdUnit>[0];

export function xml(value: string): string {
  if ([...value].some(char => char.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(char))) throw new Error('Service arguments cannot contain control characters.');
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
export function serviceOwnerMarker(home: string): string { return `OpenTig CLI home: ${Buffer.from(home, 'utf8').toString('base64')}`; }
export function psQuote(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
export function encodedPowerShell(script: string): string { return Buffer.from(script, 'utf16le').toString('base64'); }
export function serviceArgs(input: ServiceDefinitionInput): string[] {
  return [input.cliEntrypoint, 'serve', '--host', input.host, '--port', String(input.port), '--home', input.home];
}
export function renderLaunchAgent(input: ServiceDefinitionInput, label: string): string {
  const args = [input.nodeExecutable, ...serviceArgs(input)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(input.home)}</string>
<key>EnvironmentVariables</key><dict>
<key>NODE_ENV</key><string>production</string>
<key>OPENTIG_SERVICE_HOME</key><string>${xml(input.home)}</string>
${input.environmentPath === undefined ? '' : `<key>PATH</key><string>${xml(input.environmentPath)}</string>`}
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>3</integer>
<key>ExitTimeOut</key><integer>10</integer>
</dict></plist>
`;
}

/** Keep a recognizable parent attached so service stop can terminate its process tree. */
export function windowsServerScript(input: ServiceDefinitionInput): string {
  return `$ErrorActionPreference = 'Stop'; $env:NODE_ENV = 'production'; $env:OPENTIG_SERVICE_HOME = ${psQuote(input.home)}; `
    + (input.environmentPath === undefined ? '' : `$env:PATH = ${psQuote(input.environmentPath)}; `)
    + `& ${[input.nodeExecutable, ...serviceArgs(input)].map(psQuote).join(' ')} *> $null; exit $LASTEXITCODE`;
}
export function renderWindowsTask(input: { name: string; sid: string; powershell: string; script: string; home: string; worker?: boolean }): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>${serviceOwnerMarker(input.home)}</Description></RegistrationInfo>
<Triggers>${input.worker ? '' : `<LogonTrigger><Enabled>true</Enabled><UserId>${xml(input.sid)}</UserId></LogonTrigger>`}</Triggers>
<Principals><Principal id="Owner"><UserId>${xml(input.sid)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><ExecutionTimeLimit>${input.worker ? 'PT5M' : 'PT0S'}</ExecutionTimeLimit>${input.worker ? '' : '<RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>'}</Settings>
<Actions Context="Owner"><Exec><Command>${xml(input.powershell)}</Command><Arguments>-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encodedPowerShell(input.script)}</Arguments><WorkingDirectory>${xml(input.home)}</WorkingDirectory></Exec></Actions>
</Task>`;
}
