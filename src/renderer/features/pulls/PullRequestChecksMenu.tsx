import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { IconAlertTriangle, IconCircleCheck, IconCircleMinus, IconCircleX, IconClock, IconExternalLink } from '@tabler/icons-react';
import type { PullRequestCheck, PullRequestCheckState, PullRequestLiveState } from '../../../shared/contracts';
import { MobileSheet } from '@/components/MobileSheet';
import { useMobileChrome } from '@/components/mobile-chrome-context';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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

export function PullRequestChecksMenu({ checks, url }: { checks: PullRequestLiveState['checks']; url: string }) {
  const [open, setOpen] = useState(false);
  const phone = useMobileChrome() !== null;
  if (checks.rollup === 'NONE' && !checks.items.length) return <PullRequestChecksSummary state={checks.rollup} />;
  const list = <>
    {groupPullRequestChecks(checks.items).map((group) => (
      <section key={group.label} className="pr-checks-group" aria-label={group.label}>
        <h4>{group.label}{checks.truncated ? null : <span className="plain-count">{group.checks.length}</span>}</h4>
        {group.checks.map((check) => <CheckRow key={JSON.stringify([check.workflow, check.name])} check={check} />)}
      </section>
    ))}
    {!checks.items.length && <p className="pr-stack-notice">GitHub didn't return the individual checks.</p>}
    {checks.partial && <p className="pr-stack-notice">GitHub didn't share every detail with this account, so some checks may be missing.</p>}
    {checks.truncated && (
      <div className="pr-stack-notice pr-checks-truncated">
        <p>Some checks aren't listed here.</p>
        {url && <button className="pr-checks-all" onClick={() => openOnGitHub(`${url}/checks`)}>View all on GitHub <IconExternalLink aria-hidden="true" /></button>}
      </div>
    )}
  </>;
  if (phone) {
    return <>
      <button className="pr-checks-trigger" aria-haspopup="dialog" onClick={() => setOpen(true)}>{pullRequestChecksSentence(checks)}</button>
      <MobileSheet open={open} onOpenChange={setOpen} title="Checks">{list}</MobileSheet>
    </>;
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger render={<button className="pr-checks-trigger" />}>{pullRequestChecksSentence(checks)}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-50 outline-none">
          <Popover.Popup className="pr-stack-popup pr-checks-popup" aria-label="Checks">{list}</Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CheckRow({ check }: { check: PullRequestCheck }) {
  const { Icon, label, tone } = RESULTS[check.result];
  const name = check.workflow ? `${check.workflow} · ${check.name}` : check.name;
  const url = check.url;
  return (
    <Tooltip>
      <TooltipTrigger render={url ? <button className="pr-check-row" onClick={() => openOnGitHub(url)} /> : <div className="pr-check-row" />}>
        <Icon className={`pr-check-result ${tone}`} aria-hidden="true" />
        <span className="pr-check-text">
          <strong>{check.name}</strong>
          <small>{check.workflow ? `${check.workflow} · ` : ''}{label}</small>
        </span>
        {check.required && <span className="pr-check-required">Required</span>}
        {url && <IconExternalLink className="pr-check-link" aria-hidden="true" />}
      </TooltipTrigger>
      <TooltipContent>{name}{url ? ' · Open on GitHub' : ''}</TooltipContent>
    </Tooltip>
  );
}
