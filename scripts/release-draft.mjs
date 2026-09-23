import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const NOTES_START = '<!-- opentig:release-notes:start -->';
export const NOTES_END = '<!-- opentig:release-notes:end -->';
const stable = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function versionParts(value) {
  const match = stable.exec(value);
  if (!match) throw new Error(`Expected a stable version: ${value}`);
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Version exceeds safe integer range.');
  return parts;
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function selectDraft(releases, packageVersion) {
  versionParts(packageVersion);
  const published = releases.filter((r) => !r.draft && !r.prerelease && r.tag_name.startsWith('v') && stable.test(r.tag_name))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
  const drafts = releases.filter((r) => r.draft && r.body?.includes(NOTES_START));
  if (drafts.length > 1) throw new Error('Multiple managed release drafts; resolve them before continuing.');
  const draft = drafts[0];
  if (draft && (draft.prerelease || !draft.tag_name.startsWith('v') || !stable.test(draft.tag_name)
    || (published && compareVersions(draft.tag_name, published.tag_name) <= 0))) {
    throw new Error('Managed draft must be newer than the last stable release.');
  }
  let version = packageVersion;
  if (published && compareVersions(version, published.tag_name) <= 0) {
    const parts = versionParts(published.tag_name);
    parts[2] += 1;
    version = parts.join('.');
  }
  // A manually chosen higher draft version is preserved; package bumps can
  // promote the same draft from a proposed patch to a minor/major release.
  if (draft && compareVersions(draft.tag_name, version) > 0) version = draft.tag_name.slice(1);
  const tag = `v${version}`;
  versionParts(tag);
  if (releases.some((r) => r.id !== draft?.id && r.tag_name === tag)) {
    throw new Error(`Release ${tag} already exists outside the managed draft.`);
  }
  return { published, draft, tag };
}

function escapeMarkdown(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]])/g, '\\$1');
}

function describeCommit({ message }) {
  const lines = message.trim().split('\n');
  const merge = /^Merge pull request #(\d+)\b/.exec(lines[0]);
  const subject = (merge ? lines.slice(1).find((line) => line.trim()) : lines[0]) || lines[0];
  return { subject, pr: merge?.[1] || /\(#(\d+)\)$/.exec(subject)?.[1] || null };
}

function creditedAuthor(user, name) {
  const login = user?.login;
  return {
    login: typeof login === 'string' && /^[a-z\d-]+(?:\[bot\])?$/i.test(login) ? login : null,
    name: name || 'Unknown author',
    bot: user?.type === 'Bot' || /\[bot\]$/i.test(login || ''),
  };
}

export async function attributeChanges({ api, git, commits, previousTag, head }) {
  const wanted = new Set(commits.map(({ sha }) => sha));
  const metadata = new Map();
  for (let page = 1; wanted.size; page += 1) {
    const batch = await api('GET', `/commits?sha=${head}&per_page=100&page=${page}`);
    for (const commit of batch) {
      if (wanted.delete(commit.sha)) metadata.set(commit.sha, commit);
    }
    if (batch.length < 100) break;
  }
  if (wanted.size) throw new Error('GitHub author metadata is missing for release commits.');

  const previousCommits = new Set(previousTag ? git('rev-list', previousTag, '--').trim().split('\n') : []);
  const previousPrAuthors = new Set();
  const pulls = new Map();
  // PR creators can differ from both the commit author and the merger. Use
  // actual merged PR metadata, never interpret an arbitrary #number as proof.
  for (let page = 1; ; page += 1) {
    const batch = await api('GET', `/pulls?state=closed&base=main&per_page=100&page=${page}`);
    for (const pr of batch) {
      if (!pr.merged_at) continue;
      pulls.set(String(pr.number), pr);
      if (previousCommits.has(pr.merge_commit_sha) && pr.user?.login) previousPrAuthors.add(pr.user.login.toLowerCase());
    }
    if (batch.length < 100) break;
  }
  const entries = commits.map((commit) => {
    const details = describeCommit(commit);
    const pull = pulls.get(details.pr);
    const verifiedPr = pull?.merge_commit_sha === commit.sha;
    const data = metadata.get(commit.sha);
    return { ...commit,
      subject: verifiedPr ? pull.title : details.subject,
      pr: verifiedPr ? details.pr : null,
      author: verifiedPr ? creditedAuthor(pull.user) : creditedAuthor(data.author, data.commit?.author?.name),
    };
  });
  const newContributors = [];
  const seen = new Set(previousPrAuthors);
  for (const entry of entries) {
    const { login, bot } = entry.author;
    if (!login || bot || seen.has(login.toLowerCase())) continue;
    seen.add(login.toLowerCase());
    const previous = previousTag
      ? await api('GET', `/commits?sha=${encodeURIComponent(previousTag)}&author=${encodeURIComponent(login)}&per_page=1`)
      : [];
    if (!previous.length) newContributors.push(entry);
  }
  return { entries, newContributors };
}

function changeLink(entry, base) {
  return entry.pr ? `[#${entry.pr}](${base}/pull/${entry.pr})` : `[${entry.sha.slice(0, 7)}](${base}/commit/${entry.sha})`;
}

export function renderNotes(commits, repository, previousTag, head, newContributors = []) {
  const base = `https://github.com/${repository}`;
  const groups = new Map(['Features', 'Fixes', 'Maintenance'].map((name) => [name, []]));
  for (const commit of commits) {
    const entry = { ...describeCommit(commit), ...commit };
    const { subject, author } = entry;
    const type = /^(\w+)(?:\([^)]*\))?!?:/.exec(subject)?.[1];
    const group = type === 'feat' ? 'Features' : type === 'fix' || type === 'perf' ? 'Fixes' : 'Maintenance';
    const by = author?.login ? `@${author.login}` : escapeMarkdown((author?.name || 'Unknown author').replace(/\s+/g, ' '));
    groups.get(group).push(`- ${escapeMarkdown(subject.replace(/\s*\(#\d+\)$/, ''))} by ${by} in ${changeLink(entry, base)}`);
  }
  const sections = [...groups].filter(([, items]) => items.length)
    .map(([name, items]) => `### ${name}\n\n${items.join('\n')}`);
  if (newContributors.length) sections.push(`## New Contributors\n\n${newContributors.map((entry) =>
    `- @${entry.author.login} made their first contribution in ${changeLink(entry, base)}`).join('\n')}`);
  const compare = previousTag ? `${base}/compare/${previousTag}...${head}` : `${base}/commits/${head}`;
  return `${NOTES_START}\n## What's changed\n\n${sections.join('\n\n')}\n\n[Full changelog](${compare})\n${NOTES_END}`;
}

export function replaceNotes(body, notes) {
  if (!body) return notes;
  const start = body.indexOf(NOTES_START);
  const end = body.indexOf(NOTES_END);
  if (start < 0 || end < start || body.indexOf(NOTES_START, start + 1) >= 0
    || body.indexOf(NOTES_END, end + 1) >= 0) {
    throw new Error('Release notes markers are missing or ambiguous; refusing to overwrite manual notes.');
  }
  return body.slice(0, start) + notes + body.slice(end + NOTES_END.length);
}

export function readCommits(git, previousTag, head) {
  if (previousTag) git('merge-base', '--is-ancestor', `${previousTag}^{commit}`, head);
  const range = previousTag ? `${previousTag}..${head}` : head;
  const fields = git('log', '--first-parent', '--reverse', '--format=%H%x00%B%x00', range, '--').split('\0');
  const commits = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const sha = fields[i].trim();
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid commit in release history.');
    commits.push({ sha, message: fields[i + 1] });
  }
  return commits;
}

