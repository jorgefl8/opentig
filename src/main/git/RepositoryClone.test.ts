import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execa } from 'execa';
import { cloneRepository } from './RepositoryClone';
import { GitProcess, type RunOptions } from './GitProcess';
import { cloneFailureMessage, cloneInputError, cloneSource, parseCloneProgress, type CloneJob } from '../../shared/onboarding';

type Progress = Pick<CloneJob, 'phase' | 'percent' | 'received'>;

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(path.join(tmpdir(), 'opentig-clone-')); roots.push(value); return value; }
const input = (parentPath: string) => ({ url: 'https://example.com/sample.git', parentPath, folderName: 'sample' });

describe('repository cloning', () => {
  it('clones a real HTTP repository into a new folder without changing its source', async () => {
    const directory = await root(), source = path.join(directory, 'source'), bare = path.join(directory, 'sample.git');
    await mkdir(source);
    await execa('git', ['init', source]);
    await writeFile(path.join(source, 'README.md'), 'sample\n');
    await execa('git', ['add', '.'], { cwd: source });
    await execa('git', ['-c', 'user.name=Sample', '-c', 'user.email=sample@example.com', 'commit', '-m', 'Initial'], { cwd: source });
    await execa('git', ['clone', '--bare', source, bare]);
    await execa('git', ['update-server-info'], { cwd: bare });
    const server = createServer((request, response) => {
      const target = path.join(directory, new URL(request.url!, 'http://localhost').pathname);
      void readFile(target).then(data => { response.end(data); }, () => { response.statusCode = 404; response.end(); });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const progress: Progress[] = [];
      const destination = await cloneRepository(new GitProcess(), { ...input(directory), url: 'http://127.0.0.1:' + port + '/sample.git' }, new AbortController().signal, value => progress.push(value));
      // Windows checkouts may convert line endings (core.autocrlf).
      expect((await readFile(path.join(destination, 'README.md'), 'utf8')).replace(/\r\n/g, '\n')).toBe('sample\n');
      expect((await execa('git', ['status', '--porcelain'], { cwd: source })).stdout).toBe('');
      expect(progress[0]?.phase).toBe('Connecting to remote');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('refuses even an empty existing destination and never starts Git', async () => {
    const directory = await root(); await mkdir(path.join(directory, 'sample'));
    const run = vi.fn();
    await expect(cloneRepository({ run } as unknown as GitProcess, input(directory), new AbortController().signal, vi.fn())).rejects.toThrow('already exists');
    expect(run).not.toHaveBeenCalled();
    expect(await readdir(path.join(directory, 'sample'))).toEqual([]);
  });

  it('retains partial data on cancellation and exposes only recognized progress', async () => {
    const directory = await root(), controller = new AbortController(), progress: Progress[] = [];
    // The clone resolves its parent; on Windows that can expand short names in the temp path.
    const destination = path.join(await realpath(directory), 'sample');
    const run = vi.fn(async (_cwd: string, args: string[], options: RunOptions) => {
      expect(args.slice(-3)).toEqual(['--', input(directory).url, destination]);
      await writeFile(path.join(destination, 'keep.txt'), 'partial work');
      options.onStderr?.('Receiving objects: 42% (42/100), 1.50 MiB | 2.00 MiB/s\rprivate remote diagnostic\n');
      controller.abort();
      throw new Error('aborted');
    });
    await expect(cloneRepository({ run } as unknown as GitProcess, input(directory), controller.signal, value => progress.push(value))).rejects.toThrow('partial data');
    expect(await readFile(path.join(directory, 'sample', 'keep.txt'), 'utf8')).toBe('partial work');
    expect(progress).toContainEqual({ phase: 'Receiving objects', percent: 34, received: '1.50 MiB' });
    expect(JSON.stringify(progress)).not.toContain('private remote');
  });

  it('removes only the empty reservation after failure and can retry', async () => {
    const git = { run: vi.fn(async (_cwd: string, _args: string[], options: RunOptions) => {
      options.onStderr?.('fatal: Authentication failed for \'https://example.com/sample.git/\'\n');
      throw new Error('exit 128');
    }) } as unknown as GitProcess;
    const directory = await root();
    await expect(cloneRepository(git, input(directory), new AbortController().signal, vi.fn())).rejects.toThrow(/^Authentication failed\. Sign in/);
    expect(await readdir(directory)).toEqual([]);
  });

  it.each(['file:///tmp/repo', 'ext::command', '--upload-pack=command', 'https://token@example.com/repo', 'https://example.com/repo?token=secret', '-oProxyCommand=x@host:repo', 'git@-oProxy:repo', 'git@host:-repo'])('rejects unsupported or credential-bearing URL %s', url => {
    expect(cloneInputError({ ...input('/projects'), url })).not.toBeNull();
  });
  it.each(['../other', '..', '.', 'CON', 'sample/other', 'a\\b', 'nul.txt'])('rejects unsafe destination name %s', folderName => {
    expect(cloneInputError({ ...input('/projects'), folderName })).not.toBeNull();
  });
  it.each(['https://example.com/org/repo.git', 'git@example.com:org/repo.git', 'ssh://git@example.com:2222/org/repo.git'])('accepts network repository URL %s', url => {
    expect(cloneInputError({ ...input('/projects'), url })).toBeNull();
  });

  it('weights Git phases into one forward-moving percentage', () => {
    expect(parseCloneProgress('Counting objects: 100% (5/5), done.')).toEqual({ phase: 'Preparing objects', percent: null, received: null });
    expect(parseCloneProgress('Receiving objects: 100% (5/5), 41.20 MiB | 3.00 MiB/s, done.')).toEqual({ phase: 'Receiving objects', percent: 80, received: '41.20 MiB' });
    expect(parseCloneProgress('Resolving deltas:  50% (1/2)')).toMatchObject({ percent: 88 });
    expect(parseCloneProgress('Updating files: 100% (9/9), done.')).toMatchObject({ phase: 'Checking out files', percent: 100 });
    expect(parseCloneProgress('remote: hello')).toBeNull();
  });
  it('maps common failures to actionable messages', () => {
    expect(cloneFailureMessage('git@github.com: Permission denied (publickey).')).toMatch(/^SSH key rejected/);
    expect(cloneFailureMessage('ERROR: Repository not found.')).toMatch(/^Repository not found/);
    expect(cloneFailureMessage('Could not resolve host: example.invalid')).toMatch(/^Could not reach/);
  });
  it('describes the host and transport of valid URLs', () => {
    expect(cloneSource('git@github.com:acme/payments.git')).toEqual({ host: 'GitHub', transport: 'SSH' });
    expect(cloneSource('https://gitlab.example.com/acme/payments.git')).toEqual({ host: 'gitlab.example.com', transport: 'HTTPS' });
    expect(cloneSource('https://github.com')).toBeNull();
  });
});
