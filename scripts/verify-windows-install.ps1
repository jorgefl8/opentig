$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Installer smoke runs only on a disposable GitHub Windows runner.'
}
$dataDirectory = Join-Path $env:APPDATA 'OpenTig'
$registration = 'HKCU:\Software\OpenTig'
if ((Test-Path $dataDirectory) -or (Test-Path $registration)) {
  throw 'Refusing to test over existing OpenTig data or an existing installation.'
}
$testRoot = Join-Path $env:RUNNER_TEMP ('opentig-install-' + [guid]::NewGuid().ToString('N'))
$installed = Join-Path $testRoot 'app'
$installer = Get-Item 'out/make/production/win32-x64/*Setup.exe'
if (@($installer).Count -ne 1) { throw 'Expected exactly one installer.' }
New-Item -ItemType Directory -Path $testRoot, $dataDirectory | Out-Null
$sentinel = Join-Path $dataDirectory 'installer-smoke.txt'
Set-Content -LiteralPath $sentinel -Value 'preserve-user-data' -NoNewline
function Invoke-Installer([string]$Phase, [string]$Executable, [string]$Arguments, [int]$TimeoutSeconds = 300) {
  # Allow time for scanning and extraction on busy hosted runners.
  # Keep a bounded wait, with separate diagnostics for install and uninstall.
  Write-Host "${Phase}: starting (timeout: ${TimeoutSeconds}s)."
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru
  try {
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      # Terminate the NSIS child processes as well as the original launcher.
      try { $process.Kill($true) } catch { Write-Warning "${Phase}: could not stop process tree: $($_.Exception.Message)" }
      throw "${Phase} timed out after ${TimeoutSeconds}s."
    }
    if ($process.ExitCode -ne 0) { throw "${Phase} failed with exit code $($process.ExitCode)." }
    Write-Host "${Phase}: completed in $([math]::Round($timer.Elapsed.TotalSeconds, 1))s."
  } finally {
    $process.Dispose()
  }
}
function Remove-SmokeDirectory([string]$Path) {
  # The NSIS uninstaller can still be removing itself when verification finishes.
  # Cleanup must not replace the outcome of the actual installation assertions.
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    try {
      if (-not (Test-Path -LiteralPath $Path)) { return }
      Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      return
    } catch {
      if ($attempt -eq 4) {
        Write-Warning "Temporary installer-test cleanup incomplete at '${Path}': $($_.Exception.Message)"
      } else {
        Start-Sleep -Milliseconds 250
      }
    }
  }
}
try {
  Invoke-Installer 'Installation' $installer.FullName "/S /D=$installed"
  if (-not (Test-Path (Join-Path $installed 'OpenTig.exe'))) { throw 'Installed application missing.' }
  if ((Get-ItemPropertyValue $registration 'InstallLocation') -ne $installed) { throw 'Install registration does not match the executable location.' }
  if ((Get-Content -Raw $sentinel) -ne 'preserve-user-data') { throw 'Installation changed existing data.' }
  $uninstaller = Join-Path $installed 'Uninstall OpenTig.exe'
  if (-not (Test-Path $uninstaller)) { throw 'Uninstaller missing.' }
  Invoke-Installer 'Uninstallation' $uninstaller '/S'
  $deadline = (Get-Date).AddSeconds(30)
  while ((Test-Path (Join-Path $installed 'OpenTig.exe')) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (Test-Path (Join-Path $installed 'OpenTig.exe')) { throw 'Uninstaller left the application installed.' }
  if (Test-Path $registration) { throw 'Uninstaller left the install registration behind.' }
  if ((Get-Content -Raw $sentinel) -ne 'preserve-user-data') { throw 'Uninstall removed application data.' }
  Write-Output 'WINDOWS_INSTALL_UNINSTALL_DATA_OK'
} finally {
  # Both locations were absent before this disposable-runner test.
  Remove-SmokeDirectory $dataDirectory
  Remove-SmokeDirectory $testRoot
}
