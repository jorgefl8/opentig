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
      <AccordionTrigger className="ai-executable-trigger p-3">
        <span className="ai-executable-heading">
          <IconAdjustments aria-hidden="true" />
          <span><strong>Advanced CLI detection</strong><small>Executable path and diagnostics</small></span>
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
      </AccordionContent>
    </AccordionItem>
  </Accordion>;
}

function sourceLabel(source: AiHarnessStatus['executableSource']): string {
  return source === 'configured' ? 'Configured path' : source === 'process-path' ? 'Inherited PATH' : source === 'user-path' ? 'Refreshed user PATH' : 'Known installation location';
}
