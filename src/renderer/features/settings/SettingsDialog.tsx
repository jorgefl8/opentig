import { RepositoryAiSettings } from './RepositoryAiSettings';
import { GitHubSettings } from './GitHubSettings';
import { AiExecutableSettings } from './AiExecutableSettings';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { aiExecutablePathsKey } from '@shared/ai-status';
import { formatDateTime } from '@shared/date-format';
import {
  IconAlertTriangle, IconBrandGithub, IconHistory, IconKeyboard,
  IconLoader4, IconNetwork, IconRefresh, IconSettings, IconSparkles, IconX,
} from '@tabler/icons-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { sileo } from 'sileo';
import type { AiHarnessId, AiHarnessStatus, Preferences, RepositoryInfo } from '../../../shared/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { SearchablePicker, type SearchablePickerGroup } from '@/components/SearchablePicker';
import { AiLogDialog } from '@/features/ai/AiLogDialog';
import { AiProviderIcon } from '@/features/ai/AiProviderIcon';
import { harnessLabel } from '@/features/ai/harness-copy';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { GeneralSettings } from './GeneralSettings';
import { ProblemsLogDialog } from './ProblemsLogDialog';
import { ShortcutsSettings } from './ShortcutsSettings';
import { UpdateSettings } from './UpdateSettings';
import { WebAccessSettings } from './WebAccessSettings';

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: IconSettings },
  { id: 'updates', label: 'Updates', icon: IconRefresh },
  { id: 'shortcuts', label: 'Shortcuts', icon: IconKeyboard },
  { id: 'github', label: 'GitHub', icon: IconBrandGithub },
  { id: 'ai', label: 'AI assistance', icon: IconSparkles },
  { id: 'diagnostics', label: 'Diagnostics', icon: IconAlertTriangle },
  { id: 'webAccess', label: 'Web access', icon: IconNetwork },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];
