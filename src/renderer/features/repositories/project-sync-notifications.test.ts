// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sileo, Toaster } from 'sileo';
import { repositorySyncLoadingToast } from './project-sync';
import { conflictNotificationAction, conflictToastId } from '../changes/conflict-notification';

let root: Root;
let container: HTMLDivElement;
const notices = () => [...container.querySelectorAll<HTMLElement>('[data-sileo-toast]:not([data-exiting="true"])')];
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(700); });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  sileo.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Toaster, { theme: 'light', position: 'bottom-right' })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  sileo.clear();
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['success', 'error'] as const)('keeps push progress and its %s result after the AI notice starts closing', async (outcome) => {
  let finish!: () => void;
  const push = new Promise<void>((resolve, reject) => {
    finish = () => outcome === 'success' ? resolve() : reject(new Error('Remote rejected the push'));
  });
  // Handle the simulated rejection immediately, including Sileo's own promise.
  void push.catch(() => undefined);
  let notification!: Promise<void>;
  await act(async () => { sileo.success({ title: 'Message generated with AI' }); });
  await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(5_300); });
  expect(notices()).toHaveLength(0); // AI notification's exit animation is pending.
  await act(async () => {
    notification = sileo.promise(push, {
      loading: repositorySyncLoadingToast('repo', 'push', 'Pushing commits…'),
      success: { title: '1 commit pushed' },
      error: { title: 'Could not push commits' },
    });
    void notification.catch(() => undefined);
  });
  await settle();
  expect(notices()).toHaveLength(1);
  expect(notices()[0]?.dataset.state).toBe('loading');
  expect(notices()[0]?.textContent).toContain('Pushing commits…');
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(notices()).toHaveLength(1);
  await act(async () => { finish(); await notification.catch(() => undefined); });
  await settle();
  expect(notices()[0]?.dataset.state).toBe(outcome);
  expect(notices()[0]?.textContent).toContain(outcome === 'success' ? '1 commit pushed' : 'Could not push commits');
});

it('keeps a second push visible while the previous push notification finishes closing', async () => {
  let finish!: () => void;
  const push = new Promise<void>((resolve) => { finish = resolve; });
  const previous = repositorySyncLoadingToast('repo', 'push', 'Previous push');
  await act(async () => { sileo.success(previous); });
  await settle();
  await act(async () => {
    sileo.dismiss(previous.id);
    void sileo.promise(push, {
      loading: repositorySyncLoadingToast('repo', 'push', 'Pushing commits…'),
      success: { title: '1 commit pushed' },
      error: { title: 'Could not push commits' },
    });
  });
  await settle();
  expect(notices()).toHaveLength(1);
  expect(notices()[0]?.dataset.state).toBe('loading');
  await act(async () => { finish(); await push; });
  await settle();
  expect(notices()[0]?.textContent).toContain('1 commit pushed');
});

it('dismisses resolved conflicts without closing an in-flight pull or losing its result', async () => {
  let finish!: () => void;
  const pull = new Promise<void>((resolve) => { finish = resolve; });
  let notification!: Promise<void>;
  const conflictId = conflictToastId('repo');
  const conflictToast = { id: conflictId, title: 'Conflict needs resolution', duration: 10_000 };
  await act(async () => {
    sileo.error(conflictToast);
    notification = sileo.promise(pull, {
      loading: repositorySyncLoadingToast('repo', 'pull', 'Pulling changes…'),
      success: { title: '1 commit pulled' },
      error: { title: 'Could not pull changes' },
    });
  });
  await settle();
  expect(notices()).toHaveLength(2);
  expect(notices().some((notice) => notice.textContent?.includes('Conflict needs resolution'))).toBe(true);
  expect(notices().some((notice) => notice.dataset.state === 'loading')).toBe(true);
  await act(async () => {
    if (conflictNotificationAction(['file.ts'], []) === 'dismiss') sileo.dismiss(conflictId);
  });
  await settle();
  expect(notices()).toHaveLength(1);
  expect(notices()[0]?.dataset.state).toBe('loading');
  expect(notices()[0]?.textContent).toContain('Pulling changes…');
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(notices()).toHaveLength(1);
  await act(async () => { finish(); await notification; });
  await settle();
  expect(notices()).toHaveLength(1);
  expect(notices()[0]?.dataset.state).toBe('success');
  expect(notices()[0]?.textContent).toContain('1 commit pulled');
});
