# Development and packaging

[← Documentation](README.md)

Building from source requires Node.js 24.15 or newer and Git. All commands below run from the repository root.

Keep Node type definitions on the Node 24 line. Dependabot defers Trash major updates until its glob dependencies have a patched version, and KaTeX 0.19+ until `marked-katex-extension` supports it. Revisit these exclusions when updating the corresponding integrations. Desktop uses Electron 44; building or running a macOS desktop package requires macOS 13 or newer.

Mermaid's KaTeX dependency is overridden to use the same patched version as Markdown math (`$katex` in `package.json`). Mermaid 12.1 still requests the vulnerable 0.16 line; the override addresses [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) without downgrading Mermaid. Remove the override once Mermaid accepts a patched KaTeX version. `scripts/mermaid-katex.test.mjs` resolves KaTeX from Mermaid and checks display math in both output modes and rejection of inherited `trust` options.

## Run from source

```powershell
npx --yes npm@11.6.2 ci
npm start
```

`npm start` builds the shared server/client and Electron main/preload with Vite, then launches **OpenTig Dev**. Restart the command after source changes; this launcher does not provide live reload. Its data lives in the OS application-data directory under `OpenTig Dev` (normally `~/.config/OpenTig Dev` on Linux or `%APPDATA%/OpenTig Dev` on Windows), without copying or falling back to production data. The profile is selected before Electron takes its instance lock or opens a session. Only one desktop Dev instance runs at a time. A fresh Dev profile starts with Network access and the global double-Control shortcut disabled. Development can run on Linux; Windows installers and Windows-specific behavior must still be verified on Windows.

For browser development on a Linux machine without a desktop session, run:

```bash
npm run start:web:dev
```

This builds the current server and web client, then starts **OpenTig Dev** without Electron at the fixed address `http://127.0.0.1:6867`. It prints a five-minute pairing code/link. Its persistent data is `~/.opentig-dev`, separate from both production CLI data (`~/.opentig`) and Electron Dev data, so the two runtimes never share writable settings. Production `OPENTIG_HOME`, `OPENTIG_HOST`, and `OPENTIG_PORT` values do not redirect this command; custom launch options are rejected. An occupied port fails instead of selecting another port. Stop it with `Ctrl+C`; after code changes, run the command again to rebuild (there is no live reload).

While it is running, generate a fresh code from another terminal:

```bash
npm run pair:web:dev
```

A Cloudflare Tunnel running on the same machine can route `dev.opentig.example.com` to `http://127.0.0.1:6867` and a separate production hostname to `http://127.0.0.1:6767`. Open `/pair` on the chosen HTTPS hostname and paste that instance's code; keep the listener on loopback and restrict the hostnames to your users with Cloudflare Access. This command does not install or configure Cloudflare or a background service. Browser checks cover the shared UI and server; native desktop integration and Windows installers still need separate validation.

For a persistent Linux tunnel endpoint, run the built Dev server as a **systemd user service**, so it stays running independently of a terminal or coding session. Create `~/.config/systemd/user/opentig-dev.service`, adjusting the checkout, Node executable, and CLI search paths for your machine:

```ini
[Unit]
Description=OpenTig Dev web server
StartLimitIntervalSec=60
StartLimitBurst=10

[Service]
Type=simple
WorkingDirectory=%h/src/opentig
ExecStart=/usr/bin/node %h/src/opentig/packages/server/dist/dev.mjs serve
Environment=PATH=%h/.local/bin:%h/.bun/bin:/usr/local/bin:/usr/bin:/bin
Restart=always
RestartSec=3
TimeoutStopSec=15
UMask=0077
StandardOutput=null
StandardError=journal

[Install]
WantedBy=default.target
```

After building with `npm run build:server`, run `systemctl --user daemon-reload` and `systemctl --user enable --now opentig-dev.service`. Enable user lingering with `loginctl enable-linger "$USER"` if the service should start at boot and survive logout. Startup pairing output is discarded; use `npm run pair:web:dev` whenever you need a new code. Inspect the service with `systemctl --user status opentig-dev.service` and `journalctl --user -u opentig-dev.service`. After rebuilding, use `systemctl --user restart opentig-dev.service`; it keeps the same `~/.opentig-dev` data and browser sessions. Do not run `start:web:dev` alongside the service on the same port. A healthy Cloudflare connector still returns a gateway error if this application service is stopped.

During local iterations, run the tests that import the changed source files:

```bash
npm run test:related -- src/main/git/GitRepositoryOperations.ts
```

For changes to tests, run those files directly with `npm test -- <test-file>`. Related tests follow static imports; configuration, dynamically selected modules, and architecture checks that read source files require explicit tests or the complete suite. Use behavior assertions for regressions and syntax-aware checks for dependency boundaries; avoid checking literal source text or duplicating constants.

Run all quality gates before integrating:

```powershell
npm run check
```

`npm run typecheck` uses the native TypeScript 7 compiler with strict checking. `npm run lint` uses Oxlint with the existing JavaScript, TypeScript, React Hooks, and React Refresh rule severities and environment-specific overrides in `.oxlintrc.json`. `npm run lint:fix` applies safe lint fixes. The configuration explicitly enables the migrated rules rather than adopting a broader default preset; `no-undef` and `no-useless-assignment` currently come from Oxlint's nursery category, so review their behavior when updating the pinned Oxlint version. React Compiler configuration and gating rules are omitted because the build does not enable configurable React Compiler options. Oxc Parser powers the architecture tests without depending on the old TypeScript compiler API. Formatting is handled separately from these checks.

