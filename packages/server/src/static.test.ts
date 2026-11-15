import { createServer, get, type IncomingHttpHeaders, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { isDirectLocalClient } from './client-locality';
import { serveStatic } from './static';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

/** The response as sent, without the decompression `fetch` applies. */
function raw(url: string, headers: Record<string, string>): Promise<{ headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    get(url, { headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ headers: response.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function serve(): Promise<{ origin: string; script: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'opentig-static-'));
  await mkdir(path.join(root, 'assets'));
  await mkdir(path.join(root, 'vscode-icons'));
  const script = `export const text = ${JSON.stringify('x'.repeat(20_000))};\n`;
  await writeFile(path.join(root, 'index.html'), '<!doctype html>');
  await writeFile(path.join(root, 'assets', 'index-AbCdEfGh1.js'), script);
  await writeFile(path.join(root, 'vscode-icons', 'file_type_js.svg'), '<svg/>');
  const server: Server = createServer((request, response) => {
    void serveStatic(root, request.url ?? '/', response, false, { acceptEncoding: request.headers['accept-encoding'], local: isDirectLocalClient(request) });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  cleanups.push(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  return { origin: `http://127.0.0.1:${address.port}`, script };
}

it('compresses for a client through a proxy or the network, and not for a browser on this machine', async () => {
  const { origin, script } = await serve();
  const remote = await raw(`${origin}/assets/index-AbCdEfGh1.js`, { 'Accept-Encoding': 'br, gzip', 'X-Forwarded-For': '203.0.113.7' });
  expect(remote.headers['content-encoding']).toBe('br');
  expect(remote.headers.vary).toBe('Accept-Encoding');
  const body = remote.body;
  expect(body.length).toBeLessThan(script.length / 10);
  expect(brotliDecompressSync(body).toString('utf8')).toBe(script);

  const local = await fetch(`${origin}/assets/index-AbCdEfGh1.js`, { headers: { 'Accept-Encoding': 'br, gzip' } });
  expect(local.headers.get('content-encoding')).toBeNull();
  expect(await local.text()).toBe(script);
});

it('lets browsers keep a file icon for good only when its address names the icon set', async () => {
  const { origin } = await serve();
  expect((await fetch(`${origin}/vscode-icons/file_type_js.svg?v=0123456789ab`)).headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  // An older client asks without the fingerprint, and its icons may change under the same address.
  expect((await fetch(`${origin}/vscode-icons/file_type_js.svg`)).headers.get('cache-control')).toBe('no-cache');
});

it('answers every app address with the app, never with a file under it or an error page', async () => {
  const { origin } = await serve();
  for (const address of ['/r/abc', '/r/abc/file/src/app.ts', '/r/abc/file/assets/index-AbCdEfGh1.js', '/r/abc/file/%E0%A4%A', '/r/abc/file/..%2F..%2Findex.html#L4']) {
    const response = await fetch(`${origin}${address}`);
    expect(response.status, address).toBe(200);
    expect(response.headers.get('content-type'), address).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control'), address).toBe('no-cache');
    expect(await response.text(), address).toBe('<!doctype html>');
  }
  // Paths outside the app's addresses keep their meaning.
  expect((await fetch(`${origin}/assets/missing.js`)).status).toBe(404);
  expect((await fetch(`${origin}/rx/file.js`)).status).toBe(404);
});
