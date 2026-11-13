import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PushResult } from '../../../shared/contracts';
import type { PublicationContext, UpstreamNameMismatch } from '@shared/repository-access';
import { opentig } from '@/lib/opentig-api';
import { publicationKey } from './publication-context';

export interface RemoteChoice {
  id: string;
  repositoryId: string;
  label: string;
  hasUpstream: boolean;
  result: Extract<PushResult, { status: 'remote-required' }>;
  resolve(context: PublicationContext | null): void;
}

/** A branch whose upstream has another name waits for this confirmation before it is published under its own name. */
export interface NewBranchChoice {
  id: string;
  repositoryId: string;
  label: string;
  branch: string;
  oid: string;
  remote: string;
  upstream: UpstreamNameMismatch;
  /** Confirmed, and the push is running. */
  publishing: boolean;
  resolve(confirmed: boolean): void;
}

/** The server owns account/destination configuration; clients never approve or remember it. */
export function useBranchPush() {
  const client = useQueryClient();
  const [choices, setChoices] = useState<RemoteChoice[]>([]);
  const [newBranches, setNewBranches] = useState<NewBranchChoice[]>([]);
  const pending = useRef(new Set<RemoteChoice>());
  const pendingNewBranches = useRef(new Set<NewBranchChoice>());
  useEffect(() => {
    const requests = pending.current;
    const confirmations = pendingNewBranches.current;
    return () => {
      for (const request of requests) request.resolve(null); requests.clear();
      for (const request of confirmations) request.resolve(false); confirmations.clear();
    };
  }, []);
  const publishAsNewBranch = useCallback(async (repositoryId: string, label: string, context: PublicationContext & { upstreamMismatch: UpstreamNameMismatch }): Promise<PushResult | null> => {
    const id = crypto.randomUUID();
    const confirmed = await new Promise<boolean>((resolve) => {
      const request: NewBranchChoice = { id, repositoryId, label, branch: context.branch!, oid: context.oid!, remote: context.remote!, upstream: context.upstreamMismatch, publishing: false, resolve };
      pendingNewBranches.current.add(request); setNewBranches(current => [...current, request]);
    });
    if (!confirmed) return null;
    setNewBranches(current => current.map(request => request.id === id ? { ...request, publishing: true } : request));
    try {
      return await opentig.refs.push(repositoryId, { remote: context.remote!, expectedBranch: context.branch!, expectedOid: context.oid!, asNewBranch: true }, context.id);
    } finally {
      setNewBranches(current => current.filter(request => request.id !== id));
      await client.invalidateQueries({ queryKey: publicationKey(repositoryId) });
    }
  }, [client]);
  const push = useCallback(async (repositoryId: string, label: string): Promise<PushResult | null> => {
    let context = await opentig.refs.pushContext(repositoryId);
    // Pushing would update the upstream's branch; offer the branch's own name instead.
    if (context.blockedReason === 'upstream-name' && context.upstreamMismatch && context.branch && context.oid && context.remote) {
      return publishAsNewBranch(repositoryId, label, { ...context, upstreamMismatch: context.upstreamMismatch });
    }
    if (context.blocked) return { status: 'rejected', reason: 'configuration', message: context.blocked };
    if (!context.branch || !context.oid || !context.remotes.length) return { status: 'rejected', reason: 'configuration', message: 'Choose a branch with commits and configure a remote before publishing.' };
    if (!context.remote) {
      const reviewed = await new Promise<PublicationContext | null>((resolve) => {
        const request: RemoteChoice = { id: crypto.randomUUID(), repositoryId, label, hasUpstream: context.hasUpstream ?? false,
          result: { status: 'remote-required', branch: context.branch!, oid: context.oid!, remotes: context.remote ? [context.remote, ...context.remotes.filter(remote => remote !== context.remote)] : context.remotes }, resolve };
        pending.current.add(request); setChoices(current => [...current, request]);
      });
      if (!reviewed) return null;
      context = reviewed;
    }
    try {
      return await opentig.refs.push(repositoryId, { remote: context.remote!, expectedBranch: context.branch!, expectedOid: context.oid! }, context.id);
    } finally {
      await client.invalidateQueries({ queryKey: publicationKey(repositoryId) });
    }
  }, [client, publishAsNewBranch]);
  const choice = choices[0];
  const finish = (context: PublicationContext | null) => {
    if (!choice) return;
    pending.current.delete(choice); setChoices(current => current.filter(request => request !== choice)); choice.resolve(context);
  };
  const newBranch = newBranches[0];
  const confirmNewBranch = (confirmed: boolean) => {
    if (!newBranch || newBranch.publishing) return;
    pendingNewBranches.current.delete(newBranch);
    // A confirmed choice stays open, publishing, until its push finishes.
    if (!confirmed) setNewBranches(current => current.filter(request => request !== newBranch));
    newBranch.resolve(confirmed);
  };
  return { push, remoteChoice: choice, selectRemote: finish, newBranchChoice: newBranch, confirmNewBranch };
}
