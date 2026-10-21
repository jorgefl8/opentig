import { useMemo } from 'react';
import { IconArrowLeft, IconDownload, IconFolder, IconFolderOpen, IconRadar2 } from '@tabler/icons-react';
import type { AiHarnessId, BootstrapData, Preferences } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { AppName } from '@/components/AppName';
import { Kbd } from '@/components/ui/kbd';
import { EnvironmentStrip } from '@/features/onboarding/EnvironmentStrip';
import { GitMissingPanel } from '@/features/onboarding/GitMissingPanel';
import { useToolChecks } from '@/features/onboarding/useToolChecks';
import type { SettingsSection } from '@/features/settings/SettingsDialog';
import { RepositoryFaviconImage } from './RepositoryFavicon';
import { useRepositoryFavicons } from './useRepositoryFavicons';
import { groupRecentRepositories } from './repository-select-model';
import '@/features/onboarding/onboarding.css';

/** The start screen doubles as onboarding: one step to a repository, tools at a glance. */
export function Welcome({ recent, preferences, onPreference, onOpen, onClone, onFind, onRecent, onSettings, onBack }: {
  recent: BootstrapData['recentRepositories'];
  preferences: Preferences;
  onPreference(partial: Partial<Preferences>): unknown;
  onOpen(): void;
  onClone(): void;
  onFind(): void;
  onRecent(id: string): void;
  onSettings(section: SettingsSection): void;
  /** Present while onboarding is replayed over an open repository. */
  onBack?: (() => void) | undefined;
}) {
  const repositories = useMemo(() => groupRecentRepositories(recent), [recent]);
  const favicons = useRepositoryFavicons(repositories);
  const checks = useToolChecks();
  const gitBlocked = checks.git !== null && checks.git.state !== 'ready';
  const gitReady = checks.git?.state === 'ready';
  return (
    <div className="welcome">
      {window.opentigDesktop && <div className="welcome-titlebar" aria-hidden="true" />}
      {onBack && <div className="welcome-corner"><Button variant="ghost" size="sm" onClick={onBack}><IconArrowLeft />Back to workspace</Button></div>}
      <img className="welcome-logo" src="./opentig.svg" alt="" />
      <h1><AppName /></h1>
      <p>{repositories.length ? 'Pick up where you left off, or bring in another repository.' : 'Start with a repository. Everything else can wait.'}</p>
      {gitBlocked ? <GitMissingPanel status={checks.git!} checking={checks.checking} onRecheck={checks.recheck} /> : <div className="welcome-actions">
        <button type="button" className="welcome-action primary" disabled={!gitReady} onClick={onOpen}>
          <span className="welcome-action-icon"><IconFolderOpen /></span><strong>Open a folder</strong><small>A repository already {window.opentigDesktop ? 'on this computer' : 'on your server'}</small><span className="welcome-action-keys"><Kbd>Ctrl</Kbd><Kbd>O</Kbd></span>
        </button>
        <button type="button" className="welcome-action" disabled={!gitReady} onClick={onClone}>
          <span className="welcome-action-icon"><IconDownload /></span><strong>Clone from URL</strong><small>GitHub, GitLab, or any Git host over HTTPS or SSH</small>
        </button>
        <button type="button" className="welcome-action" disabled={!gitReady} onClick={onFind}>
          <span className="welcome-action-icon"><IconRadar2 /></span><strong>Find {window.opentigDesktop ? 'on this computer' : 'on the server'}</strong><small>Look for repositories in ~/code, ~/projects, and similar folders</small>
        </button>
      </div>}
      <EnvironmentStrip checks={checks} assistant={preferences.commitMessageHarness} onAssistant={(id: AiHarnessId) => void onPreference({ commitMessageHarness: id })} onSettings={onSettings} />
      {!gitBlocked && <p className="welcome-note">Optional tools never block you. Change them anytime in Settings.</p>}
      {repositories.length > 0 && <section><h2>Repositories</h2>{repositories.map((item) => <button key={item.key} disabled={gitBlocked} onClick={() => onRecent(item.recent.id)}><RepositoryFaviconImage src={favicons.get(item.key)} fallback={<IconFolder aria-hidden="true" />} /><span><strong>{item.name}</strong><small>{item.rootPath}</small></span></button>)}</section>}
    </div>
  );
}
