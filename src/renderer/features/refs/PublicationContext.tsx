import { useQuery } from '@tanstack/react-query';
import { publicationKey, publicationDestination } from './publication-context';
import { opentig } from '@/lib/opentig-api';
import { Button } from '@/components/ui/button';

export function PublicationContext({ repositoryId, revision, onSettings, onPush, disabled }: { repositoryId: string; revision: string; onSettings(): void; onPush(): void; disabled: boolean }) {
  const result = useQuery({ queryKey: [...publicationKey(repositoryId), revision], queryFn: () => opentig.refs.pushContext(repositoryId), staleTime: 15_000 });
  return <div className="publication-context" aria-label="Next publication">
    <span>{result.data ? <><strong>{result.data.login ? `@${result.data.login}` : 'External Git authentication'}</strong><span aria-hidden="true"> → </span>{result.data.remote ?? 'Choose remote'} · {publicationDestination(result.data)}</> : result.error ? 'Publication context unavailable' : 'Reading publication context…'}</span>
    <Button variant="outline" size="sm" onClick={onPush} disabled={disabled || !result.data?.oid || !result.data.branch || !!result.data.blocked}>Push</Button>
    <Button variant="ghost" size="sm" aria-label="Repository access" onClick={onSettings}>Access</Button>
  </div>;
}
