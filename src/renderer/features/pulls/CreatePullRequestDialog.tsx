import { useEffect, useMemo, useRef, useState } from 'react';
import { IconGitPullRequest, IconLoader4, IconPlayerStop, IconUpload } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { AiHarnessId, AiHarnessStatus, Preferences } from '../../../shared/contracts';
import type { BranchInfo, RepositoryStatus } from '../../../shared/git-types';
import type { SerializedAiError } from '../../../shared/errors';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Textarea } from '@/components/ui/textarea';
import { opentig } from '@/lib/opentig-api';
import { ViewerTabs, ViewerTabsList, ViewerTabsPanel } from '@/components/ui/viewer-tabs';
import { renderMarkdown } from '@/features/markdown/render-markdown';
import { AiProviderIcon } from '@/features/ai/AiProviderIcon';
import { ghDetail, ghErrorTitle, openOnGitHub } from './gh-utils';
import '@/features/markdown/markdown.css';

interface CreatePullRequestDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  repositoryId: string;
  branches: BranchInfo[];
  status: RepositoryStatus | null;
  preferences: Preferences;
  aiProviders: AiHarnessStatus[] | undefined;
  pushBusy: boolean;
  onPush(): void;
  onCreated(prNumber: number | null): void;
}

export function CreatePullRequestDialog(props: CreatePullRequestDialogProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [base, setBase] = useState('');
  const [draft, setDraft] = useState(false);
  const [bodyTab, setBodyTab] = useState<'edit' | 'preview'>('edit');
  const [previewHtml, setPreviewHtml] = useState('');
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const generationRequest = useRef<string | null>(null);
  const previewToken = useRef(0);

  const currentBranch = props.status?.branch ?? null;
  const harness = props.preferences.commitMessageHarness;
  const model = props.preferences.commitMessageModels[harness] ?? 'default';
  const modelLabel = aiModelLabel(props.aiProviders, harness, model);
  const baseOptions = useMemo(() => props.branches
    .filter((branch) => branch.remote && !branch.fullName.endsWith('/HEAD') && branch.name !== `origin/${currentBranch ?? ''}`)
    .map((branch) => branch.name), [currentBranch, props.branches]);

  useEffect(() => {
    if (!props.open) return;
    setBase((current) => current && baseOptions.includes(current) ? current : defaultBase(baseOptions));
  }, [baseOptions, props.open]);

  useEffect(() => {
    if (!props.open || bodyTab !== 'preview') return;
    const token = ++previewToken.current;
    renderMarkdown(body || '_No description._').then((html) => {
      if (token === previewToken.current) setPreviewHtml(html);
    }).catch(() => {
      if (token === previewToken.current) setPreviewHtml('<p>Could not render the preview.</p>');
    });
  }, [body, bodyTab, props.open]);

  // Closing the dialog aborts any generation still in flight.
  useEffect(() => {
    if (props.open) return;
    const active = generationRequest.current;
    if (active) void opentig.github.cancelDraft(active).catch(() => undefined);
  }, [props.open]);

  const needsPublish = props.status !== null && !props.status.upstream;
  const needsPush = props.status !== null && Boolean(props.status.upstream) && props.status.ahead > 0;
  const detachedOrUnborn = props.status !== null && (props.status.detached || props.status.unborn || !props.status.branch);
  const blocked = props.status === null || needsPublish || needsPush || detachedOrUnborn || baseOptions.length === 0;

  const cancelGeneration = async () => {
    const active = generationRequest.current;
    if (active) await opentig.github.cancelDraft(active).catch(() => undefined);
  };

  const generateDraft = async () => {
    if (blocked || generating || creating || !base) return;
    const requestId = crypto.randomUUID();
    generationRequest.current = requestId;
    setGenerating(requestId);
    try {
      const result = await opentig.github.generateDraft({ repositoryId: props.repositoryId, base, harness, model, requestId });
      if (generationRequest.current !== requestId) return;
      setTitle(result.title);
      setBody(result.body);
      setBodyTab('edit');
      sileo.success({
        title: `Draft generated with ${harnessLabel(result.harness)}`,
        description: result.contextWasTruncated ? 'A truncated version of the branch diff was used. Review before publishing.' : 'Review and edit before publishing.',
      });
    } catch (reason) {
      const detail = aiDetail(reason);
      if (detail?.code === 'AI_CANCELLED') sileo.info({ title: 'Generation canceled' });
      else sileo.error({ title: 'Could not generate the draft', description: detail?.message ?? messageOf(reason), duration: 10_000 });
    } finally {
      if (generationRequest.current === requestId) generationRequest.current = null;
      setGenerating((current) => current === requestId ? null : current);
    }
  };

  const create = async () => {
    if (blocked || creating || generating || !title.trim() || !base) return;
    setCreating(true);
    try {
      const result = await opentig.github.createPullRequest({ repositoryId: props.repositoryId, title: title.trim(), body, base, draft });
      setTitle('');
      setBody('');
      setDraft(false);
      sileo.success({
        title: draft ? 'Draft pull request created' : 'Pull request created',
        description: result.url,
        button: { title: 'Open', onClick: () => openOnGitHub(result.url) },
      });
      props.onCreated(result.number);
    } catch (reason) {
      const detail = ghDetail(reason);
      sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? messageOf(reason), duration: 10_000 });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(next) => { if (!creating) props.onOpenChange(next); }}>
      <DialogPopup className="create-pr-dialog">
        <div className="create-pr-content">
          <DialogTitle><IconGitPullRequest aria-hidden="true" /> Create pull request</DialogTitle>
          <DialogDescription>
            {currentBranch ? <>From <code>{currentBranch}</code> into the selected base branch on GitHub.</> : 'Check out a branch to create a pull request.'}
          </DialogDescription>
          {needsPublish && (
            <div className="create-pr-notice">
              <span>The branch has no upstream. Publish it to origin (for example <code>git push -u origin {currentBranch ?? 'HEAD'}</code>) and refresh.</span>
            </div>
          )}
          {needsPush && (
            <div className="create-pr-notice">
              <span>The branch has {props.status?.ahead} unpushed {props.status?.ahead === 1 ? 'commit' : 'commits'}. Push them so the pull request includes your work.</span>
              <Button variant="outline" size="xs" disabled={props.pushBusy} onClick={props.onPush}>
                {props.pushBusy ? <IconLoader4 className="animate-spin" /> : <IconUpload />} Push
              </Button>
            </div>
          )}
          {!needsPublish && !needsPush && detachedOrUnborn && (
            <div className="create-pr-notice"><span>Pull requests need a checked-out branch with commits.</span></div>
          )}
          {baseOptions.length === 0 && !detachedOrUnborn && (
            <div className="create-pr-notice"><span>No remote branches are available to use as a base. Fetch the remote first.</span></div>
          )}
          <div className="create-pr-base-row">
            <div className="create-pr-field">
              <label htmlFor="create-pr-base">Base branch</label>
              <Select value={base} onValueChange={(value) => setBase(value ?? '')}>
                <SelectTrigger id="create-pr-base" className="create-pr-base" disabled={blocked || creating || Boolean(generating)}><SelectValue>{base ? stripOrigin(base) : 'Select a base'}</SelectValue></SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {baseOptions.map((option) => <SelectItem key={option} value={option}>{stripOrigin(option)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="create-pr-draft">
              <Checkbox checked={draft} onCheckedChange={(checked) => setDraft(checked === true)} disabled={blocked || creating || Boolean(generating)} />
              <span>Create as draft</span>
            </label>
          </div>
          <div className="create-pr-field">
            <label htmlFor="create-pr-title">Title</label>
            <input
              id="create-pr-title"
              className="create-pr-title"
              value={title}
              maxLength={300}
              placeholder="Pull request title"
              disabled={blocked || creating || Boolean(generating)}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <ViewerTabs value={bodyTab} onValueChange={(value) => setBodyTab(value as typeof bodyTab)} className="create-pr-field create-pr-body-field">
            <div className="create-pr-body-header">
              <label htmlFor="create-pr-body">Description</label>
              <ViewerTabsList
                label="Description view"
                className="markdown-viewer-tabs"
                items={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]}
              />
            </div>
            <ViewerTabsPanel value="edit" className="create-pr-body-panel">
              <Textarea
                id="create-pr-body"
                value={body}
                rows={10}
                placeholder="Describe the change (GitHub Markdown)"
                disabled={blocked || creating || Boolean(generating)}
                onChange={(event) => setBody(event.target.value)}
              />
            </ViewerTabsPanel>
            <ViewerTabsPanel value="preview" className="create-pr-preview markdown-prose" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </ViewerTabs>
        </div>
        <div className="create-pr-actions">
          <Button
            variant="outline"
            className="create-pr-generate commit-composer-generate"
            disabled={blocked || creating}
            aria-label={generating ? 'Cancel generation' : undefined}
            onClick={() => generating ? void cancelGeneration() : void generateDraft()}
          >
            {generating ? <IconPlayerStop className="text-destructive" /> : <AiProviderIcon harness={harness} />}
            {generating
              ? <ShimmeringText text="Generating draft…" />
              : <span className="commit-composer-provider">Generate with <span className="commit-composer-harness">{harnessLabel(harness)}</span><span aria-hidden="true">·</span><span className="commit-composer-model">{modelLabel}</span></span>}
          </Button>
          <div className="create-pr-submit-actions">
            <Button variant="ghost" onClick={() => props.onOpenChange(false)} disabled={creating}>Cancel</Button>
            <Button onClick={() => void create()} disabled={blocked || creating || Boolean(generating) || !title.trim() || !base}>
              {creating ? <IconLoader4 className="animate-spin" /> : <IconGitPullRequest />} {creating ? 'Creating…' : 'Create pull request'}
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function defaultBase(options: string[]): string {
  return options.find((option) => option === 'origin/main')
    ?? options.find((option) => option === 'origin/master')
    ?? options[0]
    ?? '';
}

function stripOrigin(value: string): string {
  return value.replace(/^origin\//, '');
}

function harnessLabel(harness: AiHarnessId): string {
  return harness === 'codex' ? 'Codex' : harness === 'claude' ? 'Claude Code' : 'OpenCode';
}

function aiModelLabel(providers: AiHarnessStatus[] | undefined, harness: AiHarnessId, model: string): string {
  return providers?.find((provider) => provider.id === harness)?.models.find((option) => option.id === model)?.label
    ?? (model === 'default' ? 'Default (CLI)' : model);
}

function aiDetail(reason: unknown): SerializedAiError | null {
  if (!(reason instanceof Error) || !('detail' in reason) || !reason.detail || typeof reason.detail !== 'object') return null;
  const detail = reason.detail as Partial<SerializedAiError>;
  return typeof detail.code === 'string' && detail.code.startsWith('AI_') && typeof detail.message === 'string' ? detail as SerializedAiError : null;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'An unexpected error occurred.';
}
