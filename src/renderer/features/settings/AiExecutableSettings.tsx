import { useState } from 'react';
import type { AiHarnessId, AiHarnessStatus, Preferences } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { harnessLabel } from '@/features/ai/harness-copy';

export function AiExecutableSettings({ harness, preferences, status, onPreference }: {
  harness: AiHarnessId;
  preferences: Preferences;
  status: AiHarnessStatus | undefined;
  onPreference(partial: Partial<Preferences>): void | Promise<boolean>;
}) {
  const saved = preferences.aiExecutablePaths[harness] ?? '';
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const save = async (value: string) => {
    setSaving(true);
    try {
      const result = await onPreference({ aiExecutablePaths: { ...preferences.aiExecutablePaths, [harness]: value } });
      if (result !== false) setDraft(value);
    } finally { setSaving(false); }
  };
  return <details className="settings-disclosure">
    <summary>Advanced CLI detection</summary>
    <div className="settings-disclosure-content">
      <label className="settings-field-label" htmlFor="ai-executable-path">
        <strong>{harnessLabel(harness)} executable</strong>
        <span>Leave on Automatic, or enter an absolute executable path without arguments. For web access, use a path on the server.</span>
      </label>
      <input className="field-input ai-executable-input" id="ai-executable-path" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Automatic" maxLength={4096} spellCheck={false} autoComplete="off" disabled={saving} />
      <div className="settings-actions">
        <Button size="sm" onClick={() => void save(draft)} disabled={saving || draft === saved}>Save path</Button>
        <Button size="sm" variant="ghost" onClick={() => void save('')} disabled={saving || (!saved && !draft)}>Reset to Automatic</Button>
      </div>
      {status?.executablePath && <div className="settings-note ai-executable-diagnostic"><span>Detected executable</span><code>{status.executablePath}</code><span>Source: {sourceLabel(status.executableSource)}</span></div>}
      {status?.discoveryWarning && <p className="settings-note">{status.discoveryWarning}</p>}
    </div>
  </details>;
}

function sourceLabel(source: AiHarnessStatus['executableSource']): string {
  return source === 'configured' ? 'Configured path' : source === 'process-path' ? 'Inherited PATH' : source === 'user-path' ? 'Refreshed user PATH' : 'Known installation location';
}
