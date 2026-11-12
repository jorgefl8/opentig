import { IconRobot } from '@tabler/icons-react';
import { listAgents } from './local-refs-model';

/** Marks a worktree where coding agents are working. The names are the label, so it needs no tooltip. */
export function AgentLabel({ agents, compact = false }: { agents: readonly string[]; compact?: boolean }) {
  if (agents.length === 0) return null;
  const text = compact && agents.length > 1 ? `${agents[0]} +${agents.length - 1}` : listAgents(agents);
  return (
    <span className="agent-label">
      <IconRobot aria-hidden="true" />
      {text}
      <span className="sr-only">{compact && agents.length > 1 ? ` (${listAgents(agents)})` : ''} working</span>
    </span>
  );
}
