import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PushResult } from '../../../shared/contracts';
import type { PublicationContext } from '@shared/repository-access';
import { opentig } from '@/lib/opentig-api';
import { publicationIdentity, publicationKey } from './publication-context';

export interface RemoteChoice {
  id: string;
  repositoryId: string;
  label: string;
  result: Extract<PushResult, { status: 'remote-required' }>;
  resolve(context: PublicationContext | null): void;
}

/** Each concurrent project push owns its original repository and reviewed context. */
export function useBranchPush() {
  const client = useQueryClient();
  const [choices, setChoices] = useState<RemoteChoice[]>([]);
  const pending = useRef(new Set<RemoteChoice>());
  useEffect(() => {
    const requests = pending.current;
    return () => { for (const request of requests) request.resolve(null); requests.clear(); };
  }, []);
  const push = useCallback(async (repositoryId: string, label: string): Promise<PushResult | null> => {
    const cached = client.getQueriesData<PublicationContext>({ queryKey: publicationKey(repositoryId) }).map(([, data]) => data).filter(Boolean).at(-1);
    let context = await opentig.refs.pushContext(repositoryId);
    if (context.blocked) return { status: 'rejected', reason: 'configuration', message: context.blocked };
    if (!context.branch || !context.oid || !context.remotes.length) return { status: 'rejected', reason: 'configuration', message: 'Choose a branch with commits and configure a remote before publishing.' };
    if (!context.remote || !cached || publicationIdentity(cached) !== publicationIdentity(context)) {
      const reviewed = await new Promise<PublicationContext | null>((resolve) => {
        const request: RemoteChoice = { id: crypto.randomUUID(), repositoryId, label,
          result: { status: 'remote-required', branch: context.branch!, oid: context.oid!, remotes: context.remote ? [context.remote, ...context.remotes.filter(remote => remote !== context.remote)] : context.remotes }, resolve };
        pending.current.add(request); setChoices(current => [...current, request]);
      });
      if (!reviewed) return null;
      context = reviewed;
    }
    client.setQueryData(publicationKey(repositoryId), context);
    return opentig.refs.push(repositoryId, { remote: context.remote!, expectedBranch: context.branch!, expectedOid: context.oid! }, context.id);
  }, [client]);
  const choice = choices[0];
  const finish = (context: PublicationContext | null) => {
    if (!choice) return;
    pending.current.delete(choice); setChoices(current => current.filter(request => request !== choice)); choice.resolve(context);
  };
  return { push, remoteChoice: choice, selectRemote: finish };
}
