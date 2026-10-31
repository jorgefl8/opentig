# Web access, tunnels, and browser pairing

Keep OpenTig running on the machine that holds your repositories. A browser connects to that instance; files, Git operations, and optional CLI integrations run on the host.

You can connect from the same computer, a trusted LAN/VPN, or an HTTPS reverse proxy. These are different addresses for the same authenticated server and interface. Enabling browser access does not start a second backend.

**Every paired browser has owner access with the permissions of the OS account running OpenTig.** There are no read-only roles or per-repository permissions. Only pair devices and people you trust with that authority. See the [authority model](#authority-model).

- **Remote server over SSH:** [start the CLI and forward a port](#headless-server-over-ssh).
- **Desktop, phone, or another computer:** [choose a connection method](#choose-how-the-browser-connects), then [pair the browser](#pairing-and-sessions).
- **Manage existing access:** [pause browser access](#pause-browser-access), [recover access locally](#recover-access-locally), or [revoke a device](#revoke-access).

## Headless server over SSH

**Requirements:** Node.js 24+ and Git on the remote machine.

1. Start OpenTig on the remote machine:

   ```bash
   npx --yes @opentig/cli@latest serve
   ```

2. Keep that process running. On your laptop, forward a local port:

   ```bash
   ssh -N -L 6767:127.0.0.1:6767 user@your-server
   ```

3. Open `http://127.0.0.1:6767/pair` on the laptop and enter the server's one-use code.
4. Select a repository with the server folder picker. You are browsing the remote host's folders.

If local port 6767 is busy, use `-L 7676:127.0.0.1:6767` and browse to local port 7676 instead. For a phone, use a private VPN or HTTPS reverse proxy as described below. **Never expose the raw HTTP listener to the public internet.**

The headless `@opentig/cli` package exposes the same backend directly and binds to loopback by default. Use `--host` to select another interface; OpenTig prints an owner-authority warning. CLI servers start with browser access enabled.

For a persistent service, follow [installation and CLI](getting-started.md).

<details>
<summary>Service startup, platforms, and updates</summary>

Running the package with `npx` or `bunx` does not change startup configuration. On Linux, macOS, and Windows, `opentig service install` explicitly stages the exact package version under the selected OpenTig home, installs a project-independent user service, and starts it.

Linux enables user lingering for boot persistence. macOS and Windows start at login and stop at logout. Repositories are added, opened, and switched exclusively from the web UI; neither CLI startup nor the service is scoped to a repository.

Use `opentig service status`, `opentig service restart`, or `opentig service uninstall` to manage it. Browser updates restart this managed CLI service without changing the global npm package or desktop app.

</details>

## Choose how the browser connects

A pairing code authorizes the browser, but the browser still needs a network route to OpenTig. Configure private networks and tunnels separately.

| Where the browser is | Connection method |
| --- | --- |
| On the OpenTig computer | **Local**, using its loopback address |
| On a trusted LAN or VPN | **LAN**, using an interface address reachable from that device |
| Across networks, including a phone | An HTTPS reverse proxy/tunnel on the OpenTig host, pointing to loopback |

In the desktop app or an already paired browser, open **Settings → Web access** and enable **Web access**. It is off by default on desktop. **Pair a browser** and its destination choices appear only while access is enabled.

**Connect on the same computer**

Choose **Local** to use:

```text
http://127.0.0.1:<actual-port>
```

Desktop prefers port `6767`, but the displayed actual port takes precedence if it selected another one. The CLI uses its configured port exactly (`6767` by default) and fails on a conflict, so a tunnel target never moves silently.

**Connect through a trusted LAN or VPN**

1. Enable **Web access** and accept the owner-authority warning.
2. Enable **LAN access**.
3. Choose **LAN** and select a listed interface address.

The existing listener rebinds to `0.0.0.0`; no second runtime starts. Browser changes require confirmation because disabling LAN can disconnect a browser using that address. Raw non-loopback HTTP is unencrypted: use only trusted networks and restrict the port with the host firewall.

**Connect through an HTTPS tunnel or proxy**

For Cloudflare Tunnel or another reverse proxy running on the OpenTig computer:

1. Enable **Web access** and leave **LAN access** disabled so the listener stays on loopback.
2. Point the tunnel origin to `http://127.0.0.1:<actual-port>`.
3. In **Pair a browser**, choose **My domain**, enter `https://your-domain.example`, and select **Save and use**.
4. Choose **Create pairing link**. Scan the QR or open the copied link, then choose a recognizable device name. Alternatively, open `https://your-domain.example/pair` and paste the code.

Use an HTTP/HTTPS root address without credentials, paths, query parameters, or fragments. A bare domain defaults to HTTPS. Saving selects the domain for the next link and QR.

**Saving a domain only builds links and QR codes.** It does not configure a tunnel, change the listener, or grant authentication. LAN exposure is unnecessary for a tunnel on the same machine. Protect access across networks with the proxy's own access policy or MFA.

<details>
<summary>Edit or remove the pairing domain</summary>

Choose **Edit** beside the saved domain. **Cancel** preserves it; **Remove** deletes it and switches to **Local**. Link creation is disabled while editing or until a new domain is saved. Canceling a new domain returns to **Local** without saving the draft.

</details>

**Use a private network or tunnel with the CLI**

A Cloudflare Tunnel connector on the same host can forward to `http://127.0.0.1:6767` while the CLI keeps its default loopback listener. On a private Tailscale network, [Tailscale Serve](https://tailscale.com/kb/1312/serve) can provide an HTTPS proxy to that address.

For direct private-interface access, pass `--host <private-interface-IP>` to `opentig serve` or `opentig service install`. Loopback alone is unreachable from another device. Configure the tunnel or private network, open `/pair` at its address, and enter a code generated by `opentig pair`.

<details>
<summary>Proxy headers, origin checks, and HTTPS cookies</summary>

The proxy should preserve `Host` (the normal behavior) or send `X-Forwarded-Host`. OpenTig validates the `Origin` authority against the authority of each HTTP or WebSocket request. The scheme may differ because TLS terminates at the local proxy.

Forwarded hosts are accepted only when the immediate TCP peer is loopback, preventing LAN clients from forging proxy headers. Cloudflare client IP and `X-Forwarded-For` metadata are also trusted only from loopback. HTTPS pairing produces a `Secure` session cookie.

</details>

### Configure access from a browser

Every paired browser can change **Web access**, **LAN access**, and the saved pairing domain. Under **Connection details**, it can also edit **Listening address** and **Port**. These are server settings shared with all clients, including desktop. Saved values survive restarts and override the CLI startup address and port until reset.

| Listening address | Use |
| --- | --- |
| `127.0.0.1` | Local access or a tunnel on the same host |
| `0.0.0.0` | All IPv4 interfaces |
| An IPv4/IPv6 address assigned to the server | One specific interface |

The port must be between 1 and 65535.

**Save edits on connected clients before changing the listener.** Changes require confirmation and wait for running operations. The initiating client blocks changes while it has unsaved files or active operations. A desktop window that needs a new address waits for unsaved edits before reloading.

If binding or saving fails, OpenTig restores the previous listener. Successful changes may disconnect clients: open the new address/port and update the tunnel origin separately. A different hostname may require pairing again because browser cookies are host-specific.

OpenTig does not configure your tunnel, firewall, TLS certificates, or OS service through these controls.

For new pairing links, **Current address** uses the address through which the browser connects, including a tunnel. **Local**, **LAN**, and **My domain** can target other destinations. Saving a domain changes link construction, not authentication or routing.

### Recover access locally

A browser cannot re-enable access while browser authorization is paused. Use the desktop app's private session to re-enable it in Settings, or run these commands locally on the CLI host:

```bash
opentig reset-access
opentig service restart
```

For a custom CLI home, use the same `--home <path>` on both commands. For a foreground server, restart its process instead of using `service restart`.

`reset-access` removes only saved web/listener configuration. After restart, browser access is enabled and the startup address/port apply. Repositories, application preferences, and paired sessions are preserved. Reload a previously paired browser at an address that reaches the server. The paused pairing page also provides recovery instructions.

The command also succeeds if no access configuration is saved. It prints restart guidance for managed and foreground instances but does not restart either automatically. Do not reset access simply because another application occupies the port: close that application or change the listener instead.

<details>
<summary>Recover access to a source Dev instance</summary>

From the source checkout, run `node packages/server/dist/dev.mjs reset-access`, then restart the existing Dev service. Defaults are loopback port `6867` and a separate Dev data directory.

</details>

## Pairing and sessions

1. Create a code or pairing link in **Settings → Web access → Pair a browser**, or generate one on the CLI host with `opentig pair`. `opentig service install` also offers to pair a device as soon as the service is running.
2. Open its link/QR, or paste the code into `/pair` at any address that reaches the same instance.
3. Review the confirmation form and choose a device name.

Codes are **one-use and valid for five minutes**. Generating another code invalidates the previous unused one. The **Close** button dismisses the QR/link/code display, even during creation; it does not invalidate a copied code. Codes remain valid until used, replaced, expired, or invalidated by disabling Web access. Expired codes disappear from the display automatically.

An unpaired browser offers **Pair this browser**, with a copyable CLI command in both the authentication notice and pairing form: `opentig pair` for production or `pnpm run pair:web:dev` for Dev. These views fit narrow screens and scroll when needed.

Opening `/pair` checks the existing session first. Authenticated browsers return to the app; a connection failure offers retry rather than demanding another code. Sessions survive server restarts.

Paired browsers can create another five-minute link or QR using their current address or another selected destination. They can inspect, rename, and revoke sessions, and configure server access.

<details>
<summary>Pairing secrets, cookies, and stored session data</summary>

Pairing links use this form:

```text
<http-or-https-origin>/pair#token=<one-use-secret>
```

The fragment keeps the secret out of the initial HTTP request. The client clears it before displaying the confirmation form, then exchanges the secret and editable device name for a host-only `HttpOnly`, `SameSite=Strict` owner-session cookie. A raw code can be pasted into `/pair` on another domain serving the same instance; it is never put in a query string or browser storage.

Only credential hashes and non-secret display metadata are stored under the server data directory. Browser records retain the editable name, browser/OS/device type, trusted peer address, proxy indicator, and last connection time.

Desktop has a private session established with a one-use bootstrap secret sent through Electron's private utility message channel. A new bootstrap replaces older desktop records.

</details>

### Pause browser access

Turn off **Web access** and confirm with the red **Disable Web access** button. Canceling leaves access enabled.

Confirming immediately blocks browser access on every address, including localhost and tunnels, disconnects paired browsers, and invalidates the pending code. **Paired devices and session credentials stay saved**, including across restarts while paused. The private desktop session keeps working on the same server and port; the switch does not restart the server.

Turning access back on restores still-valid sessions. Reload the browser or select **Check again** on `/pair`. Expired sessions, cleared cookies, or explicit revocation require fresh pairing.

**Pausing from a browser disconnects that browser too.** CLI servers start web-enabled but can also be paused. After you pause a CLI server from a browser, its paused page shows the [local recovery command](#recover-access-locally); a desktop-hosted server is restored from the desktop app. To permanently remove saved access, [revoke the browser](#revoke-access).

<details>
<summary>Listener behavior and migration from older settings</summary>

Web access controls authorization, while the separate **LAN access** setting changes the listener and reconnects clients without replacing the runtime. Disabling Web access retains the LAN preference and can leave the current listener bound until restart. Static assets and health endpoints may still be served while browser backend access is disabled.

Server status and endpoints are grouped with LAN access. Displayed endpoints reflect the active listener. Saved listening address and port settings apply at startup; older desktop settings retain their previous startup policy until a listener change is saved.

Previously enabled LAN settings migrate to both switches enabled. Older loopback-only installations with active paired browsers retain Web access without enabling LAN. This one-time migration preserves sessions and saves the new settings before startup. Installations without active paired browsers remain closed, and an explicit Web access OFF is respected. If sessions cannot be read or migration cannot be saved, startup stops instead of applying a partial migration.

</details>

## Authority model

Every authenticated browser is an owner and uses the permissions of the server's OS account. It can:

- Read, edit, move, and trash repository files.
- Stage, commit, switch branches/worktrees, pull, and push.
- Use authenticated `gh` operations.
- Invoke configured AI CLIs.

There are no read-only roles, per-repository scopes, or multi-user permissions. Do not pair a device or person that should not receive this authority.

## Revoke access

1. Open **Settings → Web access** in desktop OpenTig or an authenticated browser.
2. Find the device in the session list.
3. Revoke that browser, or choose **Revoke browsers** to remove all browser sessions.

You can also rename devices. The list shows the private desktop session and paired browsers, with browser/OS, trusted peer address, proxy state, last activity, and live WebSocket connection/tab counts. These controls do not revoke the private desktop session.

Revoked browsers show fresh-pairing instructions. To admit one again, create a new one-use link from desktop or another authenticated browser. For a headless server, run `opentig pair --home <same-home>` as the same OS user.

<details>
<summary>How the CLI verifies the running instance</summary>

Before printing a new five-minute code, link, and terminal QR, the command verifies the PID, readiness identity, app/protocol version, private instance ID, and same-host admin credential. This credential is stored separately with private file permissions; `runtime.json` never contains it.

</details>

## Connection behavior

Healthy connections show no connection notification. Before the first successful connection, OpenTig shows a full loading state rather than a partial app.

| Situation | What happens |
| --- | --- |
| Connection is interrupted | One persistent notification tracks connecting, reconnecting, offline, or incompatible states without accumulating alerts |
| Connection returns | The notification disappears, fresh application state loads, and events resume for every connected tab |
| Authentication fails | Automatic retries stop and the browser is asked to pair again; browsers without a valid session see pairing instructions without a startup error notification |
| Server upgrade makes the open client incompatible | **Reload** fetches the current interface; the browser still warns about unsaved editor changes |

**Interrupted requests fail and are not replayed on reconnect.** The server may have finished an interrupted change or may still be running it, so a commit, push, pull, or branch switch shows **Result not confirmed** and refreshes. Check the current state before trying again. Each command has its own time limit, long enough for its slowest Git or GitHub CLI steps; while disconnected, a new request waits for the connection for up to 30 seconds and is not sent after that. Retry attempts use bounded exponential backoff and jitter. The connection notification also disappears when pairing is required.

<details>
<summary>Large responses and slow connections</summary>

Each WebSocket response is limited to 4 MiB of UTF-8 JSON, including its envelope and escaped text. Larger results fail with `RESPONSE_TOO_LARGE` while the session stays connected; content is never silently truncated. Request a narrower scope where possible. A diff within Git's 32 MiB output limit can still exceed this transport limit. Images use authenticated HTTP instead of WebSocket JSON.

A separate 8 MiB send-queue budget closes an accumulating slow connection with code 1013. Reconnection does not replay pending operations.

</details>

## Diagnostics

**Check server status**

The desktop Web Access pane reports the server state and actual port, local/detected network endpoints, local/LAN link and QR targets, a domain-independent pairing code, named owner sessions with connection metadata and live counts, and restart errors.

You can also check readiness:

```powershell
Invoke-RestMethod http://127.0.0.1:6767/readyz
```

Use the app's actual port if it differs from `6767`. A ready server returns its status, protocol version, and application version.

To check a CLI service, run `opentig service status` with the same `--home` if applicable. Public `/readyz` alone does not prove that a newly installed service owns that listener.

**If access fails**

- **Browser stuck on Authentication required:** revoke stale sessions if appropriate, create a fresh pairing link, and open that exact link.
- **Desktop cannot connect:** restart the packaged application and inspect the server log and `/readyz` response.

The rotating log is `logs/server.log` inside Electron's OpenTig user-data directory or the selected CLI home. Authentication material and URL secrets are redacted.

CLI service installation and restart also report known startup failures immediately, with the selected home and recovery instructions. See [command errors and recovery](getting-started.md#command-errors-and-recovery) for port conflicts, startup output, and service recovery.

<details>
<summary>Enable WebSocket performance logging</summary>

Set `OPENTIG_PERF_LOG=1` before starting the server to add performance metadata to the existing log. It is disabled by default and adds I/O when enabled.

Entries include validated operation names, request bytes, encoded JSON bytes, serialization/request duration, queued bytes, and send outcome. Broadcasts are encoded once; send measurements remain per socket. Oversized responses report the replacement error's encoded size, not the original content size.

Send duration ends at the `ws` write callback. It does not measure receipt, JSON parsing, or client rendering. Payloads, paths, correlation IDs, session IDs, and authentication material are excluded.

</details>

## Safe deployment

- Use a trusted LAN or VPN and restrict the port with the host firewall.
- Across networks, point a same-machine HTTPS reverse proxy/tunnel at loopback and use its access policy or MFA.
- Never forward the raw HTTP port to the public internet. Avoid untrusted Wi-Fi: non-loopback HTTP is unencrypted.
- Revoke sessions when a paired device is lost or no longer trusted.

OpenTig does not provide built-in TLS, user roles, a relay, Tailscale/SSH automation, or Docker packaging. External network controls must protect remote deployments. Managed CLI services are available on Linux, macOS, and Windows, but Windows/macOS services do not run before login; see [installation and CLI](getting-started.md#background-services).
