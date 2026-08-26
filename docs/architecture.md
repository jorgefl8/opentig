# Server architecture

OpenTig is server-first even when it runs as a Windows desktop application. The
React renderer never executes Git, filesystem, GitHub, or AI operations itself.
It sends typed commands to one authenticated server, exactly as a paired browser
does.

## Runtime topology

```text
Electron renderer ───────────────┐
                                 │ authenticated HTTP + WebSocket
Paired browser ──────────────────┤
                                 ▼
                         OpenTig server runtime
                         ├─ Git and filesystem services
                         ├─ settings and repository state
                         ├─ GitHub and optional AI CLI adapters
                         ├─ repository watcher and runtime events
                         ├─ owner-session authentication
                         └─ production React client
                                 │
                                 ▼
                         host Git / gh / AI CLIs

Electron main
├─ starts, probes, restarts, and stops the utility server
├─ installs the private desktop owner session
├─ changes loopback/LAN exposure
└─ provides narrow native-only capabilities through preload

Node CLI
├─ parses host/port/home/presentation options
├─ invokes the same runOpenTigServer factory in-process
├─ leaves repository discovery and selection to the shared web UI
├─ writes credential-free runtime identity for `opentig pair`
├─ owns browser launch and SIGINT/SIGTERM shutdown
└─ optionally installs the exact build as a Linux systemd user service
```

The desktop window loads the production client from the local server origin.
There is no separate desktop renderer backend and no duplicate Web Access
runtime.

## Ownership boundaries

| Layer | Owns | Does not own |
| --- | --- | --- |
| React renderer | UI state, queries, command calls, reconnect/bootstrap | Node.js, Git processes, filesystem access |
| WebSocket transport | correlation IDs, timeouts, cancellation, heartbeat, reconnect, runtime events | domain behavior or mutation replay |
| Server command registry | typed command-to-handler mapping, validation, per-session cancellation | Electron window or OS UI |
| Runtime | Git, files, settings, repositories, watchers, GitHub, AI adapters | HTTP, cookies, Electron lifecycle |
| HTTP/WebSocket server | static client, readiness, authentication, origin checks, sessions, transport limits | desktop-native capabilities |
| Electron main/preload | utility lifecycle, folder picker, Explorer reveal, file clipboard, title-bar integration | Git/filesystem domain commands |

This boundary keeps browser and desktop behavior aligned. A domain feature added
to the server API becomes available to both clients unless it explicitly needs a
native capability.

## Request and event flow

1. The client opens `/ws` on the same origin that served the React application.
2. The server authenticates the owner-session cookie and validates the exact
   WebSocket origin.
3. A request contains a correlation ID, command name, and typed tuple arguments.
4. The registry validates the command and arguments, then delegates to the
   shared runtime.
5. The server returns one typed result for that ID. Interrupted mutations are
   rejected; they are never silently replayed after reconnect.
6. Repository and filesystem changes are published as runtime events to every
   connected owner session.
7. After reconnect, each client bootstraps fresh authoritative state.

Large request classes have explicit byte budgets. The transport also applies
connection, request-rate, pending-request, result-size, timeout, and heartbeat
limits.

## Desktop server lifecycle

Electron starts `packages/server/dist/utility.mjs` with
`utilityProcess.fork`. The bootstrap configuration and one-use desktop secret
cross the private parent/utility message port; they are not placed in process
arguments or environment variables.

The supervisor:

- prefers port `6767` and scans a bounded range when that implicit port is busy;
- waits for `/readyz` before loading the application;
- writes redacted rotating server logs;
- restarts unexpected exits with bounded backoff;
- keeps one selected port and one utility process;
- shuts down the WebSocket server and runtime gracefully.

A renderer reload does not terminate the utility process. When the server
restarts, connected clients reject pending operations, reconnect, and reload
authoritative state.

## Data and persistence

Desktop paths are derived from Electron's user-data directory:

| Path | Purpose |
| --- | --- |
| `settings.json` | repositories, preferences, and application state |
| `settings.json.bak` | last known-good settings document, used if the primary file cannot be parsed |
| `ai-log.jsonl` | local AI-operation log |
| `problems.jsonl` | local Git, file, and network failure log |
| `desktop-server.json` | persisted loopback/LAN exposure |
| `server/` | hash-only owner-session authentication state |
| `logs/server.log` | redacted rotating utility-server log |

The headless CLI derives equivalent paths from `~/.opentig` or `--home`:

| Path | Purpose |
| --- | --- |
| `settings.json` | repositories, preferences, and application state |
| `settings.json.bak` | last known-good settings document, used if the primary file cannot be parsed |
| `ai-log.jsonl` | local AI-operation history |
| `problems.jsonl` | local Git, file, and network failure log |
| `server/` | hash-only sessions plus a private same-host admin credential |
| `runtime.json` | PID, bind address, version/protocol, and instance identity; no credential |
| `logs/server.log` | redacted rotating CLI server log |

Pairing secrets are memory-only. Persistent session files contain credential
hashes rather than usable cookie values, plus editable device names and
non-secret browser, OS, device, proxy/IP, and last-connection metadata. The
private desktop session is replaced on a new desktop bootstrap instead of
accumulating duplicates. Live connection counts are derived from WebSockets and
are not persisted.

## Native capability boundary

The preload bridge is intentionally narrow. It exposes only capabilities that a
normal browser cannot reproduce safely: selecting/relocating a directory,
reading explicit file paths or an image from the desktop clipboard, revealing a
path in Explorer, title-bar theming, zoom, and desktop-only listener controls.
Authenticated session inventory, renaming, and browser revocation remain
ordinary server APIs, so the same management view works in desktop and browser.

Confirmation dialogs live in React. Cross-platform deletion moves content to
the operating system Trash from the server runtime.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/shared/server-api.ts` | renderer-facing typed server API |
| `src/shared/protocol.ts` | command ownership, mutation flags, and request budgets |
| `src/main/runtime/` | Electron-free runtime and command registry |
| `packages/server/src/server.ts` | shared server construction boundary |
| `packages/server/src/http.ts` | HTTP, readiness, static client, and auth routes |
| `packages/server/src/websocket.ts` | authenticated command/event transport |
| `packages/server/src/auth*.ts` | pairing and persistent owner sessions |
| `packages/server/src/utility.ts` | thin Electron utility-process adapter |
| `packages/server/src/bin.ts` / `cli.ts` | Node shebang and thin headless lifecycle adapter |
| `src/main/server/` | Electron supervisor and exposure settings |
| `src/renderer/lib/websocket-transport.ts` | browser/Electron client transport |
| `src/main/ipc/` | native-only desktop handlers |

## Verification

Run from the repository root:

```powershell
npm run typecheck
npm run lint
npm test
npm run package
```

Focused server coverage lives under `packages/server/src/*.test.ts`; runtime
boundary tests live under `src/main/runtime`; supervisor tests live under
`src/main/server`; renderer transport tests live under `src/renderer/lib`.

`npm run release:pack:headless` builds the web client and server once, then emits
one tarball plus JSON metadata containing its version, SHA-256, npm integrity,
and exact file list. `npm run release:inspect:headless` rejects version drift,
checkout paths, source/tests/state, Electron/native imports, and undeclared
artifacts. Release automation consumes that tested tarball rather than rebuilding it.
