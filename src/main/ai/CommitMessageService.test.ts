import { describe, expect, it, vi } from 'vitest';
import type { AiHarnessStatus } from '../../shared/contracts';
import { AiOperationError } from '../../shared/errors';
import type { GitRepositoryOperations } from '../git/GitRepositoryOperations';
import { CommitMessageService } from './CommitMessageService';
import type { AiProvider, CommitMessageContext } from './types';

const context: CommitMessageContext = {
  repositoryId: 'repo', repositoryPath: 'C:\\repo', branch: 'main', summary: 'summary', patch: 'patch',
  recentSubjects: [], fingerprint: 'same', truncated: false,
};
const ready = (id: 'codex' | 'claude'): AiHarnessStatus => ({
  id, label: id, availability: 'ready', installed: true, authStatus: 'authenticated', models: [{ id: 'default', label: 'Default' }], checkedAt: new Date().toISOString(),
});

function operations(fingerprints = ['same', 'same']): GitRepositoryOperations {
  let index = 0;
  return { getCommitMessageContext: vi.fn(async () => ({ ...context, fingerprint: fingerprints[index++] ?? 'same' })) } as unknown as GitRepositoryOperations;
}

describe('CommitMessageService', () => {
  it('routes to only the selected provider', async () => {
    const codexGenerate = vi.fn(async () => ({ subject: 'Add AI', body: '' }));
    const claudeGenerate = vi.fn(async () => ({ subject: 'Wrong provider', body: '' }));
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
    const fallback = vi.fn(async () => ({ subject: 'Fallback', body: '' }));
    const providers: AiProvider[] = [
      { id: 'codex', status: async () => ready('codex'), generate: async () => { throw new AiOperationError({ code: 'AI_RATE_LIMITED', operation: 'test', harness: 'codex', message: 'limited' }); } },
      { id: 'claude', status: async () => ready('claude'), generate: fallback },
    ];
    const service = new CommitMessageService(operations(), providers);
    await expect(service.generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-2' })).rejects.toMatchObject({ detail: { code: 'AI_RATE_LIMITED' } });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('rejects a result when staged context changes', async () => {
    const provider: AiProvider = { id: 'codex', status: async () => ready('codex'), generate: async () => ({ subject: 'Add AI', body: '' }) };
    const service = new CommitMessageService(operations(['before', 'after']), [provider]);
    await expect(service.generate({ repositoryId: 'repo', harness: 'codex', model: 'default', requestId: 'request-3' })).rejects.toMatchObject({ detail: { code: 'AI_STAGED_CHANGES_CHANGED' } });
  });
});
