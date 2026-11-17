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

describe('the in-memory trail as a list', () => {
  it('lists the steps either way nearest first, and goes straight to one with what it kept', () => {
    const trail = createMemoryTrail();
    trail.start(at('files'));
    trail.push(at('history'));
    const changes = trail.push(at('changes'));
    trail.remember(changes.key, { scroll: [{ area: 'list', path: [0], identity: 'div', top: 120, left: 0 }] });
    trail.push(at('search'));
    expect(trail.steps().back.map((step) => [step.location.view, step.offset])).toEqual([['changes', -1], ['history', -2], ['files', -3]]);
    expect(trail.steps().forward).toEqual([]);

    const restored: Array<{ view: string; top: number | undefined }> = [];
    trail.onRestore((entry) => restored.push({ view: entry.location.view, top: entry.memory.scroll[0]?.top }));
    trail.go(-3);
    trail.go(2);
    expect(restored).toEqual([{ view: 'files', top: undefined }, { view: 'changes', top: 120 }]);
    expect(trail.steps().back.map((step) => step.location.view)).toEqual(['history', 'files']);
    expect(trail.steps().forward.map((step) => [step.location.view, step.offset])).toEqual([['search', 1]]);
  });

  it('ignores a jump past either end', () => {
    const trail = createMemoryTrail();
    trail.start(at('files'));
    trail.push(at('history'));
    const restored: string[] = [];
    trail.onRestore((entry) => restored.push(entry.location.view));
    trail.go(-2);
    trail.go(1);
    expect(restored).toEqual([]);
  });
});
