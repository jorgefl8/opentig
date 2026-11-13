import { authorName, authorUrl } from '@/site';

/** Stable Schema.org identifiers shared by the homepage and documentation graphs. */
export const entityId = (home: string, entity: 'website' | 'application' | 'author') => `${home}#${entity}`;

export const author = (home: string) => ({ '@type': 'Person', '@id': entityId(home, 'author'), name: authorName, url: authorUrl });

/** Serialize JSON-LD for an inline script, escaping `<` so content cannot close the element. */
export const jsonLd = (data: object) => JSON.stringify(data).replace(/</g, '\\u003c');

interface DocumentationPage {
  home: string;
  url: string;
  title: string;
  description: string;
  image: string;
  dateModified?: string;
}

/** A guide as a TechArticle about OpenTig, with breadcrumbs matching the visible docs navigation. */
export function documentationGraph({ home, url, title, description, image, dateModified }: DocumentationPage) {
  const documentation = new URL('/docs/', home).href;
  const trail = [{ name: 'OpenTig', url: home }, { name: 'Documentation', url: documentation }];
  if (url !== documentation) trail.push({ name: title, url });
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        '@id': `${url}#article`,
        url,
        headline: title,
        description,
        image,
        inLanguage: 'en',
        ...(dateModified && { dateModified }),
        isPartOf: { '@id': entityId(home, 'website') },
        about: { '@id': entityId(home, 'application') },
        author: { '@id': entityId(home, 'author') },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      author(home),
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: trail.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: item.url })),
      },
    ],
  };
}
