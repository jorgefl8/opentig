import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiHarnessId, AiHarnessStatus, GhCliStatus } from '@shared/contracts';
import type { GitToolStatus } from '@shared/onboarding';
import { opentig } from '@/lib/opentig-api';

export type GitHubCheck = 'pending' | 'ready' | 'sign-in' | 'missing' | 'error';

export interface ToolChecks {
  git: GitToolStatus | null;
  github: GitHubCheck;
  /** Every assistant OpenTig knows, as detected on this computer or server. */
  ai: AiHarnessStatus[] | null;
  /** Assistants that are installed and signed in, in display order. */
  assistants: AiHarnessId[] | null;
  checking: boolean;
  recheck(): void;
}

export function githubCheck(status: GhCliStatus): GitHubCheck {
  if (!status.installed) return 'missing';
  if (status.authStatus === 'unauthenticated') return 'sign-in';
  return status.availability === 'ready' ? 'ready' : 'error';
}

export function availableAssistants(statuses: AiHarnessStatus[]): AiHarnessId[] {
  return statuses.filter(status => status.installed && status.authStatus !== 'unauthenticated' && status.availability !== 'error').map(status => status.id);
}

/** Git gates the app; GitHub CLI and AI assistants are optional and checked in parallel. */
export function useToolChecks(): ToolChecks {
  const [git, setGit] = useState<GitToolStatus | null>(null);
  const [github, setGithub] = useState<GitHubCheck>('pending');
  const [ai, setAi] = useState<AiHarnessStatus[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(3);
  const forced = useRef(false);

  // A recheck keeps the previous results on screen until the new ones arrive.
  useEffect(() => {
    let active = true;
    const force = forced.current;
    const settle = () => { if (active) setPending(value => value - 1); };
    setPending(3);
    void opentig.app.gitStatus().then(
      value => { if (active) setGit(value); },
      reason => { if (active) setGit({ state: 'error', platform: 'other', message: reason instanceof Error ? reason.message : 'Could not check Git.' }); },
    ).finally(settle);
    void opentig.github.status(force).then(
      value => { if (active) setGithub(githubCheck(value)); },
      () => { if (active) setGithub('error'); },
    ).finally(settle);
    void opentig.ai.statuses(force).then(
      values => { if (active) setAi(values); },
      () => { if (active) setAi([]); },
    ).finally(settle);
    return () => { active = false; };
  }, [attempt]);

  const recheck = useCallback(() => { forced.current = true; setAttempt(value => value + 1); }, []);
  const assistants = useMemo(() => ai && availableAssistants(ai), [ai]);
  return { git, github, ai, assistants, checking: pending > 0, recheck };
}
