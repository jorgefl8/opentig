import { useCallback, useEffect, useRef, useState } from 'react';
import type { PushResult } from '../../../shared/contracts';
import { opentig } from '@/lib/opentig-api';

export interface RemoteChoice {
  id: string;
  label: string;
  result: Extract<PushResult, { status: 'remote-required' }>;
  resolve(remote: string | null): void;
}

/** All push entry points share remote selection, including concurrent project pushes. */
export function useBranchPush() {
  const [choices, setChoices] = useState<RemoteChoice[]>([]);
  const pending = useRef(new Set<RemoteChoice>());
  useEffect(() => {
    const requests = pending.current;
    return () => { for (const request of requests) request.resolve(null); requests.clear(); };
  }, []);

  const push = useCallback(async (repositoryId: string, label: string): Promise<PushResult | null> => {
    const result = await opentig.refs.push(repositoryId);
    if (result.status !== 'remote-required') return result;
    const remote = await new Promise<string | null>((resolve) => {
      const request: RemoteChoice = { id: crypto.randomUUID(), label, result, resolve };
      pending.current.add(request);
      setChoices((current) => [...current, request]);
    });
    if (!remote) return null;
    return opentig.refs.push(repositoryId, { remote, expectedBranch: result.branch, expectedOid: result.oid });
  }, []);

  const choice = choices[0];
  const finish = (remote: string | null) => {
    if (!choice) return;
    pending.current.delete(choice);
    setChoices((current) => current.filter((request) => request !== choice));
    choice.resolve(remote);
  };
  return {
    push,
    remoteChoice: choice,
    selectRemote: finish,
  };
}
