import type { ComponentProps } from 'react';

interface SpinnerProps extends Omit<ComponentProps<'svg'>, 'children'> {
  /** Names the spinner for assistive technology. Without it the spinner is decorative. */
  label?: string;
}

/**
 * The app's one loading indicator: a faint ring with a quarter arc that turns.
 * It sizes and colors like an icon. Only the group inside turns, about the
 * center of the 24-unit viewBox. The `<svg>` element itself is never
 * transformed: rotating the element was measured to carry the whole icon
 * around a small circle on some displays.
 */
export function Spinner({ label, ...props }: SpinnerProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      data-slot="spinner"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      {...props}
    >
      <circle cx="12" cy="12" r="9" opacity=".22" />
      <g className="spinner-arc"><path d="M12 3a9 9 0 0 1 9 9" /></g>
    </svg>
  );
}
