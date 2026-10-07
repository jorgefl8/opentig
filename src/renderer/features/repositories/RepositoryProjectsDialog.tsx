import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconAlertTriangle, IconFolder, IconFolderPlus, IconFolderSymlink, IconLoader4, IconPencil, IconTrash, IconX } from '@tabler/icons-react';
import type { RepositoryOrganization, RepositoryProject } from '../../../shared/contracts';
import { MAX_PROJECT_NAME_LENGTH } from '../../../shared/repository-projects';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { SearchablePicker } from '@/components/SearchablePicker';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { buildRepositoryPickerModel, getRepositoryPickerDisplayOrder, shortenRepositoryPath, type RepositoryOption } from './repository-select-model';
import { RepositoryOrderButtons, RepositoryOrderList, RepositoryOrderRow } from './RepositoryOrderControls';
import { OpenRepositoryDialog } from './OpenRepositoryDialog';
import { opentig } from '@/lib/opentig-api';
import { useMobileLayout } from '@/lib/use-mobile-layout';

const NO_PROJECT = '__opentig_no_project__';

interface RepositoryProjectsDialogProps {
  open: boolean;
  projects: RepositoryProject[];
  repositories: RepositoryOption[];
  onOpenChange(open: boolean): void;
  onForgetRepository(repository: RepositoryOption): Promise<RepositoryOrganization>;
  onRelocateRepository(repository: RepositoryOption, path: string): Promise<void>;
  onOrganizationChange(organization: RepositoryOrganization): void;
}

