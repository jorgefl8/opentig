# Website contribution guide

The `website/` pnpm workspace package contains OpenTig's public landing page and documentation. It uses Astro, Tailwind CSS, OGL, and Fumadocs, and produces a static site independent of the desktop application, CLI, and paired browser UI. A small Worker in front of the static files only handles [Markdown content negotiation for agents](#agent-access). The site does not start or connect to an OpenTig server.

This guide is for repository contributors and is not published in the website documentation. Production operations are maintained separately in a local, untracked runbook.

Choose the task you need:

- [Run and check the website locally](#develop-and-check).
- [Edit documentation or add a public guide](#published-documentation).
- [Change the landing page, demo, or social preview](#content-and-appearance).
- [Control indexing, agent access, and preview builds](#crawling-indexing-and-missing-pages).
- [Understand CI and application releases](#ci-and-release-separation).

## Develop and check

Use Node.js 24.15+ and pnpm 12+ from the repository root:

```bash
pnpm install
pnpm run dev:website
```

Astro prints its local address, normally `http://127.0.0.1:4321`. Stop a foreground server with Ctrl+C. For a remote machine, use your development environment's port forwarding to reach that listener.

Astro may start in the background when launched by a coding agent:

- Check that instance with `pnpm run dev:website status`.
- Stop it with `pnpm run dev:website stop`.
- Choose a different port with `pnpm run dev:website --port 4322`.

Before submitting changes, run the checks and build, then preview the generated site:

```bash
pnpm run check:website
pnpm run build:website
pnpm run preview:website
```

`check:website` builds the demo and runs Astro and demo type checks, Oxlint, and regression tests. Every build also validates the generated pages. `preview:website` serves the build locally; it does not publish it.

**Landing-page edits refresh normally in Astro.** Restart `pnpm run dev:website` after editing the demo or shared renderer to rebuild the demo assets.

<details>
<summary>What the checks validate</summary>

Every Astro build runs `website/scripts/validate-build.mjs` through the `astro:build:done` hook, including builds to a custom output directory. It parses the generated HTML and XML with parse5 and saxes and fails on missing or duplicate metadata, inconsistent canonical/social URLs, wrong indexing policy, broken local links or fragments, missing HTML/CSS asset references, and incorrect social PNG dimensions. It also checks the homepage JSON-LD structure and its agreement with the metadata, and compares the sitemap against the generated indexable pages. For agent access, it requires the robots.txt Content Signals, a Markdown alternate on every content page, a `Link` header in `_headers` announcing that file, and an `llms.txt` that lists every documentation page's Markdown and links only to generated files. The expected indexing policy comes from Vite's environment loader using the build's actual mode and environment directory. `WEBSITE_NOINDEX` accepts only `true`, `false`, or an unset value.

Validation is offline: external links are checked for URL format and local/private hosts, not network availability. The JSON-LD checks protect this site's agreed data contract; they do not replace Schema.org validation or establish search-result eligibility. When adding pages or deliberately changing the metadata contract, update the sitemap and relevant checks together. Regression tests mutate temporary output to ensure real failures are rejected and remove their files afterwards. No test artifacts are published.

Regression tests cover the sample repository, documentation transforms, Markdown generation, content negotiation in the Worker, and build validator.

</details>

<details>
<summary>Dependency and TypeScript compatibility</summary>

The website keeps its own TypeScript version because the Astro checker currently supports TypeScript 6; the application uses its existing version. A process-local module hook in `website/scripts/check.mjs` keeps Astro/Volar on that compatible compiler even when the hoisted install places them alongside the application compiler. Dependencies are pinned in `website/package.json` and resolved in the repository's single `pnpm-lock.yaml`.

The website explicitly pins Astro's `cookie` dependency so its prerendered build resolves the correct API independently of the application's older transitive copy.

</details>

## Published documentation

**Edit the original Markdown in the repository.** The public site reads guides from `docs/` and selected root-level policy files. There are no duplicated guides or runtime GitHub fetches. Committing or pushing does not update the site; changes become public after rebuilding and manually deploying it.

### Update an existing guide

1. Find its source in `website/docs.config.mjs` and edit that file. The overview lives in `website/src/content/docs/index.md`.
2. Keep feature changes and their documentation in the same commit. Describe current behavior, requirements, defaults, and important limits.
3. Run `pnpm run check:website` and `pnpm run build:website`, plus any checks needed for accompanying application changes. Documentation-only changes do not require an application build.
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

The Windows download control in the installation card includes a small SmartScreen notice; the hero omits it to keep a single line below its actions. `SmartScreenNotice.astro` links to the installation guide's **Windows SmartScreen warning** section. Keep the notice and guide consistent with the installer's signing status; neither claims an antivirus scan has run or certifies the download as safe.

The CLI installation card includes a **View on npm** link to the official `@opentig/cli` package below its setup button. Keep the npm destination in `website/src/site.ts` alongside the repository and download links. The hero uses the red npm mark in `website/src/assets/icons/npm.svg`, with a straight vertical divider between its link and the copy control.

The hero and navigation adapt their primary install action to the visitor's operating system. `PlatformDetect.astro` runs an inline script before the navigation renders and sets `data-platform` on the document to `windows`, `macos`, or `linux`; phones and tablets, unknown systems, and visitors without JavaScript get the Windows action. On Windows, the hero shows **Download for Windows** and **View on GitHub**, and the navigation shows **Download**. On macOS and Linux, the hero shows `npx --yes @opentig/cli@latest service install` with a filled **Copy** button and an npm icon opening the package in a new tab, followed by a note that it runs in the background and adds the `opentig` command, and a smaller **View on GitHub** button; the navigation shows **Install**, which scrolls to the installation section. Elements marked `data-platform-only="windows"` or `"cli"` are hidden by the matching document attribute, so switching never reflows the page after load. A Windows/macOS/Linux selector below the actions lets visitors switch manually and announces the change to screen readers; it is hidden without JavaScript, when a short note links macOS and Linux visitors to the installation section instead.

One centered monospaced line follows the actions: the version, **Free & open source**, and either the VirusTotal status (Windows) or **Requires Node.js 24+ and Git** (macOS and Linux). The hero does not fill the viewport, and the interactive demo follows it directly, so the product is visible on a typical laptop screen without scrolling. The installation card copies the same command, defined once in `website/src/site.ts`; its setup button leads to the guide, which also covers trying OpenTig once with `npx --yes @opentig/cli@latest`. Both copy controls work independently and report successful copies with their own `hero` or `install` placement.

Edit sections in `website/src/components/landing/`. Shared GitHub, download, and documentation destinations live in `website/src/site.ts`. Every Download button, including the documentation navigation, links directly to the Windows x64 installer. The landing navigation links to Demo, Features, AI, Install, and Docs. The hero and installation card show its version below the button in monospaced text. Browser/CLI setup instructions link to the installation guide.

Production builds write the latest stable release's installer link and version into the HTML, structured data, `/llms.txt`, and the homepage's Markdown twin, so crawlers, AI agents, and visitors without JavaScript see the current release. **Deploy website** records GitHub's latest release with the workflow token in a separate step and passes only that file to the build through `WEBSITE_RELEASE_FILE`; the deployment fails if that release has no matching installer. Other builds ask GitHub anonymously and, if it is unreachable or rate-limited, warn and link to GitHub's latest-release page, labelled **Latest release** (`latestReleasePage` in `website/src/lib/downloads.ts`), so local builds and tests need no GitHub access and nothing in the repository names a release version. Development servers always render that link. Publishing a release therefore needs no website change; deploy the website afterwards so the generated pages name the new version.

The browser then checks GitHub's latest stable release once per page and updates the installer link and version together, so a release published after the last deployment still appears without a rebuild. It only accepts the matching uploaded Windows installer from the official repository. If JavaScript is disabled, the API is unavailable or rate-limited, or the release has no matching installer, the buttons keep the installer rendered at build time. Release-note links still open GitHub.

The resolver also retains an optional installer identity: repository, version, release ID, asset ID, exact filename, byte size, and SHA-256 from GitHub's asset digest. Missing or invalid identity metadata does not prevent downloading, but cannot establish a match with an analysis. The static fallback has no scan identity. Duplicate installer filenames are rejected rather than choosing an ambiguous asset.

`website/src/lib/installer-scan.ts` defines the analysis metadata contract and validates it against that full identity. The resolver reads optional scan metadata from the same GitHub response's release notes and returns it alongside the installer as `scan`. There are no extra requests per visitor. The website does not call VirusTotal or submit installers. The separate [release scan workflow](releases.md#installer-analysis-tooling) produces the metadata, and website deployment remains manual.

For Windows visitors, the hero shows **VirusTotal** on the version and free/open-source line; the Windows installation card places it next to the version. `InstallerScan.astro` opens a floating information card on hover, keyboard focus, or tap. The card stays open while its content is hovered or focused, supports its report link, and closes with Escape or an outside click; `website/src/lib/release-ui.ts` updates links, versions, and scan information from the same resolved release, revalidating the scan identity before presenting it. The card shows the exact filename and SHA-256 when available. Replacing a release clears previous counts, dates, and report links, including when the replacement has no usable scan.

| Display | Meaning |
| --- | --- |
| **Checking scan status…** | The single GitHub release request is still pending. |
| **Scan pending / queued / in progress** | The metadata reports that state; no final engine counts are shown. |
| **Scan status unavailable** | The API failed, identity or metadata is missing/invalid/mismatched, or the scan explicitly reports unavailability. This is never represented as zero detections. Without JavaScript, the initial unavailable status and clickable card and fallback download remain usable. |
| **N malicious · N suspicious** | A completed analysis reports those separate counts. Any nonzero count highlights the summary. Zero counts use neutral styling, without a safety verdict. |
| **No engines assessed the file** | The analysis completed, but every engine outcome was a timeout, failure, or unsupported file type. |

Completed cards include the UTC analysis date, assessed and unassessed engine totals, and all eight outcome counters. The status-update date is shown separately from the analysis date. The **View VirusTotal report** link appears only when validated metadata contains the report URL; it opens in a new tab. Otherwise the disclosure says that the public link is not available yet. Every card explains that an antivirus scan is not a guarantee of safety. The SmartScreen explanation remains separate.

Status is a snapshot loaded once per page, not a live poll. Reload to request newer release metadata; GitHub caching can delay changes. A verified report link reflects the producer's availability check at the recorded time, not a promise that VirusTotal will remain reachable.

The version 1 contract requires `schemaVersion`, `installer`, `state`, and `updatedAt`. States are `pending`, `queued`, `in-progress`, `completed`, and `unavailable`. Only `completed` accepts `analysis`, containing VirusTotal's `analysisAt` date and all eight `statistics` counters: `malicious`, `suspicious`, `harmless`, `undetected`, `timeout`, `confirmed-timeout`, `failure`, and `type-unsupported`. `updatedAt` records the local state observation/write, not a claimed analysis completion time. Counters must be nonnegative safe integers with a positive, safe total. Partial or missing counters never default to zero. Suspicious results and unassessed engines remain distinct; no safety verdict is derived from zero detections.

An optional `submission` checkpoint has a `phase` of `uploading`, `uncertain`, or `submitted`, plus `startedAt`. Only a submitted checkpoint includes `analysisId` and `submittedAt`. Submitted receipts may accompany queued, in-progress, completed, or unavailable states; uploading and uncertain checkpoints never accompany results. The validator rejects extra fields and inconsistent chronology. These public provider identifiers allow resumption without storing credentials or replaying an uncertain upload.

Active and completed analyses may include a `report` with the exact SHA-256 file URL and `verifiedAt`. The producer must verify public report availability before including that field; the validator checks metadata consistency without network access. A completed analysis can lack an available public report. Timestamps use canonical UTC ISO strings with milliseconds, and analysis/verification dates cannot follow `updatedAt`. Unknown schema versions, states, fields, mismatched identities, and incoherent metadata are rejected. Validated data is copied so later mutations of the input cannot alter it.

`website/src/lib/installer-scan-notes.ts` reads and prepares updates to a public JSON comment delimited by `<!-- opentig:installer-scan:start` and `opentig:installer-scan:end -->`. Keep it outside the existing changelog markers. These helpers perform no GitHub writes. Updates preserve surrounding notes, reject duplicate or malformed blocks, and refuse older or conflicting metadata. Missing, invalid, or mismatched scan data leaves the download usable without an associated scan. Notes may be cached by GitHub, so status changes are not guaranteed to appear immediately. Release comments are public metadata, never secret storage.

Website copy avoids em dashes. Describe browser access as a connection to a running OpenTig instance on the repository host, with pairing required; the Windows app can provide that instance itself, or the CLI can run the server. Keep this setup detail separate from the main product promise.

The page has floating navigation with a GitHub link, a hero, the interactive demo, Git workflow, pull request, and AI sections, a host diagram, the FAQ, a closing installation section, and a footer. Only the hero uses the pixel font. Every other section opens with `SectionHeading.astro`: a left-aligned Geist H2 whose short claim is followed, in the same sentence, by a quieter explanation (`--heading-detail`). Keep both parts short. Feature titles use H3 elements beneath their section H2.

Features are shown with crops of the real interface instead of icons or drawn mockups. `Shot.astro` imports each WebP from `website/src/assets/landing/`, so every version gets a hashed URL, and places it at its natural CSS size, rising from the bottom edge of its tile. These are intentional product assets: they come from the interactive demo, with the Launchpad sample repository and normal OpenTig branding, captured at 2x in the dark theme. Narrow crops are 300 CSS pixels wide (the sidebar) and wide crops 660, so `tile-grid-split` sizes its columns to show sidebar crops without scaling. Each crop has alternative text describing what it shows. Tiles in one section share hairline borders (`tile-grid`) so they read as one surface.

<details>
<summary>Update the interface crops</summary>

Capture the demo in a 960 CSS pixel wide viewport at a device scale factor of 2, after the state each crop needs: one file staged with a commit message typed (`changes`) and the `src/filter-tasks.js` diff (`diff`), both 548 CSS pixels tall so every changed file shows above the commit box; `README.md` in Preview, scrolled to its Features heading so the Mermaid flowchart fits (`preview`), the GitHub list (`pulls`), PR #24 with its stack indicator open (`stack`), the **Releases** list (`releases`), and a CI run's job graph in **Actions** (`actions`). The demo has no AI, so the commit plan (`split`) needs a build whose `ai.statuses` and `ai.generateCommitMessage` return a ready CLI and a two-group proposal; build it to a separate ignored output directory and restore `website/demo/api.ts` afterwards. Crop the sidebar at x 0, or the main area at x 300, from y 42; encode WebP at quality 0.9. `Shot.astro` reads each image's size, so crops can change height. Recapture the demo poster from the demo's first view at 1280 × 720 whenever the sample's changes or the interface change. Review each image before deployment. Capture scripts, the temporary AI build, and source PNGs stay untracked.

</details>

- **Git workflows (`#features`):** staging from a diff, branches and worktrees, and **Preview more than code** (HTML, images, SVG, and Markdown with Mermaid diagrams).
- **GitHub (`#pull-requests`):** the PR list with stack layer indicators, a PR with its stack open, releases, and an Actions run graph. A note links to the GitHub guide and names the `gh` requirement.
- **Host diagram (`#anywhere`):** an inline SVG of repositories, Git, and OpenTig on one host, reached by a laptop, tablet, and phone through SSH, a VPN, or an HTTPS tunnel. Dashed links flow, small dots travel each way along them, and the device screens animate, all in CSS; reduced motion stops the animation and hides the dots. A wide layout is replaced by a stacked one below 640 pixels. Short notes on local operations, pairing, and networking link to the browser access guide.

- **Hero:** identify OpenTig as a free, open-source Git client and a focused workspace for Git repositories. Supporting copy covers file browsing, diffs, editing, commits, branches, worktrees, and GitHub pull requests, followed directly by installation actions. AI copy and the tool-logo row belong farther down the page.
- **Landing animations:** the desktop navigation adapts React Bits Gooey Nav with a charcoal selection highlight and matching animation, following the current section while retaining ordinary links. The pixel-font hero adapts Kokonut UI Typing Text, cycling through Git repositories, code reviews, pull requests, and the next commit. The second line forms a centered group with a stationary prefix and a fixed-width slot. Each animated phrase starts at the slot's left edge to keep a consistent gap after the prefix, including while deleting. Both parts share a baseline; on narrower screens, the prefix and phrase slot use separate centered lines to keep the heading height stable. Typing pauses off screen and stays on Git repositories without JavaScript or with reduced motion. The animated phrases are drawn with CSS generated content, so the heading's text for search engines and copying is only *A focused workspace for your Git repositories.* Reduced motion also removes the gooey transition. Source attribution and bundled license notices are listed in `THIRD_PARTY_NOTICES.md`.
- **AI assistance (`#tools`):** one tile pairs the real commit plan with three two-tone statements: commit splitting first, with its review, staging, and commit steps, then commit messages and PR descriptions. The statements share the plan's height, so neither column leaves empty space. Make user review and confirmation explicit, link to the AI assistance guide, and explain that everyday Git work needs no AI account. Keep the tool-logo carousel below these capabilities, listing Git, GitHub, Claude Code, Codex, OpenCode, and Grok Build under “Your Git tools. Your choice of AI.” Use a centered, semibold H3 for that subheading, with space above the logos and a smaller size than the section H2.
- **Installation (`#install`):** the closing section presents separate download/setup actions for Windows desktop and the CLI server, followed by one line linking the browser access and installation guides. Windows desktop requires Windows 10+ x64 and Git; the CLI supports Linux, macOS, and Windows with Node.js 24+ and Git. Both require a running host instance for paired browser access. The navigation links here on macOS and Linux; keep requirements aligned with `docs/getting-started.md` and `docs/web-access.md`.
- **FAQ (`#faq`):** precede the closing installation section and link from the footer. The seven questions cover browser access to a running host, platforms and requirements, existing repositories, the MIT license, optional GitHub and AI integrations, and context shared with AI providers. Link answers to the corresponding guides and keep them aligned with installation, web access, features, GitHub, and AI privacy documentation.

FAQ answers use native `details` controls that work with keyboard, touch, and JavaScript disabled. The browser-access answer starts expanded, multiple answers can stay open, and all answers appear in the generated HTML.

### Interactive demo

The `#workflow` section follows the hero and, on screens 768 CSS pixels and wider, loads the demo automatically as it approaches the viewport. No activation click or account is required. Narrower screens show the poster with an **Open the interactive demo** button that opens `/demo/` full screen instead of embedding it: the app disables overscroll chaining for its phone layout, so an embedded frame would capture swipes and stop the page from scrolling. A small monospaced label and the **Open in a new tab** link sit above the frame; the link opens `/demo/` separately. A rounded border and soft shadow surround the fixed-height app viewport, with a real OpenTig screenshot shown while loading. A quiet loading strip disappears when the app signals readiness. Four short steps below the frame suggest what to try.

**The demo uses sample data only.** It compiles the actual React renderer with a browser-only API adapter in `website/demo/`. Nothing accesses visitors' repositories or connects to an OpenTig server. The site has no hosted accounts or real repository operations.

Git operations are simulated in memory, independently in each page. There is no reset control or commit-count limit: after committing, visitors can keep editing and committing, with history and remaining edits still available. Reloading starts a fresh sample.

<details>
<summary>What visitors can try</summary>

The Launchpad sample supports file browsing, editing and saving, file and folder operations, diff review, staging and unstaging, discarding edits, sample commits, undoing a commit, publishing and pushing, history, text search and replace, HTML preview, sample AI assistance, sample pull request review and actions, sample Actions runs and releases, and appearance settings.

- **Staging and commits:** staging saves the chosen version. Later edits remain outside a commit until staged again. The branch starts unpublished: **Publish** makes it track `origin/feature/task-filters` on a simulated remote without network access, after which each sample commit adds to the **Push** count. Like the installed app, **Undo commit** applies only to commits not pushed yet and keeps their changes staged.
- **Files:** new files and folders, rename, delete, copy, cut, paste, drag-and-drop moves, and text search replacements change the sample in memory. File operations can be undone and redone; deleted files show as deletions that can be staged, committed, or discarded.
- **AI assistance:** Codex appears with a **Sample responses** model. No AI provider is contacted: commit messages, commit plans that separate code from documentation, and pull request drafts are fixed responses chosen from the staged paths, and preparing a plan's group stages exactly its files.
- **HTML:** `Files → index.html` opens a self-contained release manifest, set in serif and monospaced type on a paper background, with Preview and Code tabs. The working change adds a **Hide completed** filter that hides the shipped tasks. Edits can be previewed, saved, staged, and committed.
- **Working changes:** the sample starts with six changes on `feature/task-filters`: the JavaScript filter, its test, a TypeScript option type, a filter bar in `index.html`, a ticked README checklist item, and an untracked `CHANGELOG.md`. The changelog can be staged as a new file, unstaged back to untracked, committed, or discarded, which deletes it.
- **Sample files:** each file shows a different viewer. `README.md` renders the repository logo, a GitHub alert, a Mermaid flowchart, code blocks, a table, a task list, and inline math. `src/types.ts` and `src/progress.ts` show TypeScript beside the JavaScript filter; `data/tasks.json`, `tsconfig.json`, and the workflows under `.github/workflows/` cover JSON and YAML. `ci.yml`'s `test`, `lint`, and `preview` jobs match the sample PR checks and run graphs; `preview` needs `test` and runs only on pushes to `main`, so pull requests show it as skipped. `prepare-release.yml` and `nightly.yml` hold the triggers and inputs that **Run a workflow** offers. `assets/logo.svg` opens in the SVG viewer and is also the repository icon, which the installed app discovers from the same path. Folders nest to any depth.
- **Pull requests:** examples include open, draft, merged, and closed PRs, Markdown summaries, commit timelines, full diffs, and per-commit diffs. PRs #23, #24, and #25 form a native stack, so their layer indicators open the stack. Fixtures stay independent of working-tree edits. Sample PRs have no GitHub links; PR creation is disabled.
- **Actions and releases:** the GitHub view lists sample workflow runs and opens each one as a read-only graph of its jobs and steps; sample releases show their notes and assets. **Run a workflow** lists the sample workflows and their inputs, but running one needs an installed instance.
- **Settings:** appearance, changes layout, and line wrapping are available. The heading and close control stay visible while the list scrolls. Repository sync and ignored-file controls are omitted.

Merging, closing, reopening, draft changes, auto-merge, branch updates, title and description edits, comments, and reviews change the sample pull requests in memory, for the current page only; comments and reviews are posted as `opentig-demo`, which can edit and delete its own. Reverts, workflow approvals, running workflows, creating, editing, or publishing releases, new pull requests, GitHub accounts, branch and worktree management, projects, cloning, and revealing files require an installed instance; the demo explains that for each area instead of attempting them.

</details>

<details>
<summary>Demo assets, accessibility, and build</summary>

The separate demo link adapts to narrow screens, and the link has visible keyboard focus. Without JavaScript, the poster and workflow instructions remain available without a loading indicator. The poster at `website/public/images/workflow-review.webp` is an intentional product asset with normal OpenTig branding and sample data; source captures and tooling stay untracked.

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

Color tokens in `website/src/index.css` mirror the desktop dark theme in `src/renderer/styles/index.css`. The shared landing `Button.astro` follows the desktop button’s blue shadow, hover, focus, and pressed states; navigation and section calls to action use the same component. Secondary buttons, including **View on GitHub** and **Set up OpenTig CLI**, use the same charcoal background as the selected navigation item, with a lighter hover and darker pressed state.

<details>
<summary>Contrast, keyboard access, and motion</summary>

The website uses separate colors for filled blue actions, large headings, and small blue text. Headings keep a saturated blue, while small text uses a lighter tone for contrast. Button gradients retain their relief while their text stays readable in normal, hover, and pressed states. Secondary text and carousel labels remain readable over the brightest background glyphs. Links share a visible keyboard focus outline, and scroll margins keep focused controls clear of the fixed navigation. Keyboard-only links let visitors skip navigation or bypass the interactive demo. They stay visually clipped until focused, rather than being positioned above the viewport where mobile browser chrome can reveal them during scrolling. These styles belong to the landing page; the shared application theme is unchanged.

The landing page opts into `viewport-fit=cover` so its fixed background can fill the available screen, including device safe areas. Content, the fixed navigation, focused skip links, and anchor scroll offsets respect the device's safe-area insets in portrait and landscape. Documentation and demo pages retain their default viewport behavior. The browser still controls the appearance of its own toolbars and status area.

The fixed background is fully visible behind the hero, fades to 10% opacity as the visitor scrolls past it so dense sections stay quiet, and returns to 75% as the closing installation section comes into view. It renders at up to 30 frames per second and caps its internal resolution at a pixel ratio of 1.5 and two million pixels. It pauses in hidden tabs and resumes when the page returns. Reduced-motion preferences stop the terminal animation and logo carousel; resizing redraws the same terminal frame. If the browser loses and restores the WebGL context, the background recreates its resources. The page remains usable without WebGL.

</details>

Fonts and branding are served locally from `website/public/`. All three landing fonts use WOFF2 and `font-display: swap`. Only Geist and Geist Pixel Triangle are preloaded, for the body and large headings; Inconsolata loads when the page uses monospaced text. Inconsolata retains its full character coverage and variable weight range, with its unused width axis fixed at the normal width (100). The demo keeps the application's own fonts. The author avatar in the footer loads from GitHub. License notices for the port and bundled assets are in [third-party notices](../THIRD_PARTY_NOTICES.md).

<details>
<summary>Regenerate the Inconsolata font asset</summary>

To regenerate `Inconsolata-normal.woff2`, extract `website/public/fonts/Inconsolata.ttf` from commit `3c779ff` into a temporary directory. With FontTools 4.67.0 and its WOFF dependencies installed there, run `fonttools varLib.instancer Inconsolata.ttf wdth=100 --no-recalc-timestamp -o Inconsolata-normal.ttf`, then `fonttools ttLib.woff2 compress Inconsolata-normal.ttf -o Inconsolata-normal.woff2`. Copy only the resulting WOFF2 into `website/public/fonts/` and retain the OFL notice. This is an asset preparation step, not a dependency of the website build.

</details>

### Metadata and social previews

Page titles, descriptions, canonical URLs, and Open Graph and Twitter card metadata live in `website/src/layouts/Layout.astro`. The homepage uses the same title and description for search and social previews. The shared social image is `website/public/opentig-social.jpg`, a 1200 × 630 card exported at twice that resolution (2400 × 1260) so it stays sharp on high-density screens and when zoomed. It is a JPEG to stay under about 300 KB, above which WhatsApp may omit the preview. The metadata declares its type, actual dimensions, and alternative text, and the build validator checks them against the file.

<details>
<summary>Update the social image</summary>

The editable card source is `website/design/social-card.html`, outside the published site. Under the headline "Your Git workspace, on desktop and phone.", it combines two real product screenshots with the local logo and Geist font: `docs/images/workspace.png` and, in a phone frame, `docs/images/workspace-phone.png`. Both use normal OpenTig branding and the Launchpad sample repository in the interactive demo. The desktop capture shows the GitHub pull-request list, an open PR, and its side-by-side diff; the phone capture shows the same PR's summary with its **Merge** button. The phone frame has thin bezels. To update it, capture the desktop demo at 1440 × 660 CSS pixels and the phone demo at 390 × 816 CSS pixels (the frame's screen ratio, so nothing is cropped), both at a device scale factor of 2. Then serve the repository root on loopback, open `/website/design/social-card.html` in a browser at exactly 1200 × 630 CSS pixels with a device scale factor of 2, wait for the font and images to load, and export the viewport as a JPEG at quality 85 to `website/public/opentig-social.jpg`. Check that it is 2400 × 1260 pixels and under about 300 KB. Keep the screenshot faithful to the application and inspect the exported image before deployment. Source captures and temporary tooling stay untracked. The earlier `/og-image.png` and `/opentig-social.png` remain available for previously cached previews; the latter holds the same card at 1200 × 630.

</details>

<details>
<summary>Homepage structured data</summary>

The indexable homepage emits one JSON-LD graph in its HTML head, defined in `website/src/pages/index.astro`. It connects `WebSite` (OpenTig's name, canonical home URL, and English language) to `SoftwareApplication` (Git client category, supported host platforms, requirements, MIT license link, free availability, installation guide, and the official repository and npm package via `sameAs`). Requirements distinguish the Windows desktop installer from the Windows/Linux/macOS CLI server and explain browser pairing to a running instance. The description is shared with page metadata through `siteDescription` in `website/src/site.ts`. URLs derive from Astro's configured public origin and the existing repository constants; JSON is serialized with HTML-sensitive `<` characters escaped.

The graph is omitted from development, noindex preview builds, and the 404 page. It contains no inferred release version, ratings, reviews, company identity, or hosted-app claims. Free availability is expressed with `isAccessibleForFree` and an offer price of zero in USD (`priceCurrency` is required alongside `price`). Valid [Schema.org application data](https://schema.org/SoftwareApplication) does not by itself establish eligibility for Google's software-app rich result, whose [requirements include a genuine rating or review](https://developers.google.com/search/docs/appearance/structured-data/software-app). Keep the data factual instead of adding unsupported fields to satisfy that eligibility check.

</details>

## Crawling, indexing, and missing pages

### Production pages and missing routes

Astro generates `/robots.txt` and `/sitemap.xml` at build time. Production robots.txt allows crawling, declares [Content Signals](#agent-access), and points to the absolute sitemap URL. The sitemap includes the homepage and published documentation routes from `website/docs.config.mjs`. Add other published content routes to `publicPaths` in `website/src/pages/sitemap.xml.ts`. Do not add errors, assets, redirects, or fragment links. Dates and priorities are omitted rather than inferred from build time.

After each deployment, **Deploy website** submits every sitemap URL to [IndexNow](https://www.indexnow.org/), which Bing and other participating search engines use to pick up changed pages without waiting for a crawl. The key is public by design: `website/public/<key>.txt` proves ownership, and the key constant lives in `website/scripts/indexnow.mjs`; change both together. A refused or unreachable submission is reported but does not fail the deployment.

`website/src/pages/404.astro` provides the branded error page. Workers uses `not_found_handling: "404-page"` to return it with HTTP 404 for missing routes, including nested paths. The page always has `noindex` and omits canonical and `og:url` metadata so an error is not presented as a content page. Direct `/404` variants also receive `X-Robots-Tag: noindex` through `website/public/_headers`.

### Agent access

AI agents can read the site as Markdown instead of rendered HTML:

- **Markdown twins.** The homepage and every documentation page have a Markdown version at the same route plus `index.md`, for example `/docs/github/index.md`. Guides are generated at build time from the same source and link rewriting as the rendered page (`website/scripts/agent-markdown.mjs`), with the page title and description at the top. The homepage version is the same overview as `llms.txt`. The demo and 404 pages have no Markdown version.
- **`/llms.txt`.** An [llms.txt](https://llmstxt.org/) overview generated from `siteDescription`, the landing page's installation facts, and the documentation sections in `website/docs.config.mjs`, linking to each Markdown twin.
- **Discovery.** Each page's HTML head has a `<link rel="alternate" type="text/markdown">`. `website/public/_headers` sends the same relation and `rel="describedby"` for `llms.txt` as [`Link` response headers](https://www.rfc-editor.org/rfc/rfc8288) on `/`, `/docs/`, and `/docs/:page/`.
- **Content negotiation.** `website/worker/index.mjs` runs before the static files only for the routes in `run_worker_first` in `website/wrangler.jsonc` (`/` and `/docs/*`). A `GET` or `HEAD` request to a page whose `Accept` header lists `text/markdown` at least as highly as `text/html` receives the Markdown twin with `Content-Type: text/markdown`. Browsers, wildcard `*/*` requests, and pages without a twin get the normal response. Page responses on these routes carry `Vary: Accept`. Every other path is served by Workers Static Assets without running the Worker.
- **Content Signals.** robots.txt declares `Content-Signal: search=yes, ai-input=yes, ai-train=yes` ([contentsignals.org](https://contentsignals.org/)): the site may be indexed for search, used as input for AI answers, and used for model training. These are stated preferences, not access controls. To change them, edit `contentSignals` in `website/scripts/agent-access.mjs`; the build validator and robots.txt use the same value.

New public routes that need a Markdown version must use a trailing slash, pass `markdown` to the shared layout, generate the twin, and be covered by `_headers` and `run_worker_first`. The build validator rejects a content page without them. Use `pnpm run preview:website` for the HTML site; `pnpm --filter @opentig/website exec wrangler dev` serves the production build through the Worker to check negotiation and headers locally.

### Build a preview that stays out of search

Development pages are marked `noindex`. For a separately hosted preview, set `WEBSITE_NOINDEX=true` **when building**, even if its canonical origin remains `https://opentig.com`. This adds `noindex` to every page using the shared layout, emits an empty sitemap, and removes the sitemap announcement from robots.txt. Crawling stays allowed so search engines can read the `noindex` instruction, as described in [Google's indexing guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing). This setting controls indexing, not access to the site.

For example, build a preview into an ignored directory without replacing the production output (Bash):

```bash
WEBSITE_NOINDEX=true pnpm --filter @opentig/website run build --outDir ../.ai/website-preview
```

**Keep preview output separate from `website/dist`.** A noindex build targeting that directory fails validation, stopping the normal deployment command before Wrangler runs. If a build fails, rebuild successfully before manually uploading its files.

Leave `WEBSITE_NOINDEX` unset for the normal build and rebuild with `pnpm run build:website`. `WEBSITE_URL` only controls URL generation; it does not switch indexing policy.

## CI and release separation

**CI validates the website but does not deploy it.** The existing **CI** workflow (`.github/workflows/ci.yml`) has a separate `website` job for relevant pull requests and pushes to `main`. It:

1. Installs the root workspace dependencies with lifecycle scripts disabled.
2. Runs website checks.
3. Builds production output and a noindex preview in `.ai/website-preview`, running the SEO validator on both.

A manual CI run validates both projects. CI has read-only repository permissions and no Cloudflare credentials. A separate **Deploy website** workflow is exclusively manual; it is not triggered by CI, pushes, application releases, or scan results.

To publish an approved website revision after production configuration is in place, open **Actions → Deploy website → Run workflow** and select `main`. Only upstream `main` is accepted. The workflow checks out that run's commit, installs the locked dependencies, runs `check:website` and `build:website` sequentially, then deploys the validated static output using the workspace's pinned Wrangler. Production configuration belongs to the `website-production` GitHub environment and is maintained in the private operations runbook. Credentials are not passed to dependency installation, checks, or builds; a separate step reads the latest release with the workflow's read-only token and hands the build only the resulting file; the public analytics ID is supplied at build time and required for this production workflow. Concurrent manual deployments are queued instead of cancelling an upload in progress. The local `pnpm run deploy:website` is only a fallback for when the workflow is unavailable; see `website/README.md` for what it skips.

Changes confined to `website/`, this guide, or `.github/workflows/website.yml` skip the application's heavy CI jobs and do not create application release notes or a new draft. Editing this unpublished guide alone does not trigger the website build; edits to the deployment workflow do. Run the local website checks when changing this guide's examples or instructions. CI still reports a scope decision for each project. Application release notes exclude these website-only commits, including merged PRs; **Prepare release** will not create an application version or tag when those are the only changes since the last stable release.

Changes to the shared renderer, shared contracts, public UI assets, or root TypeScript configuration validate both projects because the demo uses them. Changes to shared files such as the root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `.oxlintrc.json` validate both projects and remain eligible for application release notes. Mixed commits containing application changes also remain included regardless of their commit title.

The website's private package version is independent of the desktop and CLI release version. The existing `vX.Y.Z` tags and installer/npm publication workflows belong to the application.

Published documentation changes also trigger website validation, without requiring application builds for documentation-only edits. Release filtering is narrower: the website-only exclusion covers `website/`, this guide, and the website deployment workflow, not every published Markdown file.
