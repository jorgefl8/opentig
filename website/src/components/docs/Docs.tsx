import type { ReactNode } from 'react';
import type { Root } from 'fumadocs-core/page-tree';
import type { TOCItemType } from 'fumadocs-core/toc';
import { RootProvider } from 'fumadocs-ui/provider/astro';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsPage, DocsTitle, EditOnGitHub } from 'fumadocs-ui/layouts/docs/page';
import { downloadUrl, repositoryUrl } from '@/site';
import Search from './Search';

interface Props {
  tree: Root;
  pathname: string;
  title: string;
  source: string;
  toc: TOCItemType[];
  children: ReactNode;
}
export function Docs({ tree, pathname, title, source, toc, children }: Props) {
  return <RootProvider pathname={pathname} theme={{ enabled: false }} search={{ SearchDialog: Search }}>
    <DocsLayout tree={tree} themeSwitch={{ enabled: false }} tabs={false}
      nav={{ url: '/', title: <><img src="/favicon.svg" width={28} height={28} alt="" /><span>OpenTig</span><span className="docs-brand-label">Docs</span></> }}
      links={[{ type: 'custom', children: <a className="docs-download" href={downloadUrl} data-analytics-placement="docs-nav">Download</a> }]}
      sidebar={{ footer: <nav aria-label="Resources" className="docs-resources">
        <a href={`${repositoryUrl}/releases`}>Release notes ↗</a>
        <a href="/demo/">Try OpenTig</a>
        <a href="/">← Back to website</a>
      </nav> }}>
      <DocsPage toc={toc} id="main-content" tabIndex={-1} breadcrumb={{ includeRoot: true }}>
        <DocsTitle>{title}</DocsTitle>
        <DocsBody>{children}</DocsBody>
        <EditOnGitHub data-docs-source="true" href={`${repositoryUrl}/blob/main/${source}`}>Edit on GitHub</EditOnGitHub>
      </DocsPage>
    </DocsLayout>
  </RootProvider>;
}
