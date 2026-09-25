# Security and AI privacy

[← Documentation](README.md) · [Report a vulnerability](../SECURITY.md)

## Local-first and security model

- Repository contents are read from and written to their existing local paths.
- The renderer has no direct Node.js, filesystem, or process access.
- Git, filesystem, persistence, AI, and GitHub operations run through one typed, validated WebSocket command boundary in both desktop and browser clients. Requests have correlation IDs, cancellation and timeouts; interrupted operations are rejected rather than replayed after reconnect.
- The private server transport binds to loopback by default, requires an owner session for commands and image bytes, validates exact mutation/WebSocket origins, and blocks static-file traversal and symlink escape. Enabling **Settings → Network access** persists a desktop-only setting and restarts that same backend on `0.0.0.0`; disabling it returns to `127.0.0.1`. OpenTig never starts a second Web Access server.
- New browsers pair through a five-minute, one-use URL fragment displayed as a link and local QR code; the fragment is cleared before exchange. Paired browsers receive a cookie and server session lasting 30 days, renewed automatically when the app connects, resumes in the foreground, and hourly while visible. Renewal extends both the cookie and server session without another pairing code or interrupting connected tabs; temporary network failures retry. Closing the browser or restarting the server preserves access. After 30 days without a successful renewal, the server rejects the expired credential and disconnects expired browser connections. Expiry, clearing site cookies, or revoking access requires a new code; renewal cannot restore expired or revoked access. Desktop bootstrap cookies remain session-only. Steady-state credentials use host-only `HttpOnly`, `SameSite=Strict` cookies, only credential hashes are persisted, and revoking all sessions disconnects paired browsers while replacing the private desktop session. Network access grants owner-level file, Git, GitHub, and AI CLI authority as the OS user: use only a trusted LAN or VPN, an HTTPS reverse proxy, or an SSH tunnel, and never expose the raw port publicly.
- Headless `pair` authenticates over a same-host-only administrative route using a separate private file under `~/.opentig/server`; `runtime.json` contains PID/address/version identity but no credential. Pairing secrets remain memory-only and appear only in the deliberate one-time terminal output/URL fragment, never in arguments, environment variables, routine logs, query strings, or persisted state.
- Electron starts the backend after readiness on preferred port `6767`, scanning a bounded range upward only when that implicit port is occupied. Dev instead scans `6867`–`6876`, while production scans `6767`–`6776`; each keeps its selected port when Network access is toggled. Distinct session-cookie names let both profiles stay paired in the same browser on the same host, and revocation affects only that profile. If its range is full, startup fails rather than switching to the other profile. Its one-use desktop bootstrap secret crosses the private parent/utility message port exactly once; it is absent from process arguments, environment variables, renderer JavaScript, and redacted rotating logs. Unexpected exits restart one utility process on the same selected port.
- The narrow preload bridge contains only proven desktop capabilities such as folder selection/relocation, file clipboard import, Explorer reveal, title-bar theming, and zoom. Text clipboard access stays in the renderer's browser API.
- Git commands use argument arrays with `shell: false`, bounded output, timeouts, path validation, and per-repository write serialisation.
- External links are allowlisted to `http(s)://` and `mailto:` before Electron's window-navigation interception opens them in the system browser.
- HTML previews run in a sandbox; rendered Markdown is sanitised before display.
- OpenTig does not read or persist GitHub or AI API tokens. Connected CLIs manage their own authentication.

## AI privacy

For commit-message generation, OpenTig sends the selected local AI CLI only a bounded staged diff, its summary, staged paths, the branch name, and up to ten recent commit subjects. It does not include unstaged content; untracked files are included only after you stage them.

Multi-commit proposals are accepted only when they partition every staged path exactly once. OpenTig preserves its generous, fairly distributed patch budget for large staged changes; a trimmed individual diff can still be grouped from the complete path list and summary. Proposals remain blocked when the complete file set cannot be trusted, such as partially staged files or staged renames, and OpenTig verifies that the staged snapshot has not changed before preparing the first group. Preparing a group changes only the Git index; every commit still requires an explicit review and confirmation.

For pull-request drafting, it sends a bounded comparison between the current branch and the selected base branch. If the context is truncated, the interface tells you to review the result carefully.

Generated content remains editable and pending. No commit is created and no pull request is published until you explicitly confirm the corresponding action.
