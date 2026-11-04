import { lazyWithPreload } from '@/lib/lazy-with-retry';

/**
 * The PR viewer and its code view are downloaded on first use. The list starts
 * the viewer's download as it shows, and a PR's summary the code view's, so
 * opening either neither waits for the code nor shows a loading message.
 */
export const LazyPullRequestViewer = lazyWithPreload(() => import('./PullRequestViewer').then((module) => ({ default: module.PullRequestViewer })));
export const LazyPullRequestDiff = lazyWithPreload(() => import('./PullRequestDiff'));
