import type { RepositoryAccess, AccessCheck } from '@shared/repository-access';

const labels: Record<AccessCheck['state'], string> = { unchecked: 'Not checked', ok: 'Verified', expired: 'Expired or revoked', inaccessible: 'Missing or inaccessible', offline: 'Connection unavailable', external: 'External authentication', stale: 'Previous result · refresh required' };
export function RepositoryAccessStatus({ access, checking }: { access: RepositoryAccess; checking: boolean }) {
  return <div className="repository-access-status">
    <p><strong>Push destination:</strong> {access.publication.remote ?? 'Choose a remote'} · {access.publication.urls.join(', ') || 'Not configured'}</p>
    <dl>{([['Account identity', access.identity], ['GitHub / PR access', access.api], ['Git HTTPS read at push destination', access.read], ['Write permission at push destination', access.write]] as const).map(([label, check]) => <div key={label}>
      <dt>{label}</dt><dd>{checking ? 'Checking…' : check.state === 'ok' && label.startsWith('Write') ? 'Declared by GitHub' : labels[check.state]}</dd>
      {check.message && <small>{check.message}</small>}
    </div>)}</dl>
    {access.publication.mode === 'external' && <p>Git uses your existing helpers, SSH keys or agents. Its identity is not verified by the GitHub account selection.</p>}
    <p>Read access and declared write permission do not guarantee that branch policies allow a push.</p>
    {access.publication.blocked && <p role="status">{access.publication.blocked}</p>}
    {access.lastOperation && <details><summary>Last Git result · {access.lastOperation.ok ? 'Succeeded' : 'Failed'}</summary>
      <p>{access.lastOperation.operation} · {access.lastOperation.login ? `@${access.lastOperation.login}` : 'External authentication'} · {access.lastOperation.url}</p>
      <p>{access.lastOperation.message ?? 'Operation completed.'}</p><small>Previous result; a new check or operation may differ.</small>
    </details>}
  </div>;
}
