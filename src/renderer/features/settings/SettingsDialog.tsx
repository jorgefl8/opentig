import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  IconAlertTriangle, IconDeviceDesktop, IconHierarchy2, IconHistory, IconKeyboard, IconList,
  IconLoader4, IconMoon, IconNetwork, IconRefresh, IconSettings, IconSparkles, IconSun, IconX,
} from '@tabler/icons-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { sileo } from 'sileo';
import type { AiHarnessId, AiHarnessStatus, ChangesLayoutPreference, MonoFontPreference, Preferences, ThemePreference, UiFontPreference } from '../../../shared/contracts';
import {
  formatRemoteFetchInterval,
  MAX_REMOTE_FETCH_INTERVAL_SECONDS,
  REMOTE_FETCH_INTERVAL_STEP_SECONDS,
} from '../../../shared/remote-fetch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { AiLogDialog } from '@/features/ai/AiLogDialog';
import { AiProviderIcon } from '@/features/ai/AiProviderIcon';
import { harnessLabel } from '@/features/ai/harness-copy';
import { opentig } from '@/lib/opentig-api';
import { ProblemsLogDialog } from './ProblemsLogDialog';
import { ShortcutsSettings } from './ShortcutsSettings';
import { UpdateSettings } from './UpdateSettings';
import { WebAccessSettings } from './WebAccessSettings';

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: IconSettings },
  { id: 'updates', label: 'Updates', icon: IconRefresh },
  { id: 'shortcuts', label: 'Shortcuts', icon: IconKeyboard },
  { id: 'ai', label: 'AI assistance', icon: IconSparkles },
  { id: 'diagnostics', label: 'Diagnostics', icon: IconAlertTriangle },
  { id: 'webAccess', label: 'Web access', icon: IconNetwork },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];
