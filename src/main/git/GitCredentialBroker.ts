import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

/** Git invokes helpers through its POSIX shell, including Git for Windows. */
export function gitShellQuote(value: string): string {
  return `'${value.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`;
}

export function managedGitHubPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/^https:\/\/github\.com\//i.test(value) || url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) return null;
    if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(url.pathname)) return null;
    return url.pathname.slice(1);
  } catch { return null; }
}

/** Token stays in this process. Only credential get receives it over a private,
 * bounded loopback exchange. This is not isolation from hostile same-user code. */
export async function createCredentialBroker(url: string, login: string, token: string) {
  const allowedPath = managedGitHubPath(url);
  if (!allowedPath) throw new Error('Managed authentication requires one plain github.com HTTPS repository URL.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-git-auth-'));
  const key = randomBytes(32).toString('hex');
  const server = createServer((request, response) => {
    response.setHeader('Connection', 'close');
    if (request.method !== 'POST' || request.url !== '/' || request.headers['x-opentig-key'] !== key) { response.writeHead(403).end(); return; }
    let body = '';
    request.setTimeout(5_000, () => request.destroy());
    request.on('data', (data: Buffer) => { body += data.toString('utf8'); if (body.length > 8192) request.destroy(); });
    request.on('end', () => {
      const fields = body.trim().split('\n').map(line => line.replace(/\r$/, '').split(/=(.*)/s));
      const value = Object.fromEntries(fields.map(([name, field]) => [name, field]));
      const unique = ['protocol', 'host', 'path'].every(name => fields.filter(([key]) => key === name).length === 1);
      if (!unique || value.protocol !== 'https' || value.host !== 'github.com' || value.path !== allowedPath) { response.writeHead(403).end(); return; }
      response.end(`username=${login}\npassword=${token}\n\n`);
    });
  });
  const dispose = async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  };
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const headers = path.join(directory, 'headers');
    const helper = path.join(directory, 'helper.sh');
    await writeFile(headers, `X-OpenTig-Key: ${key}\n`, { mode: 0o600 });
    // curl is included in Git for Windows. --disable ignores user curlrc;
    // no proxy or redirect is allowed even for this local credential exchange.
    await writeFile(helper, `#!/bin/sh\n[ "$1" = get ] || exit 0\ncurl --disable --silent --fail --noproxy '*' --max-time 10 --proto '=http' --header @${gitShellQuote(headers)} --data-binary @- http://127.0.0.1:${port}/ || exit 1\n`, { mode: 0o700 });
    return { helper: `!sh ${gitShellQuote(helper)}`, directory, dispose };
  } catch (error) { await dispose(); throw error; }
}
