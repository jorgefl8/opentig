# Release automation

[← Documentation](README.md)

OpenTig releases move through three stages: **draft notes**, **prepare a tagged build**, then **publish the reviewed release**. A notes-only draft has no prepared binaries.

- [Prepare and publish](#prepare-and-publish): the normal release sequence.
- [Retry or correct a release](#retry-or-correct-a-release): what to do after a failure or code change.
- [Build candidates for testing](#build-candidates-for-testing): Dev ZIPs and unsigned installers.
- [npm publishing](#npm-publishing) and [Windows signing and updates](#windows-signing-and-updates): setup and requirements.

## Builds and releases on GitHub

| Stage | Trigger and result |
| --- | --- |
| **Next release draft** | Qualifying pushes to `main` create or refresh one unpublished draft and its notes |
| **Prepare release** | Manual workflow freezes the version, commit, tag, and notes, then builds Windows and CLI artifacts |
| **Publish release** | Manual release-page action makes the Windows update available and triggers CLI publication |
| **Publish CLI to npm** | Publishes the exact prepared tarball; wait for success before installing from npm |

**Drafting does not build installers or notify installed clients.** It is independent of CI success, runs only on upstream `main`, uses the built-in Actions token, and needs no additional secret.

### Website and application releases

The [public website](website.md#ci-and-release-separation) has a separate validation job within CI and is deployed manually to Cloudflare Workers. Website-only means every changed path is in `website/` or `docs/website.md`; the former dedicated website workflow path is also recognized when filtering historical commits.

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

Preparation chooses the managed draft's proposed version, including a higher manually selected version. It aligns the desktop/server package versions and workspace lockfile, creating a version commit only when needed.

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

**CLI release draft** builds from the same frozen tag as Windows, inspects the package, installs it globally on a disposable Linux runner, and checks startup, the web client, pairing, session persistence across restart, and graceful shutdown.

It attaches the tarball and metadata only to the matching draft. Existing assets are never replaced; retries accept identical CLI assets.

It can also run manually on `main` with an existing draft tag to complete an older release without changing its tag, notes, or Windows installer. A different existing CLI artifact is rejected instead of silently rebuilding an immutable version.

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
