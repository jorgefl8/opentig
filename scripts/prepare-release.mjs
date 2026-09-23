import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listReleases, releaseApi } from './release-api.mjs';
import { attributeChanges, readCommits, renderNotes, replaceNotes, selectDraft } from './release-draft.mjs';

const versionFiles = ['package.json', 'packages/server/package.json', 'package-lock.json'];

function versionDocuments(read, version) {
  const [desktop, server, lock] = versionFiles.map((file) => JSON.parse(read(file)));
  if (lock.lockfileVersion !== 3 || lock.packages?.['']?.name !== desktop.name
    || lock.packages?.['packages/server']?.name !== server.name) throw new Error('Unexpected workspace lockfile layout.');
  desktop.version = server.version = lock.version = lock.packages[''].version = lock.packages['packages/server'].version = version;
  return [desktop, server, lock].map((document) => `${JSON.stringify(document, null, 2)}\n`);
}

function assertVersions(git, commit, version) {
  const read = (file) => git('show', `${commit}:${file}`);
  const expected = versionDocuments(read, version);
  for (const [index, file] of versionFiles.entries()) {
    if (JSON.stringify(JSON.parse(read(file))) !== JSON.stringify(JSON.parse(expected[index]))) {
      throw new Error(`Tagged version does not match ${file}; never move an existing release tag.`);
    }
  }
}

async function assertDraftUnchanged(api, draft, tag) {
  if (!draft) {
    if ((await listReleases(api)).some((release) => release.tag_name === tag)) throw new Error('Release appeared during preparation; retry.');
    return;
  }
  const current = await api('GET', `/releases/${draft.id}`);
  if (!current.draft || current.prerelease || current.tag_name !== draft.tag_name
    || current.body !== draft.body || current.name !== draft.name || current.target_commitish !== draft.target_commitish
    || JSON.stringify(current.assets || []) !== JSON.stringify(draft.assets || [])) {
    throw new Error('Draft changed during preparation; retry without overwriting it.');
  }
}

