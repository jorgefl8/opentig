import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { IconAlertTriangle, IconFolder, IconFolderPlus, IconLoader4, IconPencil, IconTrash, IconX } from '@tabler/icons-react';
import type { RepositoryOrganization, RepositoryProject } from '../../../shared/contracts';
import { MAX_PROJECT_NAME_LENGTH } from '../../../shared/repository-projects';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { shortenRepositoryPath, type RepositoryOption } from './repository-select-model';

const NO_PROJECT = '__justgit_no_project__';

interface RepositoryProjectsDialogProps {
  open: boolean;
  projects: RepositoryProject[];
  repositories: RepositoryOption[];
  onOpenChange(open: boolean): void;
  onOrganizationChange(organization: RepositoryOrganization): void;
}

export function RepositoryProjectsDialog({ open, projects, repositories, onOpenChange, onOrganizationChange }: RepositoryProjectsDialogProps) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const assignments = useMemo(() => new Map(projects.flatMap((project) => project.repositoryKeys.map((key) => [key, project.id] as const))), [projects]);

  useEffect(() => {
    if (open) return;
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
    if (await run('create', () => window.justgit.projects.create(name))) setNewName('');
  };

  const saveRename = async (event: FormEvent) => {
    event.preventDefault();
    const name = editingName.trim();
    if (!editingId || !name || busy) return;
    if (await run(`rename:${editingId}`, () => window.justgit.projects.rename(editingId, name))) setEditingId(null);
  };

  const removeProject = async (projectId: string) => {
    if (busy) return;
    if (await run(`remove:${projectId}`, () => window.justgit.projects.remove(projectId))) setDeletingId(null);
  };

  const assignProject = async (repositoryKey: string, projectId: string | null) => {
    if (busy) return;
    await run(`assign:${repositoryKey}`, () => window.justgit.projects.assign(repositoryKey, projectId));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="repository-projects-dialog w-[min(660px,calc(100vw-2.5rem))]">
        <header className="repository-projects-header">
          <div>
            <DialogTitle>Manage projects</DialogTitle>
            <DialogDescription>Group repositories inside JustGit. Nothing moves on disk.</DialogDescription>
          </div>
          <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close project management" />}><IconX /></DialogClose>
        </header>

        <div className="repository-projects-body">
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

            <div className="repository-project-list">
              {projects.length === 0 && <p className="repository-projects-empty">No projects yet. Create one to group related repositories.</p>}
              {projects.map((project) => {
                const count = project.repositoryKeys.length;
                const rowBusy = busy === `rename:${project.id}` || busy === `remove:${project.id}`;
                return (
                  <div className="repository-project-row" key={project.id} aria-busy={rowBusy || undefined}>
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
                          <Button variant="ghost" size="icon-sm" aria-label={`Rename ${project.name}`} disabled={Boolean(busy)} onClick={() => { setEditingId(project.id); setEditingName(project.name); setDeletingId(null); }}><IconPencil /></Button>
                          <Button variant="ghost" size="icon-sm" className="repository-row-delete" aria-label={`Delete ${project.name}`} disabled={Boolean(busy)} onClick={() => { setDeletingId(project.id); setEditingId(null); }}><IconTrash /></Button>
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="repository-projects-section" aria-labelledby="repository-assignments-heading">
            <div className="repository-projects-section-heading">
              <h3 id="repository-assignments-heading">Repositories <span>{repositories.length}</span></h3>
              <p>One project per repository</p>
            </div>
            <div className="repository-assignment-list">
              {repositories.length === 0 && <p className="repository-projects-empty">No recent repositories to assign yet.</p>}
              {repositories.map((repository) => {
                const projectId = assignments.get(repository.key) ?? NO_PROJECT;
                const rowBusy = busy === `assign:${repository.key}`;
                return (
                  <div className="repository-assignment-row" key={repository.key} aria-busy={rowBusy || undefined}>
                    <IconFolder aria-hidden="true" />
                    <span className="repository-assignment-copy">
                      <strong>{repository.name}</strong>
                      <Tooltip>
                        <TooltipTrigger render={<small />}>{shortenRepositoryPath(repository.rootPath, 4)}</TooltipTrigger>
                        <TooltipContent>{repository.rootPath}</TooltipContent>
                      </Tooltip>
                    </span>
                    {rowBusy && <IconLoader4 className="repository-assignment-busy animate-spin" aria-hidden="true" />}
                    <Select value={projectId} onValueChange={(value) => void assignProject(repository.key, value === NO_PROJECT ? null : value)} disabled={Boolean(busy)}>
                      <SelectTrigger size="sm" aria-label={`Project for ${repository.name}`}><SelectValue>{projects.find((project) => project.id === projectId)?.name ?? 'No project'}</SelectValue></SelectTrigger>
                      <SelectContent align="end" alignItemWithTrigger={false}>
                        <SelectItem value={NO_PROJECT}>No project</SelectItem>
                        {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <footer className="repository-projects-footer">
          <DialogClose render={<Button variant="outline" size="sm" />}>Done</DialogClose>
        </footer>
      </DialogPopup>
    </Dialog>
  );
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
