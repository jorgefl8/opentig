import { useState } from 'react';
import type { AiHarnessId, AiHarnessStatus, Preferences } from '../../../shared/contracts';
import { IconAdjustments } from '@tabler/icons-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
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
  return <Accordion className="ai-executable-settings">
    <AccordionItem value="cli-detection">
      <AccordionTrigger className="ai-executable-trigger">
        <span className="ai-executable-heading">
          <IconAdjustments aria-hidden="true" />
          <span><strong>Advanced CLI detection</strong><small>Executable path and environment</small></span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="ai-executable-content">
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="ai-executable-path">
            <strong>{harnessLabel(harness)} executable</strong>
            <span>Leave on Automatic, or enter an absolute executable path without arguments. For web access, use a path on the server.</span>
          </label>
          <div className="ai-executable-editor">
            <input className="ai-executable-input" id="ai-executable-path" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Automatic" maxLength={4096} spellCheck={false} autoComplete="off" disabled={saving} />
            <div className="ai-executable-actions">
              <Button size="sm" onClick={() => void save(draft)} disabled={saving || draft === saved}>Save path</Button>
              <Button size="sm" variant="outline" onClick={() => void save('')} disabled={saving || (!saved && !draft)}>Reset to Automatic</Button>
            </div>
          </div>
          {status?.executablePath && <div className="ai-executable-diagnostic"><strong>Detected executable</strong><code>{status.executablePath}</code><span>Source: {sourceLabel(status.executableSource)}</span></div>}
          {status?.discoveryWarning && <p className="ai-login-hint">{status.discoveryWarning}</p>}
        </div>
        <div className="settings-field settings-toggle-row ai-environment-row">
          <label className="settings-field-label" htmlFor="ai-shell-environment"><strong>Refresh user environment</strong><span>Reads the saved Windows environment or runs your Bash, Zsh or Fish startup files on Linux and macOS. Disable to use the inherited environment and known installation locations only.</span></label>
          <button id="ai-shell-environment" type="button" role="switch" aria-checked={preferences.aiShellEnvironment} aria-label="Refresh user environment" className="settings-switch" onClick={() => onPreference({ aiShellEnvironment: !preferences.aiShellEnvironment })}><span /></button>
        </div>
      </AccordionContent>
    </AccordionItem>
  </Accordion>;
}

function sourceLabel(source: AiHarnessStatus['executableSource']): string {
  return source === 'configured' ? 'Configured path' : source === 'process-path' ? 'Inherited PATH' : source === 'user-path' ? 'Refreshed user PATH' : 'Known installation location';
}
