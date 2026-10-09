import type { ReactNode } from 'react';
import { IconCopy } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { RepositoryAccess } from '@shared/repository-access';
import { Button } from '@/components/ui/button';
import { writeClipboardText } from '@/lib/browser-capabilities';
import { repositoryAccessDebugText } from './github-access-copy';

const accessChecks = (access: RepositoryAccess) => [['Account', access.identity], ['GitHub / PRs', access.api], ['Git read', access.read], ['Write permission', access.write]] as const;

function accessSummary(access: RepositoryAccess, checking: boolean): string {
  if (checking) return 'Checking access…';
  const states = accessChecks(access).map(([, check]) => check.state);
  if (states.includes('expired')) return 'Reconnect your GitHub account';
  if (states.includes('offline')) return 'Could not reach GitHub · try again';
  if (access.publication.blocked || states.includes('inaccessible')) return 'Access needs attention';
  if (access.lastOperation && !access.lastOperation.ok) return `Last ${access.lastOperation.operation} failed`;
  if (states.includes('stale')) return 'Access check out of date · check again';
  const verified = access.identity.state === 'ok' && access.api.state === 'ok' && access.write.state === 'ok';
  if (verified && access.publication.mode === 'external') return 'GitHub access verified';
  if (verified && access.read.state === 'ok') return 'Access verified';
  return 'Access not fully checked';
}

export function RepositoryAccessStatus({ access, checking, action }: { access: RepositoryAccess; checking: boolean; action: ReactNode }) {
  const failed = access.lastOperation && !access.lastOperation.ok ? access.lastOperation : null;
  const failures = accessChecks(access).filter(([, check]) => ['expired', 'inaccessible', 'offline'].includes(check.state));
  return <div className="repository-access-status" aria-busy={checking}>
    <div className="settings-general-row">
      <strong className="github-access-summary" role="status">{accessSummary(access, checking)}</strong>
      <div className="settings-general-control">{action}</div>
    </div>
    {access.publication.blocked && <p className="github-settings-notice" role="status">{access.publication.blocked}</p>}
    {!checking && failures.map(([label, check]) => <p className="github-settings-notice" role="status" key={label}><strong>{label}</strong>{check.message || (check.state === 'expired' ? 'Reconnect the account or choose another one.' : check.state === 'offline' ? 'Check the connection and try again.' : 'Check the selected account and its repository permissions.')}</p>)}
    {failed && <p className="github-settings-notice" role="status"><strong>Last {failed.operation} failed</strong>{failed.message || 'Check access and retry the operation.'}</p>}
  </div>;
}

export function CopyAccessDiagnostics({ access, accountLogin }: { access: RepositoryAccess; accountLogin?: string | null }) {
  const copy = async () => {
    try {
      await writeClipboardText(repositoryAccessDebugText(access, accountLogin));
      sileo.success({ title: 'Diagnostics copied' });
    } catch (error) {
      sileo.error({ title: 'Could not copy diagnostics', description: error instanceof Error ? error.message : 'The request could not be completed.' });
    }
  };
  return <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
    <IconCopy />Copy diagnostics
  </Button>;
}
