import { RepositoryAiSettings } from './RepositoryAiSettings';
import { GitHubSettings } from './GitHubSettings';
import { AiExecutableSettings } from './AiExecutableSettings';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { aiExecutablePathsKey } from '@shared/ai-status';
import { formatDateTime } from '@shared/date-format';
import { IconLoader4, IconRefresh, IconSparkles, IconX } from '@tabler/icons-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { sileo } from 'sileo';
import type { AiHarnessId, AiHarnessStatus, Preferences, RepositoryInfo } from '../../../shared/contracts';
import { StatusWord, type StatusTone } from '@/components/StatusWord';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { SearchablePicker, type SearchablePickerGroup } from '@/components/SearchablePicker';
import { AiLogDialog } from '@/features/ai/AiLogDialog';
import { AiProviderIcon } from '@/features/ai/AiProviderIcon';
import { harnessLabel } from '@/features/ai/harness-copy';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import { GeneralSettings } from './GeneralSettings';
import { ProblemsLogDialog } from './ProblemsLogDialog';
import { SettingRow } from './SettingRows';
import { ShortcutsSettings } from './ShortcutsSettings';
import { UpdateSettings } from './UpdateSettings';
import { WebAccessSettings } from './WebAccessSettings';

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'updates', label: 'Updates' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'github', label: 'GitHub' },
  { id: 'ai', label: 'AI assistance' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'webAccess', label: 'Web access' },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];
