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

`check:website` runs Astro's component/type checks, Oxlint, and the www redirect tests. The website keeps its own TypeScript version because the Astro checker currently supports TypeScript 6; the application uses its existing version. A process-local module hook in `website/scripts/check.mjs` keeps Astro/Volar on that compatible compiler even when npm hoists them alongside the application compiler. Dependencies are pinned in `website/package.json` and resolved in the repository's single `package-lock.json`.

## Content and appearance

The page contains floating navigation, a hero, feature cards, a tool carousel, getting-started steps, a download call to action, and a footer. It uses OpenTig’s desktop dark palette (electric blue accents and neutral surfaces), Geist, Inconsolata, and Geist Pixel Triangle, plus a decorative WebGL terminal effect. Reduced-motion preferences stop the terminal animation and logo carousel; the page remains usable without WebGL.

Color tokens in `website/src/index.css` mirror the desktop dark theme in `src/renderer/styles/index.css`. The shared landing `Button.astro` follows the desktop button’s blue shadow, hover, focus, and pressed states; navigation and section calls to action use the same component.

Website copy avoids em dashes. Describe browser access as a connection to a running OpenTig instance on the repository host, with pairing required; the Windows app can provide that instance itself, or the CLI can run the server. Keep this setup detail separate from the main product promise.

The hero identifies OpenTig as a free, open-source Git client and presents a focused workspace for Git repositories. Its supporting copy covers file browsing, diffs, editing, commits, branches, worktrees, and GitHub pull requests. Optional AI assistance is described separately as help with commit messages, commit splitting, and PR descriptions.

Edit sections in `website/src/components/landing/`. Shared GitHub, download, and documentation destinations live in `website/src/site.ts`. The website explicitly pins Astro's `cookie` dependency so its prerendered build resolves the correct API independently of the application's older transitive copy. Downloads link to the latest published GitHub release without fetching release metadata during the build. Browser/CLI setup instructions link to the installation guide. The site contains no repository operations or hosted accounts.

Fonts and branding are served locally from `website/public/`. The author avatar in the footer loads from GitHub. License notices for the port and bundled assets are in [third-party notices](../THIRD_PARTY_NOTICES.md).

## Manual deployment to Cloudflare Workers

`npm run build:website` writes `website/dist/`. [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) serves that directory directly; no Astro server adapter, application server, or database is needed.

The checked-in `website/wrangler.jsonc` targets the `opentig-website` Worker and binds `opentig.com` as a custom domain. The account ID is configured locally through `CLOUDFLARE_ACCOUNT_ID`, outside the public configuration. Cloudflare manages the domain's DNS record and TLS certificate. The `workers.dev` endpoint and version preview URLs are disabled. Unknown paths return 404 rather than falling back to the homepage.

`www.opentig.com` is bound to the small `opentig-www` Worker configured in `website/wrangler.www.jsonc`. It permanently redirects HTTP and HTTPS requests to `https://opentig.com`, preserving paths and query parameters. The primary site continues to serve static assets directly. If the redirect code or configuration changes, deploy it separately with `npm run deploy:www --workspace @opentig/website`; append `-- --dry-run` to validate without publishing. Website content updates still use the main deployment command below.

Before the first deployment on a new machine, copy `website/.env.example` to `website/.env` and fill in `CLOUDFLARE_ACCOUNT_ID` with the account that owns the production domain. Wrangler loads this ignored file for both configurations. Account IDs identify the target account; the authenticated session supplies permission to deploy. Contributors deploying a fork must also change the Worker names, domains, Astro public origin, and www redirect destination to their own values.

From the repository root:

```bash
# Once per development machine, unless Wrangler is already logged in:
npm exec --workspace @opentig/website -- wrangler login

# Validate and build the site, then inspect the deployment without publishing:
npm run deploy:website -- --dry-run

# Validate, rebuild, and publish the current local website:
npm run deploy:website
```

Wrangler is pinned as a website development dependency. Its local login is shared across projects on the same machine, so an existing Wrangler session can be reused. Credentials are stored by Wrangler outside the repository. Its generated `.wrangler/` state and local secret files are ignored by Git.

Deployment is manual. Neither GitHub Actions nor Cloudflare Workers Builds is connected to publish on push. `deploy:website` uploads the current working copy, so review local changes before running it. It does not create an application release, tag, or npm package.

Astro uses `https://opentig.com` as the default public origin for canonical and social-image URLs. Set `WEBSITE_URL` at build time only when deliberately targeting another origin, and rebuild before uploading. Changing that variable does not change the Wrangler domains or the account selected through `CLOUDFLARE_ACCOUNT_ID`.

## CI and release separation

The existing **CI** workflow (`.github/workflows/ci.yml`) has a separate `website` job that installs only the website workspace, checks and builds it on relevant pull requests and pushes to `main`. A manual CI run validates both projects. There is no extra website workflow, artifact upload, or deployment job. CI has read-only repository permissions and no Cloudflare credentials.

Changes confined to `website/` or this guide skip the application's heavy CI jobs and do not trigger **Next release draft**. CI still reports a scope decision for each project. Application release notes exclude these website-only commits, including merged PRs; **Prepare release** will not create an application version or tag when those are the only changes since the last stable release.

Changes to shared files such as the root `package.json`, `package-lock.json`, and `.oxlintrc.json` validate both projects and remain eligible for application release notes. Mixed commits containing application changes also remain included regardless of their commit title. The website's private package version is independent of the desktop and CLI release version. The existing `vX.Y.Z` tags and installer/npm publication workflows belong to the application.
