import { IconRobot } from '@tabler/icons-react';
import type { AiHarnessId } from '@shared/contracts';
import { AiProviderIcon } from '@/features/ai/AiProviderIcon';
import { listAgents } from './local-refs-model';

/** Agents whose mark OpenTig already ships for its own AI settings. */
const HARNESSES: Record<string, AiHarnessId> = { 'Claude Code': 'claude', Codex: 'codex', OpenCode: 'opencode', 'Grok Build': 'grok' };

/** The agent's own mark, or a generic one for agents OpenTig has no mark for. */
export function AgentMark({ agent }: { agent: string }) {
  const harness = HARNESSES[agent];
  return (
    <span className="agent-mark" aria-hidden="true">
      {harness ? <AiProviderIcon harness={harness} /> : <IconRobot />}
    </span>
  );
}

/** The marks of several agents, overlapping like avatars. */
export function AgentMarks({ agents, max = 3 }: { agents: readonly string[]; max?: number }) {
  return (
    <span className="agent-marks" aria-hidden="true">
      {agents.slice(0, max).map((agent) => <AgentMark key={agent} agent={agent} />)}
    </span>
  );
}

/**
 * Marks a worktree where coding agents are working. The names are the label, so it needs no tooltip.
 * The compact form fits a menu row; the full one gives each agent its own chip.
 */
export function AgentLabel({ agents, compact = false }: { agents: readonly string[]; compact?: boolean }) {
  if (agents.length === 0) return null;
  if (!compact) {
    return (
      <span className="agent-labels">
        {agents.map((agent) => (
          <span key={agent} className="agent-label">
            <span className="agent-label-live" aria-hidden="true" />
            <AgentMark agent={agent} />
            {agent}
          </span>
        ))}
        <span className="sr-only"> working</span>
      </span>
    );
  }
  return (
    <span className="agent-label">
      <span className="agent-label-live" aria-hidden="true" />
      <AgentMarks agents={agents} />
      {agents.length > 1 ? `${agents.length} agents` : agents[0]}
      <span className="sr-only">{agents.length > 1 ? ` (${listAgents(agents)})` : ''} working</span>
    </span>
  );
}
