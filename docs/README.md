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

The public `opentig` npm CLI, `npx`/`bunx` distribution, release automation, and
signed public release pipeline are not shipped yet. They are the next delivery
stage; the current `@opentig/server` workspace remains private and is packaged
only as part of the desktop application.
