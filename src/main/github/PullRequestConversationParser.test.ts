import { describe, expect, it } from 'vitest';
import { parsePullRequestConversation } from './PullRequestConversationParser';

const author = (login: string, kind = 'User') => ({ __typename: kind, login, avatarUrl: `https://example.invalid/${login}.png` });
const comment = (id: string, createdAt: string, overrides: object = {}) => ({ id, body: `Comment ${id}`, createdAt, url: `https://github.com/sample/demo/pull/1#${id}`, isMinimized: false, author: author('ana'), ...overrides });
const review = (id: string, state: string, submittedAt: string | null, overrides: object = {}) => ({ id, state, body: '', submittedAt, createdAt: '2026-01-01T00:00:00Z', url: `https://github.com/sample/demo/pull/1#${id}`, isMinimized: false, author: author('ben'), ...overrides });
const page = (nodes: unknown[], hasPreviousPage = false) => ({ pageInfo: { hasPreviousPage }, nodes });
const response = (comments: unknown[], reviews: unknown[], extra: object = {}) => JSON.stringify({ data: { repository: { pullRequest: { comments: page(comments), reviews: page(reviews) } } }, ...extra });

describe('parsePullRequestConversation', () => {
  it('merges comments and reviews, oldest first', () => {
    const parsed = parsePullRequestConversation(response([comment('c2', '2026-01-03T00:00:00Z'), comment('c1', '2026-01-01T00:00:00Z')], [review('r1', 'APPROVED', '2026-01-02T00:00:00Z')]));
    expect(parsed?.entries.map(entry => entry.id)).toEqual(['c1', 'r1', 'c2']);
    expect(parsed?.entries[1]).toMatchObject({ kind: 'review', verdict: 'APPROVED', author: { login: 'ben', isBot: false } });
    expect(parsed?.entries[0]).toMatchObject({ kind: 'comment', verdict: null, body: 'Comment c1', url: expect.stringContaining('#c1') });
  });

  it('recognises bots from GitHub\'s own type, whatever their name', () => {
    const parsed = parsePullRequestConversation(response([comment('c1', '2026-01-01T00:00:00Z', { author: author('github-actions', 'Bot') }), comment('c2', '2026-01-02T00:00:00Z', { author: author('robot-fan') })], []));
    expect(parsed?.entries.map(entry => entry.author?.isBot)).toEqual([true, false]);
  });

  it('leaves out the viewer\'s own pending review', () => {
    expect(parsePullRequestConversation(response([], [review('r1', 'PENDING', null)]))?.entries).toEqual([]);
  });

  it('keeps entries from deleted accounts and marks hidden ones', () => {
    const parsed = parsePullRequestConversation(response([comment('c1', '2026-01-01T00:00:00Z', { author: null, isMinimized: true })], []));
    expect(parsed?.entries[0]).toMatchObject({ author: null, minimized: true });
  });

  describe('what the viewer can change', () => {
    const allowed = { viewerDidAuthor: true, viewerCanUpdate: true, viewerCanDelete: true };
    const reviewEntry = (state: string, overrides: object) => parsePullRequestConversation(response([], [review('r1', state, '2026-01-01T00:00:00Z', { body: 'Text', ...allowed, ...overrides })]))?.entries[0];

    it('lets the viewer edit and delete their own comment, and reads its version', () => {
      const parsed = parsePullRequestConversation(response([comment('c1', '2026-01-01T00:00:00Z', { updatedAt: '2026-01-02T00:00:00Z', lastEditedAt: '2026-01-02T00:00:00Z', ...allowed })], []));
      expect(parsed?.entries[0]).toMatchObject({ canEdit: true, canDelete: true, edited: true, updatedAt: '2026-01-02T00:00:00Z' });
    });

    it("doesn't offer other people's text, even when GitHub allows a maintainer to change it", () => {
      const parsed = parsePullRequestConversation(response([comment('c1', '2026-01-01T00:00:00Z', { ...allowed, viewerDidAuthor: false })], []));
      expect(parsed?.entries[0]).toMatchObject({ canEdit: false, canDelete: false });
    });

    it('respects what GitHub refuses, and treats missing permissions as refused', () => {
      expect(reviewEntry('COMMENTED', { viewerCanUpdate: false, viewerCanDelete: false })).toMatchObject({ canEdit: false, canDelete: false });
      expect(parsePullRequestConversation(response([comment('c1', '2026-01-01T00:00:00Z')], []))?.entries[0]).toMatchObject({ canEdit: false, canDelete: false, edited: false, updatedAt: '2026-01-01T00:00:00Z' });
    });

    it("never deletes a review, because GitHub refuses even while reporting that it can", () => {
      for (const state of ['COMMENTED', 'APPROVED', 'CHANGES_REQUESTED']) expect(reviewEntry(state, {})).toMatchObject({ canEdit: true, canDelete: false });
    });

    it('has nothing to edit in a review without text', () => {
      expect(reviewEntry('APPROVED', { body: '' })).toMatchObject({ canEdit: false, canDelete: false });
    });
  });

  it('says when GitHub has more than one page', () => {
    const truncated = JSON.stringify({ data: { repository: { pullRequest: { comments: page([], true), reviews: page([]) } } } });
    expect(parsePullRequestConversation(truncated)?.truncated).toBe(true);
    expect(parsePullRequestConversation(response([], []))?.truncated).toBe(false);
  });

  it('keeps what it can when a nested field was withheld', () => {
    const partial = JSON.stringify({ data: { repository: { pullRequest: { comments: page([comment('c1', '2026-01-01T00:00:00Z')]), reviews: null } } }, errors: [{ type: 'FORBIDDEN', path: ['repository', 'pullRequest', 'reviews'] }] });
    expect(parsePullRequestConversation(partial)).toMatchObject({ partial: true, entries: [{ id: 'c1' }] });
  });

  it.each([
    ['empty output', ''],
    ['invalid JSON', 'nope'],
    ['an HTTP error body', JSON.stringify({ message: 'Bad credentials' })],
    ['a missing PR', JSON.stringify({ data: { repository: { pullRequest: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'pullRequest'] }] })],
    ['another kind of error', response([], [], { errors: [{ type: 'INTERNAL', path: ['repository', 'pullRequest', 'comments'] }] })],
    ['a malformed entry', response([{ id: 'c1' }], [])],
  ])('reports %s as unusable', (_name, raw) => {
    expect(parsePullRequestConversation(raw)).toBeNull();
  });
});
