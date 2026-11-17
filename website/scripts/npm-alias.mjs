// The website tells visitors to run `npx opentig@latest`. Deploying it is only
// truthful once the opentig alias is on npm at the same version as the
// @opentig/cli it runs.
//
//   node website/scripts/npm-alias.mjs
//
// OPENTIG_ALLOW_MISSING_NPM_ALIAS=1 deploys anyway, for an urgent fix: the
// check then warns, naming what the site will say that is not true, instead
// of failing. The Deploy website workflow sets it from its
// allow_missing_npm_alias input.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const registry = 'https://registry.npmjs.org';

async function latest(name, fetchImplementation) {
  const response = await fetchImplementation(`${registry}/${name.replace('/', '%2f')}`, { headers: { Accept: 'application/vnd.npm.install-v1+json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm lookup of ${name} failed: HTTP ${response.status}.`);
  return (await response.json())['dist-tags']?.latest ?? null;
}

/** Resolves with the shared version, or rejects with what is missing. */
export async function checkNpmAlias(fetchImplementation = fetch) {
  const [cli, alias] = await Promise.all([latest('@opentig/cli', fetchImplementation), latest('opentig', fetchImplementation)]);
  if (!cli) throw new Error('@opentig/cli has no latest version on npm.');
  if (alias !== cli) {
    throw new Error(`The site shows "npx opentig@latest", but opentig@latest is ${alias ? alias : 'not published'} while @opentig/cli@latest is ${cli}. `
      + 'Publish the opentig alias from the same release first (docs/releases.md), then deploy.');
  }
  return cli;
}

/** The warning printed when a deployment goes ahead without a matching alias. */
export function overrideWarning(problem) {
  return `WARNING: deploying with OPENTIG_ALLOW_MISSING_NPM_ALIAS although the npm check failed: ${problem} `
    + 'Until opentig@latest matches @opentig/cli@latest, the site is wrong where it tells visitors to run "npx opentig@latest": '
    + 'the npm command in the home page\'s hero and install block ("npx opentig@latest service install"), the agents\' overview and llms.txt, '
    + 'and the guides\' npx commands. The install scripts and the Windows download are not affected.';
}

/** Runs the check; with the override, a failure becomes a warning. */
export async function checkBeforeDeploy({ fetchImplementation = fetch, allowMismatch = false, warn = console.warn } = {}) {
  try {
    return { version: await checkNpmAlias(fetchImplementation), overridden: false };
  } catch (error) {
    if (!allowMismatch) throw error;
    warn(overrideWarning(error.message));
    return { version: null, overridden: true };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkBeforeDeploy({
    allowMismatch: process.env.OPENTIG_ALLOW_MISSING_NPM_ALIAS === '1',
    warn: message => {
      // In GitHub Actions, also as an annotation and in the run's summary.
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=npm alias not checked::${message}`);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `> [!WARNING]\n> ${message}\n`);
      console.error(`\n${'!'.repeat(72)}\n${message}\n${'!'.repeat(72)}\n`);
    },
  });
  if (!result.overridden) console.log(`opentig@latest and @opentig/cli@latest are both ${result.version}.`);
}
