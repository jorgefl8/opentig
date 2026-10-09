import policy from '../../../docs/ai-writing-policy.md?raw';

/** Shared with development agents through the versioned product writing guide. */
export const AI_WRITING_POLICY = policy.trim();

/** Validate structure, not language or factual claims, which need semantic review. */
export const CONVENTIONAL_TITLE_PATTERN = /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([^()\s]+\))?!?: \S(?:[^\r\n]*\S)?$/u;
