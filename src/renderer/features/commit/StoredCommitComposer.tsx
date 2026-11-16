import { memo, type ComponentProps } from 'react';
import { CommitComposer } from './CommitComposer';
import { useCommitMessage, type CommitMessageStore } from './commit-message-store';

/** The commit box over the text kept in `store`, so a key pressed in it redraws the box and nothing else. */
export const StoredCommitComposer = memo(function StoredCommitComposer({ store, ...props }: Omit<ComponentProps<typeof CommitComposer>, 'message' | 'onMessage'> & { store: CommitMessageStore }) {
  return <CommitComposer {...props} message={useCommitMessage(store)} onMessage={store.set} />;
});
