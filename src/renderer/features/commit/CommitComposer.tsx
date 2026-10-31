import type { RefObject } from 'react';
import { IconCheck, IconPlayerStop, IconX } from '@tabler/icons-react';
import type { AiHarnessId, CommitSplitProposal } from '@shared/contracts';
import { normalizeCombo } from '@shared/shortcuts';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useShortcuts } from '@/app/useShortcuts';
import { AiProviderIcon } from '@/features/ai/AiProviderIcon';
import { useTruncatedText } from '@/lib/use-truncated-text';

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
  proposal: CommitSplitProposal | null;
  preparedIndex: number | null;
  /** Indices of plan groups already committed, kept so numbering stays stable. */
  completed: ReadonlySet<number>;
  collapsed: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onMessage(message: string): void;
  onGenerate(): void;
  onCancelGenerate(): void;
  onDismissProposal(): void;
  onToggleCollapsed(): void;
  onOpenPath(path: string): void;
  onPrepare(index: number): void;
  onCommit(options: { push: boolean }): void;
}

export function CommitComposer({
  open, stagedCount, message, generating, harness, harnessLabel, modelLabel, busy, readOnly, canPush, proposal, preparedIndex, completed, collapsed, textareaRef,
  onMessage, onGenerate, onCancelGenerate, onDismissProposal, onToggleCollapsed, onOpenPath, onPrepare, onCommit,
}: CommitComposerProps) {
  const shortcuts = useShortcuts();
  if (!open) return null;

  const commitCombo = shortcuts.commit.replace('Enter', '↵');
  const committing = busy === 'commit';
  const pushing = busy === 'push';
  const blocked = readOnly || stagedCount === 0;
  // A generation in progress is about to replace the message, so what would be
  // committed isn't settled yet.
  const commitDisabled = blocked || message.trim().length === 0 || generating || Boolean(busy);

  return (
    <div className="commit-composer" role="group" aria-label="Create commit">
      {proposal && (
        <section className="commit-plan" aria-label="Suggested commit plan">
          <div className="commit-plan-heading">
            <span>
              <strong>{proposal.commits.length} commits suggested</strong>
              {completed.size > 0 && <em className="commit-plan-progress">{completed.size} of {proposal.commits.length} done</em>}
            </span>
            <span className="commit-plan-heading-actions">
              <button type="button" className="quiet-action" aria-expanded={!collapsed} onClick={onToggleCollapsed}>
                {collapsed ? 'Show plan' : 'Hide plan'}
              </button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Discard the commit plan and keep one commit" onClick={onDismissProposal}><IconX /></Button>
            </span>
          </div>
          {!collapsed && (
            <div className="commit-plan-body">
              <p>{proposal.rationale}</p>
              <div className="commit-plan-list">
                {/* Numbering follows the original plan even after commits are
                    made, so the list never renumbers itself under the user. */}
                {proposal.commits.map((commit, index) => {
                  const done = completed.has(index);
                  const prepared = preparedIndex === index;
                  return (
                    <article
                      key={`${commit.subject}:${commit.paths.join('\0')}`}
                      className={[done ? 'done' : '', prepared ? 'prepared' : ''].filter(Boolean).join(' ')}
                      aria-current={prepared ? 'step' : undefined}
                    >
                      <div>
                        <strong>
                          {done && <IconCheck className="commit-plan-done-icon" aria-hidden="true" />}
                          {index + 1}. {commit.subject}
                        </strong>
                        <small>{commit.reason}</small>
                        <span className="commit-plan-paths">
                          {commit.paths.map((filePath) => (
                            <Tooltip key={filePath}>
                              <TooltipTrigger render={<button type="button" className="commit-plan-path" onClick={() => onOpenPath(filePath)} />}>
                                {filePath}
                              </TooltipTrigger>
                              <TooltipContent>Open the diff for {filePath}</TooltipContent>
                            </Tooltip>
                          ))}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={readOnly || Boolean(busy) || prepared || done}
                        onClick={() => onPrepare(index)}
                      >{done ? 'Committed' : prepared ? 'Prepared' : 'Prepare'}</Button>
                    </article>
                  );
                })}
              </div>
              <small className="commit-plan-note">Preparing changes only the Git index, in the listed order. Review the diff before committing; OpenTig never creates the commits automatically.</small>
            </div>
          )}
        </section>
      )}
      {stagedCount > 0 && (
        <>
          <Textarea
            ref={textareaRef}
            className="commit-composer-input min-h-13 px-2.5 py-1.5"
            value={message}
            onChange={(event) => onMessage(event.target.value)}
            onKeyDown={(event) => {
              // Shift is the "also push" modifier for this command, not part of its binding.
              const withoutShift = normalizeCombo({ key: event.key, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: false, metaKey: event.metaKey });
              if (withoutShift === shortcuts.commit && !commitDisabled) {
                event.preventDefault();
                onCommit({ push: event.shiftKey && canPush });
              }
            }}
            placeholder="Commit message"
            aria-label="Commit message"
            disabled={readOnly}
          />
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
            <Button size="sm" disabled={commitDisabled} onClick={() => onCommit({ push: false })}>
              {committing ? <ShimmeringText text="Committing…" /> : `Commit ${stagedCount} ${stagedCount === 1 ? 'file' : 'files'}`}
            </Button>
            <Button variant="ghost" size="sm" className="px-2" disabled={commitDisabled || !canPush} onClick={() => onCommit({ push: true })}>
              {pushing ? <ShimmeringText text="Pushing…" /> : 'Commit and push'}
            </Button>
            <kbd className="commit-composer-hint">{commitCombo}</kbd>
          </div>
        </>
      )}
    </div>
  );
}

function GenerateAction({ generating, harness, harnessLabel, modelLabel, disabled, onGenerate, onCancelGenerate }: {
  generating: boolean; harness: AiHarnessId; harnessLabel: string; modelLabel: string; disabled: boolean;
  onGenerate(): void; onCancelGenerate(): void;
}) {
  const [textRef, truncated] = useTruncatedText(`${harnessLabel}\u0000${modelLabel}\u0000${generating}`);
  const label = <span className="commit-composer-provider">Generate with <span className="commit-composer-harness">{harnessLabel}</span><span aria-hidden="true">·</span><span className="commit-composer-model">{modelLabel}</span></span>;
  return (
    <Tooltip disabled={!truncated}>
      <TooltipTrigger render={
        <Button
          variant="ghost"
          size="xs"
          className="commit-composer-generate min-w-0 shrink"
          aria-label={generating ? 'Cancel generation' : undefined}
          disabled={disabled}
          onClick={() => generating ? onCancelGenerate() : onGenerate()}
        />
      }>
        {generating ? <IconPlayerStop className="text-destructive" /> : <AiProviderIcon harness={harness} />}
        {generating ? <ShimmeringText text="Generating message…" /> : <span ref={textRef} className="commit-composer-generate-text">{label}</span>}
      </TooltipTrigger>
      <TooltipContent>{harnessLabel} · {modelLabel}</TooltipContent>
    </Tooltip>
  );
}
