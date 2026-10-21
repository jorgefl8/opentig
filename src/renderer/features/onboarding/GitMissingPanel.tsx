import { useState } from 'react';
import { IconExternalLink, IconRefresh } from '@tabler/icons-react';
import type { GitToolStatus } from '@shared/onboarding';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { openExternalUrl } from '@/lib/browser-capabilities';

const GIT_INSTALL_OPTIONS: Record<GitToolStatus['platform'], { label: string; command: string }[]> = {
  linux: [
    { label: 'Ubuntu / Debian', command: 'sudo apt install git' },
    { label: 'Fedora', command: 'sudo dnf install git' },
    { label: 'Arch', command: 'sudo pacman -S git' },
    { label: 'openSUSE', command: 'sudo zypper install git' },
  ],
  darwin: [
    { label: 'Command line tools', command: 'xcode-select --install' },
    { label: 'Homebrew', command: 'brew install git' },
  ],
  win32: [{ label: 'winget', command: 'winget install --id Git.Git -e --source winget' }],
  other: [],
};

/** The only blocking onboarding state: nothing works without Git on the server. */
export function GitMissingPanel({ status, checking, onRecheck }: { status: GitToolStatus; checking: boolean; onRecheck(): void }) {
  const options = GIT_INSTALL_OPTIONS[status.platform];
  const [selected, setSelected] = useState(0);
  const option = options[selected];
  const missing = status.state === 'missing';
  return <section className="onboarding-git-missing" aria-labelledby="onboarding-git-missing-title">
    <h2 id="onboarding-git-missing-title">{missing ? 'Git isn’t installed yet' : 'Git couldn’t be started'}</h2>
    <p>{missing
      ? `OpenTig uses the Git installed on ${window.opentigDesktop ? 'this computer' : 'your server'}. Install it, then check again. No restart needed.`
      : status.message ?? 'Check your Git installation, then try again.'}</p>
    {missing && options.length > 0 && <>
      {options.length > 1 && <div className="onboarding-segments" role="tablist" aria-label="Install method">
        {options.map((item, index) => <button key={item.label} type="button" role="tab" aria-selected={index === selected} onClick={() => setSelected(index)}>{item.label}</button>)}
      </div>}
      <div className="onboarding-command"><code>{option!.command}</code><CopyButton value={option!.command} label="Copy command" /></div>
      {status.platform === 'win32' && <p className="onboarding-hint">Or use the Git for Windows installer and keep “Git from the command line” selected.</p>}
    </>}
    <div className="onboarding-panel-actions">
      <span>{missing ? 'Looked in PATH and your login shell.' : ''}</span>
      <Button variant="outline" size="sm" onClick={() => void openExternalUrl('https://git-scm.com/downloads')}>Install guide<IconExternalLink /></Button>
      <Button size="sm" disabled={checking} onClick={onRecheck}><IconRefresh className={checking ? 'animate-spin' : undefined} />{checking ? 'Checking…' : 'Check again'}</Button>
    </div>
  </section>;
}
