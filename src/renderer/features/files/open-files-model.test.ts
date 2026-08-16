import { describe, expect, it } from 'vitest';
import { MAX_OPEN_FILE_TABS } from '../../../shared/open-files-state';
import {
  applyKeyboardAction,
  closeTab,
  dirtyTabs,
  dirtyTabsUnder,
  draftBytes,
  edgeFades,
  emptyFileSession,
  type FileSession,
  horizontalWheelDelta,
  markTabsPresent,
  moveTab,
  openTab,
  removeTabsUnder,
  renameTabPaths,
  restoreSession,
  serializeSession,
  setTabDirty,
  tabLabels,
} from './open-files-model';

const paths = (session: FileSession) => session.tabs.map((tab) => tab.path);

function open(session: FileSession, path: string, mode: 'preview' | 'pinned' = 'preview'): FileSession {
  return openTab(session, path, mode).session;
}

describe('open files session state machine', () => {
  it('replaces a clean preview and keeps a dirty tab open', () => {
    let session = open(emptyFileSession, 'a.ts');
    expect(paths(session)).toEqual(['a.ts']);
    expect(session.previewPath).toBe('a.ts');

    session = open(session, 'b.ts');
    expect(paths(session)).toEqual(['b.ts']);
    expect(session.activePath).toBe('b.ts');

    session = setTabDirty(session, 'b.ts', true);
    expect(session.previewPath).toBeNull();
    expect(session.tabs[0]).toMatchObject({ pinned: true, dirty: true });

    session = open(session, 'c.ts');
    expect(paths(session)).toEqual(['b.ts', 'c.ts']);
    expect(session.previewPath).toBe('c.ts');
  });

  it('replaces a preview in place rather than reordering the strip', () => {
    let session = open(emptyFileSession, 'pinned.ts', 'pinned');
    session = open(session, 'preview.ts');
    session = moveTab(session, 'preview.ts', 0);
    expect(paths(session)).toEqual(['preview.ts', 'pinned.ts']);

    session = open(session, 'next.ts');
    expect(paths(session)).toEqual(['next.ts', 'pinned.ts']);
  });

  it('pins on double-click open and never duplicates an open path', () => {
    let session = open(emptyFileSession, 'a.ts');
    session = open(session, 'a.ts', 'pinned');
    expect(paths(session)).toEqual(['a.ts']);
    expect(session.previewPath).toBeNull();
    expect(session.tabs[0]?.pinned).toBe(true);

    session = open(session, 'b.ts');
    session = open(session, 'a.ts');
    expect(paths(session)).toEqual(['a.ts', 'b.ts']);
    expect(session.activePath).toBe('a.ts');
    expect(session.previewPath).toBe('b.ts');
  });

  it('opens a pinned tab beside a clean preview instead of replacing it', () => {
    let session = open(emptyFileSession, 'preview.ts');
    expect(session.previewPath).toBe('preview.ts');

    session = open(session, 'pinned.ts', 'pinned');
    expect(paths(session)).toEqual(['preview.ts', 'pinned.ts']);
    expect(session.previewPath).toBe('preview.ts');
    expect(session.activePath).toBe('pinned.ts');

    session = open(session, 'second.ts', 'pinned');
    expect(paths(session)).toEqual(['preview.ts', 'pinned.ts', 'second.ts']);
    expect(session.previewPath).toBe('preview.ts');
  });

  it('selects the right neighbour when the active tab closes', () => {
    let session = open(emptyFileSession, 'a.ts', 'pinned');
    session = open(session, 'b.ts', 'pinned');
    session = open(session, 'c.ts', 'pinned');

    const middle = closeTab(session, 'b.ts');
    expect(middle.activePath).toBe('c.ts');

    const last = closeTab(middle.session, 'c.ts');
    expect(paths(last.session)).toEqual(['a.ts']);
    expect(last.activePath).toBe('a.ts');

    const empty = closeTab(last.session, 'a.ts');
    expect(empty.session.tabs).toEqual([]);
    expect(empty.activePath).toBeNull();
  });

  it('closing an inactive tab leaves the active tab alone', () => {
    let session = open(emptyFileSession, 'a.ts', 'pinned');
    session = open(session, 'b.ts', 'pinned');
    const result = closeTab(session, 'a.ts');
    expect(result.activePath).toBe('b.ts');
    expect(paths(result.session)).toEqual(['b.ts']);
  });

  it('reorders by hand without touching active, preview, dirty state, or order stability', () => {
    let session = open(emptyFileSession, 'a.ts', 'pinned');
    session = open(session, 'b.ts', 'pinned');
    session = setTabDirty(session, 'b.ts', true);
    session = open(session, 'c.ts');

    const moved = moveTab(session, 'c.ts', 0);
    expect(paths(moved)).toEqual(['c.ts', 'a.ts', 'b.ts']);
    expect(moved.activePath).toBe(session.activePath);
    expect(moved.previewPath).toBe('c.ts');
    expect(moved.tabs.find((tab) => tab.path === 'b.ts')?.dirty).toBe(true);

    expect(paths(moveTab(moved, 'c.ts', 99))).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(moveTab(moved, 'c.ts', 0)).toBe(moved);
    expect(moveTab(moved, 'missing.ts', 1)).toBe(moved);
  });

  it('evicts the least recently activated clean tab at the cap, never the active or dirty ones', () => {
    let session = emptyFileSession;
    for (let index = 0; index < MAX_OPEN_FILE_TABS; index += 1) session = open(session, `file-${index}.ts`, 'pinned');
    expect(session.tabs).toHaveLength(MAX_OPEN_FILE_TABS);

    const result = openTab(session, 'overflow.ts', 'pinned');
    expect(result.evictedPath).toBe('file-0.ts');
    expect(result.overCap).toBe(false);
    expect(result.session.tabs).toHaveLength(MAX_OPEN_FILE_TABS);
    expect(paths(result.session)).toContain('overflow.ts');
  });

  it('keeps the new tab and reports the cap when every tab is dirty', () => {
    let session = emptyFileSession;
    for (let index = 0; index < MAX_OPEN_FILE_TABS; index += 1) {
      session = open(session, `file-${index}.ts`, 'pinned');
      session = setTabDirty(session, `file-${index}.ts`, true);
    }
    const result = openTab(session, 'overflow.ts', 'pinned');
    expect(result.overCap).toBe(true);
    expect(result.evictedPath).toBeNull();
    expect(result.session.tabs).toHaveLength(MAX_OPEN_FILE_TABS + 1);
  });

  it('follows renames and moves across nested paths without duplicating tabs', () => {
    let session = open(emptyFileSession, 'src/a.ts', 'pinned');
    session = open(session, 'src/nested/b.ts', 'pinned');
    session = setTabDirty(session, 'src/nested/b.ts', true);

    const renamed = renameTabPaths(session, [{ from: 'src', to: 'lib' }]);
    expect(paths(renamed.session)).toEqual(['lib/a.ts', 'lib/nested/b.ts']);
    expect(renamed.session.activePath).toBe('lib/nested/b.ts');
    expect(renamed.session.tabs[1]?.dirty).toBe(true);
    expect(renamed.renamed.get('src/nested/b.ts')).toBe('lib/nested/b.ts');

    const collided = renameTabPaths(renamed.session, [{ from: 'lib/nested/b.ts', to: 'lib/a.ts' }]);
    expect(paths(collided.session)).toEqual(['lib/a.ts']);
    expect(collided.session.activePath).toBe('lib/a.ts');
  });

  it('closes clean tabs when files disappear but retains dirty ones as missing', () => {
    let session = open(emptyFileSession, 'src/clean.ts', 'pinned');
    session = open(session, 'src/dirty.ts', 'pinned');
    session = setTabDirty(session, 'src/dirty.ts', true);
    session = open(session, 'other.ts', 'pinned');

    const removed = removeTabsUnder(session, ['src']);
    expect(removed.closedPaths).toEqual(['src/clean.ts']);
    expect(removed.retainedPaths).toEqual(['src/dirty.ts']);
    expect(paths(removed.session)).toEqual(['src/dirty.ts', 'other.ts']);
    expect(removed.session.tabs[0]?.missing).toBe(true);

    const again = removeTabsUnder(removed.session, ['src']);
    expect(again.retainedPaths).toEqual([]);

    const restored = markTabsPresent(again.session, new Set(['src/dirty.ts']));
    expect(restored.tabs[0]?.missing).toBe(false);
  });

  it('restores and serializes metadata only', () => {
    const session = restoreSession({
      repositoryId: '0123456789abcdef',
      tabs: [{ path: 'a.ts', pinned: true }, { path: 'b.ts', pinned: false }],
      activePath: 'b.ts',
      previewPath: 'b.ts',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(paths(session)).toEqual(['a.ts', 'b.ts']);
    expect(session.activePath).toBe('b.ts');
    expect(session.previewPath).toBe('b.ts');
    expect(session.tabs.every((tab) => !tab.dirty && !tab.missing)).toBe(true);

    const dirty = setTabDirty(session, 'a.ts', true);
    const serialized = serializeSession(dirty);
    expect(serialized).toEqual({
      tabs: [{ path: 'a.ts', pinned: true }, { path: 'b.ts', pinned: false }],
      activePath: 'b.ts',
      previewPath: 'b.ts',
    });
    expect(JSON.stringify(serialized)).not.toContain('dirty');
    expect(JSON.stringify(serialized)).not.toContain('activatedAt');
    expect(restoreSession(null)).toBe(emptyFileSession);
  });

  it('keeps worktree sessions independent', () => {
    const first = open(emptyFileSession, 'a.ts', 'pinned');
    const second = open(emptyFileSession, 'b.ts', 'pinned');
    expect(paths(first)).toEqual(['a.ts']);
    expect(paths(second)).toEqual(['b.ts']);
  });

  it('disambiguates duplicate basenames with the shortest parent suffix', () => {
    const session = ['src/one/index.ts', 'src/two/index.ts', 'src/app.ts'].reduce((acc, path) => open(acc, path, 'pinned'), emptyFileSession);
    const labels = tabLabels(session.tabs);
    expect(labels.get('src/app.ts')).toEqual({ name: 'app.ts', suffix: null });
    expect(labels.get('src/one/index.ts')).toEqual({ name: 'index.ts', suffix: 'one' });
    expect(labels.get('src/two/index.ts')).toEqual({ name: 'index.ts', suffix: 'two' });
  });

  it('resolves keyboard actions including wraparound and the ends', () => {
    let session = open(emptyFileSession, 'a.ts', 'pinned');
    session = open(session, 'b.ts', 'pinned');
    session = open(session, 'c.ts', 'pinned');

    expect(applyKeyboardAction(session, 'next').session.activePath).toBe('a.ts');
    expect(applyKeyboardAction(session, 'previous').session.activePath).toBe('b.ts');
    expect(applyKeyboardAction(session, 'close').closeRequest).toBe('c.ts');
    expect(paths(applyKeyboardAction(session, 'move-left').session)).toEqual(['a.ts', 'c.ts', 'b.ts']);
    expect(applyKeyboardAction(session, 'move-right').session).toBe(session);
    expect(applyKeyboardAction(emptyFileSession, 'next')).toEqual({ session: emptyFileSession, closeRequest: null });
  });

  it('reports unsaved tabs under a path whether or not they are on screen', () => {
    let session = open(emptyFileSession, 'src/clean.ts', 'pinned');
    session = open(session, 'src/nested/dirty.ts', 'pinned');
    session = setTabDirty(session, 'src/nested/dirty.ts', true);
    session = open(session, 'other/dirty.ts', 'pinned');
    session = setTabDirty(session, 'other/dirty.ts', true);
    session = open(session, 'active.ts', 'pinned');

    expect(dirtyTabsUnder(session, ['src'])).toEqual(['src/nested/dirty.ts']);
    expect(dirtyTabsUnder(session, ['src/nested/dirty.ts'])).toEqual(['src/nested/dirty.ts']);
    expect(dirtyTabsUnder(session, ['src/clean.ts'])).toEqual([]);
    expect(dirtyTabsUnder(session, [])).toEqual([]);
    // A sibling whose name merely starts the same is not under the folder.
    expect(dirtyTabsUnder(session, ['src/nested/dirty'])).toEqual([]);
    expect(dirtyTabsUnder(session, ['src', 'other']).sort()).toEqual(['other/dirty.ts', 'src/nested/dirty.ts']);
    expect(dirtyTabs(session).sort()).toEqual(['other/dirty.ts', 'src/nested/dirty.ts']);
    expect(dirtyTabs(emptyFileSession)).toEqual([]);
  });

  it('estimates draft memory without touching the draft', () => {
    const content = 'abcdef';
    expect(draftBytes(content)).toBe(12);
    expect(draftBytes('')).toBe(0);
    expect(content).toBe('abcdef');
  });
});

describe('open files strip geometry', () => {
  const overflowing = { scrollLeft: 40, clientWidth: 200, scrollWidth: 600 };

  it('converts vertical wheel movement to horizontal only while overflowing', () => {
    expect(horizontalWheelDelta(overflowing, 0, 30)).toBe(30);
    expect(horizontalWheelDelta({ scrollLeft: 0, clientWidth: 600, scrollWidth: 600 }, 0, 30)).toBeNull();
    expect(horizontalWheelDelta(overflowing, 40, 5)).toBeNull();
    expect(horizontalWheelDelta(overflowing, 0, 0)).toBeNull();
  });

  it('shows edge fades only on the overflowing sides', () => {
    expect(edgeFades(overflowing)).toEqual({ start: true, end: true });
    expect(edgeFades({ ...overflowing, scrollLeft: 0 })).toEqual({ start: false, end: true });
    expect(edgeFades({ ...overflowing, scrollLeft: 400 })).toEqual({ start: true, end: false });
    expect(edgeFades({ scrollLeft: 0, clientWidth: 600, scrollWidth: 600 })).toEqual({ start: false, end: false });
  });

});
