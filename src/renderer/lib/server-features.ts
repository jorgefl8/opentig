import { createContext, useContext } from 'react';
import type { OpenTigServerIdentity } from '@shared/server-protocol';

/**
 * What the connected server can answer beyond what every server of this protocol does. A
 * feature that needs a newer command is offered only when the server says it has it, so a
 * newer client connected to an older server never sends a command that server doesn't know.
 */
export interface ServerFeatures {
  /** `github.getActionJobLog`. */
  actionJobLogs: boolean;
  /** `commits.fileHistory`. */
  fileHistory: boolean;
  /** `github.getPullRequestFiles` and `github.getPullRequestFileDiff`: a pull request's code read file by file. */
  pullRequestFiles: boolean;
  /**
   * Each tab or window has its own open repository: opening one changes no other client, and an
   * address opens its repository at once instead of offering to.
   */
  repositoryPerClient: boolean;
  /** `refs.repairWorktree`. */
  worktreeRepair: boolean;
  /** `github.getCommitAuthorAvatar`. */
  commitAuthorAvatars: boolean;
}

export const NO_SERVER_FEATURES: ServerFeatures = { actionJobLogs: false, fileHistory: false, pullRequestFiles: false, repositoryPerClient: false, worktreeRepair: false, commitAuthorAvatars: false };

export function serverFeatures(identity: OpenTigServerIdentity | undefined): ServerFeatures {
  return {
    actionJobLogs: identity?.actionJobLogs === true,
    fileHistory: identity?.fileHistory === true,
    pullRequestFiles: identity?.pullRequestFiles === true,
    repositoryPerClient: identity?.repositoryPerClient === true,
    worktreeRepair: identity?.worktreeRepair === true,
    commitAuthorAvatars: identity?.commitAuthorAvatars === true,
  };
}

export const ServerFeaturesContext = createContext<ServerFeatures>(NO_SERVER_FEATURES);

export function useServerFeatures(): ServerFeatures {
  return useContext(ServerFeaturesContext);
}
