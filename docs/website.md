# Website contribution guide

The `website/` npm workspace contains OpenTig's public landing page and documentation. It uses Astro, Tailwind CSS, OGL, and Fumadocs, and produces a static site independent of the desktop application, CLI, and paired browser UI. It does not start or connect to an OpenTig server.

This guide is for repository contributors and is not published in the website documentation. Production operations are maintained separately in a local, untracked runbook.

Choose the task you need:

- [Run and check the website locally](#develop-and-check).
- [Edit documentation or add a public guide](#published-documentation).
- [Change the landing page, demo, or social preview](#content-and-appearance).
- [Control indexing and preview builds](#crawling-indexing-and-missing-pages).
- [Understand CI and application releases](#ci-and-release-separation).

## Develop and check

Use Node.js 24.15+ and npm 11+ from the repository root:

```bash
npm ci
npm run dev:website
```

Astro prints its local address, normally `http://127.0.0.1:4321`. Stop a foreground server with Ctrl+C. For a remote machine, use your development environment's port forwarding to reach that listener.

Astro may start in the background when launched by a coding agent:

- Check that instance with `npm run dev:website -- status`.
- Stop it with `npm run dev:website -- stop`.
- Choose a different port with `npm run dev:website -- --port 4322`.

Before submitting changes, run the checks and build, then preview the generated site:

```bash
npm run check:website
npm run build:website
npm run preview:website
```

`check:website` builds the demo and runs Astro and demo type checks, Oxlint, and regression tests. Every build also validates the generated pages. `preview:website` serves the build locally; it does not publish it.

**Landing-page edits refresh normally in Astro.** Restart `npm run dev:website` after editing the demo or shared renderer to rebuild the demo assets.

<details>
<summary>What the checks validate</summary>

Every Astro build runs `website/scripts/validate-build.mjs` through the `astro:build:done` hook, including builds to a custom output directory. It parses the generated HTML and XML with parse5 and saxes and fails on missing or duplicate metadata, inconsistent canonical/social URLs, wrong indexing policy, broken local links or fragments, missing HTML/CSS asset references, and incorrect social PNG dimensions. It also checks the homepage JSON-LD structure and its agreement with the metadata, and compares the sitemap against the generated indexable pages. The expected indexing policy comes from Vite's environment loader using the build's actual mode and environment directory. `WEBSITE_NOINDEX` accepts only `true`, `false`, or an unset value.

Validation is offline: external links are checked for URL format and local/private hosts, not network availability. The JSON-LD checks protect this site's agreed data contract; they do not replace Schema.org validation or establish search-result eligibility. When adding pages or deliberately changing the metadata contract, update the sitemap and relevant checks together. Regression tests mutate temporary output to ensure real failures are rejected and remove their files afterwards. No test artifacts are published.

Regression tests cover the sample repository, documentation transforms, and build validator.

</details>

<details>
<summary>Dependency and TypeScript compatibility</summary>

The website keeps its own TypeScript version because the Astro checker currently supports TypeScript 6; the application uses its existing version. A process-local module hook in `website/scripts/check.mjs` keeps Astro/Volar on that compatible compiler even when npm hoists them alongside the application compiler. Dependencies are pinned in `website/package.json` and resolved in the repository's single `package-lock.json`.

The website explicitly pins Astro's `cookie` dependency so its prerendered build resolves the correct API independently of the application's older transitive copy.

</details>

## Published documentation

**Edit the original Markdown in the repository.** The public site reads guides from `docs/` and selected root-level policy files. There are no duplicated guides or runtime GitHub fetches. Committing or pushing does not update the site; changes become public after rebuilding and manually deploying it.

### Update an existing guide

1. Find its source in `website/docs.config.mjs` and edit that file. The overview lives in `website/src/content/docs/index.md`.
2. Keep feature changes and their documentation in the same commit. Describe current behavior, requirements, defaults, and important limits.
3. Run `npm run check:website` and `npm run build:website`, plus any checks needed for accompanying application changes. Documentation-only changes do not require an application build.
4. Review the rendered page, navigation, and links locally. Submit the source changes for review; maintainers handle publication separately.

### Publish a new guide

Adding a Markdown file alone does not publish it:

1. Add its repository-relative source, title, and description to `publishedGuides` in `website/docs.config.mjs`. The entry key becomes its public slug.
2. Place that slug in `documentationSections` and link the guide from `docs/README.md`.
3. Follow the same check, review, and deployment steps as for an existing guide.

Keep contributor-only references such as this guide out of `publishedGuides` and `documentationSections`. Keep production runbooks in a local location excluded from Git, not in tracked guides.

The content collection, internal link mapping, search, sitemap, and CI scope derive from this configuration. Changes to any published source trigger website validation. Keep local development artifacts and private infrastructure out of published sources.

### Links and search

The landing page and documentation link to these public guides. Source code, release downloads, issues, and each page's **Edit on GitHub** action continue to open GitHub. Links to unlisted source files remain repository links. Adding a Markdown file to the repository alone does not publish it.

Search runs locally in the visitor's browser using `/api/docs-search.json`, generated at build time with Fumadocs static search. This path is a static asset, not a live server endpoint. Only published pages enter the index. The deployment remains Workers Static Assets and does not require a search service, database, or application server.

Website build checks validate search coverage and destinations, fragments, metadata, indexing policy, and sitemap coverage. They also reject reading links that send visitors to GitHub for an already published guide; the explicit edit action is exempt.

<details>
<summary>How Astro and Fumadocs render the guides</summary>

The website serves the documentation at `/docs/`, grouped into getting started, using OpenTig, configuration, development, and policies. Fumadocs supplies the layout, navigation, section index, mobile menu, and search through Astro's React integration. Pages are prerendered with their content in HTML; interactive navigation and search hydrate in the browser. The landing page keeps its Astro components and does not load the documentation React island.

`website/docs.config.mjs` supplies source paths, titles, descriptions, navigation groups, and public routes. `website/src/content.config.ts` reads the selected Markdown directly. Its content cache includes the publication routes, so adding or removing a guide also refreshes links in unchanged Markdown files.

`website/src/lib/docs-source.ts` connects these collections to Fumadocs. The shared `/docs/[...slug]` route generates each page using the existing SEO metadata layout. The Fumadocs URL plugin preserves trailing slashes in navigation and search so links match Astro routes in development as well as production.

`website/scripts/guide-markdown.mjs` removes the source H1 and repository back link from the rendered body, resolves links against each original file, and makes wide tables keyboard-scrollable. Fumadocs supplies the page title. Links to published guides, including explicit GitHub URLs, become local links with their queries and section fragments preserved. The same transform runs when extracting search content so section destinations match rendered headings.

</details>

## Content and appearance

### Edit sections and product copy

The Windows download controls in the hero and installation card include a small SmartScreen notice. `SmartScreenNotice.astro` links to the installation guide's **Windows SmartScreen warning** section. Keep the notice and guide consistent with the installer's signing status; neither claims an antivirus scan has run or certifies the download as safe.

The CLI installation card includes a **View on npm** link to the official `@opentig/cli` package below its setup button. Keep the npm destination in `website/src/site.ts` alongside the repository and download links. The hero uses the red npm mark in `website/src/assets/icons/npm.svg`, with a straight vertical divider between its link and the copy control.

Below the hero's download and GitHub buttons, a centered monospaced line shows the Windows version and **Free & open source**. An **or** separator leads to `npm install -g @opentig/cli`, with a copy control and an npm icon opening the package in a new tab. The installation card retains the one-off `npx --yes @opentig/cli@latest` command. Both copy controls work independently and report successful copies with their own `hero` or `install` placement.

Edit sections in `website/src/components/landing/`. Shared GitHub, download, and documentation destinations live in `website/src/site.ts`. Every Download button, including the documentation navigation, links directly to the Windows x64 installer. The hero and installation card show its version below the button in monospaced text. Browser/CLI setup instructions link to the installation guide.

The browser checks GitHub's latest stable release once per page and updates the installer link and version together, without a website rebuild. It only accepts the matching uploaded Windows installer from the official repository. If JavaScript is disabled, the API is unavailable or rate-limited, or the release has no matching installer, the buttons retain the last verified installer in `website/src/lib/downloads.ts`. Keep that fallback current when maintaining the website; it is independent of the repository's potentially unreleased package version. Builds and tests do not require GitHub access. Release-note links still open GitHub.

The resolver also retains an optional installer identity: repository, version, release ID, asset ID, exact filename, byte size, and SHA-256 from GitHub's asset digest. Missing or invalid identity metadata does not prevent downloading, but cannot establish a match with an analysis. The static fallback has no scan identity. Duplicate installer filenames are rejected rather than choosing an ambiguous asset.

`website/src/lib/installer-scan.ts` defines the analysis metadata contract and validates it against that full identity. The resolver reads optional scan metadata from the same GitHub response's release notes and returns it alongside the installer as `scan`. There are no extra requests per visitor. The website does not call VirusTotal, submit installers, or display a scan result yet. The separate [release scan workflow](releases.md#installer-analysis-tooling) produces the metadata; visible presentation is not connected, and deployment remains manual.

The version 1 contract requires `schemaVersion`, `installer`, `state`, and `updatedAt`. States are `pending`, `queued`, `in-progress`, `completed`, and `unavailable`. Only `completed` accepts `analysis`, containing VirusTotal's `analysisAt` date and all eight `statistics` counters: `malicious`, `suspicious`, `harmless`, `undetected`, `timeout`, `confirmed-timeout`, `failure`, and `type-unsupported`. `updatedAt` records the local state observation/write, not a claimed analysis completion time. Counters must be nonnegative safe integers with a positive, safe total. Partial or missing counters never default to zero. Suspicious results and unassessed engines remain distinct; no safety verdict is derived from zero detections.

An optional `submission` checkpoint has a `phase` of `uploading`, `uncertain`, or `submitted`, plus `startedAt`. Only a submitted checkpoint includes `analysisId` and `submittedAt`. Submitted receipts may accompany queued, in-progress, completed, or unavailable states; uploading and uncertain checkpoints never accompany results. The validator rejects extra fields and inconsistent chronology. These public provider identifiers allow resumption without storing credentials or replaying an uncertain upload.

Active and completed analyses may include a `report` with the exact SHA-256 file URL and `verifiedAt`. The producer must verify public report availability before including that field; the validator checks metadata consistency without network access. A completed analysis can lack an available public report. Timestamps use canonical UTC ISO strings with milliseconds, and analysis/verification dates cannot follow `updatedAt`. Unknown schema versions, states, fields, mismatched identities, and incoherent metadata are rejected. Validated data is copied so later mutations of the input cannot alter it.

`website/src/lib/installer-scan-notes.ts` reads and prepares updates to a public JSON comment delimited by `<!-- opentig:installer-scan:start` and `opentig:installer-scan:end -->`. Keep it outside the existing changelog markers. These helpers perform no GitHub writes. Updates preserve surrounding notes, reject duplicate or malformed blocks, and refuse older or conflicting metadata. Missing, invalid, or mismatched scan data leaves the download usable without an associated scan. Notes may be cached by GitHub, so status changes are not guaranteed to appear immediately. Release comments are public metadata, never secret storage.

Website copy avoids em dashes. Describe browser access as a connection to a running OpenTig instance on the repository host, with pairing required; the Windows app can provide that instance itself, or the CLI can run the server. Keep this setup detail separate from the main product promise.

The page has floating navigation, a hero, feature cards, a tool carousel, getting-started steps, a download call to action, and a footer. Section headings describe Git workflows, integrations, and opening an existing repository. Feature and step titles use H3 elements beneath their section H2.

- **Hero:** identify OpenTig as a free, open-source Git client and a focused workspace for Git repositories. Supporting copy covers file browsing, diffs, editing, commits, branches, worktrees, and GitHub pull requests, followed directly by installation actions. AI copy and the tool-logo row belong farther down the page.
- **AI assistance (`#tools`):** give commit splitting the leading card, explaining complete-file groups and the review, staging, and commit steps. Companion cards cover commit messages and PR descriptions. Make user review and confirmation explicit, link to the AI assistance guide, and explain that everyday Git work needs no AI account. Keep the tool-logo carousel below these capabilities, listing Git, GitHub, Claude Code, Codex, OpenCode, and Grok Build under “Your Git tools. Your choice of AI.”
- **Installation (`#install`):** present separate download/setup actions for Windows desktop and the CLI server, followed by browser pairing and remote-access guidance. Windows desktop requires Windows 10+ x64 and Git; the CLI supports Linux, macOS, and Windows with Node.js 24+ and Git. Both require a running host instance for paired browser access. Navigation and getting-started steps link here; keep requirements aligned with `docs/getting-started.md` and `docs/web-access.md`.
- **FAQ (`#faq`):** follow installation and link from the footer. The seven questions cover browser access to a running host, platforms and requirements, existing repositories, the MIT license, optional GitHub and AI integrations, and context shared with AI providers. Link answers to the corresponding guides and keep them aligned with installation, web access, features, GitHub, and AI privacy documentation.

FAQ answers use native `details` controls that work with keyboard, touch, and JavaScript disabled. The browser-access answer starts expanded, multiple answers can stay open, and all answers appear in the generated HTML.

### Interactive demo

The `#workflow` section loads the demo automatically as it approaches the viewport. No activation click or account is required. The fixed-height frame shows a real OpenTig screenshot while loading, with **Live demo** and **Open full screen** above the app. The indicator lights up when the app signals readiness; the full-screen action opens `/demo/` in a new tab.

**The demo uses sample data only.** It compiles the actual React renderer with a browser-only API adapter in `website/demo/`. Nothing accesses visitors' repositories or connects to an OpenTig server. The site has no hosted accounts or real repository operations.

Git operations are simulated in memory, independently in each page. There is no reset control or commit-count limit: after committing, visitors can keep editing and committing, with history and remaining edits still available. Reloading starts a fresh sample.

<details>
<summary>What visitors can try</summary>

The Launchpad sample supports file browsing, editing and saving, diff review, staging and unstaging, discarding edits, sample commits, history, text search, HTML preview, sample pull request review, and appearance settings.

- **Staging and commits:** staging saves the chosen version. Later edits remain outside a commit until staged again.
- **HTML:** `Files → index.html` opens a self-contained release board with Preview and Code tabs. Edits can be previewed, saved, staged, and committed.
- **Pull requests:** examples include open, draft, merged, and closed PRs, Markdown summaries, commit timelines, full diffs, and per-commit diffs. Fixtures stay independent of working-tree edits. Sample PRs have no GitHub links; PR creation is disabled.
- **Settings:** appearance, changes layout, and line wrapping are available. The heading and close control stay visible while the list scrolls. Repository sync and ignored-file controls are omitted.

Live GitHub connections, AI, native file operations, and unsupported actions require an installed instance and return an explanation in the demo.

</details>

<details>
<summary>Demo assets, accessibility, and build</summary>

The toolbar adapts to narrow screens, has visible keyboard focus, and respects reduced motion. Without JavaScript, the poster and workflow instructions remain available. The poster at `website/public/images/workflow-review.webp` is an intentional product asset with normal OpenTig branding and sample data; source captures and tooling stay untracked.

`website/scripts/build-demo.mjs` builds the shared UI before website development, checks, and builds. Build aliases replace the server API, update transport, connection settings, and the HTML preview transport with demo implementations. HTML uses a sandboxed `srcdoc` frame without script permissions in the static demo; the installed app retains its server-backed preview transport. Generated assets in `website/public/demo/` and the generated bundle manifest are ignored. The separate demo TypeScript config checks the adapter against the actual application contract. Regression tests cover staged snapshots, commits, conflicts, independent sample sessions, HTML edits, and sample PR filtering and diffs. The demo route always emits `noindex` and stays out of the sitemap and homepage structured data.

</details>

### Website analytics

The public website can use Umami Cloud for page views and installation intent. Set the optional public `WEBSITE_UMAMI_ID` in an ignored `website/.env` file before building; leave it unset to disable the integration. Development, noindex previews, demo pages, and error pages omit the tracker. The tracker also restricts collection to `opentig.com`, respects Do Not Track, and excludes URL queries and fragments.

| Event | Meaning |
| --- | --- |
| `open_downloads` | Open the latest GitHub release from a download link. |
| `download_installer` | Click a direct Windows installer link. This does not confirm that the download completed. |
| `open_installation_guide` | Enter the getting-started guide from another page. |
| `copy_cli_command` | Successfully copy the landing page's CLI command. |

Each action carries only a `placement` label for its location, such as `hero`, `navbar`, `install`, or `docs-nav`. These are intent signals, not completed downloads or installations. A blocked tracker does not delay links or prevent copying. The copy button appears only when the Clipboard API is available and reports success only after the clipboard write completes.

This integration does not instrument the desktop app, CLI, paired browser UI, or demo interactions. Do not add session replay, user identification, repository data, or search text to these events. Provider account administration and deployment configuration belong in the local operations runbook.

### Colors, motion, and fonts

The landing page uses OpenTig’s desktop dark palette: electric blue accents and neutral surfaces, with Geist, Inconsolata, and Geist Pixel Triangle fonts and a decorative WebGL terminal effect.

Color tokens in `website/src/index.css` mirror the desktop dark theme in `src/renderer/styles/index.css`. The shared landing `Button.astro` follows the desktop button’s blue shadow, hover, focus, and pressed states; navigation and section calls to action use the same component.

<details>
<summary>Contrast, keyboard access, and motion</summary>

The website uses separate colors for filled blue actions, large headings, and small blue text. Headings keep a saturated blue, while small text uses a lighter tone for contrast. Button gradients retain their relief while their text stays readable in normal, hover, and pressed states. Secondary text and carousel labels remain readable over the brightest background glyphs. Links share a visible keyboard focus outline, and scroll margins keep focused controls clear of the fixed navigation. Keyboard-only links let visitors skip navigation or bypass the interactive demo. These styles belong to the landing page; the shared application theme is unchanged.

The fixed background remains visible throughout the page, renders at up to 30 frames per second, and caps its internal resolution at a pixel ratio of 1.5 and two million pixels. It pauses in hidden tabs and resumes when the page returns. Reduced-motion preferences stop the terminal animation and logo carousel; resizing redraws the same terminal frame. If the browser loses and restores the WebGL context, the background recreates its resources. The page remains usable without WebGL.

</details>

Fonts and branding are served locally from `website/public/`. All three landing fonts use WOFF2 and `font-display: swap`. Only Geist and Geist Pixel Triangle are preloaded, for the body and large headings; Inconsolata loads when the page uses monospaced text. Inconsolata retains its full character coverage and variable weight range, with its unused width axis fixed at the normal width (100). The demo keeps the application's own fonts. The author avatar in the footer loads from GitHub. License notices for the port and bundled assets are in [third-party notices](../THIRD_PARTY_NOTICES.md).

<details>
<summary>Regenerate the Inconsolata font asset</summary>

To regenerate `Inconsolata-normal.woff2`, extract `website/public/fonts/Inconsolata.ttf` from commit `3c779ff` into a temporary directory. With FontTools 4.67.0 and its WOFF dependencies installed there, run `fonttools varLib.instancer Inconsolata.ttf wdth=100 --no-recalc-timestamp -o Inconsolata-normal.ttf`, then `fonttools ttLib.woff2 compress Inconsolata-normal.ttf -o Inconsolata-normal.woff2`. Copy only the resulting WOFF2 into `website/public/fonts/` and retain the OFL notice. This is an asset preparation step, not a dependency of the website build.

</details>

### Metadata and social previews

Page titles, descriptions, canonical URLs, and Open Graph and Twitter card metadata live in `website/src/layouts/Layout.astro`. The homepage uses the same title and description for search and social previews. The shared social image is `website/public/opentig-social.png` (1200 × 630), with matching dimensions and alternative text in the metadata.

<details>
<summary>Update the social image</summary>

The editable card source is `website/design/social-card.html`, outside the published site. It combines the real product screenshot in `docs/images/workspace.png` with the local logo and Geist font. The screenshot uses normal OpenTig branding and the Launchpad sample repository in the interactive demo, with the GitHub pull-request list, an open PR, and its side-by-side diff visible. To update it, capture the demo at 1440 × 660 CSS pixels, then serve the repository root on loopback, open `/website/design/social-card.html` in a browser at exactly 1200 × 630 CSS pixels, wait for the font and images to load, and export the viewport as `website/public/opentig-social.png`. If the browser scales screenshots, normalize the exported PNG to 1200 × 630 pixels without cropping. Keep the screenshot faithful to the application and inspect the exported image before deployment. Source captures and temporary tooling stay untracked. The existing `/og-image.png` remains available for previously cached previews.

</details>

<details>
<summary>Homepage structured data</summary>

The indexable homepage emits one JSON-LD graph in its HTML head, defined in `website/src/pages/index.astro`. It connects `WebSite` (OpenTig's name, canonical home URL, and English language) to `SoftwareApplication` (Git client category, supported host platforms, requirements, MIT license link, free availability, installation guide, and official repository via `sameAs`). Requirements distinguish the Windows desktop installer from the Windows/Linux/macOS CLI server and explain browser pairing to a running instance. The description is shared with page metadata through `siteDescription` in `website/src/site.ts`. URLs derive from Astro's configured public origin and the existing repository constants; JSON is serialized with HTML-sensitive `<` characters escaped.

The graph is omitted from development, noindex preview builds, and the 404 page. It contains no inferred release version, ratings, reviews, company identity, or hosted-app claims. Free availability is expressed with `isAccessibleForFree` and an offer price of zero. Valid [Schema.org application data](https://schema.org/SoftwareApplication) does not by itself establish eligibility for Google's software-app rich result, whose [requirements include a genuine rating or review](https://developers.google.com/search/docs/appearance/structured-data/software-app). Keep the data factual instead of adding unsupported fields to satisfy that eligibility check.

</details>

## Crawling, indexing, and missing pages

### Production pages and missing routes

Astro generates `/robots.txt` and `/sitemap.xml` at build time. Production robots.txt allows crawling and points to the absolute sitemap URL. The sitemap includes the homepage and published documentation routes from `website/docs.config.mjs`. Add other published content routes to `publicPaths` in `website/src/pages/sitemap.xml.ts`. Do not add errors, assets, redirects, or fragment links. Dates and priorities are omitted rather than inferred from build time.

`website/src/pages/404.astro` provides the branded error page. Workers uses `not_found_handling: "404-page"` to return it with HTTP 404 for missing routes, including nested paths. The page always has `noindex` and omits canonical and `og:url` metadata so an error is not presented as a content page. Direct `/404` variants also receive `X-Robots-Tag: noindex` through `website/public/_headers`.

### Build a preview that stays out of search

Development pages are marked `noindex`. For a separately hosted preview, set `WEBSITE_NOINDEX=true` **when building**, even if its canonical origin remains `https://opentig.com`. This adds `noindex` to every page using the shared layout, emits an empty sitemap, and removes the sitemap announcement from robots.txt. Crawling stays allowed so search engines can read the `noindex` instruction, as described in [Google's indexing guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing). This setting controls indexing, not access to the site.

For example, build a preview into an ignored directory without replacing the production output (Bash):

```bash
WEBSITE_NOINDEX=true npm run build --workspace @opentig/website -- --outDir ../.ai/website-preview
```

**Keep preview output separate from `website/dist`.** A noindex build targeting that directory fails validation, stopping the normal deployment command before Wrangler runs. If a build fails, rebuild successfully before manually uploading its files.

Leave `WEBSITE_NOINDEX` unset for the normal build and rebuild with `npm run build:website`. `WEBSITE_URL` only controls URL generation; it does not switch indexing policy.

## CI and release separation

**CI validates the website but does not deploy it.** The existing **CI** workflow (`.github/workflows/ci.yml`) has a separate `website` job for relevant pull requests and pushes to `main`. It:

1. Installs the root workspace dependencies with lifecycle scripts disabled.
2. Runs website checks.
3. Builds production output and a noindex preview in `.ai/website-preview`, running the SEO validator on both.

A manual CI run validates both projects. CI has read-only repository permissions and no Cloudflare credentials. A separate **Deploy website** workflow is exclusively manual; it is not triggered by CI, pushes, application releases, or scan results.

To publish an approved website revision after production configuration is in place, open **Actions → Deploy website → Run workflow** and select `main`. Only upstream `main` is accepted. The workflow checks out that run's commit, installs the locked dependencies, runs `check:website` and `build:website` sequentially, then deploys the validated static output using the workspace's pinned Wrangler. Production configuration belongs to the `website-production` GitHub environment and is maintained in the private operations runbook. Credentials are not passed to dependency installation, checks, or builds; the public analytics ID is supplied at build time and required for this production workflow. Concurrent manual deployments are queued instead of cancelling an upload in progress.

Changes confined to `website/`, this guide, or `.github/workflows/website.yml` skip the application's heavy CI jobs and do not create application release notes or a new draft. Editing this unpublished guide alone does not trigger the website build; edits to the deployment workflow do. Run the local website checks when changing this guide's examples or instructions. CI still reports a scope decision for each project. Application release notes exclude these website-only commits, including merged PRs; **Prepare release** will not create an application version or tag when those are the only changes since the last stable release.

Changes to the shared renderer, shared contracts, public UI assets, or root TypeScript configuration validate both projects because the demo uses them. Changes to shared files such as the root `package.json`, `package-lock.json`, and `.oxlintrc.json` validate both projects and remain eligible for application release notes. Mixed commits containing application changes also remain included regardless of their commit title.

The website's private package version is independent of the desktop and CLI release version. The existing `vX.Y.Z` tags and installer/npm publication workflows belong to the application.

Published documentation changes also trigger website validation, without requiring application builds for documentation-only edits. Release filtering is narrower: the website-only exclusion covers `website/`, this guide, and the website deployment workflow, not every published Markdown file.
