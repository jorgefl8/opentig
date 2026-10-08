import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RepositoryAccess, AccessCheck } from '@shared/repository-access';
import { formatDateTime } from '@shared/date-format';
import { publicationDestination, publicationKey } from '@/features/refs/publication-context';

const labels: Record<AccessCheck['state'], string> = {
  unchecked: 'Not checked', ok: 'Verified', expired: 'Reconnect account', inaccessible: 'No access',
  offline: 'Offline', external: 'Existing credentials', stale: 'Check again',
};
export function RepositoryAccessStatus({ access, checking }: { access: RepositoryAccess; checking: boolean }) {
  const client = useQueryClient();
  const { publication } = access;
  // Remember the context shown in Settings; a different context must be reviewed before pushing.
  useEffect(() => { client.setQueryData(publicationKey(publication.repositoryId), publication); }, [client, publication]);
  const checks = [['Account', access.identity], ['GitHub / PRs', access.api], ['Git read', access.read], ['Write permission', access.write]] as const;
  return <div className="repository-access-status" aria-busy={checking}>
    <dl className="github-access-grid">{checks.map(([label, check]) => <div key={label}>
      <dt>{label}</dt><dd data-state={checking ? 'checking' : check.state}>
        <span className="github-access-dot" aria-hidden="true" />
        {checking ? 'Checking…' : check.state === 'ok' && label === 'Write permission' ? 'Declared by GitHub' : labels[check.state]}
      </dd>
    </div>)}</dl>
    <div className="github-push-destination">
      <span className="github-settings-eyebrow">Push destination</span>
      <strong>{publicationDestination(publication)}</strong>
      <p>{publication.branch ?? 'No branch'} → {publication.remote ?? 'Choose a remote'}{publication.targetRef && ` / ${publication.targetRef.replace(/^refs\/heads\//, '')}`}</p>
      <p>Git account: {publication.mode === 'managed' && publication.login ? `@${publication.login}` : 'Existing credentials · identity not verified'}</p>
    </div>
    {publication.blocked && <p className="github-settings-notice" role="status">{publication.blocked}</p>}
    {!checking && checks.filter(([, check]) => ['expired', 'inaccessible', 'offline'].includes(check.state) && check.message)
      .map(([label, check]) => <p className="github-settings-notice" role="status" key={label}><strong>{label}</strong>{check.message}</p>)}
    <details className="github-access-details">
      <summary>Connection details{access.lastOperation && !access.lastOperation.ok && <span>Last Git operation failed</span>}</summary>
      <p>{access.checkedAt ? `Last checked: ${formatDateTime(access.checkedAt, { seconds: true })}` : 'Access has not been checked.'}</p>
      <p>{publication.urls.join(', ') || 'No push URL configured.'}</p>
      {checks.map(([label, check]) => check.message && <p key={label}><strong>{label}:</strong> {check.message}</p>)}
      <p>Git read and write permission refer to the push destination. Write permission is declared by GitHub; branch policies can still reject a push.</p>
      {publication.mode === 'external' && <p>Git uses existing helpers, SSH keys or agents. The GitHub account does not verify its identity.</p>}
      {access.lastOperation && <div className="github-last-operation">
        <strong>Last Git operation · {access.lastOperation.ok ? 'Succeeded' : 'Failed'}</strong>
        <p>{access.lastOperation.operation} · {access.lastOperation.login ? `@${access.lastOperation.login}` : 'Existing credentials'} · {formatDateTime(access.lastOperation.at, { seconds: true })}</p>
        <p>{access.lastOperation.url}</p><p>{access.lastOperation.message ?? 'Operation completed.'}</p>
        <p>Previous result; a new operation may differ.</p>
      </div>}
    </details>
  </div>;
}
