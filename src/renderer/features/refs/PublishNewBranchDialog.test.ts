// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublishNewBranchDialog } from './PublishNewBranchDialog';
import type { NewBranchChoice } from './useBranchPush';

vi.mock('motion/react', async original => ({ ...await original<typeof import('motion/react')>(), useReducedMotion: () => true }));
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function mount(overrides: Partial<NewBranchChoice> = {}) {
  const onConfirm = vi.fn();
  const choice: NewBranchChoice = { id: 'choice', repositoryId: 'repo', label: 'Demo', branch: 'fix/login', oid: 'abc1234'.padEnd(40, '0'), remote: 'origin',
    upstream: { remote: 'origin', branch: 'dev', ahead: 2 }, publishing: false, resolve: vi.fn(), ...overrides };
  const node = document.createElement('div'); document.body.append(node);
  await act(async () => createRoot(node).render(createElement(PublishNewBranchDialog, { choice, onConfirm })));
  const dialog = document.querySelector('[role=dialog]')!;
  const button = (label: string) => [...dialog.querySelectorAll('button')].find(item => item.textContent === label);
  return { dialog, button, onConfirm };
}

it('names the branch’s own destination and the upstream it replaces, never the upstream as a target', async () => {
  const { dialog, button, onConfirm } = await mount();
  expect(dialog.querySelector('h2')?.textContent).toBe('Publish as a new branch?');
  const facts = Object.fromEntries([...dialog.querySelectorAll('dt')].map(term => [term.textContent, term.nextElementSibling?.textContent]));
  expect(facts).toEqual({ Commit: '2 commits · abc1234', Destination: 'origin/fix/login', Upstream: 'origin/dev → origin/fix/login' });
  expect(dialog.querySelector('details code')?.textContent).toBe('git push -u origin HEAD:refs/heads/fix/login');
  await act(async () => button('Publish branch')!.click());
  expect(onConfirm).toHaveBeenLastCalledWith(true);
});

it('keeps both choices off while publishing', async () => {
  const { button } = await mount({ publishing: true });
  expect(button('Cancel')?.disabled).toBe(true);
  expect(button('Publishing…')?.disabled).toBe(true);
});
