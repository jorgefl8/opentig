# Network access and browser pairing

OpenTig can expose its existing desktop backend to trusted browsers on the same
LAN or VPN. Enabling Network Access does not start a second server: Electron
restarts the same supervised utility listener on network interfaces.

The headless `@opentig/cli` package exposes the same backend directly. It binds
to loopback by default; `--host` is required for another interface and prints
the same owner-authority warning.

## Enable access

1. Open **Settings → Network access** in the desktop application.
2. Enable **Network access** and accept the owner-level authority warning.
3. Select the address that the pairing link should use when more than one
   network interface is available.
4. Choose **Create pairing link**.
5. Open the link or scan its QR code within five minutes.

The setting is desktop-only. A browser cannot expose the listener, mint a link
through Electron, or change desktop server configuration.

Loopback is the default:

```text
http://127.0.0.1:<actual-port>
```

When enabled, the listener binds to `0.0.0.0` and the settings pane lists usable
LAN endpoints. Port `6767` is preferred; the displayed actual port is
authoritative if OpenTig had to select another one.

## Pairing and sessions

The pairing URL has this form:

```text
http://<trusted-address>:<port>/pair#token=<one-use-secret>
```

The secret is carried in the URL fragment, so it is not sent in the initial HTTP
request. The client exchanges it once, clears the fragment, and receives a
host-only `HttpOnly`, `SameSite=Strict` owner-session cookie. Generating another
pairing link invalidates the previous unconsumed link.

Owner sessions persist across server restarts. Only credential hashes are stored
under the server data directory. The desktop has its own private session,
established with a one-use bootstrap secret sent over Electron's private utility
message channel.

## Authority model

Every authenticated browser is an owner. It can use OpenTig with the permissions
of the OS account running the server, including:

- reading, editing, moving, and trashing repository files;
- staging, committing, switching branches/worktrees, pulling, and pushing;
- using authenticated `gh` operations;
- invoking configured AI CLIs.

There are no read-only roles, per-repository scopes, or multi-user permissions.
Do not pair a device or person that should not receive this authority.

## Revoke access

Choose **Revoke all sessions** in the desktop settings pane to disconnect every
paired browser immediately. OpenTig replaces its private desktop session so the
desktop can continue without reopening the application.

A revoked browser shows fresh-pairing instructions. Create a new one-use link
from the desktop to admit it again.

For a headless server, run `opentig pair --home <same-home>` as the same OS user.
The command verifies the PID, readiness identity, app/protocol version, private
instance ID, and same-host admin credential before printing a new five-minute
link and terminal QR. The credential is stored separately with private file
permissions; `runtime.json` never contains it.

## Connection behavior

Healthy connections do not show a persistent status pill. A visible pill means
the client is reconnecting, offline, or incompatible. Before the first successful
connection, OpenTig shows a full loading state instead of a partial application.

On a transient disconnect:

- pending requests fail rather than being replayed;
- the transport retries with bounded exponential backoff and jitter;
- a successful reconnect bootstraps fresh application state;
- server events resume for every connected tab.

Authentication failure stops automatic retries and asks the browser to pair
again.

## Diagnostics

The desktop Network Access pane reports:

- server state and actual port;
- local and detected network endpoints;
- connected owner-session count;
- restart errors.

Additional checks:

```powershell
Invoke-RestMethod http://127.0.0.1:6767/readyz
```

Use the actual port shown by the application if it is not `6767`. A ready server
returns its status, protocol version, and application version. The rotating
server log is stored at `logs/server.log` inside Electron's OpenTig user-data
directory or the selected CLI home; authentication material and URL secrets are
redacted.

If a browser remains on **Authentication required**, revoke stale sessions if
appropriate, create a fresh pairing link, and open that exact link. If the
desktop cannot connect, restart the packaged application and inspect the server
log and `/readyz` response.

## Safe deployment

Treat raw Network Access as trusted-network functionality:

- use a trusted LAN or VPN;
- for access across networks, use an HTTPS reverse proxy or SSH tunnel;
- restrict the port with the host firewall;
- never forward the raw HTTP port to the public Internet;
- avoid untrusted Wi-Fi because non-loopback HTTP is not encrypted;
- revoke sessions when a paired device is lost or no longer trusted.

OpenTig does not currently ship built-in TLS, user roles, a relay, Tailscale/SSH
automation, Docker packaging, or a service manager. Those omissions are
intentional; external network controls must protect remote deployments.