export function SettingsDialog({ preferences, onPreference, open, onOpenChange, section: requestedSection, onSectionChange, repository = null, onOnboarding }: {
  repository?: RepositoryInfo | null;
  onOnboarding?: (() => void) | undefined;
  preferences: Preferences;
  onPreference(partial: Partial<Preferences>): void | Promise<boolean>;
  open: boolean;
  onOpenChange(open: boolean): void;
  section: SettingsSection;
  onSectionChange(section: SettingsSection): void;
}) {
  // Phone browsers have no hardware keyboard to configure.
  const phoneBrowser = useMobileLayout() && !window.opentigDesktop;
  const sections = phoneBrowser ? SETTINGS_SECTIONS.filter(({ id }) => id !== 'shortcuts') : SETTINGS_SECTIONS;
  const section = phoneBrowser && requestedSection === 'shortcuts' ? 'general' : requestedSection;
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
  const title = SETTINGS_SECTIONS.find(({ id }) => id === section)?.label;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="settings-dialog w-[min(800px,calc((100vw-48px)/var(--settings-ui-scale,1)))]" style={{
        '--settings-ui-scale': window.opentigDesktop || window.matchMedia('(max-width: 767px)').matches ? 1 : preferences.uiZoom / 100,
      } as CSSProperties}>
        <div className="settings-shell">
          <aside className="settings-nav">
            <div className="settings-nav-title">Settings</div>
            {sections.map(({ id, label }) => (
              <button key={id} className={`settings-nav-item ${section === id ? 'active' : ''}`} onClick={() => onSectionChange(id)} aria-current={section === id}>
                {label}
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
              {section === 'github' ? <GitHubSettings key={repository?.id} repository={repository} /> : section === 'general' ? <GeneralSettings preferences={preferences} onPreference={onPreference} {...(onOnboarding ? { onOnboarding } : {})} /> : section === 'updates' ? <UpdateSettings /> : section === 'shortcuts' ? <ShortcutsSettings preferences={preferences} onPreference={onPreference} /> : section === 'webAccess' ? <WebAccessSettings /> : section === 'diagnostics' ? <>
                <SettingRow label="Problem history" description="Failed Git, file, and network operations recorded locally. Prompts and file contents are never stored.">
                  <Button variant="ghost" size="sm" onClick={() => setProblemsOpen(true)}>View problems</Button>
                </SettingRow>
                <ProblemsLogDialog open={problemsOpen} onOpenChange={setProblemsOpen} />
              </> : <>
                <SettingRow label="Local harness" description={<>OpenTig uses the selected CLI session. It does not copy or store credentials.{selectedStatus && <> Last checked: {formatDateTime(selectedStatus.checkedAt, { seconds: true })}</>}</>}>
                  <Button variant="ghost" size="sm" onClick={() => void checkStatuses()} disabled={loadingStatuses}>
                    {loadingStatuses ? <IconLoader4 className="animate-spin" /> : <IconRefresh />} {loadingStatuses ? <ShimmeringText text={statuses.length ? 'Checking…' : 'Loading…'} /> : 'Check again'}
                  </Button>
                </SettingRow>
                <div className="ai-harness-list" role="radiogroup" aria-label="Harness for AI assistance">
                  {(['codex', 'claude', 'opencode', 'grok'] as const).map((harness) => {
                    const harnessStatus = statuses.find((status) => status.id === harness);
                    return (
                      <button key={harness} type="button" role="radio" aria-checked={selectedHarness === harness} className="ai-harness-row" onClick={() => onPreference({ commitMessageHarness: harness })}>
                        <AiProviderIcon harness={harness} />
                        <span className="ai-harness-copy">
                          <strong>{harnessLabel(harness)}</strong>
                          <small>{harnessStatus?.version || (harnessStatus ? (harnessStatus.installationStatus === 'inspection-failed' ? 'Inspection unavailable' : harnessStatus.installed ? 'Version unavailable' : 'Executable not found') : loadingStatuses ? <ShimmeringText text="Loading…" /> : 'Status not checked')}</small>
                          {harnessStatus?.message && <small>{harnessStatus.message}</small>}
                        </span>
                        <StatusWord tone={availabilityTone(harnessStatus)}>{availabilityLabel(harnessStatus)}</StatusWord>
                      </button>
                    );
                  })}
                </div>
                <SettingRow label={`${harnessLabel(selectedHarness)} model`} description={'Default uses the harness’s built-in default. OpenTig remembers a separate selection for each harness; custom CLI configuration is excluded during generation.'}>
                  <SearchablePicker
                    key={selectedHarness}
                    groups={modelGroups}
                    value={selectedModel}
                    onValueChange={(model) => onPreference({ commitMessageModels: { ...preferences.commitMessageModels, [selectedHarness]: model } })}
                    label={`${harnessLabel(selectedHarness)} model`}
                    triggerLabel={selectedModelLabel}
                    triggerClassName="plain-select"
                    contentClassName="ai-model-picker"
                    size="default"
                    align="end"
                    placeholder="Search models…"
                  />
                </SettingRow>
                {selectedStatus?.authStatus === 'unauthenticated' && <p className="settings-note">Sign in from a terminal with <code>{loginCommand(selectedHarness, selectedStatus.cliName)}</code> and check again.</p>}
                {selectedStatus && !selectedStatus.installed && selectedStatus.installationStatus !== 'inspection-failed' && <p className="settings-note">Install {harnessLabel(selectedHarness)} and check its availability again.</p>}
                <AiExecutableSettings key={selectedHarness} harness={selectedHarness} preferences={preferences} status={selectedStatus} onPreference={onPreference} />
                <RepositoryAiSettings key={repository?.id} repository={repository} />
                <div className="settings-group">
                  <SettingRow label="Generation history" description="Outcome, duration, tokens, and cost of recent runs, kept locally for diagnostics.">
                    <Button variant="ghost" size="sm" onClick={() => setAiLogOpen(true)}>View history</Button>
                  </SettingRow>
                  <p className="settings-note">OpenTig sends the relevant diff, summary and commit subjects to the selected harness, plus supported repository instruction text when enabled. Generated content remains pending your review; history records metadata only.</p>
                </div>
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

function availabilityTone(status: AiHarnessStatus | undefined): StatusTone {
  if (!status) return 'neutral';
  if (!status.installed || status.authStatus === 'unauthenticated' || status.availability === 'error') return 'danger';
  return status.availability === 'ready' ? 'ready' : 'attention';
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
