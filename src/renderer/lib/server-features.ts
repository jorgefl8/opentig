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
}

export const NO_SERVER_FEATURES: ServerFeatures = { actionJobLogs: false, fileHistory: false };

export function serverFeatures(identity: OpenTigServerIdentity | undefined): ServerFeatures {
  return { actionJobLogs: identity?.actionJobLogs === true, fileHistory: identity?.fileHistory === true };
}

export const ServerFeaturesContext = createContext<ServerFeatures>(NO_SERVER_FEATURES);

export function useServerFeatures(): ServerFeatures {
  return useContext(ServerFeaturesContext);
}
