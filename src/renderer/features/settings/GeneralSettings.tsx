import { useId, useRef, useState, type ReactNode } from 'react';
import {
  IconCheck, IconDeviceDesktop, IconFolder, IconHierarchy2, IconList,
  IconMoon, IconRefresh, IconSun, IconTypography,
} from '@tabler/icons-react';
import type { ChangesLayoutPreference, MonoFontPreference, Preferences, ThemePreference, UiFontPreference } from '../../../shared/contracts';
import { MAX_REMOTE_FETCH_INTERVAL_SECONDS, MIN_REMOTE_FETCH_INTERVAL_SECONDS, REMOTE_FETCH_INTERVAL_STEP_SECONDS } from '../../../shared/remote-fetch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: IconDeviceDesktop },
  { value: 'light', label: 'Light', icon: IconSun },
  { value: 'dark', label: 'Dark', icon: IconMoon },
] satisfies ChoiceOption<ThemePreference>[];
const LAYOUT_OPTIONS = [
  { value: 'tree', label: 'Tree', icon: IconHierarchy2 },
  { value: 'list', label: 'List', icon: IconList },
] satisfies ChoiceOption<ChangesLayoutPreference>[];
const UI_FONTS = [
  { value: 'geist', label: 'Geist', family: "'Geist Variable', sans-serif" },
  { value: 'plus-jakarta-sans', label: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans Variable', sans-serif" },
  { value: 'space-grotesk', label: 'Space Grotesk', family: "'Space Grotesk Variable', sans-serif" },
] satisfies FontOption<UiFontPreference>[];
const CODE_FONTS = [
  { value: 'geist-mono', label: 'Geist Mono', family: "'Geist Mono Variable', ui-monospace, monospace" },
  { value: 'jetbrains-mono', label: 'JetBrains Mono', family: "'JetBrains Mono Variable', ui-monospace, monospace" },
  { value: 'inconsolata', label: 'Inconsolata', family: "'Inconsolata Variable', ui-monospace, monospace" },
  { value: 'departure', label: 'Departure Mono', family: "'Departure Mono', ui-monospace, monospace" },
  { value: 'space-grotesk', label: 'Space Grotesk', family: "'Space Grotesk Variable', sans-serif" },
] satisfies FontOption<MonoFontPreference>[];
const REMOTE_INTERVALS = [0, 15, 30, 60, 120, 300];

interface ChoiceOption<T extends string> { value: T; label: string; icon: typeof IconSun }
interface FontOption<T extends string> { value: T; label: string; family: string }

function SettingRow({ label, description, children, toggle = false }: {
  label: string; description: ReactNode; children: ReactNode; toggle?: boolean;
}) {
  return <div className={`settings-general-row${toggle ? ' settings-general-toggle' : ''}`}>
    <div className="settings-field-label"><strong>{label}</strong><span>{description}</span></div>
    <div className="settings-general-control">{children}</div>
  </div>;
}

function ChoiceGroup<T extends string>({ label, options, value, onChange }: {
  label: string; options: ChoiceOption<T>[]; value: T; onChange(value: T): void;
}) {
  return <div className="settings-theme-options" role="radiogroup" aria-label={label}>
    {options.map(({ value: option, label: text, icon: Icon }, index) => <button
      key={option} type="button" role="radio" aria-checked={value === option} tabIndex={value === option ? 0 : -1}
      className={`settings-theme-option${value === option ? ' active' : ''}`} onClick={() => onChange(option)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
          : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + options.length) % options.length;
        const next = options[nextIndex];
        if (!next) return;
        onChange(next.value);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[nextIndex]?.focus();
      }}
    ><Icon aria-hidden="true" /><span>{text}</span></button>)}
  </div>;
}

function FontPicker<T extends string>({ label, options, value, onChange }: {
  label: string; options: FontOption<T>[]; value: T; onChange(value: T): void;
}) {
  const selected = options.find((option) => option.value === value);
  return <Select value={value} onValueChange={(next) => {
    const option = options.find((candidate) => candidate.value === next);
    if (option) onChange(option.value);
  }}>
    <Tooltip>
      <TooltipTrigger render={<SelectTrigger className="settings-general-select w-[220px] text-[11px] font-normal" aria-label={label} style={{ fontFamily: selected?.family }} />}>
        <SelectValue>{selected?.label ?? value}</SelectValue>
      </TooltipTrigger>
      <TooltipContent>{selected?.label}</TooltipContent>
    </Tooltip>
    <SelectContent align="end" alignItemWithTrigger={false} className="settings-general-font-menu min-w-[14rem]">
      {options.map((option) => <SelectItem key={option.value} value={option.value} className="min-h-8 text-xs font-normal">
        <span style={{ fontFamily: option.family }}>{option.label}</span>
      </SelectItem>)}
    </SelectContent>
  </Select>;
}

