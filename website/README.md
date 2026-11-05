# OpenTig website

The public Astro landing page and documentation. See the [website guide](../docs/website.md) for development, checks, and publication.

Publish through **Actions → Deploy website** on `main`. The workflow checks and builds the site with the latest published release, then uploads it to Cloudflare Workers.

`pnpm run deploy:website` runs the same checks, build, and upload from a local checkout with your own Cloudflare credentials. Use it only when the workflow is unavailable: without `WEBSITE_UMAMI_ID` it ships without analytics, and if GitHub cannot be reached it builds with the static fallback installer instead of failing.
