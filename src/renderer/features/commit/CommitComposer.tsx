import { useState, type ReactNode, type RefObject } from 'react';
import { IconAlertTriangle, IconCheck, IconChevronDown, IconChevronRight, IconPlayerStop, IconX } from '@tabler/icons-react';
import type { AiHarnessId, CommitSplitProposal } from '@shared/contracts';
import type { FileChange } from '@shared/git-types';
import { normalizeCombo } from '@shared/shortcuts';
import { ActionConfirmPanel } from '@/components/ActionConfirmPanel';
import { MobileSheet } from '@/components/MobileSheet';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useShortcuts } from '@/app/useShortcuts';
import { AiProviderIcon } from '@/features/ai/AiProviderIcon';
import { ChangeStatusBadge } from '@/features/changes/ChangeStatusBadge';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';
import {
  activeStep, committedCount, pendingIndices, pendingPaths, planFileDiffKind,
  type CommitPlan, type CommitPlanMode, type CommitPlanOutcome, type PlannedCommit,
} from './commit-plan';

interface CommitComposerProps {
  open: boolean;
  stagedCount: number;
  message: string;
  generating: boolean;
  harness: AiHarnessId;
  harnessLabel: string;
  modelLabel: string;
  busy: string | null;
  readOnly: boolean;
  canPush: boolean;
  /** A suggested split of the staged files, while there is one to follow or to turn down. */
  plan: CommitPlan | null;
  /** What the last plan left to say: its commits, or that it was discarded. */
  outcome: CommitPlanOutcome | null;
  /** The repository's changes, for each planned file's status and the diff that shows it. */
  changes: readonly FileChange[];
  /** On a phone the plan opens in a sheet instead of taking the screen from the list. */
  phone: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onMessage(message: string): void;
  onGenerate(): void;
  onCancelGenerate(): void;
  onPlanMode(mode: CommitPlanMode): void;
  /** Stages this group as the next commit. */
  onActivateGroup(index: number): void;
  onDiscardPlan(): void;
  onDismissOutcome(): void;
  onOpenPath(path: string, kind: 'staged' | 'unstaged'): void;
  onOpenCommit(commit: PlannedCommit): void;
  onCommit(options: { push: boolean }): void;
}

