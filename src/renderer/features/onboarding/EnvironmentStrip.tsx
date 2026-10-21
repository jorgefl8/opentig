import { IconLoader4, IconRefresh } from '@tabler/icons-react';
import type { AiHarnessId, AiHarnessStatus } from '@shared/contracts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AiProviderIcon } from '@/features/ai/AiProviderIcon';
import { harnessLabel } from '@/features/ai/harness-copy';
import type { SettingsSection } from '@/features/settings/SettingsDialog';
import type { ToolChecks } from './useToolChecks';

const AI_HARNESSES = ['codex', 'claude', 'opencode', 'grok'] as const satisfies readonly AiHarnessId[];

const GITHUB_COPY = {
  pending: ['Checking GitHub CLI…', ''],
  ready: ['GitHub CLI', 'signed in'],
  'sign-in': ['GitHub CLI', 'sign-in needed'],
  missing: ['GitHub CLI', 'not installed'],
  error: ['GitHub CLI', 'check failed'],
} as const;

/** One line of optional tool status. Only Git can block, and that is shown elsewhere. */
export function EnvironmentStrip({ checks, assistant, onAssistant, onSettings }: {
  checks: ToolChecks;
  assistant: AiHarnessId;
  onAssistant(id: AiHarnessId): void;
  onSettings(section: SettingsSection): void;
}) {
  const { git, github, ai, assistants } = checks;
  const [githubLabel, githubDetail] = GITHUB_COPY[github];
  const selected = assistants?.includes(assistant) ? assistant : assistants?.[0];
  return <div className="onboarding-env" aria-label="Tools">
    <span className="onboarding-chip">{git ? <Dot state={git.state === 'ready' ? 'ready' : 'error'} /> : <Spinner />}{git?.state === 'ready' ? <>Git <em>{git.version}</em></> : git ? 'Git unavailable' : 'Checking Git…'}</span>
    <span className="onboarding-chip">
      {github === 'pending' ? <Spinner /> : <Dot state={github === 'ready' ? 'ready' : github === 'error' ? 'error' : 'warning'} />}{githubLabel}{githubDetail && <em>{githubDetail}</em>}
      {github !== 'pending' && github !== 'ready' && <button type="button" onClick={() => onSettings('github')}>Set up</button>}
    </span>
    {!ai || !assistants ? <span className="onboarding-chip"><Spinner />Checking AI assistants…</span>
      : <span className="onboarding-ai">
        <Select value={selected ?? null} onValueChange={value => { if (value) onAssistant(value as AiHarnessId); }}>
          {/* The whole chip is the trigger; utilities override the default field look. */}
          <SelectTrigger aria-label="AI assistant" size="sm" className="onboarding-chip gap-1.5 rounded-full bg-card px-2.5 text-[11.5px] font-normal hover:bg-muted aria-expanded:bg-muted dark:bg-card dark:hover:bg-muted dark:aria-expanded:bg-muted [&_svg:not([class*='size-'])]:size-3.5">
            <Dot state={selected ? 'ready' : 'none'} />AI
            <SelectValue>{selected ? <span className="onboarding-ai-value"><AiProviderIcon harness={selected} />{harnessLabel(selected)}</span> : <em>none found</em>}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} className="onboarding-ai-menu">
            {AI_HARNESSES.map(id => {
              const ready = assistants.includes(id);
              return <SelectItem key={id} value={id} disabled={!ready}>
                <AiProviderIcon harness={id} /><span className="onboarding-ai-name">{harnessLabel(id)}</span>
                <small className={ready ? 'onboarding-ai-state ready' : 'onboarding-ai-state'}>{assistantState(ai.find(status => status.id === id))}</small>
              </SelectItem>;
            })}
          </SelectContent>
        </Select>
        {!selected && <Tooltip><TooltipTrigger render={<button type="button" className="onboarding-ai-setup" onClick={() => onSettings('ai')} />}>Set up</TooltipTrigger>
          <TooltipContent>Optional. Install Codex, Claude Code, OpenCode, or Grok Build and sign in to draft commit messages.</TooltipContent></Tooltip>}
      </span>}
    <Tooltip><TooltipTrigger render={<button type="button" className="onboarding-chip onboarding-recheck" aria-label="Check tools again" disabled={checks.checking} onClick={checks.recheck} />}><IconRefresh /></TooltipTrigger><TooltipContent>Check again</TooltipContent></Tooltip>
  </div>;
}

function assistantState(status: AiHarnessStatus | undefined): string {
  if (!status) return 'Not checked';
  if (status.installationStatus === 'inspection-failed') return 'Check failed';
  if (status.installationStatus === 'not-executable' || status.installationStatus === 'incompatible') return 'Can’t run';
  if (!status.installed) return 'Not installed';
  if (status.authStatus === 'unauthenticated') return 'Sign in needed';
  return status.availability === 'error' ? 'Check failed' : 'Detected';
}

function Dot({ state }: { state: 'ready' | 'warning' | 'error' | 'none' }) {
  return <span className={`onboarding-dot ${state}`} aria-hidden="true" />;
}

function Spinner() {
  return <IconLoader4 className="onboarding-chip-spinner animate-spin" aria-hidden="true" />;
}
