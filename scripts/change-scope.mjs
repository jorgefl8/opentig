// Shared manifests, the root lockfile, and shared tooling intentionally remain
// application changes. Exempt only paths owned exclusively by the public site.
export const isWebsitePath = (file) => file.startsWith('website/')
  || file === 'docs/website.md'
  // Retain the former workflow path when classifying historical releases.
  || file === '.github/workflows/website.yml';
