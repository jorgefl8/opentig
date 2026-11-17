# OpenTig server installer for Windows PowerShell 5.1 and PowerShell 7.
#
#   irm https://opentig.com/install.ps1 | iex
#
# Read it before running it:
#
#   irm https://opentig.com/install.ps1
#
# The Windows desktop app from https://opentig.com already includes the
# OpenTig server. Use this script to run the server alone, in the background,
# and reach it from a paired browser.
#
# What it does:
#   1. Checks that Node.js 24 or later (with npx) and Git 2.31 or later are on
#      PATH. If one is missing or too old, it says what it found and where to
#      get it, then stops without changing anything.
#   2. Runs the OpenTig CLI's own background-service installation from npm:
#        npx --yes --package=@opentig/cli@latest opentig service install
#      That registers a Task Scheduler task for your user (it starts at login),
#      adds the opentig command (~\.opentig\bin) to your user Path, and, in an
#      interactive console, asks whether to pair a device now. Without one it
#      prints the pairing link instead of asking.
#
# What it does not do: install Node.js or Git, ask for administrator rights,
# or download anything other than the npm package. It never calls exit and
# leaves the session's variables and preferences as they were.
#
# Environment variables (set them first, for example $env:OPENTIG_VERSION = '1.0.0'):
#   OPENTIG_VERSION   CLI version to install, such as 1.0.0 (default: latest).
#   OPENTIG_PACKAGE   npm package to run instead, such as a local .tgz file
#                     (default: @opentig/cli@$OPENTIG_VERSION).
#   OPENTIG_HOST, OPENTIG_PORT, OPENTIG_HOME
#                     Listener address, port, and data directory, read by the
#                     CLI itself (defaults: 127.0.0.1, 6767, ~\.opentig).
#   NO_COLOR          Turns off colored output.
#
# Uninstall: opentig service uninstall
#
# Everything below is one script block that runs only once it has been read
# to its closing brace, so a download cut short runs nothing.

& {
  # These settings belong to this script block's scope and end with it.
  Set-StrictMode -Version 2.0
  $ErrorActionPreference = 'Continue'
  $PSNativeCommandUseErrorActionPreference = $false

  $onWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
  $useColor = -not $env:NO_COLOR -and -not [Console]::IsOutputRedirected

  function Write-Line([string] $Text, [string] $Color) {
    if ($useColor -and $Color) { Write-Host $Text -ForegroundColor $Color } else { Write-Host $Text }
  }

  # Prints the reason and how to fix it, then stops with an error.
  function Stop-Install([string] $Reason, [string[]] $Help) {
    Write-Line "error: $Reason" 'Red'
    foreach ($line in $Help) { Write-Line "  $line" }
    Write-Line 'Nothing was installed or changed.'
    throw 'OpenTig was not installed.'
  }

  # The path of a program on PATH; on Windows, its .exe or .cmd launcher.
  function Find-Program([string] $Name) {
    $names = if ($onWindows) { @("$Name.exe", "$Name.cmd") } else { @($Name) }
    foreach ($candidate in $names) {
      $command = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($command) { return $command.Path }
    }
    return $null
  }

  # The first line a program prints, or an empty string if it cannot run.
  function Read-FirstLine([string] $Program, [string[]] $Arguments) {
    try { return [string] (& $Program @Arguments 2>$null | Select-Object -First 1) } catch { return '' }
  }

  $nodeHelp = @('Install Node.js 24 or later from https://nodejs.org/en/download, open a new terminal, and run this installer again.')
  $gitHelp = @('Install Git 2.31 or later from https://git-scm.com/downloads, open a new terminal, and run this installer again.')

  $node = Find-Program 'node'
  if (-not $node) { Stop-Install 'Node.js 24 or later is required, but no node command was found on PATH.' $nodeHelp }
  $nodeVersion = (Read-FirstLine $node @('--version')) -replace '^v', ''
  if (-not ($nodeVersion -match '^(\d+)\.')) { Stop-Install "Node.js 24 or later is required, but $node did not report a Node.js version." $nodeHelp }
  if ([int] $Matches[1] -lt 24) { Stop-Install "Node.js 24 or later is required; found Node.js $nodeVersion at $node." $nodeHelp }

  $npx = Find-Program 'npx'
  if (-not $npx) {
    Stop-Install "npx, which comes with npm, was not found on PATH (Node.js $nodeVersion is at $node)." @('Install npm for this Node.js; the installers from https://nodejs.org/en/download include it. Then run this installer again.')
  }

  $git = Find-Program 'git'
  if (-not $git) { Stop-Install 'Git 2.31 or later is required, but no git command was found on PATH.' $gitHelp }
  $gitVersion = (Read-FirstLine $git @('--version')) -replace '^git version ', ''
  if (-not ($gitVersion -match '^(\d+)\.(\d+)')) { Stop-Install "Git 2.31 or later is required, but $git did not report a Git version." $gitHelp }
  $gitMajor = [int] $Matches[1]
  $gitMinor = [int] $Matches[2]
  if ($gitMajor -lt 2 -or ($gitMajor -eq 2 -and $gitMinor -lt 31)) { Stop-Install "Git 2.31 or later is required; found Git $gitVersion at $git." $gitHelp }

  $version = if ($env:OPENTIG_VERSION) { $env:OPENTIG_VERSION } else { 'latest' }
  $package = if ($env:OPENTIG_PACKAGE) { $env:OPENTIG_PACKAGE } else { "@opentig/cli@$version" }

  Write-Line 'Installing the OpenTig background service' 'Cyan'
  Write-Line "  Node.js  $nodeVersion ($node)"
  Write-Line "  Git      $gitVersion ($git)"
  Write-Line "  Package  $package"
  Write-Line ''

  # npx.cmd rather than npx.ps1, which script execution policies can block.
  & $npx --yes "--package=$package" opentig service install
  if ($LASTEXITCODE -ne 0) {
    Write-Line "error: OpenTig service install stopped with exit code $LASTEXITCODE. The messages above say why." 'Red'
    throw 'OpenTig was not installed.'
  }
}
