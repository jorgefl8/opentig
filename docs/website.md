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

`check:website` builds the demo, runs Astro and demo type checks, Oxlint, and regression tests for the sample repository, www redirect, and build validator. The website keeps its own TypeScript version because the Astro checker currently supports TypeScript 6; the application uses its existing version. A process-local module hook in `website/scripts/check.mjs` keeps Astro/Volar on that compatible compiler even when npm hoists them alongside the application compiler. Dependencies are pinned in `website/package.json` and resolved in the repository's single `package-lock.json`.

Every Astro build runs `website/scripts/validate-build.mjs` through the `astro:build:done` hook, including builds to a custom output directory. It parses the generated HTML and XML with parse5 and saxes and fails on missing or duplicate metadata, inconsistent canonical/social URLs, wrong indexing policy, broken local links or fragments, missing HTML/CSS asset references, and incorrect social PNG dimensions. It also checks the homepage JSON-LD structure and its agreement with the metadata, and compares the sitemap against the generated indexable pages. The expected indexing policy comes from Vite's environment loader using the build's actual mode and environment directory. `WEBSITE_NOINDEX` accepts only `true`, `false`, or an unset value.

Validation is offline: external links are checked for URL format and local/private hosts, not network availability. The JSON-LD checks protect this site's agreed data contract; they do not replace Schema.org validation or establish search-result eligibility. When adding pages or deliberately changing the metadata contract, update the sitemap and relevant checks together. Regression tests mutate temporary output to ensure real failures are rejected and remove their files afterwards. No test artifacts are published.

## Content and appearance

The page contains floating navigation, a hero, feature cards, a tool carousel, getting-started steps, a download call to action, and a footer. It uses OpenTig’s desktop dark palette (electric blue accents and neutral surfaces), Geist, Inconsolata, and Geist Pixel Triangle, plus a decorative WebGL terminal effect. Reduced-motion preferences stop the terminal animation and logo carousel; the page remains usable without WebGL.

Color tokens in `website/src/index.css` mirror the desktop dark theme in `src/renderer/styles/index.css`. The shared landing `Button.astro` follows the desktop button’s blue shadow, hover, focus, and pressed states; navigation and section calls to action use the same component.

Website copy avoids em dashes. Describe browser access as a connection to a running OpenTig instance on the repository host, with pairing required; the Windows app can provide that instance itself, or the CLI can run the server. Keep this setup detail separate from the main product promise.

The hero identifies OpenTig as a free, open-source Git client and presents a focused workspace for Git repositories. Its supporting copy covers file browsing, diffs, editing, commits, branches, worktrees, and GitHub pull requests. Optional AI assistance is described separately as help with commit messages, commit splitting, and PR descriptions.

The `#workflow` section loads an interactive demo automatically as it approaches the viewport, with a fixed-height area and a real OpenTig screenshot while loading. No activation click or account is required. A framed toolbar keeps the Live demo indicator and Open full screen action visible above the app. The indicator lights up after the embedded app signals readiness; the full-screen link opens `/demo/` in a new tab. The toolbar adapts to narrow screens, has a visible keyboard focus state, and respects reduced motion. Without JavaScript, the poster and workflow instructions remain available. The poster at `website/public/images/workflow-review.webp` is an intentional product asset with normal OpenTig branding and sample data; source captures and tooling stay untracked.

The demo compiles the actual React renderer with a browser-only API adapter in `website/demo/`. The Launchpad sample supports file browsing, editing and saving, diff review, file staging and unstaging, discarding edits, sample commits, history, text search, HTML preview, sample pull request review, and appearance settings. `Files → index.html` opens a self-contained release board with Preview and Code tabs; edits can be previewed, saved, staged, and committed. The PRs view includes open, draft, merged, and closed examples, Markdown summaries, commit timelines, full diffs, and per-commit diffs. PR fixtures stay independent of working-tree edits. Sample PRs have no GitHub links, and PR creation is disabled. Staging saves the chosen version; subsequent edits remain outside a commit until staged again. Git operations are simulated in memory, independently in each page. The demo has no reset control or commit-count limit. After a commit, visitors can keep editing and committing; the history and any remaining edits stay available. Reloading the page starts a fresh sample. Settings includes appearance, changes layout, and line wrapping. Its heading and close control stay visible while the settings list scrolls; repository sync and ignored-file controls are omitted from the sample. Nothing accesses visitors' repositories or connects to an OpenTig server. Live GitHub connections, AI, native file operations, and unsupported actions require an installed instance and return an explanation in the demo.

