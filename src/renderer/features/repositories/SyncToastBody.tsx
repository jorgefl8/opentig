import { useState, type MouseEvent } from 'react';

export interface SyncToastAction {
  title: string;
  onClick(): void;
}

/**
 * The body of a Sileo notice that has up to two actions and Git's own words
 * folded under "Details". Sileo draws a notice as one button, so its controls
 * are links, like the action Sileo renders itself.
 */
export function SyncToastBody({ lead, description, details, actions, offer }: { lead: string | undefined; description: string | undefined; details: string | undefined; actions: SyncToastAction[]; offer: boolean | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const run = (action: () => void) => (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  return (
    <>
      {lead && <strong className="sync-toast-lead">{lead} </strong>}
      {description}
      {actions.length > 0 && (
        <span className="sync-toast-actions">
          {actions.map((action, index) => (
            <a key={action.title} href="#" role="button" data-sileo-button {...(index === 0 ? { 'data-state': offer ? 'info' : 'error' } : {})} onClick={run(action.onClick)}>{action.title}</a>
          ))}
        </span>
      )}
      {details && (
        <>
          <a href="#" role="button" data-sileo-button className="sync-toast-details-toggle" aria-expanded={expanded} onClick={run(() => setExpanded((current) => !current))}>
            {expanded ? 'Hide details' : 'Details'}
          </a>
          {expanded && <pre className="sync-toast-details">{details}</pre>}
        </>
      )}
    </>
  );
}
