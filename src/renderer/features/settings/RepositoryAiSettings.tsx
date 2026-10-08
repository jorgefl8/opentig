import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { RepositoryInfo } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';

export function RepositoryAiSettings({ repository }: { repository: RepositoryInfo | null }) {
  const client = useQueryClient();
  const repositoryId = repository?.id ?? 'none';
  const key = queryKeys.aiRepositoryInstructions(repositoryId);
  const query = useQuery({ queryKey: key, queryFn: () => opentig.ai.repositoryInstructions(repository!.id), enabled: repository !== null });
  useEffect(() => {
    const refresh = () => { void client.invalidateQueries({ queryKey: queryKeys.aiRepositoryInstructions(repositoryId) }); };
    const unsubscribe = opentig.events.onAiInstructionsChanged((ids) => { if (!ids.length || ids.includes(repository?.id ?? '')) refresh(); });
    const unsubscribeRepository = opentig.events.onRepositoryChanged((id) => { if (id === repository?.id) refresh(); });
    return () => { unsubscribe(); unsubscribeRepository(); };
  }, [client, repositoryId, repository?.id]);
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => opentig.ai.setRepositoryInstructions(repository!.id, enabled),
    onSuccess: (status) => { client.setQueryData(key, status); },
    onError: () => sileo.error({ title: 'Could not save repository instructions' }),
  });
  return <div className="settings-field settings-field-separated">
    <div className="settings-field-label">
      <strong>This repository</strong>
      <span>{repository ? 'Shared across its worktrees and connected clients.' : 'Open a repository to configure its AI writing conventions.'}</span>
    </div>
    <div className="settings-general-row settings-general-toggle">
      <div className="settings-field-label">
        <strong id="repository-ai-instructions-label">Use repository instructions</strong>
        <span id="repository-ai-instructions-description">Apply writing conventions to commit messages and PR drafts. Off by default.</span>
      </div>
      <div className="settings-general-control">
        <span className="settings-general-switch-state" aria-hidden="true">{query.data?.enabled ? 'On' : 'Off'}</span>
        <button type="button" role="switch" className="settings-switch" aria-labelledby="repository-ai-instructions-label" aria-describedby="repository-ai-instructions-description" aria-checked={query.data?.enabled ?? false}
          disabled={!repository || !query.data || mutation.isPending} onClick={() => mutation.mutate(!query.data?.enabled)}><span /></button>
      </div>
    </div>
    {repository && query.data && <p className="ai-privacy-note">{query.data.files.length ? `Detected: ${query.data.files.join(', ')}.` : 'No supported instruction files detected.'} Only AGENTS.md, CLAUDE.md and GROK.md at this worktree’s root are supported. Hooks, tools and CLI configuration stay disabled.</p>}
    {query.isError && <p className="ai-login-hint">Could not check repository instructions. <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Try again</Button></p>}
  </div>;
}
