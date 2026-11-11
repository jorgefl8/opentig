import { fallbackDownload } from './lib/downloads';
export const repositoryUrl = 'https://github.com/jorgefl8/opentig';
export const npmUrl = 'https://www.npmjs.com/package/@opentig/cli';
// Installs the background service and an `opentig` command without a global npm package.
export const cliInstallCommand = 'npx --yes @opentig/cli@latest service install';
export const downloadUrl = fallbackDownload.url;
export const downloadVersion = fallbackDownload.version;
export const siteDescription = 'Browse files, review diffs, edit code, and commit changes. OpenTig brings branches, worktrees, and GitHub pull requests, Actions, and releases into one focused Git workspace.';
// The maintainer as already credited in the footer; structured data names the same public profile.
export const authorName = 'jorgefl8';
export const authorUrl = 'https://github.com/jorgefl8';