// Only this function writes to GitHub. Dependencies are injected so the whole
// release lifecycle can be tested without creating tags/releases remotely.
export async function updateDraft({ api, git, repository, packageVersion, dryRun = false }) {
  const head = git('rev-parse', 'HEAD').trim();
  const main = await api('GET', '/commits/main');
  if (head !== main.sha) return 'Main advanced; a newer run will update the draft.';
  const releases = [];
  for (let page = 1; ; page += 1) {
    const batch = await api('GET', `/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  let { published, draft, tag } = selectDraft(releases, packageVersion);
  let target = head;
  // Once a tag exists or binaries are attached, its notes must stay tied to
  // that candidate. The next draft starts after that release is published.
  if (draft?.assets?.length) return `Draft ${draft.tag_name} is frozen for release validation.`;
  const existingTag = await api('GET', `/git/ref/tags/${draft?.tag_name || tag}`, undefined, true);
  if (existingTag) {
    if (!draft) return `Tag ${tag} already exists; signed release workflow owns it.`;
    // A main push and its tag may arrive together. Reconcile that final commit
    // before freezing; do not accidentally omit the last changes in the build.
    target = (await api('GET', `/commits/${draft.tag_name}`)).sha;
    if (!/^[a-f0-9]{40}$/.test(target)) throw new Error('Invalid release tag commit.');
    tag = draft.tag_name;
    if (draft.target_commitish === target) return `Draft ${tag} is frozen for release validation.`;
  }
  if (draft && tag !== draft.tag_name && await api('GET', `/git/ref/tags/${tag}`, undefined, true)) {
    throw new Error(`Proposed tag ${tag} already exists; resolve the managed draft before continuing.`);
  }
  const commits = readCommits(git, published?.tag_name, target);
  if (!commits.length) return 'No changes since the last published stable release.';
  const { entries, newContributors } = await attributeChanges({ api, git, commits, previousTag: published?.tag_name, head: target });
  const body = replaceNotes(draft?.body, renderNotes(entries, repository, published?.tag_name, target, newContributors));
  if (Buffer.byteLength(body, 'utf8') > 120000) throw new Error('Release notes exceed the supported size.');
  if (dryRun) return JSON.stringify({ tag, commit: target, body }, null, 2);
  // Re-read immediately before patching: never set draft:true on an existing
  // release, so even a concurrent manual publication cannot be unpublished.
  if (draft) {
    const current = await api('GET', `/releases/${draft.id}`);
    if (!current.draft || current.prerelease || current.assets?.length || current.body !== draft.body
      || current.tag_name !== draft.tag_name || current.target_commitish !== draft.target_commitish || current.name !== draft.name) {
      throw new Error('Draft changed during generation; retry to preserve the newer release.');
    }
  }
  const payload = { tag_name: tag, target_commitish: target, body };
  if (!draft || draft.name === `OpenTig ${draft.tag_name}`) payload.name = `OpenTig ${tag}`;
  if (draft) await api('PATCH', `/releases/${draft.id}`, payload);
  else await api('POST', '/releases', { ...payload, draft: true, prerelease: false });
  return `Updated ${tag} with ${commits.length} main history entries.`;
}

async function main() {
  const config = JSON.parse(readFileSync('release.config.json', 'utf8'));
  const repository = `${config.owner}/${config.repo}`;
  if (process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Release drafting is restricted to main in the configured upstream repository.');
  }
  if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required.');
  const api = async (method, route, body, allowMissing = false) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${route}: HTTP ${response.status}`);
    return response.json();
  };
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  console.log(await updateDraft({ api, git, repository,
    packageVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
    dryRun: process.argv.includes('--dry-run'),
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
