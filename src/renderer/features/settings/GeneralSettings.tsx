import { useId, useRef, useState } from 'react';
import type { ChangesLayoutPreference, MonoFontPreference, Preferences, ThemePreference, UiFontPreference } from '../../../shared/contracts';
import { MAX_REMOTE_FETCH_INTERVAL_SECONDS, MIN_REMOTE_FETCH_INTERVAL_SECONDS, REMOTE_FETCH_INTERVAL_STEP_SECONDS } from '../../../shared/remote-fetch';
import { SettingGroup, SettingRow } from './SettingRows';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] satisfies ChoiceOption<ThemePreference>[];
const LAYOUT_OPTIONS = [
  { value: 'tree', label: 'Tree' },
  { value: 'list', label: 'List' },
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

interface ChoiceOption<T extends string> { value: T; label: string }
interface FontOption<T extends string> { value: T; label: string; family: string }

function ChoiceGroup<T extends string>({ label, options, value, onChange }: {
  label: string; options: ChoiceOption<T>[]; value: T; onChange(value: T): void;
}) {
  return <div className="plain-options" role="radiogroup" aria-label={label}>
    {options.map(({ value: option, label: text }, index) => <button
      key={option} type="button" role="radio" aria-checked={value === option} tabIndex={value === option ? 0 : -1}
      className="plain-option" onClick={() => onChange(option)}
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
    >{text}</button>)}
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
      <TooltipTrigger render={<SelectTrigger className="plain-select text-xs font-normal" aria-label={label} style={{ fontFamily: selected?.family }} />}>
        <SelectValue>{selected?.label ?? value}</SelectValue>
      </TooltipTrigger>
      <TooltipContent>{selected?.label}</TooltipContent>
    </Tooltip>
    <SelectContent align="end" alignItemWithTrigger={false} className="min-w-[14rem]">
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

export function GeneralSettings({ preferences, onPreference, showRepositoryOptions = true, onOnboarding }: {
  preferences: Preferences; onPreference(partial: Partial<Preferences>): void; showRepositoryOptions?: boolean;
  onOnboarding?(): void;
}) {
  const id = useId();
  const intervalTrigger = useRef<HTMLButtonElement>(null);
  const [customInterval, setCustomInterval] = useState<string | null>(null);
  const [intervalError, setIntervalError] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const interval = preferences.remoteFetchIntervalSeconds;
  const closeCustomInterval = () => { setCustomInterval(null); setIntervalError(false); intervalTrigger.current?.focus(); };

  return <div className="settings-general">
    {onOnboarding && <SettingGroup title="Getting started" className="settings-group-onboarding"><SettingRow label="Onboarding" description="Show the start screen and the first-commit checklist again."><Button variant="ghost" size="sm" onClick={onOnboarding}>Repeat onboarding</Button></SettingRow></SettingGroup>}
    <SettingGroup title="Appearance">
      <SettingRow label="Theme">
        <ChoiceGroup label="Theme" options={THEME_OPTIONS} value={preferences.theme} onChange={(theme) => onPreference({ theme })} />
      </SettingRow>
      <SettingRow label="Interface font">
        <FontPicker label="Interface font" options={UI_FONTS} value={preferences.uiFont} onChange={(uiFont) => onPreference({ uiFont })} />
      </SettingRow>
      <SettingRow label="Code font">
        <FontPicker label="Code font" options={CODE_FONTS} value={preferences.monoFont} onChange={(monoFont) => onPreference({ monoFont })} />
      </SettingRow>
      <SettingRow label="Interface size">
        <div className="settings-zoom-control">
          <input type="range" min="80" max="130" step="10" value={preferences.uiZoom} onChange={(event) => onPreference({ uiZoom: Number(event.target.value) })} aria-label="Interface zoom" />
          <output aria-live="off">{preferences.uiZoom}%</output>
        </div>
      </SettingRow>
      <SettingRow label="Text preview">
        <Button variant="ghost" size="xs" aria-label="Text preview" aria-expanded={previewOpen} aria-controls={`${id}-preview`} onClick={() => setPreviewOpen(!previewOpen)}>{previewOpen ? 'Hide' : 'Show'}</Button>
      </SettingRow>
      {previewOpen && <div id={`${id}-preview`} className="settings-preview">
        <span>src / components / Button.tsx</span>
        <code>const changes = files.filter(isModified);</code>
      </div>}
    </SettingGroup>
    <SettingGroup title="Files &amp; viewer">
      <SettingRow label="Changes layout">
        <ChoiceGroup label="Changes layout" options={LAYOUT_OPTIONS} value={preferences.changesLayout} onChange={(changesLayout) => onPreference({ changesLayout })} />
      </SettingRow>
      <SettingRow label="Wrap long lines" description="Fit lines to the viewer width.">
        <button type="button" role="switch" aria-label="Wrap long lines" aria-checked={preferences.wrapLines} className="settings-switch" onClick={() => onPreference({ wrapLines: !preferences.wrapLines })}><span /></button>
      </SettingRow>
      {showRepositoryOptions && <SettingRow label="Show ignored files">
        <button type="button" role="switch" aria-label="Show ignored files" aria-checked={preferences.showDotEnvFiles} className="settings-switch" onClick={() => onPreference({ showDotEnvFiles: !preferences.showDotEnvFiles })}><span /></button>
      </SettingRow>}
    </SettingGroup>
    {showRepositoryOptions && <SettingGroup title="Repository sync">
      <SettingRow label="Remote check interval" description="Keeps ahead and behind counts current. Off disables periodic fetch; remote checks still run when you pull or push.">
        <Select value={String(interval)} onValueChange={(value) => {
          setIntervalError(false);
          if (value === 'custom') setCustomInterval(String(interval || 30));
          else if (value !== null && REMOTE_INTERVALS.includes(Number(value))) {
            setCustomInterval(null);
            onPreference({ remoteFetchIntervalSeconds: Number(value) });
          }
        }}>
          <SelectTrigger ref={intervalTrigger} className="plain-select text-xs font-normal" aria-label="Remote check interval"><SelectValue>{intervalLabel(interval)}</SelectValue></SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false} className="min-w-[14rem]">
            {REMOTE_INTERVALS.map((value) => <SelectItem key={value} value={String(value)} className="min-h-8 text-xs font-normal">
              {intervalLabel(value)}{value === 30 && <small className="settings-option-note">Default</small>}
            </SelectItem>)}
            {!REMOTE_INTERVALS.includes(interval) && <SelectItem value={String(interval)} className="min-h-8 text-xs font-normal">{intervalLabel(interval)}<small className="settings-option-note">Custom</small></SelectItem>}
            <SelectItem value="custom" className="min-h-8 text-xs font-normal">Custom…<small className="settings-option-note">5–300 seconds</small></SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      {customInterval !== null && <form className="settings-custom-interval" noValidate onSubmit={(event) => {
        event.preventDefault();
        const value = Number(customInterval);
        if (!Number.isFinite(value) || value < MIN_REMOTE_FETCH_INTERVAL_SECONDS || value > MAX_REMOTE_FETCH_INTERVAL_SECONDS || value % REMOTE_FETCH_INTERVAL_STEP_SECONDS !== 0) {
          setIntervalError(true);
          return;
        }
        onPreference({ remoteFetchIntervalSeconds: value });
        closeCustomInterval();
      }}>
        <div className="settings-custom-interval-controls">
          <label htmlFor={`${id}-custom-interval`}>Every</label>
          <input id={`${id}-custom-interval`} className="field-input" type="number" min={MIN_REMOTE_FETCH_INTERVAL_SECONDS} max={MAX_REMOTE_FETCH_INTERVAL_SECONDS} step={REMOTE_FETCH_INTERVAL_STEP_SECONDS} required autoFocus value={customInterval}
            aria-label="Custom interval in seconds" aria-invalid={intervalError} aria-describedby={`${id}-interval-range`}
            onChange={(event) => { setCustomInterval(event.target.value); setIntervalError(false); }}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCustomInterval(); } }} />
          <span>seconds</span>
          <Button type="submit" variant="ghost" size="sm">Apply</Button>
          <Button type="button" variant="ghost" size="sm" onClick={closeCustomInterval}>Cancel</Button>
        </div>
        <p id={`${id}-interval-range`} className={intervalError ? 'settings-error' : 'settings-note'} role={intervalError ? 'alert' : undefined}>Choose 5–300 seconds, in steps of 5.</p>
      </form>}
    </SettingGroup>}
  </div>;
}
