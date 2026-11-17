import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'jorgefl8/opentig';
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const gh = (...args) => run('gh', args);
const digest = (bytes, algorithm, encoding) => createHash(algorithm).update(bytes).digest(encoding);

export function validateIdentity(tag, commit) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected a stable release tag and full commit SHA.');
}

export function verifyBundle(directory, tag, commit) {
  validateIdentity(tag, commit);
  const metadata = JSON.parse(readFileSync(path.join(directory, 'opentig-headless.json'), 'utf8'));
  const version = tag.slice(1);
  if (metadata.schemaVersion !== 1 || metadata.packageName !== '@opentig/cli' || metadata.version !== version
    || metadata.filename !== `opentig-cli-${version}.tgz`
    || metadata.release?.tag !== tag || metadata.release?.commit !== commit) throw new Error('CLI artifact does not match the release identity.');
  const tarball = path.resolve(directory, metadata.filename);
  const bytes = readFileSync(tarball);
  if (metadata.sha256 !== digest(bytes, 'sha256', 'hex')
    || metadata.npmIntegrity !== `sha512-${digest(bytes, 'sha512', 'base64')}`) throw new Error('CLI artifact integrity mismatch.');
  const packed = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json']));
  if (packed.name !== metadata.packageName || packed.version !== version || packed.private === true
    || packed.bin?.opentig !== 'dist/bin.mjs') throw new Error('Packed CLI identity does not match the release.');
  refuseLifecycles(packed);
  return { metadata, tarball, alias: verifyAlias(directory, metadata) };
}

const lifecycles = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublishOnly', 'prepack', 'postpack', 'publish', 'postpublish'];
function refuseLifecycles(packed) {
  for (const lifecycle of lifecycles) if (packed.scripts?.[lifecycle]) throw new Error(`Unexpected package lifecycle: ${lifecycle}`);
}

/** The opentig alias packed with the CLI, or null for releases prepared before it existed. */
export function verifyAlias(directory, metadata) {
  const alias = metadata.alias;
  if (alias === undefined) return null;
  if (alias?.packageName !== 'opentig' || alias.version !== metadata.version
    || alias.filename !== `opentig-${metadata.version}.tgz`) throw new Error('The opentig alias does not match the release identity.');
  const tarball = path.resolve(directory, alias.filename);
  const bytes = readFileSync(tarball);
  if (alias.sha256 !== digest(bytes, 'sha256', 'hex')
    || alias.npmIntegrity !== `sha512-${digest(bytes, 'sha512', 'base64')}`) throw new Error('The opentig alias integrity does not match.');
  const packed = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json']));
  if (packed.name !== 'opentig' || packed.version !== metadata.version || packed.private === true || packed.bin?.opentig !== 'bin.mjs'
    || JSON.stringify(packed.dependencies) !== JSON.stringify({ [metadata.packageName]: metadata.version })) {
    throw new Error('The packed opentig alias must run @opentig/cli at exactly its own version.');
  }
  refuseLifecycles(packed);
  return { ...alias, tarball };
}

export function assertRelease(release, tag, commit, draft) {
  if (release.tagName !== tag || release.isDraft !== draft || release.isPrerelease
    || release.targetCommitish !== commit) throw new Error(`Expected ${draft ? 'a draft' : 'a published stable release'} for ${tag} at ${commit}.`);
}

export function publicationTag(version, latest) {
  if (!latest || !/^\d+\.\d+\.\d+$/.test(latest)) return 'latest';
  const a = version.split('.').map(Number);
  const b = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 'latest';
    if (a[i] < b[i]) return `release-${version}`;
  }
  return 'latest';
}

function releaseState(tag) {
  return JSON.parse(gh('release', 'view', tag, '--repo', repository, '--json', 'tagName,isDraft,isPrerelease,targetCommitish,assets'));
}

function releaseCommit(tag) {
  return gh('api', `repos/${repository}/commits/${tag}`, '--jq', '.sha');
}

