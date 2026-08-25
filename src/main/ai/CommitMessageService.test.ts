import { describe, expect, it, vi } from 'vitest';
import { EMPTY_AI_USAGE } from '../../shared/ai-log';
import type { AiHarnessStatus } from '../../shared/contracts';
import { AiOperationError } from '../../shared/errors';
import type { GitRepositoryOperations } from '../git/GitRepositoryOperations';
import type { AiLogRecorder } from '../persistence/AiLogStore';
import { CommitMessageService } from './CommitMessageService';
import type { AiProvider, CommitMessageContext } from './types';

const context: CommitMessageContext = {
  repositoryId: 'repo', repositoryPath: 'C:\\repo', branch: 'main', summary: 'summary', patch: 'patch',
  recentSubjects: [], fingerprint: 'same', truncated: false,
  stagedPaths: ['README.md', 'src/app.ts'], splitBlockedReason: null,
};
const ready = (id: 'codex' | 'claude'): AiHarnessStatus => ({
  id, label: id, availability: 'ready', installed: true, authStatus: 'authenticated', models: [{ id: 'default', label: 'Default' }], checkedAt: new Date().toISOString(),
});

function operations(fingerprints = ['same', 'same'], overrides: Partial<CommitMessageContext> = {}): GitRepositoryOperations {
  let index = 0;
  return {
    getCommitMessageContext: vi.fn(async () => ({ ...context, ...overrides, fingerprint: fingerprints[index++] ?? 'same' })),
    commitGroupFingerprint: vi.fn(async (_id: string, paths: string[]) => `hash:${paths.join('|')}`),
  } as unknown as GitRepositoryOperations;
}

function recorder(): AiLogRecorder & { entries: Parameters<AiLogRecorder['append']>[0][] } {
  const entries: Parameters<AiLogRecorder['append']>[0][] = [];
  return { entries, append: (entry) => { entries.push(entry); } };
}

const splitProvider = (): AiProvider => ({
  id: 'codex', status: async () => ready('codex'), generate: async () => ({
    output: {
      subject: 'Update docs and app', body: '', rationale: 'The changes have independent responsibilities.',
      commits: [
        { subject: 'Update documentation', body: '', reason: 'Documentation is self-contained.', paths: ['README.md'] },
        { subject: 'Update application', body: '', reason: 'Runtime behavior is separate.', paths: ['src/app.ts'] },
      ],
    },
    usage: { ...EMPTY_AI_USAGE, inputTokens: 120, outputTokens: 40, costUsd: 0.02 },
  }),
});

