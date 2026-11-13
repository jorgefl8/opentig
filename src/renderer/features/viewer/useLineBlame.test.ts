// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LineBlameResult } from '@shared/line-blame';
import { LINE_BLAME_MAX_BYTES } from '@shared/line-blame';
import { DRAFT_BLAME_DELAY_MS, useLineBlame } from './useLineBlame';

const ready: LineBlameResult = { status: 'ready', commits: [], lines: [] };
let root: Root;
let container: HTMLDivElement;
let seen: (LineBlameResult | null)[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  container = document.createElement('div');
  root = createRoot(container);
  seen = [];
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Props = Parameters<typeof useLineBlame>[0];
function Probe(props: Props) {
  seen.push(useLineBlame(props));
  return null;
}

async function render(props: Partial<Props> & Pick<Props, 'load'>) {
  await act(async () => root.render(createElement(Probe, { enabled: true, repositoryId: 'repo', path: 'src/totals.ts', revision: 1, text: 'saved\n', savedText: 'saved\n', ...props })));
}

const latest = () => seen.at(-1);

it('blames the saved file without sending its text', async () => {
  const load = vi.fn(async () => ready);
  await render({ load });
  expect(load).toHaveBeenCalledWith('repo', 'src/totals.ts', undefined);
  expect(latest()).toBe(ready);
});

it('hides blame while typing and blames the draft once typing pauses', async () => {
  const load = vi.fn(async () => ready);
  await render({ load });
  await render({ load, text: 'saved\nedit\n' });
  expect(latest()).toBeNull();
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(DRAFT_BLAME_DELAY_MS); });
  expect(load).toHaveBeenLastCalledWith('repo', 'src/totals.ts', 'saved\nedit\n');
  expect(latest()).toBe(ready);
});

it('reads blame again when the repository changes, and not at all when disabled', async () => {
  const load = vi.fn(async () => ready);
  await render({ load, enabled: false });
  expect(load).not.toHaveBeenCalled();
  expect(latest()).toBeNull();
  await render({ load });
  await render({ load, revision: 2 });
  expect(load).toHaveBeenCalledTimes(2);
});

it('shows nothing when blame fails and skips drafts over the size limit', async () => {
  await render({ load: async () => { throw new Error('offline'); } });
  expect(latest()).toBeNull();
  const load = vi.fn(async () => ready);
  const huge = 'x'.repeat(LINE_BLAME_MAX_BYTES + 1);
  await render({ load, text: huge });
  await act(async () => { vi.advanceTimersByTime(DRAFT_BLAME_DELAY_MS); });
  expect(load).not.toHaveBeenCalled();
  expect(latest()).toEqual({ status: 'too-large', limitBytes: LINE_BLAME_MAX_BYTES });
});
