import type { CommitAuthorship } from '@shared/commit-authorship';

export function authorshipSourceLabel(source: CommitAuthorship['source']): string {
  return { local: 'Repository Git settings', global: 'Global Git settings', system: 'System Git settings', worktree: 'Worktree Git settings', environment: 'Backend environment', custom: 'Custom author/committer settings', mixed: 'Mixed Git settings', inferred: 'Identity inferred by Git', unset: 'Git identity not configured' }[source];
}
