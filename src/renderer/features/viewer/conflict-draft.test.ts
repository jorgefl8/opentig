import { describe, expect, it } from 'vitest';
import {
  applyConflictDraft, createConflictDraft, markConflictDraftPersisted, reconcileConflictDraft,
} from './conflict-draft';

describe('conflict draft reconciliation', () => {
  it('does not restore stale conflict markers after accepting a side', () => {
    const original = '<<<<<<< current\nours\n=======\ntheirs\n>>>>>>> incoming\n';
    const accepted = applyConflictDraft(createConflictDraft(original), 'theirs\n');

    expect(reconcileConflictDraft(accepted, original)).toBe(accepted);
    expect(reconcileConflictDraft(accepted, original).draft).toBe('theirs\n');
  });

  it('recognizes the saved choice when the refreshed file arrives', () => {
    const original = '<<<<<<< current\nours\n=======\ntheirs\n>>>>>>> incoming\n';
    const accepted = applyConflictDraft(createConflictDraft(original), 'theirs\n');
    const persisted = markConflictDraftPersisted(accepted, 'theirs\n');

    expect(reconcileConflictDraft(persisted, 'theirs\n')).toBe(persisted);
  });

  it('adopts a genuinely different external version', () => {
    const state = markConflictDraftPersisted(applyConflictDraft(createConflictDraft('markers'), 'ours'), 'ours');
    expect(reconcileConflictDraft(state, 'external')).toEqual({ draft: 'external', persistedContent: 'external', revision: 2 });
  });
});
