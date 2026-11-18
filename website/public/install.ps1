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
#   1. Checks the variables below, and that Node.js 24 or later (with npx) and
#      Git 2.31 or later are on PATH. If a value is not allowed, or a program
#      is missing or too old, it says what it found and how to fix it, then
#      stops without changing anything.
#   2. Runs the OpenTig CLI's own background-service installation from npm:
#        npx --yes --package=@opentig/cli@latest opentig service install
#      On Windows it starts npx's own script with node.exe instead of npx.cmd,
#      so no value passes through cmd.exe. That registers a Task Scheduler
#      task for your user (it starts at login), adds the opentig command
#      (~\.opentig\bin) to your user Path, and, in an interactive console,
#      asks whether to pair a device now. Without one it prints the pairing
#      link instead of asking.
#
# What it does not do: install Node.js or Git, ask for administrator rights,
# or download anything other than the npm package. It never calls exit and
# leaves the session's variables and preferences as they were.
#
# Environment variables (set them first, for example $env:OPENTIG_VERSION = '1.0.0'):
#   OPENTIG_VERSION   CLI version such as 1.0.0, or a tag such as latest
#                     (default: latest).
#   OPENTIG_PACKAGE   What to install instead of @opentig/cli@$OPENTIG_VERSION:
#                     @opentig/cli, optionally followed by @ and a version or
#                     tag, or the path of an existing .tgz file. A relative
#                     path gets .\ in front, because npm reads dir/file as a
#                     GitHub repository. Anything else is refused.
#   OPENTIG_HOST, OPENTIG_PORT, OPENTIG_HOME
#                     Listener address, port, and data directory, read by the
#                     CLI itself (defaults: 127.0.0.1, 6767, ~\.opentig).
#   NO_COLOR          Turns off colored output.
#
# Uninstall: opentig service uninstall
#
# Everything below is one script block. PowerShell parses all of it before
# running any of it, and it cannot parse a block without its closing brace,
# so a download cut short at any character runs nothing.

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

  # The path of a program on PATH, trying each file name in order.
  function Find-Program([string[]] $Names) {
    foreach ($candidate in $Names) {
      $command = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($command) { return $command.Path }
    }
    return $null
  }

  # The first line a program prints, or an empty string if it cannot run.
  function Read-FirstLine([string] $Program, [string[]] $Arguments) {
    try { return [string] (& $Program @Arguments 2>$null | Select-Object -First 1) } catch { return '' }
  }

  # A version such as 1.0.0 or 1.1.0-rc.1, or a dist-tag such as latest.
  function Test-VersionOrTag([string] $Value) {
    return $Value -cmatch '^(\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]*)?|[A-Za-z][A-Za-z0-9._-]*)$'
  }

  # Decide what npx installs before anything runs. npm reads a value such as
  # dir/file.tgz as a GitHub repository, so relative paths get .\ in front.
  $version = if ($env:OPENTIG_VERSION) { $env:OPENTIG_VERSION } else { 'latest' }
  if (-not (Test-VersionOrTag $version)) { Stop-Install "OPENTIG_VERSION must be a version such as 1.0.0 or a tag such as latest, not `"$version`"." @() }
  $package = "@opentig/cli@$version"
  if ($env:OPENTIG_PACKAGE) {
    $package = $env:OPENTIG_PACKAGE
    if ($package -match '["\r\n]') {
      Stop-Install 'OPENTIG_PACKAGE must not contain quotes or line breaks.' @()
    } elseif ($package -cmatch '\.tgz$') {
      $file = $package
      if ($package -match '^~[\\/]') {
        # The home npm resolves ~ against: USERPROFILE on Windows, HOME elsewhere.
        $userHome = if ($onWindows -and $env:USERPROFILE) { $env:USERPROFILE } elseif ($env:HOME) { $env:HOME } else { $HOME }
        $file = Join-Path $userHome $package.Substring(2)
      } elseif ($package -notmatch '^([A-Za-z]:[\\/]|[\\/]|\.{1,2}[\\/])') {
        $package = ".$([IO.Path]::DirectorySeparatorChar)$package"
        $file = $package
      }
      if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Stop-Install "OPENTIG_PACKAGE names $($env:OPENTIG_PACKAGE), but there is no such file." @() }
    } elseif ($package -ceq '@opentig/cli') {
      $package = "$package@$version"
    } elseif ($package -cmatch '^@opentig/cli@(.*)$') {
      if (-not (Test-VersionOrTag $Matches[1])) { Stop-Install "OPENTIG_PACKAGE must end in a version such as 1.0.0 or a tag such as latest, not `"$($Matches[1])`"." @() }
    } else {
      Stop-Install "OPENTIG_PACKAGE must be @opentig/cli, optionally with @ and a version or tag, or the path of a .tgz file, not `"$package`"." @()
    }
  }

  $nodeHelp = @('Install Node.js 24 or later from https://nodejs.org/en/download, open a new terminal, and run this installer again.')
  $gitHelp = @('Install Git 2.31 or later from https://git-scm.com/downloads, open a new terminal, and run this installer again.')

  # On Windows, node.exe itself: it runs npx below, so it must not be a .cmd.
  $node = Find-Program $(if ($onWindows) { @('node.exe') } else { @('node') })
  if (-not $node) { Stop-Install 'Node.js 24 or later is required, but no node command was found on PATH.' $nodeHelp }
  $nodeVersion = (Read-FirstLine $node @('--version')) -replace '^v', ''
  if (-not ($nodeVersion -match '^(\d+)\.')) { Stop-Install "Node.js 24 or later is required, but $node did not report a Node.js version." $nodeHelp }
  if ([int] $Matches[1] -lt 24) { Stop-Install "Node.js 24 or later is required; found Node.js $nodeVersion at $node." $nodeHelp }

  $npxHelp = @('Install npm for this Node.js; the installers from https://nodejs.org/en/download include it. Then run this installer again.')
  $npx = Find-Program $(if ($onWindows) { @('npx.cmd') } else { @('npx') })
  if (-not $npx) { Stop-Install "npx, which comes with npm, was not found on PATH (Node.js $nodeVersion is at $node)." $npxHelp }
  $command = $npx
  $prefix = @()
  if ($onWindows) {
    # npx.cmd would hand every argument to cmd.exe; run the script it starts instead.
    $npxScript = $null
    foreach ($directory in @((Split-Path -Parent $npx), (Split-Path -Parent $node))) {
      $candidate = Join-Path $directory 'node_modules\npm\bin\npx-cli.js'
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { $npxScript = $candidate; break }
    }
    if (-not $npxScript) { Stop-Install "npx was found at $npx, but not npm's npx-cli.js beside it or beside $node." $npxHelp }
    $command = $node
    $prefix = @($npxScript)
  }

  $git = Find-Program $(if ($onWindows) { @('git.exe', 'git.cmd') } else { @('git') })
  if (-not $git) { Stop-Install 'Git 2.31 or later is required, but no git command was found on PATH.' $gitHelp }
  $gitVersion = (Read-FirstLine $git @('--version')) -replace '^git version ', ''
  if (-not ($gitVersion -match '^(\d+)\.(\d+)')) { Stop-Install "Git 2.31 or later is required, but $git did not report a Git version." $gitHelp }
  $gitMajor = [int] $Matches[1]
  $gitMinor = [int] $Matches[2]
  if ($gitMajor -lt 2 -or ($gitMajor -eq 2 -and $gitMinor -lt 31)) { Stop-Install "Git 2.31 or later is required; found Git $gitVersion at $git." $gitHelp }

  Write-Line 'Installing the OpenTig background service' 'Cyan'
  Write-Line "  Node.js  $nodeVersion ($node)"
  Write-Line "  Git      $gitVersion ($git)"
  Write-Line "  Package  $package"
  Write-Line ''

  $arguments = $prefix + @('--yes', "--package=$package", 'opentig', 'service', 'install')
  & $command @arguments
  if ($LASTEXITCODE -ne 0) {
    Write-Line "error: OpenTig service install stopped with exit code $LASTEXITCODE. The messages above say why." 'Red'
    throw 'OpenTig was not installed.'
  }
}
