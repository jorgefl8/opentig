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
import { Button } from "@/components/ui/button";
export type SettingsSection =
  | "general"
  | "updates"
  | "shortcuts"
  | "github"
  | "ai"
  | "diagnostics"
  | "webAccess";
export function SettingsDialog({
  open,
  onOpenChange,
  preferences,
  onPreference,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  preferences: Preferences;
  onPreference(partial: Partial<Preferences>): void | Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="demo-settings" style={{
        '--demo-ui-scale': window.matchMedia('(max-width: 767px)').matches ? 1 : preferences.uiZoom / 100,
      } as CSSProperties}>
        <header className="settings-panel-header">
          <div>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription className="sr-only">Appearance and file viewer preferences.</DialogDescription>
          </div>
          <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close settings" />}>
            <IconX />
          </DialogClose>
        </header>
        <GeneralSettings
          preferences={preferences}
          onPreference={onPreference}
          showRepositoryOptions={false}
        />
      </DialogPopup>
    </Dialog>
  );
}
