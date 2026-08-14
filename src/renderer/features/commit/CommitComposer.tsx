import { useEffect, useState, type RefObject } from 'react';
import { IconArrowUp, IconGitCommit, IconPlayerStop, IconSparkles } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Textarea } from '@/components/ui/textarea';

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
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onMessage(message: string): void;
  onGenerate(): void;
  onCancelGenerate(): void;
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
  open, stagedCount, message, generating, harness, busy, readOnly, canPush, textareaRef,
  onMessage, onGenerate, onCancelGenerate, onCommit,
}: CommitComposerProps) {
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
        <span className="commit-composer-title"><IconGitCommit aria-hidden="true" />Commit {fileLabel}</span>
        <span className="commit-composer-hint"><Kbd>Ctrl</Kbd><Kbd>↵</Kbd></span>
      </div>
      <Textarea
        ref={textareaRef}
        className="commit-composer-input"
        value={message}
        onChange={(event) => onMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !commitDisabled) {
            event.preventDefault();
            onCommit({ push: event.shiftKey && canPush });
          }
        }}
        placeholder="Write commit message or…"
        rows={3}
        disabled={readOnly}
      />
      <div className="commit-composer-actions">
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
      </div>
    </div>
  );
}
