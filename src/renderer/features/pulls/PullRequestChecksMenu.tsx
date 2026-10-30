import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { IconAlertTriangle, IconChevronDown, IconCircleCheck, IconCircleMinus, IconCircleX, IconClock, IconExternalLink } from '@tabler/icons-react';
import type { PullRequestCheck, PullRequestCheckState, PullRequestLiveState } from '../../../shared/contracts';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { groupPullRequestChecks, openOnGitHub } from './gh-utils';

const RESULTS: Record<PullRequestCheck['result'], { Icon: typeof IconClock; label: string; tone: string }> = {
  pass: { Icon: IconCircleCheck, label: 'Passed', tone: 'passing' },
  fail: { Icon: IconCircleX, label: 'Failed', tone: 'failing' },
  pending: { Icon: IconClock, label: 'In progress', tone: 'pending' },
  skipped: { Icon: IconCircleMinus, label: 'Skipped', tone: 'skipped' },
  'action-required': { Icon: IconAlertTriangle, label: 'Action required', tone: 'failing' },
};

function checksSummary(state: PullRequestCheckState) {
  if (state === 'PASSING') return { Icon: IconCircleCheck, label: 'Checks passing' };
  if (state === 'FAILING') return { Icon: IconCircleX, label: 'Checks failing' };
  return { Icon: IconClock, label: 'Checks pending' };
}

/** The checks summary alone, for when only the PR's stored rollup is available. */
export function PullRequestChecksSummary({ state }: { state: PullRequestCheckState }) {
  if (state === 'NONE') return null;
  const { Icon, label } = checksSummary(state);
  return <span className={`pr-checks ${state.toLowerCase()}`}><Icon aria-hidden="true" /> {label}</span>;
}

export function PullRequestChecksMenu({ checks, url }: { checks: PullRequestLiveState['checks']; url: string }) {
  const [open, setOpen] = useState(false);
  if (checks.rollup === 'NONE' && !checks.items.length) return <PullRequestChecksSummary state={checks.rollup} />;
  const { Icon, label } = checksSummary(checks.rollup);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger render={<button className={`pr-checks pr-checks-trigger ${checks.rollup.toLowerCase()}`} />}>
        <Icon aria-hidden="true" /> {label} <IconChevronDown className="pr-checks-chevron" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-50 outline-none">
          <Popover.Popup className="pr-stack-popup pr-checks-popup" aria-label="Checks">
            {groupPullRequestChecks(checks.items).map((group) => (
              <section key={group.label} className="pr-checks-group" aria-label={group.label}>
                <h4>{group.label}{checks.truncated ? null : <span>{group.checks.length}</span>}</h4>
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
          </Popover.Popup>
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
