import type { Preferences } from '../../shared/contracts';

export interface OpenTigHostCapabilities {
  nativePicker: boolean;
  fileClipboard: boolean;
  revealInFileManager: boolean;
}

export interface OpenTigHostConfirmation {
  title: string;
  message: string;
  detail: string;
  confirmLabel: string;
  defaultAction: 'confirm' | 'cancel';
}

/** Host operations required while server commands still preserve desktop behavior. */
export interface OpenTigHost {
  readonly capabilities: OpenTigHostCapabilities;
  preferencesChanged(preferences: Preferences): void;
  setTitleBarTheme(dark: boolean): void;
  readClipboardFilePaths(): Promise<string[]>;
  readClipboardImagePng(): Buffer | null;
  selectDirectory(title: string): Promise<string | null>;
  confirm(options: OpenTigHostConfirmation): Promise<boolean>;
  revealItem(path: string): void;
}
