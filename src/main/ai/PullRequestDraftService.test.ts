import { describe, expect, it, vi } from 'vitest';
import { EMPTY_AI_USAGE } from '../../shared/ai-log';
import type { GitRepositoryOperations } from '../git/GitRepositoryOperations';
import type { AiLogRecorder } from '../persistence/AiLogStore';
import { PullRequestDraftService } from './PullRequestDraftService';
import { PR_DRAFT_SCHEMA } from './PullRequestPrompt';
import type { AiProvider } from './types';
import { draftContext } from './test-support/pull-request-context';

const context = draftContext();
const request = { repositoryId: 'repo', harness: 'grok' as const, model: 'grok-test', base: 'main', requestId: 'grok-pr' };
function fixture(changed = false) {
  const operations = { getPullRequestDraftContext: vi.fn().mockResolvedValue(context), getPullRequestDraftSnapshot: vi.fn().mockResolvedValue({ fingerprint: changed ? 'changed' : 'same' }) } as unknown as GitRepositoryOperations;
  const generate = vi.fn(async () => ({ output: { title: 'Add feature', body: 'Describe the feature.' }, usage: { ...EMPTY_AI_USAGE, inputTokens: 10, outputTokens: 5 } }));
  const provider: AiProvider = { id: 'grok', status: async () => ({ id: 'grok', label: 'Grok Build', installed: true, availability: 'ready', authStatus: 'authenticated', checkedAt: '', models: [] }), generate };
  const entries: Parameters<AiLogRecorder['append']>[0][] = [];
  const service = new PullRequestDraftService(operations, [provider], { append: (entry) => { entries.push(entry); } });
  return { service, generate, entries };
}
describe('Grok pull-request drafts', () => {
  it('routes the selected model and validates the draft while logging only metadata', async () => {
    const { service, generate, entries } = fixture();
    expect(await service.generate(request)).toMatchObject({ title: 'Add feature', body: 'Describe the feature.', harness: 'grok', model: 'grok-test', coverage: context.coverage });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ schema: PR_DRAFT_SCHEMA, model: 'grok-test', prompt: expect.stringContaining('+feature') }));
    expect(entries[0]).toMatchObject({ operation: 'pull-request-draft', harness: 'grok', status: 'success', usage: { inputTokens: 10, outputTokens: 5, costUsd: null } });
    expect(entries[0]).not.toHaveProperty('prompt');
    expect(entries[0]).not.toHaveProperty('output');
  });
  it('rejects a draft when the branch changed during generation', async () => {
    const { service, entries } = fixture(true);
    await expect(service.generate(request)).rejects.toMatchObject({ detail: { code: 'AI_STAGED_CHANGES_CHANGED', harness: 'grok' } });
    expect(entries[0]).toMatchObject({ status: 'failed', harness: 'grok' });
  });
});
