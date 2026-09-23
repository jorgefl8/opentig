# OpenTig documentation

These documents expand the project overview in the root [README](../README.md)
without duplicating its feature catalogue.

- [Server architecture](architecture.md) explains the server-first desktop and
  browser design, process ownership, request flow, recovery, and source layout.
- [Network access](web-access.md) explains trusted-LAN browser pairing,
  authentication, session revocation, diagnostics, and the security boundary.

## Implementation status

The Windows desktop application and paired browsers already use one authenticated
HTTP/WebSocket server. Electron supervises that server in a utility process and
retains only capabilities that ordinary browsers cannot provide.

The Electron-free workspace is now the public-package candidate `@opentig/cli`.
Its thin `opentig` executable, deterministic tarball interface, `npx`/`bunx`
local verification, private home, named-device pairing, graceful lifecycle, and
explicit Linux systemd installer reuse the desktop server factory. The release
pipeline prepares Windows installers and the CLI tarball from one frozen tag.
Publishing the GitHub release triggers npm publication of that verified tarball;
npm Trusted publishing must be configured first. See the root README for setup,
manual retries, and completing older draft releases.
