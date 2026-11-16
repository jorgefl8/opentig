// @vitest-environment jsdom
import { act, createElement, memo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStableHandlers } from './use-stable-handlers';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('hands a memoized child the same functions on every render, each calling the latest one', async () => {
  const drawn = vi.fn();
  const said: number[] = [];
  const Child = memo(({ onSay }: { onSay(): void }) => { drawn(); return createElement('button', { 'aria-label': 'Say', onClick: onSay }); });
  function Parent() {
    const [count, setCount] = useState(0);
    const handlers = useStableHandlers({ onSay: () => { said.push(count); } });
    return createElement('div', null,
      createElement('button', { 'aria-label': 'More', onClick: () => setCount((current) => current + 1) }),
      createElement(Child, handlers),
    );
  }
  await act(async () => root.render(createElement(Parent)));
  const press = (name: string) => act(async () => { container.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!.click(); });

  await press('Say');
  await press('More');
  await press('More');
  await press('Say');

  // The child was drawn once, and its handler still read the count of the parent's last render.
  expect(said).toEqual([0, 2]);
  expect(drawn).toHaveBeenCalledTimes(1);
});
