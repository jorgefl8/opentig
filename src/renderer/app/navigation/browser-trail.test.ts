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
