import type { CSSProperties } from "react";
import { IconX } from "@tabler/icons-react";
import type { Preferences } from "../../src/shared/contracts";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { GeneralSettings } from "@/features/settings/GeneralSettings";
import { ShortcutsSettings } from "@/features/settings/ShortcutsSettings";
import { Button } from "@/components/ui/button";
import { MobileSheet } from "@/components/MobileSheet";
import { useMobileLayout } from "@/lib/use-mobile-layout";
export type SettingsSection =
  | "general"
  | "updates"
  | "shortcuts"
  | "github"
  | "ai"
  | "diagnostics"
  | "webAccess";
/** The sections the sample can answer: appearance and the viewer, and the keys, which work here as installed. */
const sections = [
  { id: "general", label: "General" },
  { id: "shortcuts", label: "Shortcuts" },
] as const;
export function SettingsDialog({
  open,
  onOpenChange,
  preferences,
  onPreference,
  section: requested = "general",
  onSectionChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  preferences: Preferences;
  onPreference(partial: Partial<Preferences>): void | Promise<boolean>;
  section?: SettingsSection;
  onSectionChange?(section: SettingsSection): void;
}) {
  const phone = useMobileLayout();
  if (phone) {
    // Phone browsers have no hardware keyboard to configure.
    return (
      <MobileSheet open={open} onOpenChange={onOpenChange} title="Settings" tall>
        <div className="settings-sheet">
          <GeneralSettings preferences={preferences} onPreference={onPreference} showRepositoryOptions={false} />
        </div>
      </MobileSheet>
    );
  }
  const section = requested === "shortcuts" ? "shortcuts" : "general";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="settings-dialog demo-settings" style={{
        '--settings-ui-scale': window.matchMedia('(max-width: 767px)').matches ? 1 : preferences.uiZoom / 100,
      } as CSSProperties}>
        <div className="settings-shell">
          <aside className="settings-nav">
            <div className="settings-nav-title">Settings</div>
            {sections.map(({ id, label }) => (
              <button key={id} type="button" className={`settings-nav-item ${section === id ? "active" : ""}`} onClick={() => onSectionChange?.(id)} aria-current={section === id}>
                {label}
              </button>
            ))}
          </aside>
          <section className="settings-panel">
            <header className="settings-panel-header">
              <div>
                <DialogTitle>{section === "shortcuts" ? "Shortcuts" : "General"}</DialogTitle>
                <DialogDescription className="sr-only">
                  {section === "shortcuts" ? "Keyboard shortcuts, which work in this demo as in the installed app." : "Appearance and file viewer preferences."}
                </DialogDescription>
              </div>
              <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close settings" />}>
                <IconX />
              </DialogClose>
            </header>
            <div className="settings-panel-body">
              <div className="settings-panel-section">
                {section === "shortcuts"
                  ? <ShortcutsSettings preferences={preferences} onPreference={onPreference} />
                  : <GeneralSettings preferences={preferences} onPreference={onPreference} showRepositoryOptions={false} />}
              </div>
            </div>
          </section>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