const files = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`;
const shortOid = (oid: string) => oid.slice(0, 7);
const NO_GROUPS: ReadonlySet<number> = new Set();

export function CommitComposer({
  open, stagedCount, message, generating, harness, harnessLabel, modelLabel, busy, readOnly, canPush, plan, outcome, changes, phone, textareaRef,
  onMessage, onGenerate, onCancelGenerate, onPlanMode, onActivateGroup, onDiscardPlan, onDismissOutcome, onOpenPath, onOpenCommit, onCommit,
}: CommitComposerProps) {
  const shortcuts = useShortcuts();
  // Choosing only changes what the button does, so nothing is pushed by a slip in the menu.
  const [pushChosen, setPushChosen] = useState(false);
  // Each belongs to one plan, so a later plan never inherits an open question or sheet.
  const [discardAsked, setDiscardAsked] = useState<CommitSplitProposal | null>(null);
  const [sheetFor, setSheetFor] = useState<CommitSplitProposal | null>(null);
  // Cards opened or closed by hand, until another group becomes the next commit.
  const [manual, setManual] = useState<{ active: number | null; toggled: ReadonlySet<number> }>({ active: null, toggled: NO_GROUPS });
  if (!open) return null;

  const commitCombo = shortcuts.commit.replace('Enter', '↵');
  const committing = busy === 'commit';
  const pushing = busy === 'push';
  const blocked = readOnly || stagedCount === 0;
  // A generation in progress is about to replace the message, so what would be
  // committed isn't settled yet.
  const commitDisabled = blocked || message.trim().length === 0 || generating || Boolean(busy);
  const step = activeStep(plan);
  const paused = plan !== null && plan.paused !== null;
  const splitting = plan !== null && plan.mode === 'split' && !paused;
  const total = plan?.proposal.commits.length ?? 0;
  const done = plan ? committedCount(plan) : 0;
  // A plan's commits are made one by one; pushing waits until they all exist.
  const push = pushChosen && canPush && !step;
  const actionLabel = step
    ? `Commit ${step.position} of ${step.total} · ${files(step.group.paths.length)}`
    : push ? 'Commit and push' : `Commit ${files(stagedCount)}`;
  const planLocked = readOnly || Boolean(busy) || generating;
  const commitButton = (className?: string) => (
    <Button size="sm" className={className} disabled={commitDisabled} onClick={() => onCommit({ push })}>
      {committing ? <ShimmeringText text="Committing…" /> : pushing ? <ShimmeringText text="Pushing…" /> : actionLabel}
    </Button>
  );

  const activeIndex = step?.index ?? null;
  const toggled = manual.active === activeIndex ? manual.toggled : NO_GROUPS;
  const toggleGroup = (index: number) => {
    const next = new Set(toggled);
    if (!next.delete(index)) next.add(index);
    setManual({ active: activeIndex, toggled: next });
  };
  const groups = plan && splitting && (
    <ol className="commit-plan-groups">
      {plan.proposal.commits.map((group, index) => (
        <PlanGroup
          key={group.fingerprint}
          plan={plan}
          index={index}
          active={index === activeIndex}
          // The next commit starts open; a press flips whatever a card would show.
          expanded={(index === activeIndex) !== toggled.has(index)}
          changes={changes}
          locked={planLocked}
          onToggle={() => toggleGroup(index)}
          onActivate={() => onActivateGroup(index)}
          onOpenPath={onOpenPath}
          onOpenCommit={onOpenCommit}
        />
      ))}
    </ol>
  );
  const progress = splitting && (
    <span className="commit-plan-progress">
      <span className="commit-plan-progress-track" aria-hidden="true"><i style={{ width: `${(done / total) * 100}%` }} /></span>
      <span>{done} of {total} committed</span>
    </span>
  );
  const sheetOpen = phone && splitting && sheetFor === plan?.proposal;

  return (
    <div className="commit-composer" role="group" aria-label="Create commit">
      {/* Read out as the plan moves on, since the button that was pressed changes under the user. */}
      <span className="sr-only" role="status">
        {step ? `${done} of ${total} committed. Next is commit ${step.position}: ${step.group.subject}` : ''}
      </span>
      {outcome?.kind === 'finished' && (
        <section className="commit-plan-finished" role="status" aria-label="Commit plan finished">
          <div className="commit-plan-finished-heading">
            <IconCheck aria-hidden="true" />
            <strong>{outcome.commits.length} commits created</strong>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Dismiss the summary" onClick={onDismissOutcome}><IconX /></Button>
          </div>
          <ul>
            {outcome.commits.map((commit) => (
              <li key={commit.oid}>
                <button type="button" className="commit-plan-created" aria-label={`Open commit ${shortOid(commit.oid)}: ${commit.subject}`} onClick={() => onOpenCommit(commit)}>
                  <span className="commit-oid">{shortOid(commit.oid)}</span>
                  <span>{commit.subject}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {outcome?.kind === 'discarded' && (
        <p className="commit-plan-note" role="status">
          <IconCheck aria-hidden="true" />
          <span>{discardedNote(outcome)}</span>
        </p>
      )}
      {plan && paused && (
        <div className="commit-plan-note paused" role="alert">
          <IconAlertTriangle aria-hidden="true" />
          <div>
            <p><strong>Commit plan paused.</strong> {plan.paused}{done > 0 && ` ${done === 1 ? 'The commit already created stays.' : `The ${done} commits already created stay.`}`}</p>
            <span className="commit-plan-note-actions">
              <Tooltip>
                <TooltipTrigger render={<Button type="button" variant="outline" size="xs" disabled={planLocked} onClick={() => onActivateGroup(pendingIndices(plan)[0]!)} />}>Resume plan</TooltipTrigger>
                <TooltipContent>Stage commit {pendingIndices(plan)[0]! + 1} of {total} again and unstage everything else</TooltipContent>
              </Tooltip>
              <Button type="button" variant="ghost" size="xs" disabled={Boolean(busy)} onClick={onDiscardPlan}>Discard plan</Button>
            </span>
          </div>
        </div>
      )}
      {plan && !paused && (discardAsked === plan.proposal && splitting ? (
        <ActionConfirmPanel
          busy={Boolean(busy)}
          onCancel={() => setDiscardAsked(null)}
          confirm={<Button type="button" variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => { setDiscardAsked(null); onDiscardPlan(); }}>Discard plan</Button>}
        >
          <p>
            {done > 0
              ? `Discard the rest of the plan? The ${files(pendingPaths(plan).length)} left will be staged again, and the ${done === 1 ? 'commit already created stays' : `${done} commits already created stay`}.`
              : `Discard the plan? All ${files(pendingPaths(plan).length)} will be staged again, as they were.`}
          </p>
        </ActionConfirmPanel>
      ) : (
        <div className="commit-plan-bar">
          <div className="commit-mode" role="group" aria-label="How to commit the staged files">
            {/* Commits already made can't be folded back into one. */}
            <button type="button" aria-pressed={plan.mode === 'one'} disabled={planLocked || done > 0} onClick={() => onPlanMode('one')}>One commit</button>
            <button
              type="button"
              aria-pressed={plan.mode === 'split'}
              disabled={planLocked}
              onClick={() => { if (phone) setSheetFor(plan.proposal); onPlanMode('split'); }}
            >Split into {total}</button>
          </div>
          {splitting && <Button type="button" variant="ghost" size="xs" disabled={Boolean(busy)} onClick={() => setDiscardAsked(plan.proposal)}>Discard plan</Button>}
        </div>
      ))}
      {plan && plan.mode === 'one' && !paused && <p className="commit-plan-rationale">{plan.proposal.rationale}</p>}
      {plan && splitting && (phone ? (
        <>
          <button type="button" className="commit-plan-open" aria-haspopup="dialog" onClick={() => setSheetFor(plan.proposal)}>
            {progress}
            <span className="commit-plan-open-label">View plan<IconChevronRight aria-hidden="true" /></span>
          </button>
          <MobileSheet open={sheetOpen} onOpenChange={(next) => { if (!next) setSheetFor(null); }} title={`Split into ${total} commits`} description={plan.proposal.rationale} tall>
            <div className="commit-plan-sheet">
              {progress}
              {groups}
              <div className="commit-plan-sheet-actions">{commitButton()}</div>
            </div>
          </MobileSheet>
        </>
      ) : (
        <section className="commit-plan" aria-label="Commit plan">
          {progress}
          {groups}
        </section>
      ))}
      {stagedCount > 0 && (
        <div className="commit-box">
          <Textarea
            ref={textareaRef}
            className="commit-composer-input min-h-11 resize-none rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
            value={message}
            onChange={(event) => onMessage(event.target.value)}
            onKeyDown={(event) => {
              // Shift is the "also push" modifier for this command, not part of its binding.
              const withoutShift = normalizeCombo({ key: event.key, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: false, metaKey: event.metaKey });
              if (withoutShift === shortcuts.commit && !commitDisabled) {
                event.preventDefault();
                onCommit({ push: (event.shiftKey || pushChosen) && canPush && !step });
              }
            }}
            placeholder="Commit message"
            aria-label={step ? `Message for commit ${step.position} of ${step.total}` : 'Commit message'}
            disabled={readOnly}
          />
          <div className="commit-box-bar">
            <GenerateAction
              generating={generating}
              harness={harness}
              harnessLabel={harnessLabel}
              modelLabel={modelLabel}
              disabled={blocked || Boolean(busy && busy !== 'refresh')}
              onGenerate={onGenerate}
              onCancelGenerate={onCancelGenerate}
            />
            <div className="commit-composer-commit">
              {commitButton(step ? undefined : 'rounded-r-none')}
              {!step && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button size="sm" className="commit-action-menu rounded-l-none border-l-primary-foreground/25 px-0" aria-label="Choose the commit action" disabled={blocked || Boolean(busy)} />}><IconChevronDown /></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuCheckboxItem closeOnClick checked={!push} onCheckedChange={() => setPushChosen(false)}>Commit</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem closeOnClick checked={push} disabled={!canPush} onCheckedChange={() => setPushChosen(true)}>Commit and push</DropdownMenuCheckboxItem>
                    <p className="commit-action-hint">{commitCombo} runs the button</p>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function discardedNote(outcome: Extract<CommitPlanOutcome, { kind: 'discarded' }>): string {
  if (outcome.committed === 0) return `Plan discarded. All ${files(outcome.restaged)} are staged again.`;
  const kept = outcome.committed === 1 ? 'your commit stays' : `your ${outcome.committed} commits stay`;
  return `Plan discarded. The ${files(outcome.restaged)} left ${outcome.restaged === 1 ? 'is' : 'are'} staged again; ${kept}.`;
}

/** One commit of the plan: what it will say and hold, or the commit it became. */
function PlanGroup({ plan, index, active, expanded, changes, locked, onToggle, onActivate, onOpenPath, onOpenCommit }: {
  plan: CommitPlan; index: number; active: boolean; expanded: boolean; changes: readonly FileChange[]; locked: boolean;
  onToggle(): void; onActivate(): void;
  onOpenPath(path: string, kind: 'staged' | 'unstaged'): void; onOpenCommit(commit: PlannedCommit): void;
}) {
  const group = plan.proposal.commits[index]!;
  const commit = plan.committed[index];
  const total = plan.proposal.commits.length;
  const bodyId = `commit-plan-group-${index}`;
  return (
    <li className={`commit-plan-group${commit ? ' done' : active ? ' active' : ''}${expanded ? ' expanded' : ''}`} aria-current={active ? 'step' : undefined}>
      <button type="button" className="commit-plan-group-head" aria-expanded={expanded} aria-controls={bodyId} onClick={onToggle}>
        <span className="commit-plan-number" aria-hidden="true">{commit ? <IconCheck /> : index + 1}</span>
        <span className="sr-only">Commit {index + 1} of {total}{commit ? ', committed' : active ? ', staged' : ''}: </span>
        <span className="commit-plan-subject">{commit?.subject ?? group.subject}</span>
        <span className="commit-plan-meta">{commit ? <span className="commit-oid">{shortOid(commit.oid)}</span> : files(group.paths.length)}</span>
        <IconChevronRight className="commit-plan-chevron" aria-hidden="true" />
      </button>
      {expanded && (
        <div className="commit-plan-group-body" id={bodyId}>
          {group.body && <p>{group.body}</p>}
          <ul className="commit-plan-files">
            {group.paths.map((filePath) => {
              const kind = plan.kinds[filePath];
              const diffKind = commit ? null : planFileDiffKind(filePath, changes);
              return (
                <li key={filePath}>
                  <img className="vscode-tree-icon" src={getVsCodeFileIconUrl(filePath)} alt="" aria-hidden="true" draggable={false} />
                  <PlanFile
                    path={filePath}
                    hint={commit ? `Open commit ${shortOid(commit.oid)}` : diffKind === 'staged' ? `Open the staged diff for ${filePath}` : `Open the unstaged diff for ${filePath}`}
                    onOpen={commit ? () => onOpenCommit(commit) : diffKind ? () => onOpenPath(filePath, diffKind) : undefined}
                  />
                  {kind && <ChangeStatusBadge kind={kind} />}
                </li>
              );
            })}
          </ul>
          {!commit && !active && <div><Button type="button" variant="outline" size="xs" disabled={locked} onClick={onActivate}>Commit this one next</Button></div>}
        </div>
      )}
    </li>
  );
}

/** A planned file, opening the diff that shows it as it stands. Plain text once it has nothing left to show. */
function PlanFile({ path, hint, onOpen }: { path: string; hint: string; onOpen: (() => void) | undefined }): ReactNode {
  if (!onOpen) return <span className="commit-plan-file">{path}</span>;
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" className="commit-plan-file" onClick={onOpen} />}>{path}</TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function GenerateAction({ generating, harness, harnessLabel, modelLabel, disabled, onGenerate, onCancelGenerate }: {
  generating: boolean; harness: AiHarnessId; harnessLabel: string; modelLabel: string; disabled: boolean;
  onGenerate(): void; onCancelGenerate(): void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={
        <Button
          variant="ghost"
          size="xs"
          className="commit-composer-generate min-w-0 shrink"
          aria-label={generating ? 'Cancel generation' : `Generate with ${harnessLabel} · ${modelLabel}`}
          disabled={disabled}
          onClick={() => generating ? onCancelGenerate() : onGenerate()}
        />
      }>
        {generating ? <IconPlayerStop className="text-destructive" /> : <AiProviderIcon harness={harness} />}
        {generating ? <ShimmeringText text="Generating…" /> : <span className="truncate">{harnessLabel}</span>}
      </TooltipTrigger>
      <TooltipContent>{generating ? 'Cancel generation' : `Generate with ${harnessLabel} · ${modelLabel}`}</TooltipContent>
    </Tooltip>
  );
}
