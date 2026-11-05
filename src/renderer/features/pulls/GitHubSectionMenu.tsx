import type { ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { IconBrandGithub, IconExternalLink, IconLoader4, IconRefresh } from '@tabler/icons-react';
import type { GitHubRepositoryAccount } from '@shared/github-accounts';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { openOnGitHub } from './gh-utils';

/** The menu beside the section tabs: whatever narrows the list, then refreshing it and where it comes from. */
export function GitHubSectionMenu({ label, icon, filtered = false, refreshing, refreshLabel, onRefresh, nameWithOwner, githubPath, account, onOpenGitHubSettings, children }: {
  label: string;
  icon: ReactNode;
  /** The list isn't showing its default content. */
  filtered?: boolean;
  refreshing: boolean;
  refreshLabel: string;
  onRefresh(): void;
  nameWithOwner: string | null;
  githubPath: 'pulls' | 'releases' | 'actions';
  account: GitHubRepositoryAccount | null;
  onOpenGitHubSettings(): void;
  children?: ReactNode;
}) {
  return (
    <Popover.Root>
      <Tooltip>
        <TooltipTrigger render={<Popover.Trigger render={<Button variant={filtered ? 'secondary' : 'ghost'} size="icon-xs" className="change-action-button" aria-label={label} aria-pressed={filtered} />} />}>
          {refreshing ? <IconLoader4 className="animate-spin" /> : icon}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="isolate z-50 outline-none">
          <Popover.Popup className="pulls-menu-popup" aria-label={label}>
            {children}
            <button className="pulls-menu-action" disabled={refreshing} onClick={onRefresh}>
              {refreshing ? <IconLoader4 className="animate-spin" aria-hidden="true" /> : <IconRefresh aria-hidden="true" />}
              <span>{refreshLabel}</span>
            </button>
            {nameWithOwner && (
              <Popover.Close render={<button className="pulls-menu-action" onClick={() => openOnGitHub(`https://github.com/${nameWithOwner}/${githubPath}`)} />}>
                <IconExternalLink aria-hidden="true" />
                <span>Open on GitHub</span>
                <small>{nameWithOwner}</small>
              </Popover.Close>
            )}
            {account?.login && (
              <Popover.Close render={<button className="pulls-menu-action" onClick={onOpenGitHubSettings} aria-label={`GitHub account @${account.login}, open GitHub settings`} />}>
                <IconBrandGithub aria-hidden="true" />
                <span>@{account.login}</span>
                <small>Account</small>
              </Popover.Close>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