PRs and pushes to `main` run the same CI for code, configuration, and asset changes: tests on Windows and Linux, with typecheck, lint, and the production dependency audit running once on Linux. Native Trash and packed CLI smoke checks run on Windows, Linux, and macOS. Automatic CI does not package the desktop application or run its packaged server/utility checks; desktop package verification and portable Dev ZIPs are available through **Actions → Desktop Dev builds → Run workflow**. Desktop Dev requires the latest CI run for the selected branch and exact commit to succeed, waiting up to 30 minutes if it is still running. It reuses CI validation instead of repeating typecheck, lint, audit, and the source test suite; packaging and native desktop checks still run on Windows and Linux. If no CI run exists for the commit (for example, on a branch without a PR), run **Actions → CI → Run workflow** on that branch before retrying Desktop Dev. Prose-only changes to the root README, contribution guide, agent instructions, third-party notices, or Markdown files under `docs/` keep the validation checks but skip dependency installs, tests, and smoke checks. Manual CI runs always validate fully. A new push to a PR cancels its superseded CI run; main and manual runs remain independent. Windows releases also run the test suite on the Windows builder before packaging. Dependency install scripts are reviewed and pinned in `package.json` (`allowScripts`); review the relevant script again when updating one of those versions.

Build a separate Dev application to evaluate local changes or a checked-out PR:

```bash
npm run package:dev
npm run verify:packaged-desktop -- --dev
npm run verify:packaged-server -- --dev
```

On Linux x64 the executable is `out/OpenTig Dev-linux-x64/OpenTig Dev`; on Windows x64 it is `out/OpenTig Dev-win32-x64/OpenTig Dev.exe`. The Dev identity is baked into the build, so moving the executable does not change its profile. All local Dev builds share the same Dev data; use a separate worktree for a PR's source and test repository changes in a disposable clone. Dev isolates application data, not your actual repositories or authenticated Git/GitHub/AI CLIs.

`npm run verify:clipboard` checks native file references, text-path fallbacks, PNG images, and the asynchronous Electron host adapter. On Windows it also reads file drops and images written by Windows Forms. This command replaces the system clipboard; use a disposable desktop or CI session. It runs in the manual Windows desktop and release workflows.

Desktop packages use **electron-builder**; Vite remains the compiler. The web client is built once and served by the included server in both Electron and browser sessions. Only the Electron runtime dependencies are shipped, with native N-API binaries and platform Trash executables unpacked from ASAR.

`npm run make:dev` creates a **portable Dev ZIP** for the current OS. Extract the complete ZIP before launching; it needs no installer, but still stores settings in the separate OS Dev data directory. It has no updater or stable update feed. Artifacts are written under `out/make/dev/<platform>-<arch>/`.

Build the stable Windows x64 application and **NSIS installer** on Windows:

```powershell
npm run package
npm run make
npm run verify:packaged-desktop
npm run verify:packaged-server
npm run verify:packaged-utility
npm run verify:packaged-trash
npm run verify:clipboard
```

The executable is `out/OpenTig-win32-x64/OpenTig.exe`; the installer is `out/make/production/win32-x64/OpenTig-<version>-win32-x64-Setup.exe`. The one-click installer installs for the current user, creates desktop/Start menu shortcuts, and preserves application data on uninstall. Stable keeps the `OpenTig` identity and existing production data location. An existing Squirrel installation is not automatically migrated or removed; installer migration and Windows behavior must be checked on Windows before release.

To cross-build Windows targets from Linux, pass `-- --platform=win32 --arch=x64` to `package`, `make`, `package:dev`, or `make:dev`. Building NSIS on Linux also requires a working Wine installation and its runtime libraries, such as the environment in the electron-builder `electronuserland/builder:wine` container. ZIP builds do not need Wine. Use the same target flags with `verify:packaged-desktop` to inspect an artifact without executing it. The utility/Trash checks must run on the target OS with a graphical Electron environment; add `-- --dev` for Dev packages. `package` alone creates an unpacked application for the current OS; stable `make` is deliberately limited to the planned Windows x64 installer.

With dependencies already installed in the Linux checkout, the NSIS build can run in that container without installing Wine on the host:

```bash
docker run --rm --init --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/opentig-builder-home \
  -v "$PWD:$PWD" -w "$PWD" \
  electronuserland/builder:wine \
  bash -c 'mkdir -p "$HOME" && npm run make -- --platform=win32 --arch=x64'
```

Each package includes `opentig-build.json` with its profile, target and distribution (`directory`, `zip`, or `installer`), plus release provenance, signing status and the update repository. The updater also checks the NSIS per-user installation registration against the current executable directory. Local commands never publish artifacts. Unsigned local installers are candidates without an update feed; `make -- --release` enables the release feed without signing. Add `--signed` to require code signing; a missing certificate then fails the build. Unsigned builds explicitly disable executable signing and publisher-signature verification, even if signing credentials are present in the environment.

See [release automation](releases.md) for GitHub and npm publication.
