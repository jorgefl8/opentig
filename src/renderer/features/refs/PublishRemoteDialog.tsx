import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import type { PublicationContext } from '@shared/repository-access';
import { opentig } from '@/lib/opentig-api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import type { RemoteChoice } from './useBranchPush';
import { publicationDestination } from './publication-context';
import { gitCredentialsLocation, gitHttpsModeLabel } from '@/features/settings/github-access-copy';

/** Only shown when Git has no configured push destination. */
export function PublishRemoteDialog({ choice, onSelect }: { choice: RemoteChoice; onSelect(context: PublicationContext | null): void }) {
  const [remote, setRemote] = useState('');
  const destinations = useQueries({ queries: choice.result.remotes.map(name => ({
    queryKey: ['publication-destination', choice.id, name],
    queryFn: () => opentig.refs.pushContext(choice.repositoryId, name),
  })) });
  const context = destinations[choice.result.remotes.indexOf(remote)];
  const publishing = !(context?.data?.hasUpstream ?? choice.hasUpstream);
  return <Dialog open onOpenChange={open => { if (!open) onSelect(null); }}>
    <DialogPopup className="undo-commit-dialog">
      <div className="undo-commit-content">
        <DialogTitle>Where do you want to push?</DialogTitle>
        <DialogDescription>{choice.label} has more than one remote and no push destination for <strong>{choice.result.branch}</strong>. Choose the repository to receive your commits.</DialogDescription>
        <fieldset className="github-destination-options"><legend className="sr-only">Push destination</legend>
          {choice.result.remotes.map((name, index) => {
            const query = destinations[index]!;
            return <label key={name} className="github-destination-option">
              <input type="radio" name={`push-remote-${choice.id}`} value={name} checked={remote === name} onChange={() => setRemote(name)} disabled={!query.data || !!query.data.blocked} />
              <span><strong>{query.data ? publicationDestination(query.data) : query.isError ? 'Could not read destination' : 'Reading destination…'}</strong>
                <small>{name} · {query.data?.targetRef?.replace(/^refs\/heads\//, '') ?? choice.result.branch}</small>
                {query.data?.blocked && <small role="alert">{query.data.blocked}</small>}</span>
            </label>;
          })}
        </fieldset>
        {context?.data && <div className="repository-access-status">
          <p>Push using <strong>{gitHttpsModeLabel(context.data.mode, context.data.login)}</strong></p>
          {context.data.mode === 'external' && <p className="github-settings-note">Git uses credentials on {gitCredentialsLocation()}. OpenTig has not verified their account.</p>}
          {publishing && <p className="github-settings-note">Publishing sets a tracking branch in Git on the server, shared by all connected clients.</p>}
        </div>}
        {destinations.some(query => query.isError) && <Button variant="outline" onClick={() => void Promise.all(destinations.map(query => query.refetch()))}>Retry destinations</Button>}
      </div>
      <div className="undo-commit-actions">
        <Button variant="ghost" onClick={() => onSelect(null)}>Cancel</Button>
        <Button disabled={!context?.data || !!context.data.blocked || context.isFetching} onClick={() => onSelect(context?.data ?? null)}>{publishing ? 'Publish branch' : 'Push commits'}</Button>
      </div>
    </DialogPopup>
  </Dialog>;
}
