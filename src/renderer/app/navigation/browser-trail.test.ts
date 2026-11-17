// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { addressOf } from './address';
import { createBrowserTrail } from './browser-trail';
import type { NavigationEntry, NavigationLocation } from './location';

const at = (view: NavigationLocation['view'], selection: NavigationLocation['selection'] = null): NavigationLocation => ({
  repositoryId: 'repo', view, selection, fileHistory: null, line: null, pane: selection ? 'viewer' : 'list',
});

const trails: Array<{ detach(): void }> = [];
afterEach(() => {
  for (const trail of trails.splice(0)) trail.detach();
  window.sessionStorage.clear();
});

function open() {
  const trail = createBrowserTrail((location) => addressOf(location));
  trail.attach();
  trails.push(trail);
  return trail;
}

/** The step the browser lands on after the trail asked it to move. */
function landed(trail: ReturnType<typeof open>): Promise<NavigationEntry> {
  return new Promise((resolve) => { const stop = trail.onRestore((entry) => { stop(); resolve(entry); }); });
}

describe('the trail kept in the browser’s history, as a list', () => {
  it('lists the steps the page cannot read back from its history, and jumps through the browser to one', async () => {
    const trail = open();
    trail.start(at('files'));
    trail.push(at('history', { type: 'commit', oid: 'a'.repeat(40), subject: 'Split the store' }));
    trail.push(at('prs', { type: 'pull-request', number: 24 }));
    trail.push(at('changes'));
    expect(trail.steps().back.map((step) => [step.location.view, step.offset])).toEqual([['prs', -1], ['history', -2], ['files', -3]]);
    // A commit is named by its subject in the list, which its history entry leaves out.
    expect(trail.steps().back[1]!.location.selection).toMatchObject({ subject: 'Split the store' });

    const arrival = landed(trail);
    trail.go(-2);
    const entry = await arrival;
    expect(entry.location.view).toBe('history');
    expect(window.location.pathname).toBe(`/r/repo/commit/${'a'.repeat(40)}`);
    expect(trail.state()).toEqual({ canGoBack: true, canGoForward: true });
    expect(trail.steps().forward.map((step) => [step.location.view, step.offset])).toEqual([['prs', 1], ['changes', 2]]);
    expect(trail.steps().back[0]!.location.view).toBe('files');

    // A reload starts a new page, which still knows the steps around the one it opens on.
    trail.detach();
    const reloaded = open();
    const opened = reloaded.initial().entry!;
    reloaded.adopt(opened);
    expect(reloaded.steps().back.map((step) => step.location.view)).toEqual(['files']);
    expect(reloaded.steps().forward.map((step) => step.location.view)).toEqual(['prs', 'changes']);
    expect(reloaded.steps().back.length + reloaded.steps().forward.length).toBe(3);
  });

  it('drops the steps that were ahead once a new one is taken', async () => {
    const trail = open();
    trail.start(at('files'));
    trail.push(at('history'));
    trail.push(at('changes'));
    const arrival = landed(trail);
    trail.go(-1);
    await arrival;
    trail.push(at('search'));
    expect(trail.steps().forward).toEqual([]);
    expect(trail.steps().back.map((step) => step.location.view)).toEqual(['history', 'files']);
  });
});

