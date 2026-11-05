import { useContext } from 'react';
import { IconAlertTriangle, IconChevronRight, IconCircleCheck, IconCircleMinus, IconCircleX, IconClock, IconExternalLink, IconLoader4 } from '@tabler/icons-react';
import type { PullRequestCheck, PullRequestCheckState, PullRequestLiveState } from '../../../shared/contracts';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { parseRepositoryLink, RepositoryLinksContext } from '@/components/repository-links';
import { groupPullRequestChecks, openOnGitHub, pullRequestChecksSentence } from './gh-utils';

const RESULTS: Record<PullRequestCheck['result'], { Icon: typeof IconClock; label: string; tone: string }> = {
  pass: { Icon: IconCircleCheck, label: 'Passed', tone: 'passing' },
  fail: { Icon: IconCircleX, label: 'Failed', tone: 'failing' },
  pending: { Icon: IconClock, label: 'In progress', tone: 'pending' },
  skipped: { Icon: IconCircleMinus, label: 'Skipped', tone: 'skipped' },
  'action-required': { Icon: IconAlertTriangle, label: 'Action required', tone: 'failing' },
};

/** The checks summary alone, for when only the PR's stored rollup is available. */
export function PullRequestChecksSummary({ state }: { state: PullRequestCheckState }) {
  if (state === 'NONE') return null;
  return <span>{state === 'PASSING' ? 'Checks passing' : state === 'FAILING' ? 'Checks failing' : 'Checks pending'}</span>;
}

/** How the checks stand, in the header, leading to their tab. */
export function PullRequestChecksLink({ checks, onOpen }: { checks: PullRequestLiveState['checks']; onOpen(): void }) {
  if (checks.rollup === 'NONE' && !checks.items.length) return null;
  return <button className="pr-checks-trigger" onClick={onOpen}>{pullRequestChecksSentence(checks)}</button>;
}

export function PullRequestChecksPanel({ checks, loading, url }: { checks: PullRequestLiveState['checks'] | null; loading: boolean; url: string }) {
  if (!checks) {
    return (
      <section className="pr-checks-panel" aria-label="Checks">
        {loading
          ? <p className="pr-empty-description" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /> <ShimmeringText text="Loading checks…" /></p>
          : <p className="pr-empty-description">Couldn't load the checks.</p>}
      </section>
    );
  }
  return (
    <section className="pr-checks-panel" aria-label="Checks">
      {groupPullRequestChecks(checks.items).map((group) => (
        <section key={group.label} className="pr-checks-group" aria-label={group.label}>
          <h4>{group.label}{checks.truncated ? null : <span className="plain-count">{group.checks.length}</span>}</h4>
          {group.checks.map((check) => <CheckRow key={JSON.stringify([check.workflow, check.name])} check={check} />)}
        </section>
      ))}
      {!checks.items.length && <p className="pr-stack-notice">{checks.rollup === 'NONE' ? 'No checks have run on this pull request.' : "GitHub didn't return the individual checks."}</p>}
      {checks.partial && <p className="pr-stack-notice">GitHub didn't share every detail with this account, so some checks may be missing.</p>}
      {checks.truncated && (
        <div className="pr-stack-notice pr-checks-truncated">
          <p>Some checks aren't listed here.</p>
          {url && <button className="pr-checks-all" onClick={() => openOnGitHub(`${url}/checks`)}>View all on GitHub <IconExternalLink aria-hidden="true" /></button>}
        </div>
      )}
    </section>
  );
}

function CheckRow({ check }: { check: PullRequestCheck }) {
  const { Icon, label, tone } = RESULTS[check.result];
  const name = check.workflow ? `${check.workflow} · ${check.name}` : check.name;
  const url = check.url;
  const links = useContext(RepositoryLinksContext);
  // A GitHub Actions check of this repository opens its run here, at its job.
  const run = url && links ? parseRepositoryLink(url, links.nameWithOwner) : null;
  const openRun = run?.kind === 'workflow-run' ? () => links!.open(run) : null;
  return (
    <Tooltip>
      <TooltipTrigger render={openRun ? <button className="pr-check-row" onClick={openRun} /> : url ? <button className="pr-check-row" onClick={() => openOnGitHub(url)} /> : <div className="pr-check-row" />}>
        <Icon className={`pr-check-result ${tone}`} aria-hidden="true" />
        <span className="pr-check-text">
          <strong>{check.name}</strong>
          <small>{check.workflow ? `${check.workflow} · ` : ''}{label}</small>
        </span>
        {check.required && <span className="pr-check-required">Required</span>}
        {openRun ? <IconChevronRight className="pr-check-link" aria-hidden="true" /> : url && <IconExternalLink className="pr-check-link" aria-hidden="true" />}
      </TooltipTrigger>
      <TooltipContent>{name}{openRun ? ' · Open the run' : url ? ' · Open on GitHub' : ''}</TooltipContent>
    </Tooltip>
  );
}
