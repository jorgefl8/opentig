# Public website

The `website/` npm workspace contains OpenTig's public landing page, built with Astro, Tailwind CSS, and OGL. Its static output is independent of the desktop application, CLI, and paired browser UI. It does not start or connect to an OpenTig server.

## Develop and check

Use Node.js 24.15+ and npm 11+ from the repository root:

```bash
npm ci
npm run dev:website
```

Astro prints its local address (normally `http://127.0.0.1:4321`). Stop a foreground server with Ctrl+C. Astro may start in the background when launched by a coding agent; use `npm run dev:website -- status` and `npm run dev:website -- stop` to manage that instance. To choose a port, run `npm run dev:website -- --port 4322`. When developing on a remote machine, use your development environment's port forwarding to reach that listener.

```bash
npm run check:website
npm run build:website
npm run preview:website
```

`check:website` runs Astro's component/type checks and Oxlint. The website keeps its own TypeScript version because the Astro checker currently supports TypeScript 6; the application uses its existing version. A process-local module hook in `website/scripts/check.mjs` keeps Astro/Volar on that compatible compiler even when npm hoists them alongside the application compiler. Dependencies are pinned in `website/package.json` and resolved in the repository's single `package-lock.json`.

## Content and appearance

The page contains floating navigation, a hero, feature cards, a tool carousel, getting-started steps, a download call to action, and a footer. It uses OpenTig’s desktop dark palette (electric blue accents and neutral surfaces), Geist, Inconsolata, and Geist Pixel Triangle, plus a decorative WebGL terminal effect. Reduced-motion preferences stop the terminal animation and logo carousel; the page remains usable without WebGL.

Color tokens in `website/src/index.css` mirror the desktop dark theme in `src/renderer/styles/index.css`. The shared landing `Button.astro` follows the desktop button’s blue shadow, hover, focus, and pressed states; navigation and section calls to action use the same component.

Website copy avoids em dashes. Describe browser access as a connection to a running OpenTig instance on the repository host, with pairing required; the Windows app can provide that instance itself, or the CLI can run the server. Keep this setup detail separate from the main product promise.

Edit sections in `website/src/components/landing/`. Shared GitHub, download, and documentation destinations live in `website/src/site.ts`. The website explicitly pins Astro's `cookie` dependency so its prerendered build resolves the correct API independently of the application's older transitive copy. Downloads link to the latest published GitHub release without fetching release metadata during the build. Browser/CLI setup instructions link to the installation guide. The site contains no repository operations or hosted accounts.

Fonts and branding are served locally from `website/public/`. The author avatar in the footer loads from GitHub. License notices for the port and bundled assets are in [third-party notices](../THIRD_PARTY_NOTICES.md).

## Static output and public origin

`npm run build:website` writes `website/dist/`. A static host can publish that directory separately from OpenTig releases; no server adapter is needed.

Set `WEBSITE_URL` to the final public origin in the build environment before deployment. Astro uses it for the canonical URL and absolute social-image URLs. Without it, these URLs are omitted so local addresses cannot end up in public metadata. Rebuild after changing the origin. Hosting, DNS, and automatic publication are configured separately.

## CI and release separation

**Website CI** (`.github/workflows/website.yml`) installs only the website workspace, checks and builds it on relevant pull requests and pushes to `main`, and can also run manually. It uploads `opentig-website-<commit>` as a static build artifact kept for 14 days. The workflow has read-only repository permissions and does not publish the site or create GitHub releases.

Changes confined to `website/`, this guide, or the website workflow skip the application's heavy CI jobs and do not trigger **Next release draft**. Application CI still reports its scope decision. Application release notes exclude these website-only commits, including merged PRs; **Prepare release** will not create an application version or tag when those are the only changes since the last stable release.

Changes to shared files such as the root `package.json`, `package-lock.json`, and `.oxlintrc.json` validate both projects and remain eligible for application release notes. Mixed commits containing application changes also remain included regardless of their commit title. The website's private package version is independent of the desktop and CLI release version. The existing `vX.Y.Z` tags and installer/npm publication workflows belong to the application.
