import { describe, expect, it } from 'vitest';
import type { NavigationLocation } from './location';
import { createMemoryTrail } from './trail';

const at = (view: NavigationLocation['view']): NavigationLocation => ({ repositoryId: 'repo', view, selection: null, fileHistory: null, line: null, pane: 'list' });

describe('the in-memory trail', () => {
  it('keeps only its newest steps, so Back stops at the oldest one kept', () => {
    const trail = createMemoryTrail(3);
    trail.start(at('files'));
    trail.push(at('history'));
    trail.push(at('changes'));
    trail.push(at('search'));
    const restored: string[] = [];
    trail.onRestore((entry) => restored.push(entry.location.view));
    trail.back();
    trail.back();
    trail.back();
    expect(restored).toEqual(['changes', 'history']);
    expect(trail.state()).toEqual({ canGoBack: false, canGoForward: true });
  });

  it('drops the steps ahead when a new one is taken from the middle', () => {
    const trail = createMemoryTrail();
    trail.start(at('files'));
    trail.push(at('history'));
    trail.push(at('changes'));
    trail.back();
    trail.push(at('search'));
    expect(trail.state()).toEqual({ canGoBack: true, canGoForward: false });
    const restored: string[] = [];
    trail.onRestore((entry) => restored.push(entry.location.view));
    trail.forward();
    trail.back();
    trail.back();
    expect(restored).toEqual(['history', 'files']);
  });
});
