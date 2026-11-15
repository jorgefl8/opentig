import { IconBan, IconCircleCheck, IconCircleDot, IconCircleMinus, IconCircleX, IconClock } from '@tabler/icons-react';
import { Spinner } from '@/components/ui/spinner';
import type { ActionTone } from './action-status';

const ICONS: Record<Exclude<ActionTone, 'running'>, typeof IconClock> = {
  success: IconCircleCheck,
  failure: IconCircleX,
  queued: IconClock,
  cancelled: IconBan,
  skipped: IconCircleMinus,
  neutral: IconCircleDot,
};

/** Decorative: the text beside it always says the same in words. */
export function ActionStatusIcon({ tone, className = '' }: { tone: ActionTone; className?: string }) {
  const classes = `action-status-icon action-${tone} ${className}`;
  if (tone === 'running') return <Spinner className={classes} />;
  const Icon = ICONS[tone];
  return <Icon className={classes} aria-hidden="true" />;
}
