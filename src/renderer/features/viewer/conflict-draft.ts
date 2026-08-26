export interface ConflictDraftState {
  draft: string;
  persistedContent: string;
  revision: number;
}

export function createConflictDraft(content: string): ConflictDraftState {
  return { draft: content, persistedContent: content, revision: 0 };
}

export function applyConflictDraft(state: ConflictDraftState, content: string): ConflictDraftState {
  if (content === state.draft) return state;
  return { ...state, draft: content, revision: state.revision + 1 };
}

export function markConflictDraftPersisted(state: ConflictDraftState, content: string): ConflictDraftState {
  return state.persistedContent === content ? state : { ...state, persistedContent: content };
}

/**
 * An incoming copy equal to the last disk snapshot is stale relative to a
 * local accepted choice and must not replace the draft. A genuinely new disk
 * value becomes the next editable source.
 */
export function reconcileConflictDraft(state: ConflictDraftState, incomingContent: string): ConflictDraftState {
  if (incomingContent === state.persistedContent) return state;
  return { draft: incomingContent, persistedContent: incomingContent, revision: state.revision + 1 };
}
