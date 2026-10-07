// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RepositoryOrganization } from '../../../shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { buildRepositoryPickerModel, getRepositoryPickerDisplayOrder } from './repository-select-model';
import { RepositoryProjectsDialog } from './RepositoryProjectsDialog';

const api = vi.hoisted(() => ({ moveProject: vi.fn(), moveRepository: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { projects: api, repository: { browseDirectories: vi.fn() } } }));
let root: Root;
let container: HTMLDivElement;
let organization: RepositoryOrganization;
const changed = vi.fn();
const button = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(item => item.getAttribute('aria-label') === name)!;
const names = () => Array.from(document.querySelectorAll('.repository-assignment-copy strong')).map(item => item.textContent);
async function click(name: string) { await act(async () => button(name).click()); }
function Harness() {
  const [state, setState] = useState(organization);
  const repositories = getRepositoryPickerDisplayOrder(buildRepositoryPickerModel(state.recentRepositories, state.repositoryProjects));
  return createElement(RepositoryProjectsDialog, {
    open: true, projects: state.repositoryProjects, repositories, onOpenChange: vi.fn(),
    onForgetRepository: vi.fn(), onRelocateRepository: vi.fn(),
    onOrganizationChange: (next) => { changed(next); setState(next); },
  });
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  organization = {
    recentRepositories: ['Atlas', 'Beacon', 'Cedar', 'Delta'].map((name, i) => ({
      id: `repo-${i}`, name, repositoryName: name, path: `/sample/${name.toLowerCase()}`, commonDir: `/sample/${name.toLowerCase()}/.git`, lastOpenedAt: '2026-01-01T00:00:00Z',
    })),
    repositoryProjects: [
      { id: 'apps', name: 'Apps', repositoryKeys: ['/sample/atlas/.git', '/sample/beacon/.git'] },
      { id: 'tools', name: 'Tools', repositoryKeys: [] },
    ],
  };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(Harness))));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it('saves project order and repository order within assigned and unassigned groups, then updates their displayed numbers', async () => {
  expect(button('Move project Apps up').disabled).toBe(true);
  expect(button('Move project Tools down').disabled).toBe(true);
  organization = { ...organization, repositoryProjects: [...organization.repositoryProjects].reverse() };
  api.moveProject.mockResolvedValueOnce(organization);
  await click('Move project Tools up');
  expect(api.moveProject).toHaveBeenCalledExactlyOnceWith('tools', 0);
  expect(Array.from(document.querySelectorAll('.repository-project-copy strong')).map(item => item.textContent)).toEqual(['Tools', 'Apps']);
  expect(button('Move repository Beacon down').disabled).toBe(true);
  organization = { ...organization, repositoryProjects: organization.repositoryProjects.map(project => project.id === 'apps' ? { ...project, repositoryKeys: [...project.repositoryKeys].reverse() } : project) };
  api.moveRepository.mockResolvedValueOnce(organization);
  await click('Move repository Beacon up');
  expect(api.moveRepository).toHaveBeenLastCalledWith('/sample/beacon/.git', 0);
  expect(names()).toEqual(['Beacon', 'Atlas', 'Cedar', 'Delta']);
  const recents = [...organization.recentRepositories];
  [recents[2], recents[3]] = [recents[3]!, recents[2]!];
  organization = { ...organization, recentRepositories: recents };
  api.moveRepository.mockResolvedValueOnce(organization);
  await click('Move repository Delta up');
  expect(api.moveRepository).toHaveBeenLastCalledWith('/sample/delta/.git', 0);
  expect(names()).toEqual(['Beacon', 'Atlas', 'Delta', 'Cedar']);
  expect(Array.from(document.querySelectorAll('.repository-order-number')).map(item => item.textContent)).toEqual(['1', '2', '3', '4']);
  expect(changed).toHaveBeenCalledTimes(3);
});

it('prevents concurrent moves and preserves the visible order if saving fails', async () => {
  let fail!: (reason: Error) => void;
  api.moveRepository.mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
  await click('Move repository Beacon up');
  expect(button('Move repository Atlas down').disabled).toBe(true);
  expect(button('Reorder project Apps').disabled).toBe(true);
  expect(button('Close project management').disabled).toBe(true);
  await click('Move repository Atlas down');
  expect(api.moveRepository).toHaveBeenCalledOnce();
  await act(async () => fail(new Error('Could not save the order.')));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not save the order.');
  expect(names()).toEqual(['Atlas', 'Beacon', 'Cedar', 'Delta']);
  expect(changed).not.toHaveBeenCalled();
  expect(button('Move repository Atlas down').disabled).toBe(false);
});

it('lets arrow keys from sortable handles reach the keyboard sensor outside the dialog', async () => {
  const listener = vi.fn();
  document.addEventListener('keydown', listener);
  try {
    const handle = button('Reorder repository Atlas');
    handle.focus();
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true })));
    expect(listener).toHaveBeenCalledOnce();
  } finally { document.removeEventListener('keydown', listener); }
});