export async function main([action, directory, tag, providedCommit]) {
  if (!['stamp', 'verify', 'upload', 'publish'].includes(action)) throw new Error('Use stamp, verify, upload, or publish with directory and tag.');
  validateIdentity(tag, providedCommit || '0'.repeat(40));
  const commit = providedCommit || releaseCommit(tag);
  if (action === 'stamp') {
    const file = path.join(directory, 'opentig-headless.json');
    const metadata = JSON.parse(readFileSync(file, 'utf8'));
    metadata.release = { tag, commit };
    writeFileSync(file, `${JSON.stringify(metadata, null, 2)}\n`);
  }
  const { metadata, tarball, alias } = verifyBundle(directory, tag, commit);
  if (action === 'stamp' || action === 'verify') {
    console.log(`Verified @opentig/cli@${metadata.version}${alias ? ' and opentig' : ''} from ${tag} (${commit}).`);
    return;
  }
  if (releaseCommit(tag) !== commit) throw new Error('Release tag no longer matches the CLI source.');
  const release = releaseState(tag);
  assertRelease(release, tag, commit, action === 'upload');
  if (action === 'upload') {
    // Check every existing asset before writing anything; retries never clobber bytes.
    const files = [metadata.filename, ...alias ? [alias.filename] : [], 'opentig-headless.json'];
    const temporary = mkdtempSync(path.join(tmpdir(), 'opentig-release-assets-'));
    try {
      const missing = [];
      for (const name of files) {
        if (!release.assets.some((asset) => asset.name === name)) { missing.push(name); continue; }
        gh('release', 'download', tag, '--repo', repository, '--pattern', name, '--dir', temporary);
        if (!readFileSync(path.join(temporary, name)).equals(readFileSync(path.join(directory, name)))) {
          throw new Error(`Refusing to replace existing release asset ${name}.`);
        }
      }
      assertRelease(releaseState(tag), tag, commit, true);
      if (missing.length) gh('release', 'upload', tag, ...missing.map((name) => path.resolve(directory, name)), '--repo', repository);
      console.log(`CLI assets attached to draft ${tag}; existing assets preserved.`);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
    return;
  }
  await publish({ name: metadata.packageName, version: metadata.version, integrity: metadata.npmIntegrity, tarball }, tag, commit);
  // The alias depends on the CLI at the same version, so it always follows it.
  if (!alias) {
    console.log(`The ${tag} release was prepared without the opentig alias; only @opentig/cli was published.`);
    return;
  }
  await publish({ name: alias.packageName, version: alias.version, integrity: alias.npmIntegrity, tarball: alias.tarball, firstPublication: 'manual' }, tag, commit);
}

// Publishes one prepared tarball unless npm already has those exact bytes.
async function publish({ name, version, integrity, tarball, firstPublication }, tag, commit) {
  const registry = `https://registry.npmjs.org/${name.replace('/', '%2f')}`;
  const existing = await fetch(`${registry}/${version}`);
  if (existing.ok) {
    const published = await existing.json();
    if (published.dist?.integrity !== integrity) throw new Error(`npm already contains different bytes for ${name}@${version}.`);
    console.log(`${name}@${version} is already published with matching integrity.`);
    return;
  }
  if (existing.status !== 404) throw new Error(`npm lookup failed: HTTP ${existing.status}.`);
  const index = await fetch(registry);
  if (!index.ok && index.status !== 404) throw new Error(`npm package lookup failed: HTTP ${index.status}.`);
  if (index.status === 404 && firstPublication === 'manual') {
    // npm can trust this workflow only for a package that already exists.
    const message = `${name} is not on npm yet. Publish ${path.basename(tarball)} from this release by hand once, as docs/releases.md describes, then add this workflow as its trusted publisher.`;
    console.log(`::warning::${message}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
    return;
  }
  const latest = index.ok ? (await index.json())['dist-tags']?.latest : undefined;
  assertRelease(releaseState(tag), tag, commit, false);
  execFileSync('npm', ['publish', tarball, '--access', 'public', '--provenance', '--ignore-scripts', '--tag', publicationTag(version, latest)], { stdio: 'inherit' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