`website/scripts/build-demo.mjs` builds the shared UI before website development, checks, and builds. Build aliases replace the server API, update transport, connection settings, and the HTML preview transport with demo implementations. HTML uses a sandboxed `srcdoc` frame without script permissions in the static demo; the installed app retains its server-backed preview transport. Generated assets in `website/public/demo/` and the generated bundle manifest are ignored. Restart `npm run dev:website` after editing the demo or shared renderer to rebuild these assets; Astro continues to refresh landing-page edits normally. The separate demo TypeScript config checks the adapter against the actual application contract. Regression tests cover staged snapshots, commits, conflicts, independent sample sessions, HTML edits, and sample PR filtering and diffs. The demo route always emits `noindex` and stays out of the sitemap and homepage structured data.

Section headings describe Git workflows, integrations, and opening an existing repository. Feature and step titles use H3 elements beneath their section H2. The `#install` section presents Windows desktop and CLI server requirements with separate download/setup actions, followed by browser pairing and remote-access guidance. Windows desktop is Windows 10+ x64 with Git; the CLI supports Linux, macOS, and Windows with Node.js 24+ and Git. Both require a running host instance for paired browser access. The installation section is linked from navigation and the getting-started steps; its requirements follow `docs/getting-started.md` and `docs/web-access.md`.

Edit sections in `website/src/components/landing/`. Shared GitHub, download, and documentation destinations live in `website/src/site.ts`. The website explicitly pins Astro's `cookie` dependency so its prerendered build resolves the correct API independently of the application's older transitive copy. Downloads link to the latest published GitHub release without fetching release metadata during the build. Browser/CLI setup instructions link to the installation guide. The site has no hosted accounts or real repository operations.

Fonts and branding are served locally from `website/public/`. The author avatar in the footer loads from GitHub. License notices for the port and bundled assets are in [third-party notices](../THIRD_PARTY_NOTICES.md).

Page titles, descriptions, canonical URLs, and Open Graph and Twitter card metadata live in `website/src/layouts/Layout.astro`. The homepage uses the same title and description for search and social previews. The shared social image is `website/public/opentig-social.png` (1200 × 630), with matching dimensions and alternative text in the metadata.

The editable card source is `website/design/social-card.html`, outside the published site. It combines the existing real product screenshot in `docs/images/workspace.png` with the local logo and Geist font. To update it, serve the repository root on loopback, open `/website/design/social-card.html` in a browser at exactly 1200 × 630 CSS pixels, wait for the font and images to load, and export the viewport as `website/public/opentig-social.png`. If the browser scales screenshots, normalize the exported PNG to 1200 × 630 pixels without cropping. Keep the screenshot faithful to the application and inspect the exported image before deployment. The existing `/og-image.png` remains available for previously cached previews.

