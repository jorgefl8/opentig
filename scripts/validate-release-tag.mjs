import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const tag = process.env.OPENTIG_RELEASE_TAG;
const desktop = JSON.parse(readFileSync('package.json', 'utf8'));
const server = JSON.parse(readFileSync('packages/server/package.json', 'utf8'));
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag) || tag !== `v${desktop.version}` || desktop.version !== server.version) {
  throw new Error('Release tag must be a stable vX.Y.Z matching both desktop and server versions.');
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
if (process.env.OPENTIG_RELEASE_COMMIT && process.env.OPENTIG_RELEASE_COMMIT !== commit) throw new Error('Checkout does not match the prepared commit.');
if (git('rev-parse', `${tag}^{commit}`) !== commit) throw new Error('Checkout does not match the release tag.');
git('merge-base', '--is-ancestor', commit, 'origin/main');
const release = JSON.parse(readFileSync('release.config.json', 'utf8'));
if (`${release.owner}/${release.repo}` !== process.env.GITHUB_REPOSITORY) throw new Error('Release repository does not match the configured update feed.');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\ncommit=${commit}\n`);
console.log(`Release candidate ${tag} at ${commit} validated.`);
