/**
 * Each budget covers the slowest path through a command's Git and GitHub CLI
 * steps, plus a margin for the write queue and for reading the result. A command
 * keeps running after its budget ends, so a shorter one reports a failure for
 * work that may still succeed. Keep each outer boundary above the ones it contains.
 */
const STEP_MARGIN_MS = 30_000;

/** `git commit`, whose hooks can take as long as the step allows. */
export const COMMIT_TIMEOUT_MS = 120_000 + STEP_MARGIN_MS;
export const FETCH_TIMEOUT_MS = 120_000 + STEP_MARGIN_MS;
/** Status and publication checks, then `git push`. */
export const PUSH_TIMEOUT_MS = 120_000 + 2 * STEP_MARGIN_MS;
/** Fetch, autostash, pull, rebase abort, then restoring the stash and its fallback. */
export const PULL_TIMEOUT_MS = 120_000 + 120_000 + 120_000 + 60_000 + 120_000 + 120_000 + STEP_MARGIN_MS;
/** Stash, switch, restore the stash, then unstage what it restored. */
export const SWITCH_BRANCH_TIMEOUT_MS = 120_000 + 60_000 + 120_000 + 60_000 + STEP_MARGIN_MS;

/** Killing `git worktree remove` leaves a half-deleted folder, so this only stops a hung process. */
export const REMOVE_WORKTREE_GIT_TIMEOUT_MS = 10 * 60_000;
/** Change counts, the removal, then deleting the branch. */
export const REMOVE_WORKTREE_TIMEOUT_MS = 30_000 + REMOVE_WORKTREE_GIT_TIMEOUT_MS + 30_000 + 2 * STEP_MARGIN_MS;

export const GITHUB_NETWORK_TIMEOUT_MS = 60_000;
/** Up to two GitHub CLI reads, plus resolving the account and stack membership. */
export const GITHUB_READ_TIMEOUT_MS = 2 * GITHUB_NETWORK_TIMEOUT_MS + STEP_MARGIN_MS;
export const PULL_REQUEST_CREATE_TIMEOUT_MS = 120_000 + 2 * STEP_MARGIN_MS;
export const PULL_REQUEST_FETCH_TIMEOUT_MS = 5 * 60_000;
export const PULL_REQUEST_DIFF_GIT_TIMEOUT_MS = 120_000;
/** The PR's details, downloading its head and base, then the diff. */
export const PULL_REQUEST_DIFF_TIMEOUT_MS = GITHUB_NETWORK_TIMEOUT_MS + 2 * PULL_REQUEST_FETCH_TIMEOUT_MS + PULL_REQUEST_DIFF_GIT_TIMEOUT_MS + STEP_MARGIN_MS;
/** The PR's details, downloading its head and base, then the commit list. */
export const PULL_REQUEST_COMMITS_TIMEOUT_MS = GITHUB_NETWORK_TIMEOUT_MS + 2 * PULL_REQUEST_FETCH_TIMEOUT_MS + 60_000 + STEP_MARGIN_MS;

/** A status read that repeats while a PR is open, so a slow GitHub ends quickly. */
export const GITHUB_LIVE_READ_TIMEOUT_MS = 20_000;
/** One GitHub CLI call that changes something. */
export const GITHUB_ACTION_STEP_TIMEOUT_MS = 60_000;
/** Approving workflows checks each run again first, so it stops starting new approvals after this long. */
export const WORKFLOW_APPROVAL_WINDOW_MS = 120_000;
/** Reading the current state, the slowest action, then reading the result. That's approving workflows, whose last run can start as the window ends. */
export const GITHUB_ACTION_TIMEOUT_MS = GITHUB_LIVE_READ_TIMEOUT_MS + WORKFLOW_APPROVAL_WINDOW_MS + GITHUB_LIVE_READ_TIMEOUT_MS + 3 * GITHUB_ACTION_STEP_TIMEOUT_MS + GITHUB_LIVE_READ_TIMEOUT_MS + STEP_MARGIN_MS;

/** The client outlasts the server, so a server-side result or timeout always arrives first. */
export const CLIENT_TIMEOUT_MARGIN_MS = 30_000;
/** Waiting to reconnect stays short: a mutation should not run long after it was requested. */
export const CONNECTION_WAIT_TIMEOUT_MS = 30_000;
