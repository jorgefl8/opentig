import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconFolder, IconLoader4 } from '@tabler/icons-react';
import type { RepositoryInfo, ServerDirectoryListing } from '@shared/contracts';
import { cloneFolderName, cloneInputError, cloneSource, type CloneJob } from '@shared/onboarding';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { OpenRepositoryDialog } from '@/features/repositories/OpenRepositoryDialog';
import { opentig } from '@/lib/opentig-api';
import { joinFolder } from './onboarding-model';
import { followCloneJob, rememberCloneParent, trackCloneInBackground } from './clone-jobs';
import './onboarding.css';

const STEPS = [
  { label: 'Connect', phases: ['Preparing destination', 'Connecting to remote', 'Preparing objects'] },
  { label: 'Receive', phases: ['Receiving objects'] },
  { label: 'Resolve', phases: ['Resolving deltas'] },
  { label: 'Check out', phases: ['Checking out files', 'Opening repository', 'Repository cloned'] },
];

export function CloneRepositoryDialog({ open, onOpenChange, defaultParent, onBrowse, onPick, onCloned }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  defaultParent: string | null;
  onBrowse(path?: string): Promise<ServerDirectoryListing>;
  onPick?: (() => Promise<string | null>) | undefined;
  /** Adds and opens the cloned repository. */
  onCloned(repository: RepositoryInfo): Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [parent, setParent] = useState('');
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [picking, setPicking] = useState(false);
  const [job, setJob] = useState<CloneJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const nameEdited = useRef(false);
  const following = useRef<AbortController | null>(null);
  const urlInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setJob(null); setError(''); setRenaming(false);
    if (defaultParent) { setParent(current => current || defaultParent); return; }
    let active = true;
    void onBrowse().then(home => { if (active) setParent(current => current || home.path); }, () => undefined);
    return () => { active = false; };
  }, [defaultParent, onBrowse, open]);
  useEffect(() => () => following.current?.abort(), []);

  const running = job?.state === 'running';
  const source = cloneSource(url);
  const destination = parent.trim() && name ? joinFolder(parent.trim(), name) : '';
  const close = () => {
    if (running && job) { following.current?.abort(); trackCloneInBackground(job, repository => void onCloned(repository)); }
    onOpenChange(false);
  };

  const start = async () => {
    const input = { url: url.trim(), parentPath: parent.trim(), folderName: name };
    const invalid = cloneInputError(input);
    if (invalid) { setError(invalid); return; }
    setStarting(true); setError('');
    try {
      const started = await opentig.repository.clone(input);
      setJob(started);
      const controller = new AbortController(); following.current = controller;
      const result = await followCloneJob(started.id, setJob, controller.signal);
      if (result.state === 'completed' && result.repository) {
        rememberCloneParent(input.parentPath);
        await onCloned(result.repository);
        setUrl(''); setName(''); nameEdited.current = false; setJob(null);
        onOpenChange(false);
        return;
      }
      setJob(null);
      setError(result.error ?? 'Could not clone the repository.');
    } catch (reason) {
      if (following.current?.signal.aborted) return;
      setJob(null);
      setError(reason instanceof Error ? reason.message : 'Could not clone the repository.');
    } finally { setStarting(false); }
  };

  const activeStep = job ? STEPS.findIndex(step => step.phases.includes(job.phase)) : -1;
  return <>
    <Dialog open={open && !picking} onOpenChange={value => { if (!value) close(); }}>
      <DialogPopup className="onboarding-clone-dialog" initialFocus={urlInput}>
        {running && job ? <>
          <DialogTitle>Cloning {job.name}</DialogTitle>
          <DialogDescription className="onboarding-mono">{job.destination}</DialogDescription>
          <div className="onboarding-progress" role="progressbar" aria-label="Clone progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.percent ?? undefined} data-indeterminate={job.percent === null || undefined}>
            <i style={job.percent === null ? undefined : { width: `${job.percent}%` }} />
          </div>
          <ol className="onboarding-phases">{STEPS.map((step, index) => <li key={step.label} data-state={index < activeStep ? 'done' : index === activeStep ? 'active' : undefined}>
            {index < activeStep && <IconCheck aria-hidden="true" />}{step.label}{index === activeStep && job.percent !== null && index === 1 ? ` ${Math.round(job.percent / 0.8)}%` : ''}{index === activeStep && job.received ? ` · ${job.received}` : ''}
          </li>)}</ol>
          <p className="onboarding-hint" role="status">{job.phase}. Keeps running if you close this window or the connection drops.</p>
          <div className="onboarding-dialog-actions">
            <Button variant="ghost" onClick={close}>Run in background</Button>
            <Button variant="outline" onClick={() => void opentig.repository.cancelClone(job.id).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not cancel the clone.'))}>Cancel clone</Button>
          </div>
        </> : <form onSubmit={event => { event.preventDefault(); if (!starting) void start(); }}>
          <DialogTitle>Clone a repository</DialogTitle>
          <DialogDescription>Copy a repository from GitHub, GitLab, or any Git host {window.opentigDesktop ? 'to this computer' : 'to your server'}.</DialogDescription>
          <label htmlFor="clone-url">Repository URL</label>
          <div className="onboarding-input">
            <input ref={urlInput} id="clone-url" value={url} spellCheck={false} autoComplete="off" placeholder="https://github.com/owner/repository.git" disabled={starting}
              onChange={event => { setUrl(event.target.value); setError(''); if (!nameEdited.current) setName(cloneFolderName(event.target.value)); }} />
            {source && <span className="onboarding-source">{source.host} · {source.transport}</span>}
          </div>
          <label htmlFor="clone-parent">Clone into</label>
          <div className="onboarding-input-row">
            <input id="clone-parent" className="onboarding-input" value={parent} spellCheck={false} autoComplete="off" placeholder="Choose a folder" disabled={starting} onChange={event => { setParent(event.target.value); setError(''); }} />
            <Button type="button" variant="outline" disabled={starting} onClick={() => setPicking(true)}>Browse…</Button>
          </div>
          <div className="onboarding-destination">
            <IconFolder aria-hidden="true" />
            {renaming ? <><span>Folder name</span><input aria-label="Repository folder name" className="onboarding-input" value={name} spellCheck={false} autoFocus onChange={event => { setName(event.target.value); nameEdited.current = true; setError(''); }} onBlur={() => setRenaming(false)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setRenaming(false); } }} /></>
              : <><span>{destination ? <>Creates <code>{destination}</code></> : 'Enter a URL and a folder to see where it will be cloned.'}</span>{name && <button type="button" disabled={starting} onClick={() => setRenaming(true)}>Rename</button>}</>}
          </div>
          <p className="onboarding-hint">Private repositories use your existing Git HTTPS or SSH credentials.</p>
          {error && <p className="onboarding-error" role="alert">{error}</p>}
          <div className="onboarding-dialog-actions">
            <Button type="button" variant="ghost" disabled={starting} onClick={close}>Cancel</Button>
            <Button type="submit" disabled={starting || !url.trim() || !parent.trim() || !name}>{starting && <IconLoader4 className="animate-spin" />}Clone</Button>
          </div>
        </form>}
      </DialogPopup>
    </Dialog>
    {picking && <OpenRepositoryDialog open directory title="Choose where to clone" description="The repository gets its own new folder inside the one you choose."
      confirmLabel="Use this folder" initialPath={parent.trim() || undefined} onBrowse={onBrowse} onPick={onPick}
      onOpenChange={value => { if (!value) setPicking(false); }} onOpen={async path => { setParent(path); setError(''); setPicking(false); }} />}
  </>;
}
