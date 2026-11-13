import { createContext } from 'react';

/** What the Files editor needs from App to show line blame and open its commits. */
export interface LineBlameSettings {
  repositoryId: string;
  /** Bumps when the repository changes, such as after a commit, so blame is read again. */
  revision: number;
  enabled: boolean;
  setEnabled(enabled: boolean): void;
  /** Shows the commit in History, the way selecting it there would. */
  openCommit(oid: string, subject: string): void;
}

export const LineBlameContext = createContext<LineBlameSettings | null>(null);
