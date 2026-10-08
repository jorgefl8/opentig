import { useMemo } from 'react';
import { IconFolder, IconFolderOpen } from '@tabler/icons-react';
import type { BootstrapData } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { AppName } from '@/components/AppName';
import { RepositoryFaviconImage } from './RepositoryFavicon';
import { useRepositoryFavicons } from './useRepositoryFavicons';
import { groupRecentRepositories } from './repository-select-model';

export function Welcome({ recent, onOpen, onRecent }: { recent: BootstrapData['recentRepositories']; onOpen(): void; onRecent(id: string): void }) {
  const repositories = useMemo(() => groupRecentRepositories(recent), [recent]);
  const favicons = useRepositoryFavicons(repositories);
  return (
    <div className="welcome">
      {window.opentigDesktop && <div className="welcome-titlebar" aria-hidden="true" />}
      <h1><AppName /></h1>
      <p>Open a repository to review changes, explore files, and create commits.</p>
      <Button size="lg" onClick={onOpen}><IconFolderOpen /> Open repository</Button>
      {repositories.length > 0 && <section><h2>Repositories</h2>{repositories.map((item) => <button key={item.key} onClick={() => onRecent(item.recent.id)}><RepositoryFaviconImage src={favicons.get(item.key)} fallback={<IconFolder aria-hidden="true" />} /><span><strong>{item.name}</strong><small>{item.rootPath}</small></span></button>)}</section>}
      <small className="shortcut">Ctrl+O to open · Ctrl+R to refresh</small>
    </div>
  );
}