describe('the browser trail across page loads', () => {
  /** The browser's Back or Forward by `offset`, outside any page's trail, as when another page load holds the tab. */
  function traverse(offset: number): Promise<void> {
    return new Promise((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
      window.history.go(offset);
    });
  }
  /** A new page load on the entry the tab shows now. */
  function load() {
    const trail = open();
    const opened = trail.initial().entry!;
    trail.adopt(opened);
    return trail;
  }

  it('never lists the steps of another page load in the same tab, so the row chosen is where the browser goes', async () => {
    const views: NavigationLocation['view'][] = ['files', 'history', 'changes', 'search', 'prs', 'files'];
    const first = open();
    first.start(at(views[0]!));
    for (const view of views.slice(1)) first.push(at(view));
    first.detach();
    // An address pasted into the same tab: a page load with a trail of its own.
    window.history.pushState(null, '', '/r/repo/history');
    const second = load();
    second.push(at('changes'));
    second.push(at('search'));
    second.push(at('files', { type: 'file', path: 'README.md' }));
    expect(second.steps().back.map((step) => step.location.view)).toEqual(['search', 'changes', 'history']);
    second.detach();

    // Four Backs: the first page load's last step, loaded again.
    await traverse(-4);
    const again = load();
    expect(again.steps().back.map((step) => step.location.view)).toEqual(['prs', 'search', 'changes', 'history', 'files']);
    expect(again.steps().forward).toEqual([]);
    const arrival = landed(again);
    again.go(-3);
    expect((await arrival).location.view).toBe('changes');
    expect(again.steps().forward.map((step) => step.location.view)).toEqual(['search', 'prs', 'files']);
  });

  it('drops the steps the browser dropped when a new page load came after an earlier step', async () => {
    const first = open();
    first.start(at('files'));
    first.push(at('history'));
    first.push(at('changes'));
    const arrival = landed(first);
    first.go(-1);
    await arrival;
    first.detach();
    // From History, an address pasted: the browser drops Changes, which was ahead.
    window.history.pushState(null, '', '/r/repo/search');
    load().detach();
    await traverse(-1);
    const again = load();
    expect(again.steps().forward).toEqual([]);
    expect(again.state()).toEqual({ canGoBack: true, canGoForward: false });
  });

  it('starts empty from steps kept in a shape it cannot read, and corrects a kept step the browser shows otherwise', async () => {
    for (const garbage of ['not json', '{"v":2,"steps":"no"}', JSON.stringify({ v: 2, steps: [{ trail: '../x', index: -1, key: 7, location: {} }], tops: [['a', 'b']], last: 'x' })]) {
      window.sessionStorage.setItem('opentig.navigation.steps', garbage);
      const trail = open();
      trail.start(at('files'));
      expect(trail.steps()).toEqual({ back: [], forward: [] });
      trail.detach();
      window.sessionStorage.clear();
    }

    const trail = open();
    trail.start(at('files'));
    trail.push(at('history'));
    trail.push(at('changes'));
    trail.detach();
    // The kept step two back says Search, but the history entry there is Files.
    const kept = JSON.parse(window.sessionStorage.getItem('opentig.navigation.steps')!) as { steps: Array<{ index: number; location: NavigationLocation }> };
    const wrong = kept.steps.reduce((oldest, step) => step.index < oldest.index ? step : oldest);
    wrong.location = at('search');
    window.sessionStorage.setItem('opentig.navigation.steps', JSON.stringify(kept));
    const reloaded = load();
    expect(reloaded.steps().back.map((step) => step.location.view)).toEqual(['history', 'search']);
    const arrival = landed(reloaded);
    reloaded.go(-2);
    expect((await arrival).location.view).toBe('files');
    expect(reloaded.steps().forward.map((step) => step.location.view)).toEqual(['history', 'changes']);
    reloaded.go(2);
    await landed(reloaded);
    expect(reloaded.steps().back.map((step) => step.location.view)).toEqual(['history', 'files']);
  });

  it('lists only the steps the browser’s history still holds, and takes out a step it cannot reach', async () => {
    const trail = createBrowserTrail((location) => addressOf(location), { arrivalMs: 50 });
    trail.attach();
    trails.push(trail);
    trail.start(at('files'));
    for (let step = 0; step < 60; step++) trail.push(at(step % 2 ? 'history' : 'changes'));
    // A browser keeps about fifty entries per tab.
    const length = Object.getOwnPropertyDescriptor(History.prototype, 'length')!;
    Object.defineProperty(window.history, 'length', { configurable: true, get: () => 50 });
    try {
      expect(trail.steps().back).toHaveLength(49);
      // The entry is gone though its length says otherwise: the jump never arrives.
      Object.defineProperty(window.history, 'length', { configurable: true, get: () => 61 });
      const go = window.history.go;
      window.history.go = () => undefined;
      const missed = new Promise<void>((resolve) => { trail.onMissedJump(resolve); });
      trail.go(-55);
      await missed;
      window.history.go = go;
      expect(trail.steps().back).toHaveLength(54);
      expect(trail.steps().back.at(-1)!.offset).toBe(-54);
    } finally {
      Object.defineProperty(window.history, 'length', length);
      delete (window.history as unknown as Record<string, unknown>).length;
    }
  });
});
