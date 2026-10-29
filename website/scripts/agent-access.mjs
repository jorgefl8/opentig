// Dependency-free: shared by the build, its validator and the Worker.

// Content Signals (https://contentsignals.org/): allow search, answers and training.
export const contentSignals = 'search=yes, ai-input=yes, ai-train=yes';

// Each HTML route ending in "/" has a Markdown twin at "<route>index.md" for agents.
// The Worker serves it for `Accept: text/markdown`; pages also link to it directly.
export const markdownPath = route => {
  if (!route.startsWith('/') || !route.endsWith('/')) throw new Error(`Markdown routes need a trailing slash: ${route}`);
  return `${route}index.md`;
};
