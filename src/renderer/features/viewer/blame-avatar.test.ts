// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LineBlameCommit } from '@shared/line-blame';
import { UNCOMMITTED_OID } from '@shared/line-blame';
import { forgetCommitAuthorAvatars, useCommitAuthorAvatar, type LoadCommitAuthorAvatar } from './blame-avatar';
import { LineBlameCard } from './LineBlame';

const ada: LineBlameCommit = { oid: 'a'.repeat(40), uncommitted: false, authorName: 'Ada Lovelace', authorEmail: 'ada@example.com', authoredAt: '2026-08-12T10:41:00Z', summary: 'Add order totals' };
const grace: LineBlameCommit = { ...ada, oid: 'c'.repeat(40), authorName: 'Grace Hopper', authorEmail: 'grace@example.com', summary: 'Fix rounding in totals' };
const ADA_PICTURE = 'https://avatars.githubusercontent.com/u/1?v=4&s=64';
const GRACE_PICTURE = 'https://avatars.githubusercontent.com/u/2?v=4&s=64';
const preload = async () => undefined;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  forgetCommitAuthorAvatars();
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

/** The card as the blame layer shows it, with the picture its hook has so far. */
function Card({ commit, open = true, load }: { commit: LineBlameCommit; open?: boolean; load: LoadCommitAuthorAvatar }) {
  const avatar = useCommitAuthorAvatar({ enabled: open, repositoryId: 'repo', commit, load, preload });
  return createElement(LineBlameCard, { blame: { commit, originalLine: 4 }, now: Date.parse('2026-11-18T12:00:00Z'), avatar, onOpenCommit: () => undefined });
}

async function render(props: Parameters<typeof Card>[0]) {
  await act(async () => root.render(createElement(Card, props)));
}

function deferred() {
  const answers = new Map<string, (url: string | null) => void>();
  const load = vi.fn<LoadCommitAuthorAvatar>((_repositoryId, oid) => new Promise((resolve) => { answers.set(oid, resolve); }));
  const answer = async (oid: string, url: string | null) => { await act(async () => { answers.get(oid)?.(url); }); };
  return { load, answer };
}

const avatarBox = () => container.querySelector('.line-blame-card-avatar');
const picture = () => avatarBox()?.querySelector('img')?.getAttribute('src') ?? null;

it('opens at once with the placeholder in place of the picture, which replaces it once it arrives', async () => {
  const { load, answer } = deferred();
  await render({ commit: ada, load });
  expect(container.textContent).toContain('Ada Lovelace');
  expect(avatarBox()?.querySelector('svg')).not.toBeNull();
  expect(picture()).toBeNull();
  await answer(ada.oid, ADA_PICTURE);
  expect(picture()).toBe(ADA_PICTURE);
  expect(avatarBox()?.querySelector('svg')).toBeNull();
});

it('drops a late answer for a commit the card no longer shows', async () => {
  const { load, answer } = deferred();
  await render({ commit: ada, load });
  await render({ commit: grace, load });
  await answer(ada.oid, ADA_PICTURE);
  expect(container.textContent).toContain('Grace Hopper');
  expect(picture()).toBeNull();
  await answer(grace.oid, GRACE_PICTURE);
  expect(picture()).toBe(GRACE_PICTURE);
});

it('asks only while the card is open, and keeps the placeholder when there is no picture', async () => {
  const { load, answer } = deferred();
  await render({ commit: ada, open: false, load });
  expect(load).not.toHaveBeenCalled();
  await render({ commit: ada, load });
  await answer(ada.oid, null);
  expect(avatarBox()?.querySelector('svg')).not.toBeNull();
});

it('shows a picture already loaded at once on another commit by the same author', async () => {
  const { load, answer } = deferred();
  await render({ commit: ada, load });
  await answer(ada.oid, ADA_PICTURE);
  await render({ commit: { ...ada, oid: 'b'.repeat(40) }, load });
  expect(picture()).toBe(ADA_PICTURE);
  expect(load).toHaveBeenCalledTimes(1);
});

it('has no picture for lines that are not committed yet', async () => {
  const load = vi.fn<LoadCommitAuthorAvatar>(async () => ADA_PICTURE);
  await render({ commit: { ...ada, oid: UNCOMMITTED_OID, uncommitted: true }, load });
  expect(container.textContent).toContain('Not committed yet');
  expect(avatarBox()).toBeNull();
  expect(load).not.toHaveBeenCalled();
});
