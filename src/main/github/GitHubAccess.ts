import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CliCandidate } from '../ai/CliResolver';
import type { CliRunResult } from '../ai/CliProcessRunner';
import type { RepositoryInfo, PullRequestLiveState } from '../../shared/contracts';
import type { GitHubCommandAuth } from './GitHubAccountAuth';

export interface GhRunOptions {
  cwd: string;
  operation: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  stdin?: string;
  auth: GitHubCommandAuth;
  executable: CliCandidate;
}

export interface GitHubTarget {
  repository: RepositoryInfo;
  nameWithOwner: string;
  auth: GitHubCommandAuth;
  executable: CliCandidate;
}

/** What the GitHub mutation services need from `GitHubService`, which owns routing and credentials. */
export interface GitHubAccess {
  requireGitHub(repositoryId: string, operation: string): Promise<GitHubTarget & { context: { revision: number; login?: string | null } }>;
  run(executable: CliCandidate, args: string[], options: GhRunOptions): Promise<CliRunResult>;
  invalidate(repositoryId: string): void;
  /** Reads GitHub now, without joining a read already in progress. */
  readLiveState(repositoryId: string, number: number): Promise<PullRequestLiveState>;
  revisionFor(repository: RepositoryInfo): number;
}

/** Long text travels through a private temporary file: no argument limits, and nothing read as a flag or by a shell. */
export async function withPrivateTextFile<T>(content: string, use: (filePath: string) => Promise<T>): Promise<T> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'opentig-gh-'));
  const filePath = path.join(temporary, 'body.md');
  try {
    await writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
    return await use(filePath);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
