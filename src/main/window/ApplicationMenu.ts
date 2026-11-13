import type { ApplicationProfile } from '../../shared/application-profile';

interface KeyInput {
  readonly type: string;
  readonly key: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly isAutoRepeat: boolean;
}

/** Without a menu, Dev builds keep F12 and Ctrl+Shift+I for DevTools; production has neither. */
export function isDevToolsShortcut(input: KeyInput, profile: ApplicationProfile): boolean {
  if (profile !== 'dev' || input.type !== 'keyDown' || input.isAutoRepeat || input.alt) return false;
  if (input.key === 'F12') return !input.control && !input.meta && !input.shift;
  return (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i';
}
