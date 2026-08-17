import { useEffect, useState, type RefObject } from 'react';
import { IconArrowUp, IconCheck, IconGitCommit, IconListDetails, IconPlayerStop, IconSparkles, IconX } from '@tabler/icons-react';
import type { CommitSplitProposal } from '@shared/contracts';
import { normalizeCombo } from '@shared/shortcuts';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useShortcuts } from '@/app/useShortcuts';

/** Keep the exit animations in sync with the durations declared in index.css. */
const EXIT_MS = 170;

interface CommitComposerProps {
  open: boolean;
  stagedCount: number;
  message: string;
  generating: boolean;
  harness: string;
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

/**
 * Keeps a node mounted while its exit animation plays, so the composer and its
 * actions can animate out instead of disappearing in a single frame.
 */
function useExitAnimation(open: boolean, duration: number): { mounted: boolean; state: 'open' | 'closed' } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const timer = window.setTimeout(() => setMounted(false), duration);
    return () => window.clearTimeout(timer);
  }, [open, duration]);
  return { mounted, state: open ? 'open' : 'closed' };
}

export function CommitComposer({
  open, stagedCount, message, generating, harness, busy, readOnly, canPush, proposal, preparedIndex, completed, collapsed, textareaRef,
  onMessage, onGenerate, onCancelGenerate, onDismissProposal, onToggleCollapsed, onOpenPath, onPrepare, onCommit,
}: CommitComposerProps) {
  const shortcuts = useShortcuts();
  const commitComboKeys = shortcuts.commit.split('+');
  const panel = useExitAnimation(open, EXIT_MS);
  const hasMessage = message.trim().length > 0;
  // The commit actions stay hidden until there is something to commit, so the
  // first decision is always "write it or generate it".
  const actions = useExitAnimation(open && hasMessage && !generating, EXIT_MS);
  if (!panel.mounted) return null;

  const committing = busy === 'commit';
  const pushing = busy === 'push';
  const blocked = readOnly || stagedCount === 0;
  const commitDisabled = blocked || !hasMessage || Boolean(busy);
  const fileLabel = `${stagedCount} ${stagedCount === 1 ? 'file' : 'files'}`;

  return (
    <div className="commit-composer" data-state={panel.state} role="group" aria-label="Create commit">
      <div className="commit-composer-header">
        <span className="commit-composer-title"><IconGitCommit aria-hidden="true" />{stagedCount > 0 ? `Commit ${fileLabel}` : 'Commit plan'}</span>
        {stagedCount > 0 && <span className="commit-composer-hint">{commitComboKeys.map((key) => <Kbd key={key}>{key === 'Enter' ? '↵' : key}</Kbd>)}</span>}
      </div>
      {proposal && (
        <section className="commit-plan" aria-label="Suggested commit plan">
          <div className="commit-plan-heading">
            <span>
              <IconListDetails aria-hidden="true" />
              <strong>{proposal.commits.length} commits suggested</strong>
              {completed.size > 0 && <em className="commit-plan-progress">{completed.size} of {proposal.commits.length} done</em>}
            </span>
            <span className="commit-plan-heading-actions">
              <Button type="button" variant="ghost" size="xs" aria-expanded={!collapsed} onClick={onToggleCollapsed}>
                {collapsed ? 'Show plan' : 'Hide plan'}
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Discard the commit plan and keep one commit" onClick={onDismissProposal}><IconX /></Button>
            </span>
          </div>
          {!collapsed && (
            <>
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
                        variant={prepared ? 'secondary' : 'outline'}
                        size="xs"
                        disabled={readOnly || Boolean(busy) || prepared || done}
                        onClick={() => onPrepare(index)}
                      >{done ? 'Committed' : prepared ? 'Prepared' : 'Prepare'}</Button>
                    </article>
                  );
                })}
              </div>
              <small className="commit-plan-note">Preparing changes only the Git index, in the listed order. Review the diff before committing; JustGit never creates the commits automatically.</small>
            </>
          )}
        </section>
      )}
      {stagedCount > 0 && <Textarea
        ref={textareaRef}
        className="commit-composer-input"
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
        placeholder="Write commit message or…"
        rows={3}
        disabled={readOnly}
      />}
      {stagedCount > 0 && <div className="commit-composer-actions">
        <Button
          variant="outline"
          className="commit-composer-generate"
          aria-label={generating ? 'Cancel generation' : undefined}
          disabled={blocked || Boolean(busy && busy !== 'refresh')}
          onClick={() => generating ? onCancelGenerate() : onGenerate()}
        >
          {generating ? <IconPlayerStop className="text-destructive" /> : <IconSparkles />}
          {generating ? <ShimmeringText text="Generating message…" /> : <span>Generate with <span className="commit-composer-harness">{harness}</span></span>}
        </Button>
        {actions.mounted && (
          <div className="commit-composer-commit" data-state={actions.state}>
            <Button className="commit-composer-primary" disabled={commitDisabled} onClick={() => onCommit({ push: false })}>
              <IconGitCommit /> {committing ? 'Committing…' : 'Commit'}
            </Button>
            <Button
              variant="outline"
              className="commit-composer-secondary"
              disabled={commitDisabled || !canPush}
              onClick={() => onCommit({ push: true })}
            >
              <IconArrowUp /> {pushing ? 'Pushing…' : 'Commit and push'}
            </Button>
          </div>
        )}
      </div>}
    </div>
  );
}
