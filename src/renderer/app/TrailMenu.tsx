import { useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import {
  IconArrowLeft, IconBrandGithub, IconFile, IconFiles, IconGitCommit, IconGitCompare, IconGitPullRequest, IconHistory, IconPlayerPlay, IconSearch, IconTag,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MobileSheet } from '@/components/MobileSheet';
import { useLongPress } from '@/lib/use-long-press';
import type { StepIcon, StepName } from './navigation/step-names';

export type TrailDirection = 'back' | 'forward';

/** A step in the list Back or Forward opens. */
export interface TrailListItem {
  key: string;
  /** How many steps away: negative behind, positive ahead. */
  offset: number;
  name: StepName;
}

/** The steps one way of the current one, nearest first. Read as the list opens, so it always matches the trail. */
export type ListTrailSteps = (direction: TrailDirection) => TrailListItem[];

const ICONS: Record<StepIcon, typeof IconFile> = {
  changes: IconGitCompare, files: IconFiles, history: IconHistory, github: IconBrandGithub, search: IconSearch,
  file: IconFile, commit: IconGitCommit, 'pull-request': IconGitPullRequest, release: IconTag, run: IconPlayerPlay,
};

function StepRow({ name }: { name: StepName }) {
  const Icon = ICONS[name.icon];
  return <>
    <Icon aria-hidden="true" />
    <span className="trail-step-text">
      <strong>{name.title}</strong>
      <small>{name.detail}</small>
    </span>
  </>;
}

/**
 * Back or Forward in the toolbar. A click takes one step; a right click, a held
 * press, the menu key or the down arrow lists every step that way, nearest
 * first, and choosing one goes straight there.
 */
export function TrailButton({ direction, enabled, keys, keysAria, children, onStep, listSteps, onGo }: {
  direction: TrailDirection;
  enabled: boolean;
  keys: string;
  keysAria: string;
  children: ReactNode;
  onStep(): void;
  listSteps: ListTrailSteps;
  onGo(offset: number): void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [steps, setSteps] = useState<TrailListItem[] | null>(null);
  /** Opened from the keyboard, the list starts on its first step, as a menu button's does. */
  const fromKeyboard = useRef(false);
  const label = direction === 'back' ? 'Back' : 'Forward';
  const openList = (keyboard = false) => {
    if (!enabled) return;
    const list = listSteps(direction);
    fromKeyboard.current = keyboard;
    if (list.length) setSteps(list);
  };
  const press = useLongPress(() => openList(), { mouse: true });
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Enter and Space take one step, as a click does; the down arrow opens the list, as on a menu button.
    if (event.key !== 'ArrowDown' || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    openList(true);
  };
  return <>
    <Tooltip disabled={steps !== null}>
      <TooltipTrigger render={<Button
        ref={button}
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-keyshortcuts={keysAria}
        aria-haspopup="menu"
        aria-expanded={steps !== null}
        focusableWhenDisabled
        disabled={!enabled}
        onClick={onStep}
        onKeyDown={onKeyDown}
        {...press}
      />}>{children}</TooltipTrigger>
      <TooltipContent className="flex-col items-start gap-0.5">
        <span>{label} <Kbd>{keys}</Kbd></span>
        <span className="text-muted-foreground">Right-click or hold to see every step</span>
      </TooltipContent>
    </Tooltip>
    <DropdownMenu
      open={steps !== null}
      onOpenChange={(open) => { if (!open) setSteps(null); }}
      onOpenChangeComplete={(open) => {
        // Not over a row the arrows already reached while the list was opening.
        const active = document.activeElement;
        if (open && fromKeyboard.current && !(active instanceof HTMLElement && active.getAttribute('role') === 'menuitem' && popup.current?.contains(active))) {
          popup.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
        }
      }}
    >
      <DropdownMenuContent ref={popup} anchor={button} finalFocus={button} align="end" className="trail-menu" aria-label={direction === 'back' ? 'Go back to' : 'Go forward to'}>
        <div className="trail-menu-heading" aria-hidden="true">{direction === 'back' ? 'Go back to' : 'Go forward to'}</div>
        {steps?.map((step) => (
          <DropdownMenuItem key={step.key} className="trail-step" onClick={() => onGo(step.offset)}>
            <StepRow name={step.name} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  </>;
}

/**
 * The phone's back arrow: a tap takes one step back, and holding it lists the
 * steps behind in a sheet. Focus returns to the arrow when the sheet closes.
 */
export function TrailBackArrow({ buttonRef, onBack, listBackSteps, onGo }: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  onBack(): void;
  listBackSteps?: (() => TrailListItem[]) | undefined;
  onGo?: ((offset: number) => void) | undefined;
}) {
  const [steps, setSteps] = useState<TrailListItem[] | null>(null);
  // Kept while the sheet slides away, so its rows don't vanish before it does.
  const [shown, setShown] = useState(steps);
  if (steps && steps !== shown) setShown(steps);
  const press = useLongPress(() => {
    const list = listBackSteps?.() ?? [];
    if (list.length) setSteps(list);
  }, { disabled: !listBackSteps || !onGo, mouse: true });
  return <>
    <button ref={buttonRef} type="button" className="mobile-bar-button" aria-label="Back" onClick={onBack} {...press}><IconArrowLeft aria-hidden="true" /></button>
    {onGo && (
      <MobileSheet open={steps !== null} onOpenChange={(open) => { if (!open) setSteps(null); }} onClosed={() => setShown(null)} title="Go back to" finalFocus={() => buttonRef.current}>
        <div className="trail-sheet-rows">
          {shown?.map((step) => (
            <button key={step.key} type="button" className="mobile-sheet-action trail-step" onClick={() => { setSteps(null); onGo(step.offset); }}>
              <StepRow name={step.name} />
            </button>
          ))}
        </div>
      </MobileSheet>
    )}
  </>;
}
