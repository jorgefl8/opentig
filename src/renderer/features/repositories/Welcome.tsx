import { appDisplayName } from '@/lib/app-identity';
import { IconFolder, IconFolderOpen } from '@tabler/icons-react';
import type { BootstrapData } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { groupRecentRepositories } from './repository-select-model';

export function Welcome({ recent, onOpen, onRecent }: { recent: BootstrapData['recentRepositories']; onOpen(): void; onRecent(id: string): void }) {
  const repositories = groupRecentRepositories(recent);
  return (
    <div className="welcome">
      <h1>{appDisplayName}</h1><p>Open a repository to review changes, explore files, and create commits.</p>
      <Button size="lg" onClick={onOpen}><IconFolderOpen /> Open repository</Button>
      {repositories.length > 0 && <section><h2>Recent</h2>{repositories.map((item) => <button key={item.key} onClick={() => onRecent(item.recent.id)}><IconFolder /><span><strong>{item.name}</strong><small>{item.rootPath}</small></span></button>)}</section>}
      <small className="shortcut">Ctrl+O to open · Ctrl+R to refresh</small>
    </div>
  );
}
