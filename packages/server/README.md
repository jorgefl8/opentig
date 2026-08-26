# OpenTig CLI

Run the same authenticated OpenTig server, runtime, protocol, and production web client used by the Windows desktop application.

OpenTig is local-first: it works with existing Git repositories on the machine running the server. Node.js 24 or later and Git are required.

## Local use

Pin an exact version for repeatable use:

```bash
npx --yes @opentig/cli@0.1.0
npx --yes @opentig/cli@0.1.0 serve
bunx @opentig/cli@0.1.0 serve
```

Plain `bunx` installs and launches the Node-shebang executable. Running OpenTig under the Bun runtime itself is not supported.

Run `opentig help` or `opentig --help` for commands, examples, pairing/tunnel guidance, service management, environment variables, and shutdown behavior.

`opentig` and `opentig start` open the pairing link in the system browser. `opentig serve` keeps browser launch disabled and prints a terminal QR. Use `--no-browser` to suppress presentation in start mode. The CLI starts one project-independent server; add, open, and switch repositories exclusively from the web UI using paths on the server.

The default listener is `127.0.0.1:6767`. If the configured port is busy, OpenTig fails instead of silently changing a reverse-proxy target. Configuration precedence is command line, `OPENTIG_HOST` / `OPENTIG_PORT` / `OPENTIG_HOME`, then defaults. Data lives under `~/.opentig` unless `--home` is supplied. Settings, hash-only sessions, AI history, credential-free runtime identity, a private same-host admin credential, and rotating logs are kept there.

Run `opentig pair --home <same-home>` as the same OS user to mint a new five-minute, one-use code and link for a running server. Open `/pair` on the local, LAN, or tunnel domain, paste the code, and confirm or edit the suggested device name. SIGINT and SIGTERM close clients, watchers, owned Git/AI processes, persistence, and logs; a second signal forces exit.

`npx` and `bunx` never install background persistence. Linux/systemd users can opt in with `opentig service install`, inspect it with `opentig service status`, and remove it with `opentig service uninstall`. The installer stages the exact package outside the temporary npx cache, uses the private OpenTig home as its stable working directory, and enables user lingering. It is never scoped to a repository. Other platforms should use their preferred service manager for now.

A non-loopback listener grants authenticated owner sessions the filesystem, Git, GitHub CLI, and configured AI CLI authority of the operating-system account running OpenTig. Use a trusted LAN/VPN, HTTPS reverse proxy, or SSH tunnel with a restrictive firewall. Never expose the raw HTTP port to the public Internet or use unencrypted non-loopback HTTP on an untrusted network.

Pin versions for production. Upgrade or roll back by stopping the process and running a different immutable version. Docker, built-in TLS, Tailscale/SSH automation, multi-user roles, and self-update are not included.

Source, documentation, and security guidance: <https://github.com/jorgefl8/opentig>

## License

MIT. Bundled third-party assets retain their own licences; see `THIRD_PARTY_NOTICES.md`.
