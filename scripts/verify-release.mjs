import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { extractFile } from '@electron/asar';
import { repositoryRoot } from './build-desktop.mjs';
import { verifyReleaseMetadata } from './release-metadata.mjs';

if (process.platform !== 'win32') throw new Error('Release signature verification must run on Windows.');
const publisher = process.env.OPENTIG_PUBLISHER_NAME;
if (!publisher?.trim()) throw new Error('OPENTIG_PUBLISHER_NAME is required.');
const metadata = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const repository = JSON.parse(await readFile(path.join(repositoryRoot, 'release.config.json'), 'utf8'));
const installer = await verifyReleaseMetadata(path.join(repositoryRoot, 'out/make/production/win32-x64'), metadata.version);
const resources = path.join(repositoryRoot, 'out/OpenTig-win32-x64/resources');
const manifest = JSON.parse(extractFile(path.join(resources, 'app.asar'), 'opentig-build.json').toString());
assert.equal(manifest.signedRelease, true);
assert.equal(manifest.distribution, 'installer');
assert.equal(manifest.updateRepository, `${repository.owner}/${repository.repo}`);
const feed = parse(await readFile(path.join(resources, 'app-update.yml'), 'utf8'));
assert.equal(feed.provider, 'github');
assert.equal(feed.owner, repository.owner);
assert.equal(feed.repo, repository.repo);
assert.deepEqual(Array.isArray(feed.publisherName) ? feed.publisherName : [feed.publisherName], [publisher]);
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(repositoryRoot, 'scripts/verify-windows-signature.ps1'),
  '-Installer', installer, '-Application', path.join(resources, '../OpenTig.exe'), '-Publisher', publisher], { stdio: 'inherit', windowsHide: true });
console.log('SIGNED_WINDOWS_RELEASE_OK');
