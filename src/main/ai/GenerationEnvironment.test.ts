import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withGenerationEnvironment } from './GenerationEnvironment';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function directory() { const dir = await mkdtemp(path.join(os.tmpdir(), 'opentig-profile-test-')); directories.push(dir); return dir; }

describe('generation profiles', () => {
  it('keeps Codex credentials linked but excludes global rules and configuration, and cleans up on failure', async () => {
    const home = await directory();
    await writeFile(path.join(home, 'auth.json'), 'fake-authentication');
    await writeFile(path.join(home, 'AGENTS.md'), 'GLOBAL_MARKER');
    await writeFile(path.join(home, 'config.toml'), 'UNTRUSTED_CONFIG');
    let temporary = '';
    await expect(withGenerationEnvironment('codex', { CODEX_HOME: home, CODEX_CONFIG_PATH: '/untrusted', CODEX_PROFILE: 'unsafe' }, async options => {
      temporary = options.cwd!;
      expect(options.env?.CODEX_HOME).not.toBe(home);
      expect(options.removeEnv).toEqual(expect.arrayContaining(['CODEX_CONFIG_PATH', 'CODEX_PROFILE']));
      await expect(access(path.join(options.env!.CODEX_HOME!, 'AGENTS.md'))).rejects.toThrow();
      await expect(access(path.join(options.env!.CODEX_HOME!, 'config.toml'))).rejects.toThrow();
      expect((await stat(path.join(options.env!.CODEX_HOME!, 'auth.json'))).ino).toBe((await stat(path.join(home, 'auth.json'))).ino);
      await writeFile(path.join(options.env!.CODEX_HOME!, 'auth.json'), 'refreshed-fake-authentication');
      throw new Error('cancelled');
    })).rejects.toThrow('cancelled');
    await expect(access(temporary)).rejects.toThrow();
    expect(await readFile(path.join(home, 'auth.json'), 'utf8')).toBe('refreshed-fake-authentication');
    expect(await readFile(path.join(home, 'AGENTS.md'), 'utf8')).toBe('GLOBAL_MARKER');
  });
  it('isolates OpenCode configuration and environment overrides while preserving only the authentication data root', async () => {
    const data = await directory();
    await withGenerationEnvironment('opencode', { XDG_DATA_HOME: data, OPENCODE_CONFIG: '/untrusted', OPENCODE_CONFIG_CONTENT: '{"plugins":["untrusted"]}', OPENCODE_MODELS_URL: 'https://untrusted.invalid' }, async options => {
      expect(options.env?.XDG_DATA_HOME).toBe(data);
      expect(options.env?.HOME).toBe(options.cwd);
      expect(options.env?.OPENCODE_CONFIG_PROJECT_DISABLE).toBe('1');
      expect(options.env?.OPENCODE_CONFIG_DIR).toContain(options.cwd);
      expect(options.removeEnv).toEqual(expect.arrayContaining(['OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_MODELS_URL']));
    });
  });
  it('refuses remote OpenCode configuration without reading credentials', async () => {
    const data = await directory(); await mkdir(path.join(data, 'opencode'));
    const database = new DatabaseSync(path.join(data, 'opencode', 'opencode.db'));
    database.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT); INSERT INTO kv VALUES ('wellknown:sources', '[\"https://untrusted.invalid\"]'); CREATE TABLE credential (value TEXT); INSERT INTO credential VALUES ('FAKE_SECRET');");
    database.close();
    let ran = false;
    await expect(withGenerationEnvironment('opencode', { XDG_DATA_HOME: data }, async () => { ran = true; })).rejects.toMatchObject({ detail: { operation: 'ai-isolation' } });
    expect(ran).toBe(false);
  });
});