function intervalLabel(seconds: number): string {
  if (seconds === 0) return 'Off';
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} ${seconds === 60 ? 'minute' : 'minutes'}`;
  return `${seconds} seconds`;
}

export function GeneralSettings({ preferences, onPreference }: {
  preferences: Preferences; onPreference(partial: Partial<Preferences>): void;
}) {
  const id = useId();
  const intervalTrigger = useRef<HTMLButtonElement>(null);
  const [customInterval, setCustomInterval] = useState<string | null>(null);
  const [intervalError, setIntervalError] = useState(false);
  const [intervalHelpOpen, setIntervalHelpOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const interval = preferences.remoteFetchIntervalSeconds;
  const closeCustomInterval = () => { setCustomInterval(null); setIntervalError(false); intervalTrigger.current?.focus(); };

  return <div className="settings-general">
    <div className="settings-general-content">
      <section className="settings-general-group" aria-labelledby={`${id}-appearance`}>
        <h3 id={`${id}-appearance`}><IconSun aria-hidden="true" />Appearance</h3>
        <SettingRow label="Theme" description="Follow your system or choose a theme.">
          <ChoiceGroup label="Theme" options={THEME_OPTIONS} value={preferences.theme} onChange={(theme) => onPreference({ theme })} />
        </SettingRow>
        <SettingRow label="Interface font" description="Menus, labels and navigation.">
          <FontPicker label="Interface font" options={UI_FONTS} value={preferences.uiFont} onChange={(uiFont) => onPreference({ uiFont })} />
        </SettingRow>
        <SettingRow label="Code font" description="Code, diffs and the file viewer.">
          <FontPicker label="Code font" options={CODE_FONTS} value={preferences.monoFont} onChange={(monoFont) => onPreference({ monoFont })} />
        </SettingRow>
        <SettingRow label="Interface size" description="Scale text, icons and controls.">
          <div className="settings-zoom-control">
            <input type="range" min="80" max="130" step="10" value={preferences.uiZoom} onChange={(event) => onPreference({ uiZoom: Number(event.target.value) })} aria-label="Interface zoom" />
            <output aria-live="off">{preferences.uiZoom}%</output>
          </div>
        </SettingRow>
        {previewOpen && <div id={`${id}-preview`} className="settings-general-preview">
          <span><IconFolder aria-hidden="true" />src / components / Button.tsx</span>
          <code><span>const</span> changes = files.filter(isModified);</code>
        </div>}
      </section>
      <section className="settings-general-group" aria-labelledby={`${id}-files`}>
        <h3 id={`${id}-files`}><IconFolder aria-hidden="true" />Files &amp; viewer</h3>
        <SettingRow label="Changes layout" description="Folders or a flat list.">
          <ChoiceGroup label="Changes layout" options={LAYOUT_OPTIONS} value={preferences.changesLayout} onChange={(changesLayout) => onPreference({ changesLayout })} />
        </SettingRow>
        <SettingRow label="Wrap long lines" description="Fit lines to the viewer width." toggle>
          <span className="settings-general-switch-state" aria-hidden="true">{preferences.wrapLines ? 'On' : 'Off'}</span>
          <button type="button" role="switch" aria-label="Wrap long lines" aria-checked={preferences.wrapLines} className="settings-switch" onClick={() => onPreference({ wrapLines: !preferences.wrapLines })}><span /></button>
        </SettingRow>
        <SettingRow label="Show ignored files" description={<>Include files excluded by <code>.gitignore</code>.</>} toggle>
          <span className="settings-general-switch-state" aria-hidden="true">{preferences.showDotEnvFiles ? 'On' : 'Off'}</span>
          <button type="button" role="switch" aria-label="Show ignored files" aria-checked={preferences.showDotEnvFiles} className="settings-switch" onClick={() => onPreference({ showDotEnvFiles: !preferences.showDotEnvFiles })}><span /></button>
        </SettingRow>
      </section>
      <section className="settings-general-group" aria-labelledby={`${id}-sync`}>
        <h3 id={`${id}-sync`}><IconRefresh aria-hidden="true" />Repository sync</h3>
        <SettingRow label="Remote check interval" description="Keep ahead / behind counts current.">
          <Select value={String(interval)} onValueChange={(value) => {
            setIntervalError(false);
            if (value === 'custom') setCustomInterval(String(interval || 30));
            else if (value !== null && REMOTE_INTERVALS.includes(Number(value))) {
              setCustomInterval(null);
              onPreference({ remoteFetchIntervalSeconds: Number(value) });
            }
          }}>
            <SelectTrigger ref={intervalTrigger} className="settings-general-select settings-general-interval w-[174px] text-[11px] font-normal" aria-label="Remote check interval"><SelectValue>{intervalLabel(interval)}</SelectValue></SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false} className="min-w-[14rem]">
              {REMOTE_INTERVALS.map((value) => <SelectItem key={value} value={String(value)} className="min-h-8 text-xs font-normal">
                {intervalLabel(value)}{value === 30 && <small className="settings-general-option-note">Default</small>}
              </SelectItem>)}
              {!REMOTE_INTERVALS.includes(interval) && <SelectItem value={String(interval)} className="min-h-8 text-xs font-normal">{intervalLabel(interval)}<small className="settings-general-option-note">Custom</small></SelectItem>}
              <SelectItem value="custom" className="min-h-8 text-xs font-normal">Custom…<small className="settings-general-option-note">5–300 seconds</small></SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <div className="settings-general-help">
          <span>{interval === 0 ? 'Periodic fetch is off.' : `Checks every ${interval} seconds.`}</span>
          <button type="button" aria-expanded={intervalHelpOpen} aria-controls={`${id}-interval-help`} onClick={() => setIntervalHelpOpen(!intervalHelpOpen)}>What does Off do?</button>
        </div>
        {intervalHelpOpen && <p id={`${id}-interval-help`} className="settings-general-help-detail">Off disables periodic fetch. Remote checks still run when you pull or push.</p>}
        {customInterval !== null && <form className="settings-general-custom" noValidate onSubmit={(event) => {
          event.preventDefault();
          const value = Number(customInterval);
          if (!Number.isFinite(value) || value < MIN_REMOTE_FETCH_INTERVAL_SECONDS || value > MAX_REMOTE_FETCH_INTERVAL_SECONDS || value % REMOTE_FETCH_INTERVAL_STEP_SECONDS !== 0) {
            setIntervalError(true);
            return;
          }
          onPreference({ remoteFetchIntervalSeconds: value });
          closeCustomInterval();
        }}>
          <div className="settings-general-custom-controls">
            <label htmlFor={`${id}-custom-interval`}>Every</label>
            <input id={`${id}-custom-interval`} type="number" min={MIN_REMOTE_FETCH_INTERVAL_SECONDS} max={MAX_REMOTE_FETCH_INTERVAL_SECONDS} step={REMOTE_FETCH_INTERVAL_STEP_SECONDS} required autoFocus value={customInterval}
              aria-label="Custom interval in seconds" aria-invalid={intervalError} aria-describedby={`${id}-interval-range`}
              onChange={(event) => { setCustomInterval(event.target.value); setIntervalError(false); }}
              onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCustomInterval(); } }} />
            <span>seconds</span>
            <Button type="submit" variant="outline" size="sm">Apply</Button>
            <Button type="button" variant="ghost" size="sm" onClick={closeCustomInterval}>Cancel</Button>
          </div>
          <p id={`${id}-interval-range`} className={intervalError ? 'settings-general-error' : 'settings-general-help-detail'} role={intervalError ? 'alert' : undefined}>Choose 5–300 seconds, in steps of 5.</p>
        </form>}
      </section>
    </div>
    <footer className="settings-general-footer">
      <span><IconCheck aria-hidden="true" />Changes apply immediately</span>
      <button type="button" aria-expanded={previewOpen} aria-controls={`${id}-preview`} onClick={() => setPreviewOpen(!previewOpen)}><IconTypography aria-hidden="true" />Text preview</button>
    </footer>
  </div>;
}