describe('CommitMessageService', () => {
  it('routes to only the selected provider', async () => {
    const codexGenerate = vi.fn(async () => ({ output: { subject: 'Add AI', body: '' }, usage: { ...EMPTY_AI_USAGE } }));
    const claudeGenerate = vi.fn(async () => ({ output: { subject: 'Wrong provider', body: '' }, usage: { ...EMPTY_AI_USAGE } }));
    const providers: AiProvider[] = [
      { id: 'codex', status: async () => ready('codex'), generate: codexGenerate },
      { id: 'claude', status: async () => ready('claude'), generate: claudeGenerate },
    ];
    const service = new CommitMessageService(operations(), providers);
    const result = await service.generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-1' });
    expect(result.message).toBe('Add AI');
    expect(codexGenerate).toHaveBeenCalledOnce();
    expect(claudeGenerate).not.toHaveBeenCalled();
  });

  it('does not fall back when the selected provider fails', async () => {
    const fallback = vi.fn(async () => ({ output: { subject: 'Fallback', body: '' }, usage: { ...EMPTY_AI_USAGE } }));
    const providers: AiProvider[] = [
      { id: 'codex', status: async () => ready('codex'), generate: async () => { throw new AiOperationError({ code: 'AI_RATE_LIMITED', operation: 'test', harness: 'codex', message: 'limited' }); } },
      { id: 'claude', status: async () => ready('claude'), generate: fallback },
    ];
    const service = new CommitMessageService(operations(), providers);
    await expect(service.generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-2' })).rejects.toMatchObject({ detail: { code: 'AI_RATE_LIMITED' } });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('rejects a result when staged context changes', async () => {
    const provider: AiProvider = { id: 'codex', status: async () => ready('codex'), generate: async () => ({ output: { subject: 'Add AI', body: '' }, usage: { ...EMPTY_AI_USAGE } }) };
    const service = new CommitMessageService(operations(['before', 'after']), [provider]);
    await expect(service.generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-3' })).rejects.toMatchObject({ detail: { code: 'AI_STAGED_CHANGES_CHANGED' } });
  });

  it('returns a validated split proposal from the same generation', async () => {
    const service = new CommitMessageService(operations(), [splitProvider()]);
    const result = await service.generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-4' });
    expect(result.proposal?.commits).toHaveLength(2);
    expect(result.proposal?.commits[0]?.paths).toEqual(['README.md']);
    expect(result.splitBlockedReason).toBeNull();
  });

  it('gives every group its own fingerprint so each commit keeps a staleness check', async () => {
    const service = new CommitMessageService(operations(), [splitProvider()]);
    const result = await service.generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-5' });
    expect(result.proposal?.commits.map((commit) => commit.fingerprint)).toEqual(['hash:README.md', 'hash:src/app.ts']);
  });

  it('still offers a split when only the patch was truncated', async () => {
    const service = new CommitMessageService(operations(['same', 'same'], { truncated: true }), [splitProvider()]);
    const result = await service.generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-6' });
    expect(result.contextWasTruncated).toBe(true);
    expect(result.proposal?.commits).toHaveLength(2);
  });

  it('refuses a split and reports why when the repository state blocks it', async () => {
    const reason = 'app.ts is only partially staged, so it cannot be grouped by file.';
    const service = new CommitMessageService(operations(['same', 'same'], { splitBlockedReason: reason }), [splitProvider()]);
    const result = await service.generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-7' });
    expect(result.proposal).toBeNull();
    expect(result.splitBlockedReason).toBe(reason);
  });

  it('records a successful run with the usage the harness reported', async () => {
    const log = recorder();
    const service = new CommitMessageService(operations(), [splitProvider()], log);
    await service.generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-8' });

    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({
      operation: 'commit-message', harness: 'codex', status: 'success', errorCode: null, errorMessage: null,
      stagedFileCount: 2, contextTruncated: false, splitOffered: true, splitGroups: 2,
      splitRejectedReason: null, splitBlockedReason: null,
      usage: { inputTokens: 120, outputTokens: 40, costUsd: 0.02 },
    });
    expect(log.entries[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records why a proposed split was thrown away', async () => {
    const log = recorder();
    const provider: AiProvider = {
      id: 'codex', status: async () => ready('codex'), generate: async () => ({
        output: {
          subject: 'Update things', body: '', rationale: 'Two concerns.',
          // Leaves src/app.ts uncovered, which the parser must refuse.
          commits: [
            { subject: 'One', body: '', reason: 'a', paths: ['README.md'] },
            { subject: 'Two', body: '', reason: 'b', paths: ['README.md'] },
          ],
        },
        usage: { ...EMPTY_AI_USAGE },
      }),
    };
    const service = new CommitMessageService(operations(), [provider], log);
    const result = await service.generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-9' });

    expect(result.proposal).toBeNull();
    expect(log.entries[0]).toMatchObject({ status: 'success', splitOffered: false });
    expect(log.entries[0]?.splitRejectedReason).toContain('duplicated path "README.md"');
  });

  it('separates a cancellation from a failure', async () => {
    const failing = (code: 'AI_CANCELLED' | 'AI_RATE_LIMITED'): AiProvider => ({
      id: 'codex', status: async () => ready('codex'),
      generate: async () => { throw new AiOperationError({ code, operation: 'test', harness: 'codex', message: code }); },
    });
    const cancelled = recorder();
    await new CommitMessageService(operations(), [failing('AI_CANCELLED')], cancelled)
      .generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-10' }).catch(() => undefined);
    const failed = recorder();
    await new CommitMessageService(operations(), [failing('AI_RATE_LIMITED')], failed)
      .generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-11' }).catch(() => undefined);

    expect(cancelled.entries[0]).toMatchObject({ status: 'cancelled', errorCode: 'AI_CANCELLED', errorMessage: 'AI_CANCELLED' });
    expect(failed.entries[0]).toMatchObject({ status: 'failed', errorCode: 'AI_RATE_LIMITED', errorMessage: 'AI_RATE_LIMITED' });
  });

  it('propagates transport cancellation to the selected provider', async () => {
    const log = recorder();
    const providerState: { signal: AbortSignal | null } = { signal: null };
    const provider: AiProvider = {
      id: 'codex',
      status: async () => ready('codex'),
      generate: async (input) => new Promise((_resolve, reject) => {
        providerState.signal = input.signal;
        input.signal.addEventListener('abort', () => reject(new AiOperationError({
          code: 'AI_CANCELLED', operation: 'test', harness: 'codex', message: 'Generation canceled.',
        })), { once: true });
      }),
    };
    const service = new CommitMessageService(operations(), [provider], log);
    const controller = new AbortController();
    const generation = service.generate(
      { repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'transport-cancel' },
      controller.signal,
    );
    await vi.waitFor(() => expect(providerState.signal).not.toBeNull());

    controller.abort();

    await expect(generation).rejects.toMatchObject({ detail: { code: 'AI_CANCELLED' } });
    expect(providerState.signal?.aborted).toBe(true);
    expect(log.entries[0]).toMatchObject({ status: 'cancelled', errorCode: 'AI_CANCELLED' });
  });

  it('never lets a logging failure reach the caller', async () => {
    const broken: AiLogRecorder = { append: () => { throw new Error('disk full'); } };
    const service = new CommitMessageService(operations(), [splitProvider()], broken);
    await expect(service.generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-12' })).resolves.toMatchObject({ harness: 'codex' });
  });
});
