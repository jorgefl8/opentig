#!/bin/sh
# OpenTig installer for macOS and Linux.
#
#   curl -fsSL https://opentig.com/install.sh | sh
#
# Read it before running it:
#
#   curl -fsSL https://opentig.com/install.sh | less
#
# What it does:
#   1. Checks that this is macOS or Linux, and that Node.js 24 or later (with
#      npx) and Git 2.31 or later are on PATH. If one is missing or too old, it
#      says what it found and where to get it, then stops without changing
#      anything.
#   2. Runs the OpenTig CLI's own background-service installation from npm:
#        npx --yes --package=@opentig/cli@latest opentig service install
#      That installs the service for your user, adds the opentig command
#      (~/.opentig/bin) to PATH in your shell profile, and, in a terminal, asks
#      whether to pair a device now. Without a terminal it prints the pairing
#      link instead of asking.
#
# What it does not do: install Node.js or Git, use sudo, or download anything
# other than the npm package.
#
# Environment variables:
#   OPENTIG_VERSION   CLI version to install, such as 1.0.0 (default: latest).
#   OPENTIG_PACKAGE   npm package to run instead, such as a local .tgz file
#                     (default: @opentig/cli@$OPENTIG_VERSION).
#   OPENTIG_HOST, OPENTIG_PORT, OPENTIG_HOME
#                     Listener address, port, and data directory, read by the
#                     CLI itself (defaults: 127.0.0.1, 6767, ~/.opentig).
#   NO_COLOR          Turns off colored output.
#
# Options after "sh -s --" are passed to "service install", for example:
#
#   curl -fsSL https://opentig.com/install.sh | sh -s -- --port 6768 --no-modify-path
#
# Uninstall: opentig service uninstall
#
# Everything below is one function, called on the last line, so a download
# cut short runs nothing.

opentig_install() {
  set -eu

  newline='
'
  bold='' reset='' error_red='' error_reset=''
  if [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != dumb ]; then
    if [ -t 1 ]; then
      bold=$(printf '\033[1m') reset=$(printf '\033[0m')
    fi
    if [ -t 2 ]; then
      error_red=$(printf '\033[1;31m') error_reset=$(printf '\033[0m')
    fi
  fi

  say() {
    printf '%s\n' "$1"
  }

  # Prints the reason and how to fix it on standard error, then stops.
  fail() {
    printf '%serror:%s %s\n' "$error_red" "$error_reset" "$1" >&2
    shift
    for line do
      printf '  %s\n' "$line" >&2
    done
    printf 'Nothing was installed or changed.\n' >&2
    exit 1
  }

  # The first line of a command's output, or nothing if the command fails.
  first_line() {
    output=$("$@" 2>/dev/null) || output=''
    printf '%s' "${output%%"$newline"*}"
  }

  is_number() {
    case $1 in
      '' | *[!0-9]*) return 1 ;;
      *) return 0 ;;
    esac
  }

  node_help='Install Node.js 24 or later from https://nodejs.org/en/download, open a new terminal, and run this installer again.'

  os=$(uname -s 2>/dev/null) || os=unknown
  case $os in
    Linux)
      system=Linux
      git_help='Install Git 2.31 or later with your distribution'"'"'s package manager or from https://git-scm.com/downloads, then run this installer again.'
      ;;
    Darwin)
      system=macOS
      git_help='Install Git 2.31 or later with "xcode-select --install" or from https://git-scm.com/downloads, then run this installer again.'
      ;;
    MINGW* | MSYS* | CYGWIN*)
      fail 'This installer is for macOS and Linux.' \
        'On Windows, download the desktop app from https://opentig.com, or install the server from PowerShell:' \
        '  irm https://opentig.com/install.ps1 | iex'
      ;;
    *)
      fail "OpenTig runs on macOS, Linux, and Windows; this system reports \"$os\"."
      ;;
  esac

  node_path=$(command -v node 2>/dev/null) || node_path=''
  if [ -z "$node_path" ]; then
    fail 'Node.js 24 or later is required, but no node command was found on PATH.' "$node_help"
  fi
  node_version=$(first_line "$node_path" --version)
  node_version=${node_version#v}
  node_major=${node_version%%.*}
  if ! is_number "$node_major"; then
    fail "Node.js 24 or later is required, but $node_path did not report a Node.js version." "$node_help"
  fi
  if [ "$node_major" -lt 24 ]; then
    fail "Node.js 24 or later is required; found Node.js $node_version at $node_path." "$node_help"
  fi

  npx_path=$(command -v npx 2>/dev/null) || npx_path=''
  if [ -z "$npx_path" ]; then
    fail "npx, which comes with npm, was not found on PATH (Node.js $node_version is at $node_path)." \
      'Install npm for this Node.js; the installers from https://nodejs.org/en/download include it. Then run this installer again.'
  fi

  git_path=$(command -v git 2>/dev/null) || git_path=''
  if [ -z "$git_path" ]; then
    fail 'Git 2.31 or later is required, but no git command was found on PATH.' "$git_help"
  fi
  # Without the Command Line Tools, /usr/bin/git only offers to install them.
  if [ "$os" = Darwin ] && [ "$git_path" = /usr/bin/git ] && ! xcode-select -p >/dev/null 2>&1; then
    fail 'Git 2.31 or later is required, but /usr/bin/git needs the Xcode Command Line Tools, which are not installed.' "$git_help"
  fi
  git_version=$(first_line "$git_path" --version)
  git_version=${git_version#git version }
  git_version=${git_version%% *}
  git_major=${git_version%%.*}
  git_minor=${git_version#*.}
  git_minor=${git_minor%%.*}
  if ! is_number "$git_major" || ! is_number "$git_minor"; then
    fail "Git 2.31 or later is required, but $git_path did not report a Git version." "$git_help"
  fi
  if [ "$git_major" -lt 2 ] || { [ "$git_major" -eq 2 ] && [ "$git_minor" -lt 31 ]; }; then
    fail "Git 2.31 or later is required; found Git $git_version at $git_path." "$git_help"
  fi

  package=${OPENTIG_PACKAGE:-@opentig/cli@${OPENTIG_VERSION:-latest}}

  # Piped from curl, standard input is this script: questions read the
  # terminal when there is one, and otherwise get no input at all.
  if { true </dev/tty; } 2>/dev/null; then
    input=/dev/tty
  else
    input=/dev/null
  fi

  say "${bold}Installing the OpenTig background service${reset}"
  say "  System   $system $(uname -m 2>/dev/null || true)"
  say "  Node.js  $node_version ($node_path)"
  say "  Git      $git_version ($git_path)"
  say "  Package  $package"
  say ''

  status=0
  "$npx_path" --yes "--package=$package" opentig service install ${1+"$@"} <"$input" || status=$?
  if [ "$status" -ne 0 ]; then
    printf '%serror:%s OpenTig service install stopped with exit code %s. The messages above say why.\n' \
      "$error_red" "$error_reset" "$status" >&2
    exit "$status"
  fi
}

opentig_install ${1+"$@"}
