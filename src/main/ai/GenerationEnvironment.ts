import { link, mkdtemp, rm, stat, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { CliRunOptions } from './CliProcessRunner';
import { AiOperationError } from '../../shared/errors';

/** Disposable working directory and customization roots; never mount a repository. */
export async function withGenerationEnvironment<T>(harness: 'codex' | 'claude' | 'opencode', inherited: Record<string, string>, run: (options: CliRunOptions) => Promise<T>): Promise<T> {
  const source = { ...process.env, ...inherited };
  const userHome = (process.platform === 'win32' ? source.USERPROFILE : source.HOME) || os.homedir();
  const temporary = await mkdtemp(path.join(os.tmpdir(), `opentig-${harness}-`));
  const env: Record<string, string> = {
    HOME: temporary, USERPROFILE: temporary,
    XDG_CONFIG_HOME: path.join(temporary, 'config'), XDG_DATA_HOME: path.join(temporary, 'data'),
    XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_STATE_HOME: path.join(temporary, 'state'),
  };
  const prefix = { codex: 'CODEX_', claude: 'CLAUDE_', opencode: 'OPENCODE_' }[harness];
  const removeEnv = Object.keys(source).filter(key => key.startsWith(prefix));
  let codexProfile: string | undefined;
  try {
    if (harness === 'codex') {
      // Keep the working directory outside the repository. The separate profile
      // lives on the credential file's volume, where a hard link is possible.
      codexProfile = await createCodexProfile(path.join(source.CODEX_HOME || path.join(userHome, '.codex'), 'auth.json'));
      env.CODEX_HOME = codexProfile;
    } else if (harness === 'claude') {
      // safe-mode excludes user customizations while keeping native keychain authentication.
      env.HOME = source.HOME || os.homedir();
      env.USERPROFILE = source.USERPROFILE || os.homedir();
      if (source.CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = source.CLAUDE_CONFIG_DIR;
      if (source.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = source.CLAUDE_CODE_OAUTH_TOKEN;
      env.CLAUDE_CODE_SAFE_MODE = '1';
    } else {
      // OpenCode 2 stores CLI-owned authentication in its database. Configuration,
      // instructions and plugins come from separate roots, which remain private.
      env.XDG_DATA_HOME = source.XDG_DATA_HOME || path.join(userHome, '.local', 'share');
      env.OPENCODE_CONFIG_DIR = path.join(temporary, 'config', 'opencode');
      env.OPENCODE_TEST_HOME = temporary;
      env.OPENCODE_CONFIG_PROJECT_DISABLE = '1';
      if (source.OPENCODE_DB) env.OPENCODE_DB = source.OPENCODE_DB;
      if (source.OPENCODE_DISABLE_CHANNEL_DB) env.OPENCODE_DISABLE_CHANNEL_DB = source.OPENCODE_DISABLE_CHANNEL_DB;
      await requireNoOpenCodeRemoteConfiguration(path.join(env.XDG_DATA_HOME, 'opencode'), source.OPENCODE_DB);
    }
    return await run({ cwd: temporary, env, removeEnv: removeEnv.filter(key => !(key in env)) });
  } finally {
    await Promise.all([temporary, ...(codexProfile ? [codexProfile] : [])].map(directory => rm(directory, { recursive: true, force: true, maxRetries: 3 })));
  }
}

async function createCodexProfile(source: string): Promise<string> {
  let profile: string | undefined;
  try {
    const authentication = await realpath(source);
    if (!(await stat(authentication)).isFile()) throw new Error('not a file');
    profile = await mkdtemp(path.join(path.dirname(authentication), '.opentig-generation-'));
    // A hard link grants the CLI access without reading/copying credentials and
    // allows in-place CLI token refreshes to update the original file.
    await link(authentication, path.join(profile, 'auth.json'));
    return profile;
  } catch {
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3 });
    throw new AiOperationError({ code: 'AI_AUTH_REQUIRED', operation: 'ai-isolation', harness: 'codex',
      message: 'Could not access Codex file authentication in an isolated profile. Check Codex file credential storage and permission to create a private profile in its authentication directory.' });
  }
}

/** Read only remote-configuration metadata, never credential rows or values. */
async function requireNoOpenCodeRemoteConfiguration(data: string, explicit?: string): Promise<void> {
  try {
    const filenames = explicit ? (explicit === ':memory:' ? [] : [path.resolve(data, explicit)]) : (await readdir(data).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })).filter(name => /^opencode(?:-[a-zA-Z0-9._-]+)?\.db$/.test(name)).map(name => path.join(data, name));
    for (const filename of filenames) {
      if (filename === ':memory:') continue;
      try { await stat(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      const database = new DatabaseSync(filename, { readOnly: true, allowExtension: false });
      try {
        const row = database.prepare("SELECT value FROM kv WHERE key = 'wellknown:sources'").get();
        if (row && row.value !== '[]') throw new Error('remote configuration');
      } finally { database.close(); }
    }
  } catch {
    throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-isolation', harness: 'opencode',
      message: 'OpenTig cannot isolate this OpenCode database: remote configuration is registered or its configuration metadata could not be verified. Use an OpenCode profile without remote configuration, or choose another harness.' });
  }
}
