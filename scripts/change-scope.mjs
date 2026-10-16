// Shared manifests, the root lockfile, and shared tooling intentionally remain
// application changes. Exempt only paths owned exclusively by the public site.
export const isWebsitePath = (file) => file.startsWith('website/')
  || file === 'docs/website.md'
  // The manual website deploy workflow also covers the former validation path.
  || file === '.github/workflows/website.yml';