export function RepositoryProjectsDialog({ open, projects, repositories, onOpenChange, onOrganizationChange, onForgetRepository, onRelocateRepository }: RepositoryProjectsDialogProps) {
  const mobile = useMobileLayout();
  const bodyRef = useRef<HTMLDivElement>(null);
  const pendingOrder = useRef<{ scrollTop: number; focused: HTMLElement | null; row: HTMLElement | null; saved: boolean } | null>(null);
  const [removingRepository, setRemovingRepository] = useState<string | null>(null);
  const [relocatingRepository, setRelocatingRepository] = useState<RepositoryOption | null>(null);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const assignments = useMemo(() => new Map(projects.flatMap((project) => project.repositoryKeys.map((key) => [key, project.id] as const))), [projects]);
  const picker = useMemo(() => buildRepositoryPickerModel(repositories.map((item) => item.recent), projects), [repositories, projects]);
  const groups = [...picker.projectSections, { id: NO_PROJECT, name: 'No project', repositories: picker.unassigned }].filter((group) => group.repositories.length > 0);
  const numbers = new Map(getRepositoryPickerDisplayOrder(picker).map((item, index) => [item.key, index + 1]));
  const orderingDisabled = Boolean(busy || editingId || deletingId || removingRepository);

  useLayoutEffect(() => {
    if (busy || !pendingOrder.current) return;
    const snapshot = pendingOrder.current;
    pendingOrder.current = null;
    const body = bodyRef.current;
    if (!open || !body) return;
    body.scrollTop = snapshot.scrollTop;
    const target = snapshot.focused?.isConnected && !snapshot.focused.matches(':disabled')
      ? snapshot.focused : snapshot.row?.querySelector<HTMLButtonElement>('.repository-order-buttons button:not(:disabled)');
    target?.focus({ preventScroll: true });
    if (snapshot.saved && snapshot.row?.isConnected && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      snapshot.row.animate?.([{ boxShadow: 'inset 0 0 0 2px var(--ring)' }, { boxShadow: 'inset 0 0 0 2px transparent' }], { duration: 350 });
    }
  }, [busy, projects, repositories, open]);

  useEffect(() => {
    if (open) return;
    setRemovingRepository(null);
    setRelocatingRepository(null);
    setEditingId(null);
    setDeletingId(null);
    setError(null);
  }, [open]);

  const run = async (operation: string, action: () => Promise<RepositoryOrganization>) => {
    setBusy(operation);
    setError(null);
    try {
      const organization = await action();
      onOrganizationChange(organization);
      return true;
    } catch (reason) {
      setError(messageOf(reason));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    if (await run('create', () => opentig.projects.create(name))) setNewName('');
  };

  const saveRename = async (event: FormEvent) => {
    event.preventDefault();
    const name = editingName.trim();
    if (!editingId || !name || busy) return;
    if (await run(`rename:${editingId}`, () => opentig.projects.rename(editingId, name))) setEditingId(null);
  };

  const removeProject = async (projectId: string) => {
    if (busy) return;
    if (await run(`remove:${projectId}`, () => opentig.projects.remove(projectId))) setDeletingId(null);
  };

  const assignProject = async (repositoryKey: string, projectId: string | null) => {
    if (busy) return;
    await run(`assign:${repositoryKey}`, () => opentig.projects.assign(repositoryKey, projectId));
  };

  const moveOrder = async (operation: string, action: () => Promise<RepositoryOrganization>, trigger?: HTMLButtonElement) => {
    if (orderingDisabled) return;
    const focused = trigger ?? (document.activeElement instanceof HTMLElement && bodyRef.current?.contains(document.activeElement) ? document.activeElement : null);
    const snapshot = mobile && bodyRef.current ? {
      scrollTop: bodyRef.current.scrollTop, focused, row: focused?.closest<HTMLElement>('[data-order-row]') ?? null, saved: false,
    } : null;
    pendingOrder.current = snapshot;
    await run(operation, async () => {
      try {
        const organization = await action();
        if (snapshot) snapshot.saved = true;
        return organization;
      } finally {
        // Preserve any scrolling done while the save was in flight too.
        if (snapshot && bodyRef.current) snapshot.scrollTop = bodyRef.current.scrollTop;
      }
    });
  };
  const moveProject = (projectId: string, toIndex: number, trigger?: HTMLButtonElement) => moveOrder(`move-project:${projectId}`, () => opentig.projects.moveProject(projectId, toIndex), trigger);
  const moveRepository = (repositoryKey: string, toIndex: number, trigger?: HTMLButtonElement) => moveOrder(`move-repository:${repositoryKey}`, () => opentig.projects.moveRepository(repositoryKey, toIndex), trigger);

  const relocate = async (repository: RepositoryOption) => {
    if (busy) return;
    setError(null);
    if (!window.opentigDesktop) { setRelocatingRepository(repository); return; }
    setBusy(`relocate:${repository.key}`);
    try {
      const path = await opentig.repository.select(`Relocate ${repository.name}`);
      if (path) await onRelocateRepository(repository, path);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogPopup className="repository-projects-dialog w-[min(660px,calc(100vw-2.5rem))]" data-mobile={mobile || undefined} onKeyDown={(event) => {
        // Dialog normally contains arrow keys; sortable handles need them to
        // reach dnd-kit's document listener for keyboard reordering.
        if (event.key.startsWith('Arrow') && event.target instanceof Element && event.target.closest('.repository-order-handle')) event.preventBaseUIHandler();
      }}>
        <header className="repository-projects-header">
          <div>
            <DialogTitle>Manage projects</DialogTitle>
            <DialogDescription>{mobile ? 'Use the up and down arrows to reorder projects and repositories.' : 'Drag projects and repositories or use the arrows to set their order.'} The selector and number shortcuts follow this saved order. Files stay on disk.</DialogDescription>
          </div>
          <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close project management" disabled={Boolean(busy)} />}><IconX /></DialogClose>
        </header>

        <div className="repository-projects-body" ref={bodyRef}>
          {error && <div className="repository-projects-error" role="alert"><IconAlertTriangle aria-hidden="true" /><span>{error}</span></div>}

          <section className="repository-projects-section" aria-labelledby="projects-heading">
            <div className="repository-projects-section-heading">
              <h3 id="projects-heading">Projects <span>{projects.length}</span></h3>
              <form className="repository-project-create" onSubmit={(event) => void createProject(event)}>
                <label className="sr-only" htmlFor="new-project-name">Project name</label>
                <input id="new-project-name" value={newName} maxLength={MAX_PROJECT_NAME_LENGTH} onChange={(event) => setNewName(event.target.value)} placeholder="New project name" disabled={Boolean(busy)} />
                <Button type="submit" size="sm" disabled={!newName.trim() || Boolean(busy)}>
                  {busy === 'create' ? <IconLoader4 className="animate-spin" /> : <IconFolderPlus />} Create
                </Button>
              </form>
            </div>

            <RepositoryOrderList draggable={!mobile} items={projects.map((project) => ({ id: project.id, label: project.name }))} onMove={(id, index) => void moveProject(id, index)}>
              <div className="repository-project-list">
                {projects.length === 0 && <p className="repository-projects-empty">No projects yet. Create one to group related repositories.</p>}
                {projects.map((project, projectIndex) => {
                  const count = project.repositoryKeys.length;
                  const rowBusy = busy === `rename:${project.id}` || busy === `remove:${project.id}` || busy === `move-project:${project.id}`;
                  return (
                    <RepositoryOrderRow draggable={!mobile} className="repository-project-row" key={project.id} id={project.id} label={`project ${project.name}`} disabled={orderingDisabled} busy={rowBusy}>
                      {editingId === project.id ? (
                        <form className="repository-inline-form" onSubmit={(event) => void saveRename(event)} onKeyDown={(event) => { if (event.key === 'Escape') setEditingId(null); }}>
                          <label className="sr-only" htmlFor={`rename-project-${project.id}`}>Rename {project.name}</label>
                          <input id={`rename-project-${project.id}`} autoFocus value={editingName} maxLength={MAX_PROJECT_NAME_LENGTH} onChange={(event) => setEditingName(event.target.value)} disabled={Boolean(busy)} />
                          <Button type="submit" size="xs" disabled={!editingName.trim() || Boolean(busy)}>Save</Button>
                          <Button type="button" variant="ghost" size="xs" onClick={() => setEditingId(null)} disabled={Boolean(busy)}>Cancel</Button>
                        </form>
                      ) : deletingId === project.id ? (
                        <div className="repository-project-confirm" role="alert">
                          <IconAlertTriangle aria-hidden="true" />
                          <span>Delete <strong>{project.name}</strong>? Its repositories stay available, just ungrouped.</span>
                          <Button variant="destructive" size="xs" disabled={Boolean(busy)} onClick={() => void removeProject(project.id)}>Delete</Button>
                          <Button variant="ghost" size="xs" disabled={Boolean(busy)} onClick={() => setDeletingId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <>
                          <span className="repository-project-icon" aria-hidden="true"><IconFolder /></span>
                          <span className="repository-project-copy"><strong>{project.name}</strong><small>{count} {count === 1 ? 'repository' : 'repositories'}</small></span>
                          <span className="repository-row-actions">
                            <RepositoryOrderButtons label={`project ${project.name}`} index={projectIndex} count={projects.length} disabled={orderingDisabled} onMove={(index, trigger) => void moveProject(project.id, index, trigger)} />
                            <Button variant="ghost" size="icon-sm" aria-label={`Rename ${project.name}`} disabled={Boolean(busy)} onClick={() => { setEditingId(project.id); setEditingName(project.name); setDeletingId(null); }}><IconPencil /></Button>
                            <Button variant="ghost" size="icon-sm" className="repository-row-delete" aria-label={`Delete ${project.name}`} disabled={Boolean(busy)} onClick={() => { setDeletingId(project.id); setEditingId(null); }}><IconTrash /></Button>
                          </span>
                        </>
                      )}
                    </RepositoryOrderRow>
                  );
                })}
              </div>
            </RepositoryOrderList>
          </section>

          <section className="repository-projects-section" aria-labelledby="repository-assignments-heading">
            <div className="repository-projects-section-heading">
              <h3 id="repository-assignments-heading">Repositories <span>{repositories.length}</span></h3>
              <p>Reorder within each group</p>
            </div>
            {repositories.length === 0 && <p className="repository-projects-empty">No repositories added yet.</p>}
            {groups.map((group) => <div className="repository-assignment-group" key={group.id}>
              <h4>{group.name}</h4>
              <RepositoryOrderList draggable={!mobile} items={group.repositories.map((item) => ({ id: item.key, label: item.name }))} onMove={(id, index) => void moveRepository(id, index)}>
                <div className="repository-assignment-list">
                  {group.repositories.map((repository, repositoryIndex) => {
                    const projectId = assignments.get(repository.key) ?? NO_PROJECT;
                    const rowBusy = busy?.endsWith(`:${repository.key}`);
                    return (
                      <RepositoryOrderRow draggable={!mobile} className="repository-assignment-row" key={repository.key} id={repository.key} label={`repository ${repository.name}`} disabled={orderingDisabled} busy={rowBusy}>
                        {removingRepository === repository.key ? (
                          <div className="repository-project-confirm" role="alert">
                            <IconAlertTriangle aria-hidden="true" />
                            <span>Remove <strong>{repository.name}</strong> and its worktrees from OpenTig? Their folders and files stay on disk. You can open them again later.</span>
                            <Button variant="destructive" size="xs" disabled={Boolean(busy)} onClick={() => {
                              void run(`forget:${repository.key}`, () => onForgetRepository(repository)).then((removed) => { if (removed) setRemovingRepository(null); });
                            }}>Remove</Button>
                            <Button variant="ghost" size="xs" disabled={Boolean(busy)} onClick={() => setRemovingRepository(null)}>Cancel</Button>
                          </div>
                        ) : (<>
                          <Kbd className="repository-order-number" aria-label={`Repository shortcut ${numbers.get(repository.key)}`}>{numbers.get(repository.key)}</Kbd>
                          <span className="repository-assignment-copy">
                            <strong>{repository.name}</strong>
                            <Tooltip>
                              <TooltipTrigger render={<small />}>{shortenRepositoryPath(repository.rootPath, 4)}</TooltipTrigger>
                              <TooltipContent>{repository.rootPath}</TooltipContent>
                            </Tooltip>
                          </span>
                          {rowBusy && <IconLoader4 className="repository-assignment-busy animate-spin" aria-hidden="true" />}
                          <SearchablePicker
                            groups={[
                              { id: 'none', label: '', items: [{ value: NO_PROJECT, label: 'No project', pinned: true }] },
                              { id: 'projects', label: 'Projects', items: projects.map((project) => ({ value: project.id, label: project.name, icon: <IconFolder /> })) },
                            ]}
                            value={projectId}
                            onValueChange={(value) => void assignProject(repository.key, value === NO_PROJECT ? null : value)}
                            label={`Project for ${repository.name}`}
                            triggerLabel={projects.find((project) => project.id === projectId)?.name ?? 'No project'}
                            placeholder="Search projects…"
                            disabled={Boolean(busy)}
                          />
                          <span className="repository-management-actions">
                            <RepositoryOrderButtons label={`repository ${repository.name}`} index={repositoryIndex} count={group.repositories.length} disabled={orderingDisabled} onMove={(index, trigger) => void moveRepository(repository.key, index, trigger)} />
                            <Tooltip>
                              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Relocate ${repository.name}`} disabled={Boolean(busy)} onClick={() => void relocate(repository)} />}><IconFolderSymlink /></TooltipTrigger>
                              <TooltipContent>Relocate repository</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Remove ${repository.name} from OpenTig`} disabled={Boolean(busy)} onClick={() => { setRemovingRepository(repository.key); setError(null); }} />}><IconTrash /></TooltipTrigger>
                              <TooltipContent>Remove from OpenTig</TooltipContent>
                            </Tooltip>
                          </span>
                        </>)}
                      </RepositoryOrderRow>
                    );
                  })}
                </div>
              </RepositoryOrderList>
            </div>)}
          </section>
        </div>

        <footer className="repository-projects-footer">
          <DialogClose render={<Button variant="outline" size="sm" disabled={Boolean(busy)} />}>Done</DialogClose>
        </footer>
      </DialogPopup>
      <OpenRepositoryDialog
        open={relocatingRepository !== null}
        onOpenChange={(next) => { if (!next) setRelocatingRepository(null); }}
        title="Relocate repository"
        description={`Choose the existing server folder for ${relocatingRepository?.name ?? 'this repository'}. This updates its saved location; it does not move files.`}
        confirmLabel="Use this folder"
        initialPath={relocatingRepository?.recent.path}
        recent={repositories.map(repository => repository.recent)}
        onBrowse={opentig.repository.browseDirectories}
        onOpen={async (path) => {
          if (relocatingRepository) await onRelocateRepository(relocatingRepository, path);
        }}
      />
    </Dialog>
  );
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
