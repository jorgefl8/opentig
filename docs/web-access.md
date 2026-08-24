# Web access, tunnels, and browser pairing

OpenTig can connect browsers on the same computer, on a trusted LAN/VPN, or
through a local HTTPS reverse proxy such as Cloudflare Tunnel. These are three
addresses for the same authenticated server/runtime/client; no duplicate
headless backend is started.

The headless `@opentig/cli` package exposes the same backend directly. It binds
to loopback by default; `--host` is required for another interface and prints
the same owner-authority warning.

## Choose how the browser connects

Open **Settings → Web access** in the desktop application, choose the address
for the pairing link, create it, then open the link or scan its QR within five
minutes.

For a browser on the same PC, select the always-available loopback endpoint:

```text
http://127.0.0.1:<actual-port>
```

For another device on a trusted LAN or VPN, enable **LAN access**, accept the
owner-authority warning, and select a listed interface address. The same
supervised utility restarts on `0.0.0.0`; it does not start a second server.

For Cloudflare Tunnel or another reverse proxy running on the OpenTig PC:

1. Leave **LAN access** disabled so the listener remains on loopback.
2. Point the tunnel origin service to `http://127.0.0.1:<actual-port>`.
3. Save the exact public origin under **External HTTPS URL**, for example
   `https://opentig.example.com`.
4. Select that HTTPS address and create the pairing link.

The external URL must be an HTTPS origin without credentials, path, query, or
fragment. OpenTig allows that exact origin for authenticated HTTP mutations and
WebSocket upgrades and marks the resulting session cookie `Secure`. It does not
trust arbitrary `Host`, `Origin`, or forwarded-protocol values. LAN exposure is
not required for a tunnel process running on the same computer.

Listener, external-origin, and Electron pairing controls are desktop-only. An
authenticated browser can inspect and revoke sessions, but cannot rebind the
desktop listener or change its trusted external origin.

Port `6767` is preferred; the displayed actual port is authoritative if OpenTig
had to select another one.

## Pairing and sessions

The pairing URL has this form:

```text
<http-or-https-origin>/pair#token=<one-use-secret>
```

The secret is carried in the URL fragment, so it is not sent in the initial HTTP
request. The client exchanges it once, clears the fragment, and receives a
host-only `HttpOnly`, `SameSite=Strict` owner-session cookie. Generating another
pairing link invalidates the previous unconsumed link.

Owner sessions persist across server restarts. Only credential hashes and
non-secret display metadata are stored under the server data directory. The
desktop has its own private session, established with a one-use bootstrap secret
sent over Electron's private utility message channel. It is labelled separately
from paired browser sessions.

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

Open **Settings → Web access** in either desktop OpenTig or an authenticated
browser. The session list shows the private desktop session, each paired browser,
its creation time, observed peer address, current browser, and live WebSocket
connection/tab count. Revoke one browser or all browser sessions. The private
desktop session is not revoked by these controls.

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

The desktop Web Access pane reports:

- server state and actual port;
- local and detected network endpoints;
- local, LAN, and configured external pairing targets;
- individual owner sessions and live connection counts;
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

Treat raw LAN access as trusted-network functionality:

- use a trusted LAN or VPN;
- for access across networks, configure an exact external HTTPS URL and use a
  reverse proxy/tunnel with its own access policy or MFA;
- restrict the port with the host firewall;
- never forward the raw HTTP port to the public Internet;
- avoid untrusted Wi-Fi because non-loopback HTTP is not encrypted;
- revoke sessions when a paired device is lost or no longer trusted.

OpenTig does not currently ship built-in TLS, user roles, a relay, Tailscale/SSH
automation, Docker packaging, or a service manager. Those omissions are
intentional; external network controls must protect remote deployments.