const SETTINGS_COPY: Record<Exclude<SettingsSection, 'webAccess'>, { title: string; description: string }> = {
  github: { title: 'GitHub', description: 'Separate settings for this repository and the OpenTig instance.' },
  updates: { title: 'Updates', description: 'Check, download, and install new OpenTig releases.' },
  general: { title: 'General', description: 'Appearance, files and repository behavior.' },
  shortcuts: { title: 'Shortcuts', description: 'Rebind commands or review the shortcuts that stay fixed.' },
  ai: { title: 'AI assistance', description: 'Local harness and model used to suggest commit messages and pull-request drafts.' },
  diagnostics: { title: 'Diagnostics', description: 'Recent local failures on this machine. Prompts and file contents are never recorded.' },
};
export function SettingsDialog({ preferences, onPreference, open, onOpenChange, section, onSectionChange, repository = null }: {
  repository?: RepositoryInfo | null;
  preferences: Preferences;
  onPreference(partial: Partial<Preferences>): void | Promise<boolean>;
  open: boolean;
  onOpenChange(open: boolean): void;
  section: SettingsSection;
  onSectionChange(section: SettingsSection): void;
}) {
  const queryClient = useQueryClient();
  const executablePathsKey = aiExecutablePathsKey(preferences.aiExecutablePaths);
  const statusQueryKey = queryKeys.aiStatuses(executablePathsKey);
  const statusQuery = useQuery({
    queryKey: statusQueryKey,
    queryFn: () => opentig.ai.statuses(false),
    enabled: open && section === 'ai',
    staleTime: Infinity,
    gcTime: Infinity,
    placeholderData: keepPreviousData,
  });
  const statuses = statusQuery.data ?? [];
  const loadingStatuses = statusQuery.isFetching;
  const [aiLogOpen, setAiLogOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const settingsBodyRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const settingsTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const };

  const previousPathsKey = useRef(executablePathsKey);
  useEffect(() => {
    if (previousPathsKey.current !== executablePathsKey) {
      // Returning to a previous path must check it again rather than revive its old UI cache.
      queryClient.removeQueries({ queryKey: queryKeys.aiStatuses(previousPathsKey.current), exact: true });
      previousPathsKey.current = executablePathsKey;
    }
  }, [executablePathsKey, queryClient]);
  useEffect(() => {
    if (statusQuery.error) sileo.error({ title: 'Could not check local AI', description: messageOf(statusQuery.error) });
  }, [statusQuery.error]);

  const checkStatuses = () => queryClient.fetchQuery({
    queryKey: statusQueryKey, queryFn: () => opentig.ai.statuses(true), staleTime: 0,
  }).catch(() => undefined);

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
  const modelGroups: SearchablePickerGroup[] = [];
  for (const model of visibleModels) {
    const providerSeparator = selectedHarness === 'opencode' ? model.id.indexOf('/') : -1;
    const provider = providerSeparator > 0 ? model.id.slice(0, providerSeparator) : selectedHarness;
    const groupId = model.id === 'default' ? 'default' : `provider:${provider}`;
    let group = modelGroups.find((candidate) => candidate.id === groupId);
    if (!group) {
      group = { id: groupId, label: model.id === 'default' ? '' : providerSeparator > 0 ? provider : harnessLabel(selectedHarness), items: [] };
      modelGroups.push(group);
    }
    group.items.push({
      value: model.id,
      label: providerSeparator > 0 && model.label === model.id ? model.id.slice(providerSeparator + 1) : model.label,
      search: model.id,
      tooltip: model.id === 'default' || model.label === model.id ? model.label : `${model.label} · ${model.id}`,
      pinned: model.id === 'default',
      icon: <IconSparkles />,
    });
  }
  const selectedModelLabel = visibleModels.find((model) => model.id === selectedModel)?.label ?? selectedModel;
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
      <DialogPopup className="settings-dialog w-[min(860px,calc((100vw-48px)/var(--settings-ui-scale,1)))]" style={{
        '--settings-ui-scale': window.opentigDesktop || window.matchMedia('(max-width: 767px)').matches ? 1 : preferences.uiZoom / 100,
      } as CSSProperties}>
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
            <div ref={settingsBodyRef} className={`settings-panel-body${section === 'general' || section === 'github' ? ' settings-panel-body-general' : ''}`}>
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={section}
                  className={`settings-panel-section${section === 'general' || section === 'github' ? ' settings-panel-section-general' : ''}${section === 'ai' ? ' settings-panel-section-ai' : ''}`}
                  initial={reduceMotion ? false : { opacity: 0, y: 7 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -5 }}
                  transition={settingsTransition}
                >
              {section === 'github' ? <GitHubSettings key={repository?.id} repository={repository} /> : section === 'general' ? <GeneralSettings preferences={preferences} onPreference={onPreference} /> : section === 'updates' ? <UpdateSettings /> : section === 'shortcuts' ? <ShortcutsSettings preferences={preferences} onPreference={onPreference} /> : section === 'webAccess' ? <WebAccessSettings /> : section === 'diagnostics' ? <>
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
                    {selectedStatus && <span>Last checked: {formatDateTime(selectedStatus.checkedAt, { seconds: true })}</span>}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void checkStatuses()} disabled={loadingStatuses}>
                    {loadingStatuses ? <IconLoader4 className="animate-spin" /> : <IconRefresh />} {loadingStatuses ? <ShimmeringText text={statuses.length ? 'Checking…' : 'Loading…'} /> : 'Check again'}
                  </Button>
                </div>
                <div className="ai-harness-list" role="radiogroup" aria-label="Harness for AI assistance">
                  {(['codex', 'claude', 'opencode', 'grok'] as const).map((harness) => {
                    const harnessStatus = statuses.find((status) => status.id === harness);
                    const selected = selectedHarness === harness;
                    return (
                      <button key={harness} type="button" role="radio" aria-checked={selected} className={`ai-harness-card ${selected ? 'active' : ''}`} onClick={() => onPreference({ commitMessageHarness: harness })}>
                        <span className="ai-harness-card-main">
                          <AiProviderIcon harness={harness} />
                          <span className="ai-harness-card-copy">
                            <strong>{harnessLabel(harness)}</strong>
                            <small>{harnessStatus?.version || (harnessStatus ? (harnessStatus.installationStatus === 'inspection-failed' ? 'Inspection unavailable' : harnessStatus.installed ? 'Version unavailable' : 'Executable not found') : loadingStatuses ? <ShimmeringText text="Loading…" /> : 'Status not checked')}</small>
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
                <div className="settings-field settings-field-separated ai-model-field">
                  <div className="settings-field-label">
                    <strong>{harnessLabel(selectedHarness)} model</strong>
                    <span>{'Default uses the harness’s built-in default. OpenTig remembers a separate selection for each harness; custom CLI configuration is excluded during generation.'}</span>
                  </div>
                  <SearchablePicker
                    key={selectedHarness}
                    groups={modelGroups}
                    value={selectedModel}
                    onValueChange={(model) => onPreference({ commitMessageModels: { ...preferences.commitMessageModels, [selectedHarness]: model } })}
                    label={`${harnessLabel(selectedHarness)} model`}
                    triggerLabel={selectedModelLabel}
                    triggerClassName="ai-model-select"
                    contentClassName="ai-model-picker"
                    size="default"
                    align="end"
                    placeholder="Search models…"
                  />
                  {selectedStatus?.authStatus === 'unauthenticated' && <p className="ai-login-hint">Sign in from a terminal with <code>{loginCommand(selectedHarness, selectedStatus.cliName)}</code> and check again.</p>}
                  {selectedStatus && !selectedStatus.installed && selectedStatus.installationStatus !== 'inspection-failed' && <p className="ai-login-hint">Install {harnessLabel(selectedHarness)} and check its availability again.</p>}
                </div>
                <AiExecutableSettings key={selectedHarness} harness={selectedHarness} preferences={preferences} status={selectedStatus} onPreference={onPreference} />
                <RepositoryAiSettings key={repository?.id} repository={repository} />
                <div className="settings-field settings-field-separated ai-history-field">
                  <div className="settings-field-label">
                    <strong>Generation history</strong>
                    <span>Outcome, duration, tokens, and cost of recent runs, kept locally for diagnostics.</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setAiLogOpen(true)}><IconHistory /> View history</Button>
                </div>
                <p className="ai-privacy-note">OpenTig sends the relevant diff, summary and commit subjects to the selected harness, plus supported repository instruction text when enabled. Generated content remains pending your review; history records metadata only.</p>
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
  if (status.installationStatus === 'inspection-failed') return 'Check failed';
  if (status.installationStatus === 'not-executable') return 'Cannot run';
  if (status.installationStatus === 'incompatible') return 'Incompatible';
  if (!status.installed) return 'Not found';
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
  if (harness === 'grok') return 'grok login';
  return cliName === 'opencode2' ? 'opencode2 auth login' : 'opencode auth login';
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'An unexpected error occurred.';
}
