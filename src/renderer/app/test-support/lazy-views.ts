/**
 * App and Toolbar load these views lazily. Importing them before a test makes
 * each `lazy()` resolve from the module cache, so waits for mocked work do not
 * also depend on how long the first transform of a view takes under load.
 */
export function preloadLazyViews(): Promise<unknown> {
  return Promise.all([
    import('@/features/viewer/Viewer'),
    import('@/features/files/FilesView'),
    import('@/features/history/HistoryView'),
    import('@/features/search/SearchView'),
    import('@/features/pulls/PullRequestsView'),
    import('@/features/files/QuickOpenDialog'),
    import('@/features/pulls/CreatePullRequestDialog'),
    import('@/features/settings/SettingsDialog'),
    import('@/features/refs/LocalRefsDialog'),
    import('@/features/repositories/RepositoryProjectsDialog'),
  ]);
}
