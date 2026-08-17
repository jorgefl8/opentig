import { useEffect, useMemo, useState } from 'react';
import { IconRestore } from '@tabler/icons-react';
import type { Preferences } from '@shared/contracts';
import {
  FIXED_SHORTCUTS, findShortcutConflict, formatCombo, isValidCombo, normalizeCombo, resolveShortcuts,
  SHORTCUT_DEFINITIONS, type ShortcutCategory, type ShortcutId,
} from '@shared/shortcuts';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const IGNORED_LISTENING_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

interface ShortcutsSettingsProps {
  preferences: Preferences;
  onPreference(partial: Partial<Preferences>): void;
}

export function ShortcutsSettings({ preferences, onPreference }: ShortcutsSettingsProps) {
  const resolved = useMemo(() => resolveShortcuts(preferences.shortcutOverrides), [preferences.shortcutOverrides]);
  const [captureError, setCaptureError] = useState<{ id: ShortcutId; message: string } | null>(null);
  const hasOverrides = Object.keys(preferences.shortcutOverrides).length > 0;

  const categories = useMemo(() => {
    const order: ShortcutCategory[] = ['General', 'Commit', 'Editor', 'Tabs'];
    return order.map((category) => ({
      category,
      definitions: SHORTCUT_DEFINITIONS.filter((def) => def.category === category),
    }));
  }, []);

  const fixedByCategory = useMemo(() => {
    const categories = [...new Set(FIXED_SHORTCUTS.map((item) => item.category))];
    return categories.map((category) => ({ category, items: FIXED_SHORTCUTS.filter((item) => item.category === category) }));
  }, []);

  const capture = (id: ShortcutId, combo: string) => {
    if (combo === resolved[id]) { setCaptureError(null); return; }
    const conflict = findShortcutConflict(id, combo, resolved);
    if (conflict) {
      const message = conflict === 'reserved'
        ? `${formatCombo(combo)} is reserved for a fixed shortcut.`
        : `${formatCombo(combo)} is already used by "${SHORTCUT_DEFINITIONS.find((def) => def.id === conflict)!.label}".`;
      setCaptureError({ id, message });
      return;
    }
    setCaptureError(null);
    const def = SHORTCUT_DEFINITIONS.find((item) => item.id === id)!;
    const nextOverrides = { ...preferences.shortcutOverrides };
    if (combo === def.defaultCombo) delete nextOverrides[id];
    else nextOverrides[id] = combo;
    onPreference({ shortcutOverrides: nextOverrides });
  };

  const reset = (id: ShortcutId) => {
    setCaptureError(null);
    const nextOverrides = { ...preferences.shortcutOverrides };
    delete nextOverrides[id];
    onPreference({ shortcutOverrides: nextOverrides });
  };

  return (
    <>
      <div className="settings-field settings-toggle-row">
        <div className="settings-field-label">
          <strong>Show and focus from anywhere</strong>
          <span>Double-tap Control to bring JustGit to the front, even while another app is focused.</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Show and focus from anywhere"
          aria-checked={preferences.doubleControlShortcutEnabled}
          className="settings-switch"
          onClick={() => onPreference({ doubleControlShortcutEnabled: !preferences.doubleControlShortcutEnabled })}
        ><span /></button>
      </div>

      <div className="settings-field settings-field-separated">
        <div className="settings-field-label">
          <strong>Keyboard shortcuts</strong>
          <span>Click a shortcut, then press a new key combination. Press Escape to cancel.</span>
        </div>
        {hasOverrides && (
          <Button
            variant="outline"
            size="sm"
            className="shortcuts-reset-all"
            onClick={() => { setCaptureError(null); onPreference({ shortcutOverrides: {} }); }}
          ><IconRestore /> Reset all to defaults</Button>
        )}
        {categories.map(({ category, definitions }) => (
          <div className="shortcuts-group" key={category}>
            <div className="shortcuts-group-heading">{category}</div>
            {definitions.map((def) => (
              <div className="shortcuts-row" key={def.id}>
                <div className="settings-field-label">
                  <strong>{def.label}</strong>
                  <span>{def.description}</span>
                </div>
                <ShortcutRecorder
                  combo={resolved[def.id]}
                  allowBare={def.allowBare}
                  isCustom={preferences.shortcutOverrides[def.id] !== undefined}
                  error={captureError?.id === def.id ? captureError.message : null}
                  onCapture={(combo) => capture(def.id, combo)}
                  onReset={() => reset(def.id)}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="settings-field settings-field-separated">
        <div className="settings-field-label">
          <strong>Fixed shortcuts</strong>
          <span>These follow platform and file-manager conventions and cannot be changed.</span>
        </div>
        {fixedByCategory.map(({ category, items }) => (
          <div className="shortcuts-group" key={category}>
            <div className="shortcuts-group-heading">{category}</div>
            {items.map((item) => (
              <div className="shortcuts-fixed-row" key={item.combo + item.label}>
                <span>{item.label}</span>
                <KbdGroup>{item.combo.split(' / ').flatMap((variant, variantIndex) => [
                  ...(variantIndex > 0 ? [<span key={`sep-${variant}`} className="shortcuts-fixed-sep"> / </span>] : []),
                  ...variant.split(' + ').map((token, tokenIndex) => <Kbd key={`${variant}-${tokenIndex}`}>{token}</Kbd>),
                ])}</KbdGroup>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function ShortcutRecorder({ combo, allowBare, isCustom, error, onCapture, onReset }: {
  combo: string;
  allowBare: boolean;
  isCustom: boolean;
  error: string | null;
  onCapture(combo: string): void;
  onReset(): void;
}) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') { setListening(false); return; }
      if (IGNORED_LISTENING_KEYS.has(event.key)) return;
      const next = normalizeCombo(event);
      setListening(false);
      if (next && isValidCombo(next, allowBare)) onCapture(next);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [listening, allowBare, onCapture]);

  return (
    <div className="shortcut-recorder">
      {error && <span className="shortcut-recorder-error">{error}</span>}
      <button
        type="button"
        className={`shortcut-recorder-button ${listening ? 'listening' : ''} ${error ? 'error' : ''}`}
        onClick={() => setListening(true)}
        onBlur={() => setListening(false)}
      >
        {listening ? 'Press a key…' : <KbdGroup>{combo.split('+').map((token) => <Kbd key={token}>{token}</Kbd>)}</KbdGroup>}
      </button>
      {isCustom && (
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Reset to default" onClick={onReset} />}><IconRestore /></TooltipTrigger>
          <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