/** Prepare only in a disposable checkout; tests use real bare Git remotes. */
export async function prepareRelease({ api, git, root, repository, dryRun = false }) {
  if (git('status', '--porcelain').trim()) throw new Error('Release preparation requires a clean checkout.');
  const head = git('rev-parse', 'HEAD').trim();
  const read = (file) => readFileSync(path.join(root, file), 'utf8');
  let { published, draft, tag: proposedTag } = selectDraft(await listReleases(api), JSON.parse(read('package.json')).version);
  let tag = draft?.tag_name || proposedTag;
  let existingTag = await api('GET', `/git/ref/tags/${tag}`, undefined, true);
  if (!existingTag && draft && tag !== proposedTag) {
    if (draft.assets?.length) throw new Error('Draft has assets but no tag; resolve it before preparing a release.');
    // A promoted version may have been pushed successfully before its draft
    // was renamed. Recover that tag instead of creating or moving another one.
    tag = proposedTag;
    existingTag = await api('GET', `/git/ref/tags/${tag}`, undefined, true);
  }
  let commit;
  if (existingTag) {
    if (!draft) throw new Error(`Tag ${tag} exists without a managed draft; refusing to reuse it.`);
    // Retry a frozen release even if newer commits or a package bump reached main.
    commit = (await api('GET', `/commits/${tag}`)).sha;
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid release tag commit.');
    git('merge-base', '--is-ancestor', commit, 'origin/main');
    assertVersions(git, commit, tag.slice(1));
    if (draft.assets?.length && draft.target_commitish !== commit) throw new Error('Draft assets belong to a different commit.');
  } else {
    if (draft?.assets?.length) throw new Error('Draft has assets but no tag; resolve it before preparing a release.');
    tag = proposedTag;
    if ((await api('GET', '/commits/main')).sha !== head) throw new Error('Main advanced; run Prepare release again on main.');
    if (!readCommits(git, published?.tag_name, head).length) throw new Error('No changes since the last published release.');
    const documents = versionDocuments(read, tag.slice(1));
    const changed = versionFiles.filter((file, index) => read(file) !== documents[index]);
    // Validate manual notes before creating a permanent tag.
    replaceNotes(draft?.body, 'validation');
    if (dryRun) return { tag, sourceCommit: head, versionCommitNeeded: changed.length > 0, resumed: false, dryRun: true };
    await assertDraftUnchanged(api, draft, tag);
    if (!draft) {
      // Establish the managed draft before creating the tag, so even a failure
      // immediately after the push can be resumed without adopting a stray tag.
      const commits = readCommits(git, published?.tag_name, head);
      const { entries, newContributors } = await attributeChanges({ api, git, commits, previousTag: published?.tag_name, head });
      const body = renderNotes(entries, repository, published?.tag_name, head, newContributors);
      if (Buffer.byteLength(body, 'utf8') > 120000) throw new Error('Release notes exceed the supported size.');
      draft = await api('POST', '/releases', { tag_name: tag, target_commitish: head, name: `OpenTig ${tag}`, body, draft: true, prerelease: false });
    }
    for (const [index, file] of versionFiles.entries()) writeFileSync(path.join(root, file), documents[index]);
    if (changed.length) {
      git('add', '--', ...versionFiles);
      git('commit', '-m', `chore(release): prepare ${tag}`);
    }
    commit = git('rev-parse', 'HEAD').trim();
    git('tag', '-a', tag, '-m', `OpenTig ${tag}`);
    // If main moves during preparation, neither the version commit nor tag is
    // pushed. Branch protection failures likewise leave the remote unchanged.
    git('push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`);
  }
  if (dryRun) return { tag, commit, resumed: true, dryRun: true };
  // A failure after the atomic push is recoverable: the next run finds the tag
  // above, reconciles notes to that exact commit, then calls the same builder.
  if (!draft?.assets?.length) {
    const commits = readCommits(git, published?.tag_name, commit);
    const { entries, newContributors } = await attributeChanges({ api, git, commits, previousTag: published?.tag_name, head: commit });
    const body = replaceNotes(draft?.body, renderNotes(entries, repository, published?.tag_name, commit, newContributors));
    if (Buffer.byteLength(body, 'utf8') > 120000) throw new Error('Release notes exceed the supported size.');
    await assertDraftUnchanged(api, draft, tag);
    const payload = { tag_name: tag, target_commitish: commit, body };
    if (!draft || draft.name === `OpenTig ${draft.tag_name}`) payload.name = `OpenTig ${tag}`;
    if (draft) await api('PATCH', `/releases/${draft.id}`, payload);
    else await api('POST', '/releases', { ...payload, draft: true, prerelease: false });
  } else await assertDraftUnchanged(api, draft, tag);
  return { tag, commit, resumed: Boolean(existingTag), dryRun: false };
}

async function main() {
  const { owner, repo } = JSON.parse(readFileSync('release.config.json', 'utf8'));
  const repository = `${owner}/${repo}`;
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Prepare release must run in Actions on main in the configured upstream repository.');
  }
  const token = process.env.GH_TOKEN;
  const api = releaseApi(repository, token);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', ...args], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    // Keep credentials out of remotes, persistent git configuration and argv.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` },
  });
  const result = await prepareRelease({ api, git, root: process.cwd(), repository, dryRun: process.env.OPENTIG_PREPARE_DRY_RUN === 'true' });
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${result.tag}\ncommit=${result.commit || ''}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## ${result.dryRun ? 'Preview' : 'Prepared'} ${result.tag}\n\n${result.dryRun ? 'No files, commits, tags or releases were changed.' : `Frozen commit: \`${result.commit}\`. The remaining jobs validate and attach the installer. Publish only after the complete workflow succeeds.`}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
