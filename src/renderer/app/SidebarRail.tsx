import type { ReactNode } from 'react';
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ariaKeyShortcut } from './sidebar-layout';

export interface SidebarRailSection<V extends string> {
  id: V;
  icon: ReactNode;
  /** Names the section and what its badge stands for, e.g. "Changes · 3 staged of 7". */
  label: string;
  badge?: { value: number; staged: boolean };
  unsaved?: boolean;
}

function badgeText(value: number): string {
  return value > 99 ? '99+' : String(value);
}

/** The collapsed desktop sidebar: one icon per section, each opening the sidebar on it. */
export function SidebarRail<V extends string>({ sections, active, ctrlHeld, toggleCombo, onSelect, onExpand }: {
  sections: readonly SidebarRailSection<V>[];
  active: V;
  ctrlHeld: boolean;
  toggleCombo: string;
  onSelect: (view: V) => void;
  onExpand: () => void;
}) {
  return (
    <nav className="sidebar-rail" aria-label="Repository views" data-shortcuts={ctrlHeld ? 'visible' : undefined}>
      <Tooltip>
        <TooltipTrigger render={<button type="button" className="sidebar-rail-button" aria-label="Expand sidebar" aria-keyshortcuts={ariaKeyShortcut(toggleCombo)} onClick={onExpand} />}>
          <IconLayoutSidebarLeftExpand aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="right">Expand sidebar <Kbd>{toggleCombo}</Kbd></TooltipContent>
      </Tooltip>
      <span className="sidebar-rail-separator" aria-hidden="true" />
      {sections.map((section, index) => (
        <Tooltip key={section.id}>
          <TooltipTrigger
            render={(
              <button
                type="button"
                className="sidebar-rail-button"
                aria-current={active === section.id ? 'page' : undefined}
                aria-label={section.label}
                aria-keyshortcuts={`Control+${index + 1}`}
                onClick={() => onSelect(section.id)}
              />
            )}
          >
            {section.icon}
            {section.badge && section.badge.value > 0 && (
              <span className="sidebar-rail-badge" data-staged={section.badge.staged ? '' : undefined} aria-hidden="true">{badgeText(section.badge.value)}</span>
            )}
            {section.unsaved && <span className="sidebar-rail-dot" aria-hidden="true" />}
            {ctrlHeld && <span className="sidebar-tab-shortcut sidebar-rail-shortcut" aria-hidden="true">{index + 1}</span>}
          </TooltipTrigger>
          <TooltipContent side="right">{section.label} <Kbd>{`Ctrl+${index + 1}`}</Kbd></TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}

/** Sits at the end of the expanded sidebar's tab bar. */
export function SidebarCollapseButton({ toggleCombo, onCollapse }: { toggleCombo: string; onCollapse: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" className="sidebar-collapse-button" aria-label="Collapse sidebar" aria-keyshortcuts={ariaKeyShortcut(toggleCombo)} onClick={onCollapse} />}>
        <IconLayoutSidebarLeftCollapse aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="bottom">Collapse sidebar <Kbd>{toggleCombo}</Kbd></TooltipContent>
    </Tooltip>
  );
}
