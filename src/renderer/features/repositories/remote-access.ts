import type { RemoteAccessProblem } from '@shared/repository-access';

export type RemoteAccessAction =
  | { kind: 'use-account'; login: string }
  | { kind: 'push-again'; login: string }
  | { kind: 'sso'; url: string }
  | { kind: 'settings' };

/** Plain-language explanation of a GitHub access failure and the action most likely to fix it. */
export function remoteAccessCopy(problem: RemoteAccessProblem): { summary: string; detail: string; action: RemoteAccessAction } {
  const repository = problem.repository;
  const organisation = repository.split('/')[0] ?? repository;
  if (problem.switchedTo) {
    return { summary: `This repository now uses @${problem.switchedTo}, which can access ${repository}.`,
      detail: problem.login ? `@${problem.login} couldn’t access it.` : 'The previous credentials couldn’t access it.',
      action: { kind: 'push-again', login: problem.switchedTo } };
  }
  if (problem.sso) {
    return { summary: `${organisation} requires single sign-on${problem.login ? ` for @${problem.login}` : ''}.`,
      detail: `Authorize GitHub CLI for ${organisation} on GitHub, then try again.`,
      action: { kind: 'sso', url: `https://github.com/orgs/${encodeURIComponent(organisation)}/sso` } };
  }
  const who = problem.transport === 'ssh' ? 'Your SSH key' : problem.login ? `@${problem.login}` : 'Git’s own credentials';
  const summary = `${who} can’t access ${repository}.`;
  const candidate = problem.candidates[0];
  if (candidate) return { summary, detail: `@${candidate} can access it.`, action: { kind: 'use-account', login: candidate } };
  return { summary,
    detail: problem.transport === 'ssh'
      ? 'Add your SSH key to a GitHub account with access to this repository, or ask for access.'
      : 'None of your connected accounts can access it. Connect the account that has access, or ask for access to the repository.',
    action: { kind: 'settings' } };
}

export function remoteAccessActionLabel(action: RemoteAccessAction): string {
  switch (action.kind) {
    case 'use-account': return `Use @${action.login}`;
    case 'push-again': return `Push with @${action.login}`;
    case 'sso': return 'Authorize on GitHub';
    default: return 'Repository access';
  }
}
