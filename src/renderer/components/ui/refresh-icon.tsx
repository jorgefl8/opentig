import type { ComponentProps } from 'react';

interface RefreshIconProps extends Omit<ComponentProps<'svg'>, 'children'> {
  /** Turns the arrows on themselves while a refresh runs. */
  turning?: boolean;
}

/**
 * The refresh icon, drawn so it can turn on itself. As with the spinner, only
 * the group inside turns, about 12px 12px: the arrows are symmetric about that
 * point, so the icon turns in place. Rotating the `<svg>` element itself was
 * measured to carry the icon around a small circle on some displays.
 */
export function RefreshIcon({ turning = false, ...props }: RefreshIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" data-slot="refresh-icon" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <g className={turning ? 'refresh-icon-turn' : undefined}>
        <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" />
        <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
      </g>
    </svg>
  );
}
