# Development and packaging

[← Documentation](README.md)

Build from source with **Node.js 24.15 or newer** and **Git**. Run all commands below from the repository root. Desktop uses Electron 44; building or running a macOS desktop package requires macOS 13 or newer.

- **Run from source:** [desktop](#desktop-development) or [browser](#browser-development).
- **Check a change:** [tests and quality gates](#tests-and-quality-gates).
- **Try a packaged change or PR:** [Dev application and portable ZIP](#dev-application-and-portable-zip).
- **Build an installer:** [stable Windows package](#stable-windows-package).

**Dev isolates application data, not your repositories or authenticated Git/GitHub/AI CLIs.** Use a separate worktree for a PR's source and a disposable clone when testing repository changes.

## Run from source

Install [pnpm](https://pnpm.io/installation) 12 or later. pnpm switches to the version pinned in `package.json`, then installs the locked dependencies:

```powershell
pnpm install
```

### Desktop development

```powershell
pnpm start
```

`pnpm start` builds the shared server/client and Electron main/preload with Vite, then launches **OpenTig Dev**. **Restart the command after source changes; there is no live reload.** Only one desktop Dev instance runs at a time.

A fresh desktop Dev profile starts with **Web access**, **LAN access**, and the global **double-Control shortcut** disabled. Development can run on Linux; Windows installers and Windows-specific behavior still require Windows validation.

<details>
<summary>Desktop Dev data and profile selection</summary>

Data lives in the OS application-data directory under `OpenTig Dev`, normally `~/.config/OpenTig Dev` on Linux or `%APPDATA%/OpenTig Dev` on Windows. OpenTig does not copy or fall back to production data.

The Dev profile is selected before Electron takes its instance lock or opens a session. All local desktop Dev builds share the same Dev data.

</details>

### Browser development

On a Linux machine without a desktop session, run:

```bash
pnpm run start:web:dev
```

This builds the current server and web client, then starts **OpenTig Dev** without Electron at `http://127.0.0.1:6867`. It prints a **five-minute pairing code/link**.

Stop it with `Ctrl+C`. After code changes, run the command again to rebuild; there is no live reload. While it is running, generate a fresh code from another terminal:

```bash
pnpm run pair:web:dev
```

**The address is fixed.** An occupied port fails instead of selecting another port. Custom launch options are rejected. Production `OPENTIG_HOME`, `OPENTIG_HOST`, and `OPENTIG_PORT` values do not redirect this command.

Browser Dev stores data in `~/.opentig-dev`, separate from production CLI data (`~/.opentig`) and Electron Dev data. The two Dev runtimes never share writable settings.

### HTTPS tunnel and persistent service

A Cloudflare Tunnel on the same machine can use these separate routes:

| Example hostname | Local destination |
| --- | --- |
| `dev.opentig.example.com` | `http://127.0.0.1:6867` |
| A separate production hostname | `http://127.0.0.1:6767` |

Open `/pair` on the chosen HTTPS hostname and paste that instance's code. Keep the listener on loopback and restrict the hostnames to your users with Cloudflare Access. The Dev command does not install or configure Cloudflare or a background service.

Browser checks cover the shared UI and server. Native desktop integration and Windows installers need separate validation.

<details>
<summary>Keep the Linux Dev server running with systemd</summary>

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

After building with `pnpm run build:server`, run `systemctl --user daemon-reload` and `systemctl --user enable --now opentig-dev.service`. Enable user lingering with `loginctl enable-linger "$USER"` if the service should start at boot and survive logout.

Startup pairing output is discarded; use `pnpm run pair:web:dev` whenever you need a new code. Inspect the service with `systemctl --user status opentig-dev.service` and `journalctl --user -u opentig-dev.service`.

After rebuilding, use `systemctl --user restart opentig-dev.service`; it keeps the same `~/.opentig-dev` data and browser sessions. Do not run `start:web:dev` alongside the service on the same port. A healthy Cloudflare connector still returns a gateway error if this application service is stopped.

</details>

## Tests and quality gates

During local iterations, run tests that import the changed source files:

```bash
pnpm run test:related src/main/git/GitRepositoryOperations.ts
```

For changes to tests, run those files directly with `pnpm test <test-file>`. Related tests follow static imports; configuration, dynamically selected modules, and architecture checks that read source files require explicit tests or the complete suite.

Use behavior assertions for regressions and syntax-aware checks for dependency boundaries. Avoid checking literal source text or duplicating constants. Give each table row a distinct branch to cover, and wait on observable conditions or fake timers instead of real sleeps. Prefer spawning Node directly over Git aliases or shells when a test only needs a child process, because those chains are slow on Windows CI.

Test files without process-wide state share reused workers. A file runs in its own fresh worker when it mocks modules, changes globals, environment variables, timers, or the DOM environment, or imports a `test-support/` helper; `vitest.config.mts` detects this from the file contents. A test that changes module-level state some other way, such as a production singleton or cache, must reset it or use one of those isolating constructs. Use `pnpm exec vitest run --sequence.shuffle` to look for order dependence.

The real Windows PowerShell environment read runs only with `OPENTIG_POWERSHELL_INTEGRATION=1`; CI enables it in the native CLI discovery check.

Run all quality gates before integrating:

```powershell
pnpm run check
```

This runs typecheck, lint, the test suite, and the production dependency audit. For changes to a published guide or the website, also run:

```bash
pnpm run check:website
pnpm run build:website
```

See [website and documentation](website.md) for publication and preview checks.

<details>
<summary>TypeScript, lint rules, and architecture checks</summary>

`pnpm run typecheck` uses the native TypeScript 7 compiler with strict checking. `pnpm run lint` uses Oxlint with the existing JavaScript, TypeScript, React Hooks, and React Refresh rule severities and environment-specific overrides in `.oxlintrc.json`. `pnpm run lint:fix` applies safe lint fixes.

The configuration explicitly enables the migrated rules rather than adopting a broader default preset; `no-undef` and `no-useless-assignment` currently come from Oxlint's nursery category, so review their behavior when updating the pinned Oxlint version.

React Compiler configuration and gating rules are omitted because the build does not enable configurable React Compiler options. Oxc Parser powers the architecture tests without depending on the old TypeScript compiler API. Formatting is handled separately from these checks.

</details>

### What CI validates

PRs and pushes to `main` use the same CI scope rules:

| Changed scope | Validation |
| --- | --- |
| **Application code, configuration, or assets** | Tests on Windows and Linux; typecheck, lint, and production dependency audit once on Linux; native Trash and packed CLI smoke checks on Windows, Linux, and macOS. The packed CLI `npx` run is skipped on Windows, where it is slow; the CLI release draft checks it once per release |
| **Website or published documentation** | Website checks and production/noindex builds on Linux. This job does not deploy the site |
| **Prose-only documentation** | Application validation jobs retain their scope checks but skip dependency installs, tests, and smoke checks. Published guides still trigger website validation |
| **Manual CI run** | Full validation regardless of changed paths |

The prose exemption covers the root README, contribution guide, security policy, agent instructions, third-party notices, and Markdown under `docs/`. A new push to a PR cancels its superseded CI run; main and manual runs remain independent.

**Automatic CI does not package the desktop app or run its packaged server/utility checks.** Windows releases also run the test suite on the Windows builder before packaging.

### Request a desktop Dev build in GitHub

1. Open **Actions → Desktop Dev builds → Run workflow** and select the branch.
2. The latest CI run for that branch and exact commit must succeed. The workflow waits up to 30 minutes if it is still running.
3. If no CI run exists, for example on a branch without a PR, run **Actions → CI → Run workflow** on the branch first, then retry Desktop Dev.

The workflow reuses CI validation instead of repeating typecheck, lint, audit, and the source test suite. It packages and verifies desktop builds on Windows and Linux and produces portable Dev ZIPs.

## Build desktop packages

Desktop packages use **electron-builder**; Vite remains the compiler. The web client is built once and served by the included server in both Electron and browser sessions. Only the Electron runtime dependencies are shipped, with native N-API binaries and platform Trash executables unpacked from ASAR.

### Dev application and portable ZIP

Build a separate Dev application to evaluate local changes or a checked-out PR:

```bash
pnpm run package:dev
pnpm run verify:packaged-desktop --dev
pnpm run verify:packaged-server --dev
```

| Platform | Executable |
| --- | --- |
| Linux x64 | `out/OpenTig Dev-linux-x64/OpenTig Dev` |
| Windows x64 | `out/OpenTig Dev-win32-x64/OpenTig Dev.exe` |

The Dev identity is baked into the build, so moving the executable does not change its profile. Local Dev builds share the desktop Dev data described above.

Use `pnpm run make:dev` to create a **portable Dev ZIP** for the current OS. Extract the complete ZIP before launching. It needs no installer, stores settings in the separate OS Dev data directory, and has **no updater or stable update feed**.

ZIP artifacts are written under `out/make/dev/<platform>-<arch>/`.

### Stable Windows package

Build the stable Windows x64 app and **NSIS installer** on Windows:

```powershell
pnpm run package
pnpm run make
pnpm run verify:packaged-desktop
pnpm run verify:packaged-server
pnpm run verify:packaged-utility
pnpm run verify:packaged-trash
pnpm run verify:clipboard
```

The executable is `out/OpenTig-win32-x64/OpenTig.exe`. The installer is `out/make/production/win32-x64/OpenTig-<version>-win32-x64-Setup.exe`.

The one-click installer installs for the current user, creates desktop/Start menu shortcuts, and preserves application data on uninstall. Stable keeps the `OpenTig` identity and existing production data location.

**Existing Squirrel installations are not automatically migrated or removed.** Check installer migration and Windows behavior on Windows before release.

### Native clipboard verification

`pnpm run verify:clipboard` checks native file references, text-path fallbacks, PNG images, and the asynchronous Electron host adapter. On Windows it also reads file drops and images written by Windows Forms. This command replaces the system clipboard; use a disposable desktop or CI session. It runs in the manual Windows desktop and release workflows.

### Cross-build Windows from Linux

To cross-build Windows targets from Linux, pass `--platform=win32 --arch=x64` to `package`, `make`, `package:dev`, or `make:dev`.

Building NSIS on Linux also requires a working Wine installation and its runtime libraries, such as the environment in the electron-builder `electronuserland/builder:wine` container. ZIP builds do not need Wine.

Use the same target flags with `verify:packaged-desktop` to inspect an artifact without executing it. The utility/Trash checks must run on the target OS with a graphical Electron environment; add `--dev` for Dev packages.

`package` alone creates an unpacked application for the current OS; stable `make` is deliberately limited to the planned Windows x64 installer.

With dependencies already installed in the Linux checkout, the NSIS build can run in that container without installing Wine on the host:

```bash
docker run --rm --init --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/opentig-builder-home \
  -v "$PWD:$PWD" -w "$PWD" \
  electronuserland/builder:wine \
  bash -c 'mkdir -p "$HOME" && node scripts/package-desktop.mjs make --platform=win32 --arch=x64'
```

### Build metadata, signing, and publication

Each package includes `opentig-build.json` with its profile, target and distribution (`directory`, `zip`, or `installer`), plus release provenance, signing status and the update repository. The updater also checks the NSIS per-user installation registration against the current executable directory.

**Local commands never publish artifacts.** Unsigned local installers are candidates without an update feed; `make -- --release` enables the release feed without signing. Add `--signed` to require code signing; a missing certificate then fails the build.

Unsigned builds explicitly disable executable signing and publisher-signature verification, even if signing credentials are present in the environment.

See [release automation](releases.md) for GitHub and npm publication.

## Dependency maintenance

Dependency install scripts are reviewed and pinned in `package.json` (`allowScripts`). Review the relevant script again when updating one of those versions.

<details>
<summary>Pinned compatibility ranges and the Mermaid/KaTeX override</summary>

Keep Node type definitions on the Node 24 line. Dependabot defers Trash major updates until its glob dependencies have a patched version, and KaTeX 0.19+ until `marked-katex-extension` supports it. Revisit these exclusions when updating the corresponding integrations.

Mermaid's KaTeX dependency is overridden to use the same patched version as Markdown math (`$katex` in `package.json`). Mermaid 12.1 still requests the vulnerable 0.16 line; the override addresses [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) without downgrading Mermaid. Remove the override once Mermaid accepts a patched KaTeX version. `scripts/mermaid-katex.test.mjs` resolves KaTeX from Mermaid and checks display math in both output modes and rejection of inherited `trust` options.

</details>
