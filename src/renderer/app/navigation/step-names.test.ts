import { describe, expect, it } from 'vitest';
import { EMPTY_MEMORY, type NavigationLocation } from './location';
import { nameStep, type StepNameSources } from './step-names';

const sources: StepNameSources = {
  repositoryId: 'here',
  repositoryName: (id) => id === 'there' ? 'launchpad' : null,
  pullTitle: (id, number) => id === 'there' && number === 24 ? 'Filter tasks by status' : null,
  runTitle: () => null,
};
const at = (repositoryId: string, view: NavigationLocation['view'], selection: NavigationLocation['selection']): NavigationLocation => ({
  repositoryId, view, selection, fileHistory: null, line: null, pane: 'viewer',
});

describe('a step’s name in the lists of Back and Forward', () => {
  it('names the repository only when it is not the one open, and the tab a pull request was left on', () => {
    const memory = { scroll: [], viewer: { tabs: [['there:pull:24', 'diff']] as Array<[string, string]> } };
    expect(nameStep({ location: at('there', 'prs', { type: 'pull-request', number: 24 }), memory }, sources))
      .toEqual({ icon: 'pull-request', title: '#24 Filter tasks by status', detail: 'launchpad · GitHub · Pull request · Code' });
    expect(nameStep({ location: at('here', 'prs', { type: 'pull-request', number: 7 }), memory: EMPTY_MEMORY }, sources))
      .toEqual({ icon: 'pull-request', title: '#7', detail: 'GitHub · Pull request' });
  });

  it('names a commit by its subject when it has one, and a file by its name and folder', () => {
    expect(nameStep({ location: at('here', 'history', { type: 'commit', oid: 'c40a9e2'.padEnd(40, '0'), subject: 'feat: filter tasks' }), memory: EMPTY_MEMORY }, sources).title).toBe('feat: filter tasks');
    // A step read back from history knows only the commit's id.
    expect(nameStep({ location: at('here', 'history', { type: 'commit', oid: 'c40a9e2'.padEnd(40, '0'), subject: 'c40a9e20' }), memory: EMPTY_MEMORY }, sources).title).toBe('Commit c40a9e2');
    expect(nameStep({ location: { ...at('here', 'files', { type: 'file', path: 'src/store/read.js' }), line: 12 }, memory: EMPTY_MEMORY }, sources))
      .toEqual({ icon: 'file', title: 'read.js:12', detail: 'Files · src/store' });
  });

  it('calls a step with nothing open in its section a section, rather than naming the section twice', () => {
    expect(nameStep({ location: { ...at('here', 'prs', null), pane: 'list' }, memory: EMPTY_MEMORY }, sources)).toEqual({ icon: 'github', title: 'GitHub', detail: 'Section' });
    expect(nameStep({ location: { ...at('there', 'history', null), pane: 'list' }, memory: EMPTY_MEMORY }, sources)).toEqual({ icon: 'history', title: 'History', detail: 'launchpad · Section' });
  });
});
