// Repository-relative sources: shared by Astro, link rewriting and CI.
// Publishing is explicit; adding a file under docs/ does not publish it automatically.
export const publishedGuides = {
  'getting-started': {
    title: 'Installation and CLI',
    description: 'Install OpenTig on Windows or run its CLI on Linux, macOS, and Windows. Requirements, browser access, background services, and updates.',
    source: 'docs/getting-started.md',
  },
  features: {
    title: 'Git workflows',
    description: 'Work with repositories, files, diffs, staging, commits, search, history, branches, and worktrees in OpenTig.',
    source: 'docs/features.md',
  },
  github: {
    title: 'GitHub and pull requests',
    description: 'Review and create GitHub pull requests in OpenTig. Configure accounts, Git credentials, native stacks, and commit authorship.',
    source: 'docs/github.md',
  },
  'ai-assistance': {
    title: 'AI assistance',
    description: 'Set up optional AI assistance for commit messages, commit splitting, and pull request drafts. Review supported CLIs, models, and supplied context.',
    source: 'docs/ai-assistance.md',
  },
  interface: {
    title: 'Interface and preferences',
    description: 'Customize OpenTig themes, fonts, shortcuts, and file views. Learn how settings, saved preferences, and mobile navigation work.',
    source: 'docs/interface.md',
  },
  'web-access': {
    title: 'Browser access and pairing',
    description: 'Connect a browser to your running OpenTig instance through SSH, a trusted network, or an HTTPS proxy. Manage pairing, sessions, and access.',
    source: 'docs/web-access.md',
  },
  'security-and-privacy': {
    title: 'Security and privacy',
    description: 'Understand OpenTig trust boundaries, local data, host permissions, and the context shared with optional AI providers.',
    source: 'docs/security-and-privacy.md',
  },
  contributing: {
    title: 'Contributing',
    description: 'Contribute to OpenTig with focused changes, local setup, quality checks, documentation updates, and reviewed pull requests.',
    source: 'CONTRIBUTING.md',
  },
  development: {
    title: 'Development and packaging',
    description: 'Run OpenTig from source, use isolated development profiles, validate changes, and build desktop packages or the CLI server.',
    source: 'docs/development.md',
  },
  architecture: {
    title: 'Architecture',
    description: 'Explore the OpenTig server, Electron shell, browser transport, persistence, and the boundaries between shared and native capabilities.',
    source: 'docs/architecture.md',
  },
  releases: {
    title: 'Release automation',
    description: 'Understand OpenTig release drafts, version tags, Windows installers, npm publication, and the separate website deployment process.',
    source: 'docs/releases.md',
  },
  'ai-writing-policy': {
    title: 'AI writing policy',
    description: 'Writing conventions for OpenTig AI drafts and development contributions, including language, evidence, privacy, and review.',
    source: 'docs/ai-writing-policy.md',
  },
  security: {
    title: 'Reporting vulnerabilities',
    description: 'Find supported OpenTig versions and learn how to report a suspected vulnerability privately with useful reproduction details.',
    source: 'SECURITY.md',
  },
  'third-party-notices': {
    title: 'Third-party notices',
    description: 'Licenses and attribution for fonts, icons, dependencies, and other third-party assets distributed with OpenTig.',
    source: 'THIRD_PARTY_NOTICES.md',
  },
};

export const documentationSections = [
  { title: 'Get started', pages: ['index', 'getting-started'] },
  { title: 'Using OpenTig', pages: ['features', 'github', 'ai-assistance'] },
  { title: 'Configuration', pages: ['interface', 'web-access', 'security-and-privacy'] },
  { title: 'Development', pages: ['contributing', 'development', 'architecture', 'releases'] },
  { title: 'Policies', pages: ['ai-writing-policy', 'security', 'third-party-notices'] },
];
export const installationPath = '/docs/getting-started/';
export const documentationPaths = ['/docs/', ...Object.keys(publishedGuides).map(slug => `/docs/${slug}/`)];
export const publishedSources = new Set(Object.values(publishedGuides).map(guide => guide.source));
export const documentationRoutes = new Map([
  ['docs/README.md', '/docs/'],
  ['README.md', '/'],
  ...Object.entries(publishedGuides).map(([slug, guide]) => [guide.source, `/docs/${slug}/`]),
]);

// Fumadocs normally strips trailing slashes, which Astro's strict routes require.
// Override the resolved URL function so page links, the tree and search agree.
export const documentationUrls = {
  name: 'astro-documentation-urls',
  config(config) {
    const getUrl = config.url;
    return { ...config, url: (...args) => `${getUrl(...args).replace(/\/$/, '')}/` };
  },
};
