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
  return <details className="ai-executable-settings settings-field-separated">
    <summary>Advanced CLI detection</summary>
    <div className="settings-field">
      <label className="settings-field-label" htmlFor="ai-executable-path">
        <strong>{harnessLabel(harness)} executable</strong>
        <span>Automatic searches this backend host. For a custom installation, enter its absolute executable path without arguments. In web access, this is a path on the server.</span>
      </label>
      <input className="ai-executable-input" id="ai-executable-path" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Automatic" maxLength={4096} spellCheck={false} autoComplete="off" disabled={saving} />
      <div className="ai-executable-actions">
        <Button size="sm" onClick={() => void save(draft)} disabled={saving || draft === saved}>Save path</Button>
        <Button size="sm" variant="outline" onClick={() => void save('')} disabled={saving || (!saved && !draft)}>Reset to Automatic</Button>
      </div>
      {status?.executablePath && <div className="ai-executable-diagnostic"><strong>Executable path</strong><code>{status.executablePath}</code><span>Source: {sourceLabel(status.executableSource)}</span></div>}
      {status?.discoveryWarning && <p className="ai-login-hint">{status.discoveryWarning}</p>}
    </div>
    <div className="settings-field">
      <label className="settings-field-label" htmlFor="ai-shell-environment"><strong>Refresh user environment</strong><span>Reads the saved Windows environment or runs your Bash, Zsh or Fish startup files on Linux and macOS. Disable to use the inherited environment and known installation locations only.</span></label>
      <button id="ai-shell-environment" type="button" role="switch" aria-checked={preferences.aiShellEnvironment} aria-label="Refresh user environment" className="settings-switch" onClick={() => onPreference({ aiShellEnvironment: !preferences.aiShellEnvironment })}><span /></button>
    </div>
  </details>;
}

function sourceLabel(source: AiHarnessStatus['executableSource']): string {
  return source === 'configured' ? 'Configured path' : source === 'process-path' ? 'Inherited PATH' : source === 'user-path' ? 'Refreshed user PATH' : 'Known installation location';
}
