import { IconBan, IconCircleCheck, IconCircleDot, IconCircleMinus, IconCircleX, IconClock, IconLoader2 } from '@tabler/icons-react';
import type { ActionTone } from './action-status';

const ICONS: Record<ActionTone, typeof IconClock> = {
  success: IconCircleCheck,
  failure: IconCircleX,
  running: IconLoader2,
  queued: IconClock,
  cancelled: IconBan,
  skipped: IconCircleMinus,
  neutral: IconCircleDot,
};

/** Decorative: the text beside it always says the same in words. */
export function ActionStatusIcon({ tone, className = '' }: { tone: ActionTone; className?: string }) {
  const Icon = ICONS[tone];
  return <Icon className={`action-status-icon action-${tone} ${tone === 'running' ? 'animate-spin' : ''} ${className}`} aria-hidden="true" />;
}
