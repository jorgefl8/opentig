# Release automation

[← Documentation](README.md)

OpenTig releases move through three stages: **draft notes**, **prepare a tagged build**, then **publish the reviewed release**. A notes-only draft has no prepared binaries.

- [Prepare and publish](#prepare-and-publish): the normal release sequence.
- [Retry or correct a release](#retry-or-correct-a-release): what to do after a failure or code change.
- [Build candidates for testing](#build-candidates-for-testing): Dev ZIPs and unsigned installers.
- [npm publishing](#npm-publishing) and [Windows signing and updates](#windows-signing-and-updates): setup and requirements.
- [Installer analysis tooling](#installer-analysis-tooling): the internal VirusTotal client and its current limits.

## Builds and releases on GitHub

| Stage | Trigger and result |
| --- | --- |
| **Next release draft** | Qualifying pushes to `main` create or refresh one unpublished draft and its notes |
| **Prepare release** | Manual workflow freezes the version, commit, tag, and notes, then builds Windows and CLI artifacts |
| **Publish release** | Manual release-page action makes the Windows update available and triggers CLI publication and installer analysis |
| **Publish CLI to npm** | Publishes the exact prepared tarball; wait for success before installing from npm |
| **Scan published Windows installer** | Analyses the published installer and records its exact asset identity and status; also supports manual recovery |

**Drafting does not build installers or notify installed clients.** It is independent of CI success, runs only on upstream `main`, uses the built-in Actions token, and needs no additional secret.

### Website and application releases

The [public website](website.md#ci-and-release-separation) has a separate validation job within CI. **Deploy website** is a separate, manual workflow on upstream `main` that validates, builds, and uploads it to Cloudflare Workers. Publishing an application release or updating scan metadata does not deploy the website. Website-only means every changed path is in `website/`, `docs/website.md`, or `.github/workflows/website.yml`.

Mixed commits and changes to shared manifests, lockfiles, or tooling remain application changes. **Prepare release** refuses to create a new application tag if only website changes have accumulated; the website is not versioned or published with the desktop and CLI.

### Draft notes and version selection

**Next release draft** handles direct commits and merged PRs. It creates a draft on the first application change after a stable release and refreshes notes on subsequent qualifying pushes. You can also run it manually on `main` to collect changes already there.

The proposed version defaults to a patch increment (`0.1.0` → `0.1.1`). A higher version in `package.json`, or a higher version chosen on the managed draft, takes precedence without creating another draft. This proposal does not change package files or create a Git tag.

Edit the release title or add prose outside the `opentig:release-notes` comment markers. Refreshes preserve those edits and replace only the generated block.

<details>
<summary>Included changes, author credits, and new contributors</summary>

Notes cover first-parent history since the highest published stable version, grouped into features, fixes, and maintenance. They include commit links and verified PR links for GitHub merge/squash messages.

Automatic `chore(release): prepare vX.Y.Z` version commits and website-only commits are excluded from notes and do not start a new draft on their own. Genuine maintenance and shared dependency updates remain included. Merge commits represent their PR once; rebased changes remain individual commits. Prereleases do not reset the stable changelog.

Every entry credits its author with `by @username`: the PR creator for merged PRs, or the GitHub-linked commit author for direct commits. Unlinked commits show the author's recorded name without exposing their email.

**New Contributors** lists each new human GitHub contributor once and links their first included change. Prior commit authors and merged-PR creators are recognized from the previous stable tag's history; bots are excluded from this section.

Before the first release, the draft uses the package version and includes eligible existing history.

</details>

## Prepare and publish

1. Open **Actions → Prepare release → Run workflow**, select `main`, and leave `dry_run` unchecked.
2. Wait for the **entire run** to succeed, including both Windows and CLI builders.
3. Review the draft's notes and all prepared files listed below.
4. Complete Windows validation, then click **Publish release** on the release page.
5. Wait for **Publish CLI to npm** to succeed before installing the CLI from npm.

The prepared draft must contain:

| Artifact | Purpose |
| --- | --- |
| Windows installer | Install or update the Windows desktop app |
| `.blockmap` and `latest.yml` | Windows update metadata |
| `opentig-cli-<version>.tgz` | The prepared CLI package |
| `opentig-headless.json` | Integrity hashes and source tag/commit |

**Publishing a notes-only draft does not prepare its binaries.** Publishing the completed release makes the Windows update available and starts npm publication without rebuilding the CLI.

To preview only, enable `dry_run`. It reports the version without changing files, commits, tags, or releases, and skips the builders.

<details>
<summary>Version alignment, atomic tag creation, and permissions</summary>

Preparation chooses the managed draft's proposed version, including a higher manually selected version. It aligns the desktop/server package versions, creating a version commit only when needed.

The version commit and annotated `vX.Y.Z` tag are pushed together atomically. A concurrent push to `main` or a branch-protection rejection cannot leave a partial tag.

Preparation explicitly calls the Windows and CLI builders. The built-in Actions token is sufficient even though its pushes do not trigger another push workflow. No personal access token or manual tag creation is needed.

The preparation job needs permission to push the version commit to `main`; it does not bypass branch protection.

</details>

## Retry or correct a release

**Creating the tag freezes the release's code and notes.** Commits arriving on `main` during the build stay out of that version. Existing tags are never moved, and published releases are never overwritten.

| Situation | Action |
| --- | --- |
| A build fails after tag creation | Run **Prepare release** again, or rerun failed jobs. It resumes the exact tagged commit even if `main` has advanced |
| Code needs a correction after tagging | Explicitly abandon the unpublished candidate and prepare a new version. Rebuilding the same tag only retries infrastructure/build failures |
| An older draft needs CLI artifacts | Run **CLI release draft** manually on `main` with the existing draft tag |
| npm publication fails | Run **Publish CLI to npm** manually on `main` with the published stable tag |

The next push to `main` after publication starts the next draft. It includes all changes since the published tag, including commits made while the previous release was being prepared.

<details>
<summary>Windows builder checks and draft uploads</summary>

**Windows release draft** is called by **Prepare release**, and can also run for a stable `vX.Y.Z` tag or manually for an existing tag.

The tag must match both package versions and point to a commit contained in `main`. It checks that commit, builds and verifies a Windows x64 installer and update metadata, tests installation/uninstallation on the runner, and uploads the installer, `.blockmap`, and `latest.yml` to a **draft** GitHub release.

Within this builder, only the final draft-upload job has repository write permission; it never executes repository code or replaces an already published release. Publishing remains a deliberate release-page action after Windows validation.

</details>

<details>
<summary>CLI builder checks and immutable assets</summary>

**CLI release draft** builds from the same frozen tag as Windows, inspects the package, installs it globally on a disposable Linux runner, and checks startup, the web client, pairing, session persistence across restart, and graceful shutdown. It also runs the packed CLI through `npx` on a Windows runner and checks the reported version.

It attaches the tarball and metadata only to the matching draft, and only after both checks pass. Existing assets are never replaced; retries accept identical CLI assets.

It can also run manually on `main` with an existing draft tag to complete an older release without changing its tag, notes, or Windows installer. A different existing CLI artifact is rejected instead of silently rebuilding an immutable version.

</details>

## Installer analysis tooling

**Scan published Windows installer** runs after a stable release is published. It can also be started manually on upstream `main` with an existing published stable `tag`. Its dedicated key must be configured before use. It is informational after publication, not a pre-release security gate, and does not publish npm packages or deploy the website.

The workflow validates the release without access to VirusTotal credentials, then uses a frozen commit from trusted `main` for the scan job. It never executes code from the release tag. The tag must belong to that trusted history. `scripts/scan-release.mjs` downloads the final public Windows installer without rebuilding it, streams and checks its byte size and SHA-256, and rechecks the release, tag commit, and asset identity before writing state. Installers, tags, signing metadata, release titles, and release status are not modified.

Only installers already intended for public distribution are submitted. VirusTotal submissions enter its community dataset; its sharing policy applies to file contents and reports. See [how VirusTotal works](https://docs.virustotal.com/docs/how-it-works). Zero detections is not a guarantee of safety and does not remove Windows SmartScreen warnings.

The managed JSON comment in the release notes holds the public scan state and a minimal submission checkpoint. It records upload intent before sending bytes, then the returned analysis ID and timestamps as soon as they are available. This allows a later run to resume without uploading again. Analysis IDs identify provider records; they are not file hashes or report links. Keys, upload URLs, and raw provider responses are never stored there. A minimal receipt is also saved as a workflow artifact for 30 days when available. Do not remove a checkpoint to force a new upload.

To retry, open **Actions → Scan published Windows installer → Run workflow**, select `main`, and enter the same published `tag`. Leave `analysis_id` empty for ordinary retries. A stored receipt resumes queries, a completed result reuses its previous analysis, and an exhausted poll count retains the last active state. If an upload was interrupted without a durable receipt, the run refuses to send it again automatically. Recover its analysis ID from the receipt artifact or confirm the submission in VirusTotal, then supply that ID in `analysis_id`. That input is never for an API key. If no ID can be recovered, manual investigation is required before another submission.

For an `invalid-upload-url` failure, the manual `diagnose_upload_url` option requests an upload URL and logs only fixed format labels. It uses the same secret and request limits, but does not download or upload the installer, poll an analysis, or change release metadata. The temporary URL and its token are never logged. Leave this option disabled for normal scans.

For an `analysis-file-mismatch` after a saved submission, the manual `diagnose_analysis` option reads that saved analysis and logs only which identity field differs. It does not download or upload the installer, and it does not change release metadata. Hashes, analysis IDs, and sizes are never logged. Leave this option disabled for normal scans.

Only the managed comment is updated. Fresh reads preserve surrounding notes and detect concurrent scan changes or repeated prose edits before writing. These checks cannot make a manual edit at the exact PATCH instant transactional; avoid editing release notes while the workflow is writing. A failure does not become zero detections. API failures retain any known receipt with an unavailable state; an already completed result is not downgraded.

The report link requires a completed API analysis associated with the same SHA-256 and size, plus a successful anonymous HTML response from its exact public GUI route. This checks file identity and route availability, not the complete interactive report UI. If the route is unavailable, the completed result has no fabricated link; a later manual retry can add it without uploading again. The website's Windows download information cards show the matching scan state, final engine counts, analysis date, and available report link from this metadata. Missing or mismatched data is shown as unavailable. Scan updates require a page reload, not a website rebuild; website deployment remains manual. See [website scan presentation](website.md#edit-sections-and-product-copy).

<details>
<summary>Client behavior, quotas, and bounded retries</summary>

`scripts/virustotal-client.mjs` is an internal Node library used by the coordinator. It has no command-line entry point. Importing it does not load credentials, make requests, or submit a file.

`createVirusTotalClient` requires an explicitly supplied API key. `submitInstaller` accepts the local file and its complete official release/asset identity, verifies its filename, byte size, and SHA-256 before making a request, and returns a submission receipt containing the analysis ID and installer identity. The same file-backed Blob is used for hashing and multipart upload; changes to the source file invalidate reads. Files over 32,000,000 bytes use a single-use upload URL; files over 650,000,000 bytes are rejected. These conservative decimal thresholds stay within the [documented upload limits](https://docs.virustotal.com/reference/files-upload-url). VirusTotal may return that upload URL on www.virustotal.com or another virustotal.com host, sometimes with an http scheme. The client upgrades only those hosts to https before sending the installer, and still requires the documented upload path. Requests do not follow redirects.

`getAnalysis` and `waitForAnalysis` require the receipt and the matching installer identity. Queued and in-progress responses return their state without partial result counts; their file metadata can be provisional on a fresh upload, so it is not treated as a mismatch until the analysis completes. A completed result requires all eight valid engine counters and a separate check of the analysis's [related file](https://docs.virustotal.com/reference/analysis-object-item), including SHA-256 and byte size. The submission id addresses the analysis. A later response may carry a different object id; that response is accepted only when the file metadata matches the installer. Malicious, suspicious, unsupported, failed, and timed-out engines remain distinct. `analysisAt` preserves VirusTotal's analysis date; `observedAt` records when the client observed the result, without claiming a precise completion time. The client derives neither a safety verdict nor a public report URL. The coordinator persists state updates through the polling callback and checks the public route separately.

The default client starts with a 16-second cooldown and serializes every API call, including upload-URL requests, uploads, retries, and polling. Queries can retry up to three attempts with backoff and `Retry-After`; uploads are never replayed automatically. An interrupted, unreadable, or server-failed upload raises `submission-uncertain`, because VirusTotal may already have accepted it. Preserve successful receipts and check remote submission state before explicitly attempting another upload. Authentication and permission failures are not retried. A `QuotaExceededError` stops all further requests from that client instead of assuming which account quota was exceeded. Errors omit raw response messages, transport diagnostics, keys, and upload URLs.

Each client is bounded to 100 requests, 20 minutes, 120 seconds per request, and 40 polls with a 30-second polling interval. A poll-count limit returns the last active state with `pollingStopped`; time or request-budget exhaustion raises an error. None becomes a completed or zero-detection result. Limits can be reduced, and request/poll intervals can be increased. All scan runs share one non-cancelling workflow concurrency group and use one client per run. These are per-client bounds, not an account-wide quota ledger. Use a dedicated key; other uses of it also consume the [Public API allowance](https://docs.virustotal.com/reference/public-vs-premium-api). Account eligibility and permitted use must be established independently of software tests. Credential provisioning belongs in the private operations runbook.

</details>

## Build candidates for testing

### Portable Dev ZIPs

Open **Actions → Desktop Dev builds → Run workflow** and select the branch to evaluate. Run it for changes to Electron, native dependencies, desktop packaging, installers, or updates, and before publishing a release.

**The latest CI run for the selected branch and exact commit must pass.** Desktop Dev waits up to 30 minutes for it and reuses its validation. If no CI run exists, run **Actions → CI → Run workflow** on that branch, then retry Desktop Dev.

The workflow builds Windows and Linux ZIPs and verifies the packaged desktop/server plus Windows utility, Trash, and clipboard integration. PRs and pushes to `main` run automatic validation, system-trash checks, and packed CLI smoke tests without desktop packaging or packaged server/utility checks.

Download `OpenTig-Dev-<OS>-manual-<run>` from the workflow run and **extract the inner application ZIP completely**. Artifacts expire after 14 days. A Dev build uses the same separate Dev profile as local builds.

<details>
<summary>Forks, runner versions, and build permissions</summary>

For a fork's branch, run the workflow in the fork or check out the change on a branch in the main repository. Dev jobs have read-only repository permissions, no signing credentials, and no publishing step.

Linux jobs explicitly use `ubuntu-24.04`, so changes to the `ubuntu-latest` label do not migrate CI or release builders automatically.

</details>

### Unsigned Windows installer candidate

Run **Windows installer candidate** manually in Actions to build an unsigned stable installer for evaluation. It runs the quality gates, package/runtime checks, and a disposable-runner install/uninstall test that checks installation registration and data preservation. Its artifact is kept for 14 days and has automatic updates disabled.

Enable its `release_mode` option to additionally build and verify unsigned release metadata and an update-enabled installer without publishing anything. This does not constitute a successful upgrade test between two releases.

## npm publishing

### Configure the trusted publisher

Configure npm [Trusted publishing](https://docs.npmjs.com/trusted-publishers/) in the settings for `@opentig/cli`:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Owner | `jorgefl8` |
| Repository | `opentig` |
| Workflow filename | `publish-cli.yml` |
| Environment | `release` |

Allow direct publication with `npm publish`, which this workflow uses. The package must already exist, and you need permission to configure its publisher.

The publish job uses Node 24 and npm OIDC with provenance. No npm token is stored in GitHub or the application. **Without publisher authorization, npm publication fails even though the GitHub release and Windows update are available.**

### Publish, retry, and install

**Publish CLI to npm** accepts only a published stable release with matching tag, commit, package identity, and integrity. It never publishes a draft or prerelease. Retrying an already published npm version succeeds only when its bytes match; backfilling an older version does not move npm's `latest` tag backwards.

To retry a failed publication, or publish a release whose older tag predates this workflow, run it manually on `main` with the published tag.

After successful publication, install globally with `npm install -g @opentig/cli@<version>` and check `opentig --version`.

Before publication, the downloaded draft tarball can be evaluated with `npm install -g /absolute/path/opentig-cli-<version>.tgz`; use a separate `--home` and port for evaluation. Installing the CLI does not start a server or install a service automatically.

## Windows signing and updates

Releases are unsigned by default and need no signing credentials. Windows may show an unknown publisher or SmartScreen warning, and device policies can block unsigned applications. Automatic updates still use HTTPS and SHA-512 download integrity checks, but do not verify a signing publisher.

### Enable certificate signing

Configure the `release` GitHub environment:

- Variable `WINDOWS_RELEASE_SIGNING`: `signed` (unset or `unsigned` keeps unsigned releases).
- Secret `WINDOWS_CSC_LINK`: the signing certificate accepted by electron-builder, normally a base64-encoded PFX, supplied privately through GitHub settings.
- Secret `WINDOWS_CSC_KEY_PASSWORD`: the certificate password.
- Variable `WINDOWS_PUBLISHER_NAME`: the exact certificate publisher/common name. The build requires signing and release verification checks Authenticode trust and the publisher on both the app and installer. The updater verifies downloaded installer signatures against this publisher.

This integration supports a certificate-based signer; a hardware/cloud signing service requires its provider-specific configuration. When signed mode is selected, missing signing credentials fail the workflow explicitly; it never falls back to unsigned. Do not place credentials in source, PR jobs, or the client.

### Update destination and Windows validation

The update destination is the public `jorgefl8/opentig` repository, recorded in `release.config.json`. Public, unauthenticated GitHub Releases allow updates without a user token. No GitHub token is embedded in the application, and browser/server credentials are unrelated to release access. Drafts and prereleases are not offered by the stable updater.

Before the first public release, validate installation and coexistence with Dev on Windows, perform an actual upgrade between two versions, and verify data preservation. These workflows do not change repository visibility.
