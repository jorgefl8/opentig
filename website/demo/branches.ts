import type { BranchInfo } from "../../src/shared/git-types";
import { branchName, daysAgo, hoursAgo, mainOid, repository, sampleHistory, type DemoRepository } from "./model.ts";
import { demoPulls } from "./pulls.ts";

/** The checked-out branch, which follows the commits, pushes, and pulls made in the page. */
export function currentBranch(model: DemoRepository): BranchInfo {
  const head = model.commits[0]!.info;
  return {
    name: branchName,
    fullName: `refs/heads/${branchName}`,
    current: true,
    remote: false,
    upstream: model.upstream,
    ahead: model.ahead(),
    behind: model.behind(),
    worktreePath: repository.path,
    oid: head.oid,
    shortOid: head.shortOid,
    subject: head.subject,
    author: head.author,
    date: head.date,
  };
}
/** A branch that is not checked out: its tip, and when that was committed. */
function otherBranch(name: string, oid: string, subject: string, date: string, remote = false): BranchInfo {
  return {
    name: remote ? `origin/${name}` : name,
    fullName: remote ? `refs/remotes/origin/${name}` : `refs/heads/${name}`,
    current: false,
    remote,
    upstream: remote ? null : `origin/${name}`,
    ahead: 0,
    behind: 0,
    worktreePath: null,
    oid,
    shortOid: oid.slice(0, 7),
    subject,
    author: "OpenTig Demo",
    date,
  };
}
/** The branch of a sample pull request, which ends on that pull request's last commit. */
function pullRequestBranch(number: number, date: string, remote = false) {
  const pull = demoPulls.get(number);
  return otherBranch(pull.headRefName, pull.headRefOid, pull.commits.at(-1)!.messageHeadline, date, remote);
}
const main = (remote = false) => otherBranch("main", mainOid, sampleHistory.find((commit) => commit.oid === mainOid)!.subject, daysAgo(6), remote);
const byName = (a: BranchInfo, b: BranchInfo) => a.name.localeCompare(b.name);

/**
 * Every branch, in the alphabetical order Git lists them: local ones, then the remote's.
 * The last commits of the local branches are spread from hours to months ago, so the
 * branch menu has an order by date to show; the remote lost the closed pull request's branch.
 */
export function sampleBranches(model: DemoRepository): BranchInfo[] {
  const published = model.commits[model.ahead()]!.info;
  return [
    ...[
      currentBranch(model),
      main(),
      pullRequestBranch(25, hoursAgo(5)),
      pullRequestBranch(24, daysAgo(4)),
      pullRequestBranch(23, daysAgo(16)),
      pullRequestBranch(18, daysAgo(75)),
    ].sort(byName),
    ...[
      otherBranch(branchName, published.oid, published.subject, published.date, true),
      main(true),
      pullRequestBranch(25, hoursAgo(5), true),
      pullRequestBranch(24, daysAgo(4), true),
      pullRequestBranch(23, daysAgo(16), true),
      pullRequestBranch(22, daysAgo(9), true),
      pullRequestBranch(20, daysAgo(1), true),
    ].sort(byName),
  ];
}