The indexable homepage emits one JSON-LD graph in its HTML head, defined in `website/src/pages/index.astro`. It connects `WebSite` (OpenTig's name, canonical home URL, and English language) to `SoftwareApplication` (Git client category, supported host platforms, requirements, MIT license link, free availability, installation guide, and official repository via `sameAs`). Requirements distinguish the Windows desktop installer from the Windows/Linux/macOS CLI server and explain browser pairing to a running instance. The description is shared with page metadata through `siteDescription` in `website/src/site.ts`. URLs derive from Astro's configured public origin and the existing repository constants; JSON is serialized with HTML-sensitive `<` characters escaped.

The graph is omitted from development, noindex preview builds, and the 404 page. It contains no inferred release version, ratings, reviews, company identity, or hosted-app claims. Free availability is expressed with `isAccessibleForFree` and an offer price of zero. Valid [Schema.org application data](https://schema.org/SoftwareApplication) does not by itself establish eligibility for Google's software-app rich result, whose [requirements include a genuine rating or review](https://developers.google.com/search/docs/appearance/structured-data/software-app). Keep the data factual instead of adding unsupported fields to satisfy that eligibility check.

## Crawling, indexing, and missing pages

Astro generates `/robots.txt` and `/sitemap.xml` at build time. Production robots.txt allows crawling and points to the absolute sitemap URL. The sitemap currently lists only the homepage; add new published content routes to `publicPaths` in `website/src/pages/sitemap.xml.ts`. Do not add errors, assets, redirects, or fragment links. Dates and priorities are omitted rather than inferred from the build time.

`website/src/pages/404.astro` provides the branded error page. Workers uses `not_found_handling: "404-page"` to return it with HTTP 404 for missing routes, including nested paths. The page always has `noindex` and omits canonical and `og:url` metadata so an error is not presented as a content page. Direct `/404` variants also receive `X-Robots-Tag: noindex` through `website/public/_headers`.

Development pages are marked `noindex`. For a separately hosted preview, set `WEBSITE_NOINDEX=true` **when building**, even if its canonical origin remains `https://opentig.com`. This adds `noindex` to every page using the shared layout, emits an empty sitemap, and removes the sitemap announcement from robots.txt. Crawling stays allowed so search engines can read the `noindex` instruction, as described in [Google's indexing guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing). This setting controls indexing, not access to the site.

For example, build a preview into an ignored directory without replacing the production output (Bash):

```bash
WEBSITE_NOINDEX=true npm run build --workspace @opentig/website -- --outDir ../.ai/website-preview
```

Leave `WEBSITE_NOINDEX` unset for production and rebuild with `npm run build:website` or `npm run deploy:website`. A noindex build targeting `website/dist` fails validation, stopping the normal deployment command before Wrangler runs; previews must use a separate output directory. If a build fails, rebuild successfully before manually uploading its files. `WEBSITE_URL` only controls URL generation; it does not switch indexing policy. The current Cloudflare configuration keeps `workers.dev` and version URLs disabled; `_headers` additionally marks those hosts `noindex` if they are enabled later, following [Cloudflare's header guidance](https://developers.cloudflare.com/workers/static-assets/headers/).

## Manual deployment to Cloudflare Workers

`npm run build:website` writes `website/dist/`. [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) serves that directory directly; no Astro server adapter, application server, or database is needed.

The checked-in `website/wrangler.jsonc` targets the `opentig-website` Worker and binds `opentig.com` as a custom domain. The account ID is configured locally through `CLOUDFLARE_ACCOUNT_ID`, outside the public configuration. Cloudflare manages the domain's DNS record and TLS certificate. The `workers.dev` endpoint and version preview URLs are disabled. Unknown paths return the branded error page with HTTP 404.

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

The existing **CI** workflow (`.github/workflows/ci.yml`) has a separate `website` job that installs the root workspace dependencies with lifecycle scripts disabled, runs website checks, and builds both production and a noindex preview on relevant pull requests and pushes to `main`. Both builds run the SEO validator; the preview goes to `.ai/website-preview`. A manual CI run validates both projects. There is no extra website workflow, artifact upload, or deployment job. CI has read-only repository permissions and no Cloudflare credentials.

Changes confined to `website/` or this guide skip the application's heavy CI jobs and do not trigger **Next release draft**. CI still reports a scope decision for each project. Application release notes exclude these website-only commits, including merged PRs; **Prepare release** will not create an application version or tag when those are the only changes since the last stable release.

Changes to the shared renderer, shared contracts, public UI assets, or root TypeScript configuration validate both projects because the demo uses them. Changes to shared files such as the root `package.json`, `package-lock.json`, and `.oxlintrc.json` validate both projects and remain eligible for application release notes. Mixed commits containing application changes also remain included regardless of their commit title. The website's private package version is independent of the desktop and CLI release version. The existing `vX.Y.Z` tags and installer/npm publication workflows belong to the application.
