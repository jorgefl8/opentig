import { execFileSync } from 'node:child_process';
import { publishedGuides } from '../docs.config.mjs';

/** Repository-root paths whose commits change each public page's content. */
export const pageSources = {
  '/': ['website/src/pages/index.astro', 'website/src/components/landing', 'website/src/site.ts'],
  '/docs/': ['website/src/content/docs/index.md'],
  ...Object.fromEntries(Object.entries(publishedGuides).map(([slug, guide]) => [`/docs/${slug}/`, [guide.source]])),
};

// Bundled builds move this module, so Git runs from the working directory and `:(top)` paths start at the repository root.
const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * When each page's sources last changed on the current branch, as strict ISO 8601.
 * Following first parents dates a merged change by its merge, when it reached the branch.
 * Dates come from Git history, never from the build time. A shallow clone or missing Git
 * cannot tell when a file last changed, so pages then have no date instead of a wrong one.
 */
export function readPageDates(sources = pageSources) {
  try {
    if (git(['rev-parse', '--is-shallow-repository']) !== 'false') throw new Error('shallow clone');
    return new Map(Object.entries(sources)
      .map(([path, files]) => [path, git(['log', '-1', '--first-parent', '--format=%cI', '--', ...files.map((file) => `:(top)${file}`)])])
      .filter(([, date]) => date));
  } catch {
    console.warn('Page modification dates are omitted: complete Git history is unavailable.');
    return new Map();
  }
}

let dates;
export const pageDates = () => dates ??= readPageDates();