const SETTINGS_COPY: Record<Exclude<SettingsSection, 'webAccess'>, { title: string; description: string }> = {
  updates: { title: 'Updates', description: 'Check, download, and install new OpenTig releases.' },
  general: { title: 'General', description: 'OpenTig appearance and behavior.' },
  shortcuts: { title: 'Shortcuts', description: 'Rebind commands or review the shortcuts that stay fixed.' },
  ai: { title: 'AI assistance', description: 'Local harness and model used to suggest commit messages and pull-request drafts.' },
  diagnostics: { title: 'Diagnostics', description: 'Recent local failures on this machine. Prompts and file contents are never recorded.' },
};
const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof IconSun }[] = [
  { value: 'system', label: 'System', icon: IconDeviceDesktop },
  { value: 'light', label: 'Light', icon: IconSun },
  { value: 'dark', label: 'Dark', icon: IconMoon },
];
const UI_FONT_OPTIONS: { value: UiFontPreference; label: string; family: string }[] = [
  { value: 'geist', label: 'Geist', family: "'Geist Variable', sans-serif" },
  { value: 'plus-jakarta-sans', label: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans Variable', sans-serif" },
  { value: 'space-grotesk', label: 'Space Grotesk', family: "'Space Grotesk Variable', sans-serif" },
];
const MONO_FONT_OPTIONS: { value: MonoFontPreference; label: string; family: string }[] = [
  { value: 'geist-mono', label: 'Geist Mono', family: "'Geist Mono Variable', ui-monospace, monospace" },
  { value: 'jetbrains-mono', label: 'JetBrains Mono', family: "'JetBrains Mono Variable', ui-monospace, monospace" },
  { value: 'inconsolata', label: 'Inconsolata', family: "'Inconsolata Variable', ui-monospace, monospace" },
  { value: 'departure', label: 'Departure Mono', family: "'Departure Mono', ui-monospace, monospace" },
  { value: 'space-grotesk', label: 'Space Grotesk', family: "'Space Grotesk Variable', sans-serif" },
];

const CHANGES_LAYOUT_OPTIONS: { value: ChangesLayoutPreference; label: string; icon: typeof IconSun }[] = [
  { value: 'tree', label: 'Tree', icon: IconHierarchy2 },
  { value: 'list', label: 'List', icon: IconList },
];

export function SettingsDialog({ preferences, onPreference, open, onOpenChange, section, onSectionChange }: {
  preferences: Preferences;
  onPreference(partial: Partial<Preferences>): void;
  open: boolean;
  onOpenChange(open: boolean): void;
  section: SettingsSection;
  onSectionChange(section: SettingsSection): void;
}) {
  const [statuses, setStatuses] = useState<AiHarnessStatus[]>([]);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [aiLogOpen, setAiLogOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const settingsBodyRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const settingsTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const };

  const loadStatuses = useCallback(async (forceRefresh = false) => {
    setLoadingStatuses(true);
    try { setStatuses(await opentig.ai.statuses(forceRefresh)); }
    catch (reason) { sileo.error({ title: 'Could not check local AI', description: messageOf(reason) }); }
    finally { setLoadingStatuses(false); }
  }, []);

  useEffect(() => {
    if (open && section === 'ai' && statuses.length === 0) void loadStatuses();
  }, [loadStatuses, open, section, statuses.length]);

  useLayoutEffect(() => {
    if (open && settingsBodyRef.current) settingsBodyRef.current.scrollTop = 0;
  }, [open, section]);

  const selectedHarness = preferences.commitMessageHarness;
  const selectedStatus = statuses.find((status) => status.id === selectedHarness);
  const selectedModel = preferences.commitMessageModels[selectedHarness] ?? 'default';
  const modelOptions = selectedStatus?.models ?? [{ id: 'default', label: 'Default (CLI)' }];
  const visibleModels = modelOptions.some((model) => model.id === selectedModel)
    ? modelOptions
    : [...modelOptions, { id: selectedModel, label: `${selectedModel} (unavailable)` }];
  const { title, description } = section === 'webAccess'
    ? {
        title: 'Web access',
        description: window.opentigDesktop
          ? 'Connect trusted browsers locally, over your LAN, or through an HTTPS tunnel.'
          : 'Review and disconnect browsers authorised to use this OpenTig server.',
      }
    : SETTINGS_COPY[section];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="settings-dialog">
        <div className="settings-shell">
          <aside className="settings-nav">
            <div className="settings-nav-title">Settings</div>
            {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
              <button key={id} className={`settings-nav-item ${section === id ? 'active' : ''}`} onClick={() => onSectionChange(id)} aria-current={section === id}>
                <Icon /> {label}
              </button>
            ))}
          </aside>
          <section className="settings-panel">
            <header className="settings-panel-header">
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={section}
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -3 }}
                  transition={settingsTransition}
                >
                  <DialogTitle>{title}</DialogTitle>
                  <DialogDescription>{description}</DialogDescription>
                </motion.div>
              </AnimatePresence>
              <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close settings" />}><IconX /></DialogClose>
            </header>
            <div ref={settingsBodyRef} className="settings-panel-body">
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={section}
                  className="settings-panel-section"
                  initial={reduceMotion ? false : { opacity: 0, y: 7 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -5 }}
                  transition={settingsTransition}
                >
              {section === 'general' ? <>
              <div className="settings-field">
                <div className="settings-field-label">
                  <strong>Theme</strong>
                  <span>Choose a light, dark, or system appearance.</span>
                </div>
                <div className="settings-theme-options" role="radiogroup" aria-label="Theme">
                  {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <button key={value} type="button" role="radio" aria-checked={preferences.theme === value} className={`settings-theme-option ${preferences.theme === value ? 'active' : ''}`} onClick={() => onPreference({ theme: value })}>
                      <Icon /> <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-field settings-field-separated">
                <div className="settings-field-label">
                  <strong>Fonts</strong>
                  <span>Interface chrome and code, chosen independently. Space Grotesk appears in both lists.</span>
                </div>
                <div className="settings-font-pickers">
                  <label className="settings-font-picker">
                    <span>Interface</span>
                    <Select
                      value={preferences.uiFont}
                      onValueChange={(value) => {
                        const next = UI_FONT_OPTIONS.find((option) => option.value === value);
                        if (next) onPreference({ uiFont: next.value });
                      }}
                    >
                      <SelectTrigger className="settings-font-select" aria-label="Interface font" style={{ fontFamily: UI_FONT_OPTIONS.find((option) => option.value === preferences.uiFont)?.family }}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" alignItemWithTrigger={false} className="w-max min-w-[16rem]">
                        {UI_FONT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <span style={{ fontFamily: option.family }}>{option.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="settings-font-picker">
                    <span>Code</span>
                    <Select
                      value={preferences.monoFont}
                      onValueChange={(value) => {
                        const next = MONO_FONT_OPTIONS.find((option) => option.value === value);
                        if (next) onPreference({ monoFont: next.value });
                      }}
                    >
                      <SelectTrigger className="settings-font-select" aria-label="Code font" style={{ fontFamily: MONO_FONT_OPTIONS.find((option) => option.value === preferences.monoFont)?.family }}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" alignItemWithTrigger={false} className="w-max min-w-[16rem]">
                        {MONO_FONT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <span style={{ fontFamily: option.family }}>{option.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              </div>
              <div className="settings-field settings-field-separated">
                <div className="settings-field-label">
                  <strong>Interface size</strong>
                  <span>Adjust the zoom for text, icons, and the rest of the application.</span>
                </div>
                <div className="settings-zoom-control">
                  <input type="range" min="80" max="130" step="10" value={preferences.uiZoom} onChange={(event) => onPreference({ uiZoom: Number(event.target.value) })} aria-label="Interface zoom" />
                  <output>{preferences.uiZoom}%</output>
                </div>
              </div>
              <div className="settings-field settings-field-separated">
                <div className="settings-field-label">
                  <strong>Changes layout</strong>
                  <span>Group changed files by folder or show them as a flat list.</span>
                </div>
                <div className="settings-theme-options" role="radiogroup" aria-label="Changes layout">
                  {CHANGES_LAYOUT_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <button key={value} type="button" role="radio" aria-checked={preferences.changesLayout === value} className={`settings-theme-option ${preferences.changesLayout === value ? 'active' : ''}`} onClick={() => onPreference({ changesLayout: value })}>
                      <Icon /> <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-field settings-field-separated">
                <div className="settings-field-label">
                  <strong>Remote check interval</strong>
                  <span>How often OpenTig fetches remotes so ahead and behind counts stay current. Set to Off to check only when you pull or push.</span>
                </div>
                <div className="settings-zoom-control">
                  <input
                    type="range"
                    min="0"
                    max={MAX_REMOTE_FETCH_INTERVAL_SECONDS}
                    step={REMOTE_FETCH_INTERVAL_STEP_SECONDS}
                    value={preferences.remoteFetchIntervalSeconds}
                    onChange={(event) => onPreference({ remoteFetchIntervalSeconds: Number(event.target.value) })}
                    aria-label="Remote check interval"
                  />
                  <output>{formatRemoteFetchInterval(preferences.remoteFetchIntervalSeconds)}</output>
                </div>
              </div>
              <div className="settings-field settings-field-separated settings-toggle-row">
                <div className="settings-field-label">
                  <strong>Wrap lines in viewer</strong>
                  <span>Wrap long lines to fit the available width.</span>
                </div>
                <button type="button" role="switch" aria-label="Wrap lines in viewer" aria-checked={preferences.wrapLines} className="settings-switch" onClick={() => onPreference({ wrapLines: !preferences.wrapLines })}><span /></button>
              </div>
              <div className="settings-field settings-field-separated settings-toggle-row">
                <div className="settings-field-label">
                  <strong>Show files ignored by Git</strong>
                  <span>Include files excluded by <code>.gitignore</code> rules in the Files view.</span>
                </div>
                <button type="button" role="switch" aria-label="Show files ignored by Git" aria-checked={preferences.showDotEnvFiles} className="settings-switch" onClick={() => onPreference({ showDotEnvFiles: !preferences.showDotEnvFiles })}><span /></button>
              </div>
              </> : section === 'updates' ? <UpdateSettings /> : section === 'shortcuts' ? <ShortcutsSettings preferences={preferences} onPreference={onPreference} /> : section === 'webAccess' ? <WebAccessSettings /> : section === 'diagnostics' ? <>
                <div className="settings-field">
                  <div className="settings-field-label">
                    <strong>Problem history</strong>
                    <span>Failed Git, file, and network operations recorded locally. Prompts and file contents are never stored.</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setProblemsOpen(true)}><IconAlertTriangle /> View problems</Button>
                </div>
                <ProblemsLogDialog open={problemsOpen} onOpenChange={setProblemsOpen} />
              </> : <>
                <div className="ai-settings-heading">
                  <div className="settings-field-label">
                    <strong>Local harness</strong>
                    <span>OpenTig uses the selected CLI session. It does not copy or store credentials.</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void loadStatuses(true)} disabled={loadingStatuses}>
                    {loadingStatuses ? <IconLoader4 className="animate-spin" /> : <IconRefresh />} {loadingStatuses ? <ShimmeringText text="Checking…" /> : 'Check again'}
                  </Button>
                </div>
                <div className="ai-harness-list" role="radiogroup" aria-label="Harness for AI assistance">
                  {(['codex', 'claude', 'opencode'] as const).map((harness) => {
                    const harnessStatus = statuses.find((status) => status.id === harness);
                    const selected = selectedHarness === harness;
                    return (
                      <button key={harness} type="button" role="radio" aria-checked={selected} className={`ai-harness-card ${selected ? 'active' : ''}`} onClick={() => onPreference({ commitMessageHarness: harness })}>
                        <span className="ai-harness-card-main">
                          <AiProviderIcon harness={harness} />
                          <span className="ai-harness-card-copy">
                            <strong>{harnessLabel(harness)}</strong>
                            <small>{loadingStatuses ? 'Checking…' : harnessStatus?.version || (harnessStatus ? (harnessStatus.installed ? 'Version unavailable' : 'Executable not found') : 'Status not checked')}</small>
                          </span>
                        </span>
                        <Badge variant={availabilityBadgeVariant(harnessStatus)} className={`ai-status-badge ${harnessStatus?.availability ?? 'unknown'}`}>
                          {availabilityLabel(harnessStatus)}
                        </Badge>
                        {harnessStatus?.message && <span className="ai-harness-message">{harnessStatus.message}</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="settings-field settings-field-separated">
                  <div className="settings-field-label">
                    <strong>{harnessLabel(selectedHarness)} model</strong>
                    <span>Default lets the CLI choose. OpenTig remembers a separate selection for each harness.</span>
                  </div>
                  <Select value={selectedModel} onValueChange={(model) => onPreference({ commitMessageModels: { ...preferences.commitMessageModels, [selectedHarness]: model } })}>
                    <SelectTrigger className="ai-model-select"><SelectValue /></SelectTrigger>
                    <SelectContent>{visibleModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {selectedStatus?.authStatus === 'unauthenticated' && <p className="ai-login-hint">Sign in from a terminal with <code>{loginCommand(selectedHarness, selectedStatus.cliName)}</code> and check again.</p>}
                  {selectedStatus && !selectedStatus.installed && <p className="ai-login-hint">Install {harnessLabel(selectedHarness)} and check its availability again.</p>}
                </div>
                <div className="settings-field settings-field-separated">
                  <div className="settings-field-label">
                    <strong>Generation history</strong>
                    <span>Outcome, duration, tokens, and cost of recent runs, kept locally for diagnostics.</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setAiLogOpen(true)}><IconHistory /> View history</Button>
                </div>
                <p className="ai-privacy-note">Only the staged diff, its summary, the branch, and recent subjects are sent to the selected harness. The generated message always remains pending your review, and the history records metadata only.</p>
                <AiLogDialog open={aiLogOpen} onOpenChange={setAiLogOpen} />
              </>}
                </motion.div>
              </AnimatePresence>
            </div>
          </section>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function availabilityLabel(status: AiHarnessStatus | undefined): string {
  if (!status) return 'Not checked';
  if (!status.installed) return 'Not installed';
  if (status.authStatus === 'unauthenticated') return 'Not authenticated';
  if (status.availability === 'ready') return 'Available';
  return 'Check';
}

function availabilityBadgeVariant(status: AiHarnessStatus | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!status) return 'outline';
  if (!status.installed || status.authStatus === 'unauthenticated' || status.availability === 'error') return 'destructive';
  return status.availability === 'ready' ? 'default' : 'secondary';
}

function loginCommand(harness: AiHarnessId, cliName?: string): string {
  if (harness === 'codex') return 'codex login';
  if (harness === 'claude') return 'claude auth login';
  return cliName === 'opencode2' ? 'opencode2 auth login' : 'opencode auth login';
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'An unexpected error occurred.';
}
