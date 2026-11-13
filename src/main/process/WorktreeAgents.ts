import { execFile } from 'node:child_process';
import { readdir, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { WorktreeAgents } from '../../shared/git-types';

/**
 * Finds coding agents working in a repository's worktrees, so OpenTig can say
 * where they are and warn before switching the branch under one of them.
 *
 * Two independent signals:
 * - A running agent process whose working directory is inside the worktree.
 *   Linux reads /proc and macOS asks `ps` and `lsof`; Windows offers no
 *   supported way to read another process's working directory.
 * - Claude Code's lock on a worktree it created, whose reason names its
 *   process (`claude agent … (pid 123 …)`). That works on every platform while
 *   the process is still alive.
 */

interface AgentSignature {
  name: string;
  /** The executable's own name, or the name of the script an interpreter runs. */
  command: RegExp;
  /** npm packages whose files an interpreter runs for this agent. */
  packages: string[];
}

const AGENTS: AgentSignature[] = [
  { name: 'Claude Code', command: /^claude$/, packages: ['@anthropic-ai/claude-code'] },
  // npm's launcher starts a native binary named after its target triple.
  { name: 'Codex', command: /^codex(?:-(?:x86_64|aarch64)-.*)?$/, packages: ['@openai/codex'] },
  { name: 'OpenCode', command: /^\.?opencode$/, packages: ['opencode-ai'] },
  { name: 'Grok Build', command: /^grok$/, packages: [] },
  { name: 'Gemini CLI', command: /^gemini$/, packages: ['@google/gemini-cli'] },
  { name: 'Copilot CLI', command: /^copilot$/, packages: ['@github/copilot'] },
  { name: 'Cursor Agent', command: /^cursor-agent$/, packages: [] },
  { name: 'Aider', command: /^aider$/, packages: [] },
];

const INTERPRETER = /^(?:node|nodejs|bun|deno|python(?:\d+(?:\.\d+)*)?)$/;
const CLAUDE_LOCK = /^claude\s.*\(pid (\d+)(?: start [^)]*)?\)\s*$/;
/** Several windows and the switch check may ask at once; one scan serves them. */
const SCAN_REUSE_MS = 1_500;

export interface ProcessEntry {
  pid: number;
  ppid: number;
  /** The executable name the system reports, which may be truncated. */
  command: string;
  argv: string[];
}

export interface AgentProcess {
  pid: number;
  name: string;
  /** Unknown when the system wouldn't say, such as for another user's process. */
  cwd: string | null;
}

export interface WorktreeAgentsOptions {
  platform?: NodeJS.Platform;
  /** OpenTig's own process: agents it starts itself, such as for commit messages, don't count. */
  ownPid?: number;
  /**
   * Replaces the process scan; tests use it to stay independent of the machine.
   * `null` means this system can't list processes, as on Windows.
   */
  scan?: () => Promise<AgentProcess[] | null>;
  isAlive?: (pid: number) => boolean;
}

/** The agent a process runs, judged only from its name and arguments. */
export function agentName(command: string, argv: readonly string[]): string | null {
  const executable = commandName(command);
  const first = commandName(argv[0] ?? '');
  for (const agent of AGENTS) {
    if (agent.command.test(executable) || agent.command.test(first)) return agent.name;
  }
  if (!INTERPRETER.test(executable) && !INTERPRETER.test(first)) return null;
  const joined = argv.join(' ').replace(/\\/g, '/');
  const script = commandName(argv.slice(1).find((argument) => !argument.startsWith('-')) ?? '');
  for (const agent of AGENTS) {
    if (agent.command.test(script)) return agent.name;
    if (agent.packages.some((name) => joined.includes(`/node_modules/${name}/`))) return agent.name;
  }
  // `python -m aider`
  const module = argv.indexOf('-m');
  return module >= 0 && argv[module + 1] === 'aider' ? 'Aider' : null;
}

/** The process id a Claude Code worktree lock names, if the lock is one. */
export function claudeLockPid(reason: string | null): number | null {
  const match = reason ? CLAUDE_LOCK.exec(reason) : null;
  return match ? Number(match[1]) : null;
}

/** Reads `lsof -F n` output into working directories by process. */
export function parseLsofWorkingDirectories(output: string): Map<number, string> {
  const directories = new Map<number, string>();
  let pid: number | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== null && !directories.has(pid)) directories.set(pid, line.slice(1));
  }
  return directories;
}

/** Reads `ps -o pid= -o ppid= -o args=` output; arguments with spaces can't be told apart there. */
export function parsePsProcesses(output: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const argv = match[3]!.trim().split(/\s+/);
    entries.push({ pid: Number(match[1]), ppid: Number(match[2]), command: argv[0] ?? '', argv });
  }
  return entries;
}

export class WorktreeAgentsDetector {
  private readonly platform: NodeJS.Platform;
  private readonly ownPid: number;
  private readonly scanProcesses: () => Promise<AgentProcess[] | null>;
  private readonly isAlive: (pid: number) => boolean;
  private lastScan: { at: number; result: Promise<AgentProcess[] | null> } | null = null;

  constructor(options: WorktreeAgentsOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.ownPid = options.ownPid ?? process.pid;
    this.scanProcesses = options.scan ?? (() => this.scanSystem());
    this.isAlive = options.isAlive ?? processAlive;
  }

