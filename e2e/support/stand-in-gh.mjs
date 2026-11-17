// A stand-in for GitHub CLI, so journeys about pull requests run against a
// real OpenTig server and a real Git repository without GitHub. It answers the
// reads OpenTig makes from what `OPENTIG_E2E_GITHUB` names: a JSON file with the
// account, the repository and its pull requests (see `GitHubWorld` in
// fixtures.ts). Anything else fails as GitHub would refuse it.
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const worldPath = process.env.OPENTIG_E2E_GITHUB;
const args = process.argv.slice(2);
if (worldPath) appendFileSync(`${worldPath}.log`, `${JSON.stringify(args)}\n`);
const world = worldPath ? JSON.parse(readFileSync(worldPath, 'utf8')) : null;

function done(value) {
  process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
  process.exit(0);
}
function refuse(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
/** `-f name=value` and `-F name=value` fields of `gh api`. */
const fields = () => {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    if ((args[index] === '-f' || args[index] === '-F') && args[index + 1]) {
      const [name, ...rest] = args[index + 1].split('=');
      values[name] = rest.join('=');
      index += 1;
    }
  }
  return values;
};

if (args[0] === '--version') done('gh version 2.80.0 (2026-01-01)\n');
if (!world) refuse('No stand-in GitHub was set up for this test.');

const [owner, name] = world.nameWithOwner.split('/');
const login = world.login;
const author = (who = login) => ({ login: who, is_bot: false });
const pull = (number) => world.pulls.find((item) => item.number === Number(number));
const url = (number) => `https://github.com/${world.nameWithOwner}/pull/${number}`;

function summary(item) {
  return {
    number: item.number, title: item.title, state: 'OPEN', isDraft: false, author: author(item.author),
    headRefName: item.headRefName, headRefOid: item.headRefOid, baseRefName: item.baseRefName, updatedAt: item.updatedAt ?? '2026-11-01T10:00:00Z',
    url: url(item.number), reviewDecision: '', additions: item.additions ?? 0, deletions: item.deletions ?? 0, statusCheckRollup: [],
    headRepository: { nameWithOwner: world.nameWithOwner },
  };
}

function details(item) {
  return {
    ...summary(item), body: item.body ?? '', changedFiles: item.changedFiles ?? 0, labels: [], baseRefOid: item.baseRefOid,
    commits: item.commits.map((commit) => ({ oid: commit.oid, messageHeadline: commit.messageHeadline, authoredDate: '2026-11-01T09:00:00Z', authors: [{ login, name: 'E2E Tester' }] })),
  };
}

function liveState(item) {
  return {
    data: {
      repository: {
        viewerPermission: 'WRITE', mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true, autoMergeAllowed: false, deleteBranchOnMerge: false, viewerDefaultMergeMethod: 'MERGE',
        pullRequest: {
          id: `PR_${item.number}`, number: item.number, state: 'OPEN', isDraft: false, headRefOid: item.headRefOid, headRefName: item.headRefName, baseRefName: item.baseRefName,
          updatedAt: item.updatedAt ?? '2026-11-01T10:00:00Z', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null, isCrossRepository: false,
          isMergeQueueEnabled: false, isInMergeQueue: false, viewerCanUpdate: true, viewerDidAuthor: true, viewerCanUpdateBranch: false, autoMergeRequest: null,
          headRef: { id: `REF_${item.number}`, target: { oid: item.headRefOid } }, headRepositoryOwner: { login: owner },
          headRepository: { id: 'R_1', viewerPermission: 'WRITE', defaultBranchRef: { name: 'main' } }, baseRef: { compare: { behindBy: 0 } },
          latestReviews: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
        },
      },
    },
  };
}

function conversation(item) {
  const comments = (item.conversation ?? []).map((entry, index) => ({
    id: `C_${item.number}_${index}`, body: entry.body, createdAt: `2026-11-01T1${index % 10}:00:00Z`, url: `${url(item.number)}#comment-${index}`, isMinimized: false,
    author: { __typename: entry.bot ? 'Bot' : 'User', login: entry.author, avatarUrl: '' },
  }));
  return { data: { repository: { pullRequest: { comments: { pageInfo: { hasPreviousPage: false }, nodes: comments }, reviews: { pageInfo: { hasPreviousPage: false }, nodes: [] } } } } };
}

const [command, subcommand] = args;
if (command === 'auth' && subcommand === 'status') {
  done({ hosts: { 'github.com': [{ state: 'success', error: '', active: true, host: 'github.com', login, tokenSource: 'keyring', scopes: 'repo, workflow', gitProtocol: 'https' }] } });
}
if (command === 'auth' && subcommand === 'token') done('gho_e2e_stand_in_token\n');
if (command === 'pr' && subcommand === 'list') {
  // A slow GitHub, for journeys that look at what shows while the list is read.
  if (world.pullListDelayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, world.pullListDelayMs);
  const head = option('--head');
  const state = option('--state');
  const open = state === 'open' || state === 'all' || state === undefined;
  done(open ? world.pulls.filter((item) => !head || item.headRefName === head).map(summary) : []);
}
if (command === 'pr' && subcommand === 'view') {
  const item = pull(args[2]);
  if (!item) refuse('GraphQL: Could not resolve to a PullRequest with the number of ' + args[2] + '.');
  done(details(item));
}
if (command === 'pr' && subcommand === 'diff') {
  // What GitHub would send, read from the clone the test set up.
  const item = pull(args[2]);
  if (!item || !world.clone) refuse('HTTP 404: Not Found');
  done(execFileSync('git', ['diff', '--no-color', `${item.baseRefOid}...${item.headRefOid}`], { cwd: world.clone, maxBuffer: 64 * 1024 * 1024 }).toString('utf8'));
}
if (command === 'api') {
  const endpoint = args.slice(1).find((arg) => !arg.startsWith('-') && args[args.indexOf(arg) - 1] !== '--jq' && args[args.indexOf(arg) - 1] !== '--header');
  if (endpoint === 'user') done(args.includes('--jq') ? `${login}\n` : { login });
  if (endpoint === 'graphql') {
    const { query = '', number } = fields();
    const item = number ? pull(number) : null;
    if (/stack\{/.test(query)) {
      const numbers = [...query.matchAll(/pr(\d+):pullRequest/g)].map((match) => match[1]);
      done({ data: { repository: Object.fromEntries(numbers.map((value) => [`pr${value}`, { stack: null, stackEntry: null }])) } });
    }
    if (item && /mergeStateStatus/.test(query)) done(liveState(item));
    if (item && /comments\(/.test(query)) done(conversation(item));
    refuse('HTTP 400: this stand-in does not answer that query');
  }
  if (endpoint === `repos/${world.nameWithOwner}`) {
    done({ name, full_name: world.nameWithOwner, owner: { login: owner }, private: false, default_branch: 'main', permissions: { admin: false, maintain: false, push: true, triage: true, pull: true } });
  }
  if (endpoint?.startsWith(`repos/${world.nameWithOwner}/actions/`)) done({ total_count: 0, workflow_runs: [], workflows: [] });
  refuse('HTTP 404: Not Found (stand-in)');
}
refuse(`unknown command ${JSON.stringify(args)} for the stand-in GitHub CLI`);
