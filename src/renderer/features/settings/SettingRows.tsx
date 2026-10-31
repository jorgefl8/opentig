import { useId, type ReactNode } from 'react';

/** A titled group of settings: a muted heading and rows on spacing, with no frame around them. */
export function SettingGroup({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  const id = useId();
  return <section className={`settings-group${className ? ` ${className}` : ''}`} aria-labelledby={id}>
    <h3 id={id}>{title}</h3>
    {children}
  </section>;
}

/** Label on the left and control on the right, on one line where the control fits. */
export function SettingRow({ label, description, children }: { label: ReactNode; description?: ReactNode; children: ReactNode }) {
  return <div className="settings-row">
    <div className="settings-field-label"><strong>{label}</strong>{description ? <span>{description}</span> : null}</div>
    <div className="settings-row-control">{children}</div>
  </div>;
}