  /** Agents in each worktree that has any; a process counts only for the innermost worktree holding it. */
  async find(worktrees: ReadonlyArray<{ path: string; locked: string | null }>): Promise<WorktreeAgents[]> {
    const roots = await Promise.all(worktrees.map(async (worktree) => ({ path: worktree.path, key: await this.canonical(worktree.path) })));
    const found = new Map<string, Set<string>>();
    const add = (worktreePath: string, name: string) => {
      const names = found.get(worktreePath) ?? new Set<string>();
      names.add(name);
      found.set(worktreePath, names);
    };
    const processes = await this.processes();
    const agentPids = processes ? new Set(processes.map((agent) => agent.pid)) : null;
    for (const worktree of worktrees) {
      const pid = claudeLockPid(worktree.locked);
      // A lock outlives a session that crashed, and its process id may since belong to another program.
      if (pid !== null && pid !== this.ownPid && this.isAlive(pid) && (!agentPids || agentPids.has(pid))) add(worktree.path, 'Claude Code');
    }
    for (const agent of processes ?? []) {
      if (!agent.cwd) continue;
      const cwd = this.comparable(agent.cwd);
      let owner: { path: string; key: string } | null = null;
      for (const root of roots) {
        if ((cwd === root.key || cwd.startsWith(root.key.endsWith(path.sep) ? root.key : `${root.key}${path.sep}`))
          && (!owner || root.key.length > owner.key.length)) owner = root;
      }
      if (owner) add(owner.path, agent.name);
    }
    return worktrees.filter((worktree) => found.has(worktree.path))
      .map((worktree) => ({ path: worktree.path, agents: [...found.get(worktree.path)!].sort() }));
  }

  private processes(): Promise<AgentProcess[] | null> {
    const now = Date.now();
    if (!this.lastScan || now - this.lastScan.at > SCAN_REUSE_MS) {
      // A failed scan leaves the processes unknown rather than stopping the caller.
      this.lastScan = { at: now, result: this.scanProcesses().catch(() => null) };
    }
    return this.lastScan.result;
  }

  private async scanSystem(): Promise<AgentProcess[] | null> {
    if (this.platform === 'linux') return this.agentsAmong(await linuxProcesses(), linuxWorkingDirectories);
    if (this.platform === 'darwin') {
      const output = await run('ps', ['-axww', '-o', 'pid=', '-o', 'ppid=', '-o', 'args=']);
      return this.agentsAmong(parsePsProcesses(output), macWorkingDirectories);
    }
    return null;
  }

  private async agentsAmong(entries: ProcessEntry[], workingDirectories: (pids: number[]) => Promise<Map<number, string>>): Promise<AgentProcess[]> {
    const parents = new Map(entries.map((entry) => [entry.pid, entry.ppid]));
    const candidates = entries.flatMap((entry) => {
      const name = agentName(entry.command, entry.argv);
      return name && entry.pid !== this.ownPid && !this.startedByOpenTig(entry.pid, parents) ? [{ pid: entry.pid, name }] : [];
    });
    if (candidates.length === 0) return [];
    const directories = await workingDirectories(candidates.map((candidate) => candidate.pid));
    return candidates.map((candidate) => ({ ...candidate, cwd: directories.get(candidate.pid) ?? null }));
  }

  private startedByOpenTig(pid: number, parents: Map<number, number>): boolean {
    let current = parents.get(pid);
    for (let depth = 0; current !== undefined && current > 1 && depth < 64; depth += 1) {
      if (current === this.ownPid) return true;
      current = parents.get(current);
    }
    return false;
  }

  private async canonical(value: string): Promise<string> {
    return this.comparable(await realpath(value).catch(() => path.resolve(value)));
  }

  /** macOS and Windows file systems usually ignore case. */
  private comparable(value: string): string {
    const resolved = path.resolve(value);
    return this.platform === 'darwin' || this.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
}

function commandName(value: string): string {
  return (value.split(/[\\/]/).pop() ?? '').replace(/\.(?:exe|cmd|js|mjs|cjs)$/i, '');
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // The process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function linuxProcesses(): Promise<ProcessEntry[]> {
  const ids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name));
  const entries = await Promise.all(ids.map(async (id): Promise<ProcessEntry | null> => {
    try {
      const [stat, cmdline] = await Promise.all([readFile(`/proc/${id}/stat`, 'utf8'), readFile(`/proc/${id}/cmdline`)]);
      // The name sits in parentheses and may itself contain spaces or parentheses.
      const close = stat.lastIndexOf(')');
      const fields = stat.slice(close + 2).split(' ');
      return {
        pid: Number(id),
        ppid: Number(fields[1]),
        command: stat.slice(stat.indexOf('(') + 1, close),
        argv: cmdline.toString('utf8').split('\0').filter(Boolean),
      };
    } catch {
      // The process ended while being read.
      return null;
    }
  }));
  return entries.filter((entry): entry is ProcessEntry => entry !== null);
}

async function linuxWorkingDirectories(pids: number[]): Promise<Map<number, string>> {
  const directories = new Map<number, string>();
  await Promise.all(pids.map(async (pid) => {
    // Another user's processes can't be read, and they can't be ours to warn about.
    const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => null);
    if (cwd && !cwd.endsWith(' (deleted)')) directories.set(pid, cwd);
  }));
  return directories;
}

async function macWorkingDirectories(pids: number[]): Promise<Map<number, string>> {
  // lsof exits with 1 when some of the processes ended meanwhile, yet still prints the rest.
  return parseLsofWorkingDirectories(await run('lsof', ['-a', '-d', 'cwd', '-n', '-F', 'n', '-p', pids.join(',')], true));
}

function run(command: string, args: string[], tolerateFailure = false): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error && !(tolerateFailure && stdout)) reject(error);
      else resolve(stdout);
    });
  });
}
