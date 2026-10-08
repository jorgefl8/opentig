import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { IconCopy } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { RepositoryAccess, AccessCheck } from '@shared/repository-access';
import { formatDateTime } from '@shared/date-format';
import { Button } from '@/components/ui/button';
import { publicationDestination, publicationKey } from '@/features/refs/publication-context';
import { writeClipboardText } from '@/lib/browser-capabilities';
import { accessStateLabels, gitHttpsModeLabel, lastGitOperationLabel, repositoryAccessDebugText } from './github-access-copy';

function checkLabel(label: string, check: AccessCheck, checking: boolean): string {
  if (checking) return 'Checking…';
  if (check.state === 'ok' && label === 'Write permission') return 'Declared by GitHub';
  return accessStateLabels[check.state];
}

export function RepositoryAccessStatus({ access, checking }: { access: RepositoryAccess; checking: boolean }) {
  const client = useQueryClient();
  const { publication } = access;
  const failed = access.lastOperation && !access.lastOperation.ok ? access.lastOperation : null;
  // Remember the context shown in Settings; a different context must be reviewed before pushing.
  useEffect(() => { client.setQueryData(publicationKey(publication.repositoryId), publication); }, [client, publication]);
  const checks = [['Account', access.identity], ['GitHub / PRs', access.api], ['Git read', access.read], ['Write permission', access.write]] as const;
  const copy = async () => {
    try {
      await writeClipboardText(repositoryAccessDebugText(access));
      sileo.success({ title: 'Copied technical details' });
    } catch (error) {
      sileo.error({ title: 'Could not copy technical details', description: error instanceof Error ? error.message : 'The request could not be completed.' });
    }
  };
  return <div className="repository-access-status" aria-busy={checking}>
    <dl className="github-access-grid">{checks.map(([label, check]) => <div key={label}>
      <dt>{label}</dt><dd data-state={checking ? 'checking' : check.state}>
        <span className="github-access-dot" aria-hidden="true" />
        {checkLabel(label, check, checking)}
      </dd>
    </div>)}</dl>
    <div className="github-push-destination">
      <span className="github-settings-eyebrow">Push destination</span>
      <strong>{publicationDestination(publication)}</strong>
      <p>{publication.branch ?? 'No branch'} → {publication.remote ?? 'Choose a remote'}{publication.targetRef && ` / ${publication.targetRef.replace(/^refs\/heads\//, '')}`}</p>
    </div>
    {publication.blocked && <p className="github-settings-notice" role="status">{publication.blocked}</p>}
    {!checking && checks.filter(([, check]) => ['expired', 'inaccessible', 'offline'].includes(check.state) && check.message)
      .map(([label, check]) => <p className="github-settings-notice" role="status" key={label}><strong>{label}</strong>{check.message}</p>)}
    {failed && <p className="github-settings-notice" role="status"><strong>Last {failed.operation} failed</strong>{failed.message || 'The Git operation did not complete.'}</p>}
    <details className="github-access-details">
      <summary>Technical details{failed && <span>Last Git operation failed</span>}</summary>
      <div className="github-access-debug">
        <dl>
          <div><dt>Last checked</dt><dd>{access.checkedAt ? formatDateTime(access.checkedAt, { seconds: true }) : 'Not checked yet'}</dd></div>
          <div><dt>Push URL</dt><dd>{publication.urls.join(', ') || 'No push URL configured.'}</dd></div>
          <div><dt>Git HTTPS</dt><dd>{gitHttpsModeLabel(publication.mode, publication.login)}</dd></div>
          {access.lastOperation && <div><dt>Last Git</dt><dd>{lastGitOperationLabel(access.lastOperation)}</dd></div>}
        </dl>
        <p className="github-settings-note">Write permission is declared by GitHub. Branch policies can still reject a push.</p>
        <div className="github-access-debug-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => void copy()} aria-label="Copy technical details">
            <IconCopy />Copy details
          </Button>
        </div>
      </div>
    </details>
  </div>;
}
