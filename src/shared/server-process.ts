import type { OpenTigPlatform } from './contracts';
import type { OpenTigServerIdentity } from './server-protocol';
import type { ApplicationProfile } from './application-profile';

export const OPEN_TIG_UTILITY_PROTOCOL_VERSION = 2;

export type OpenTigServerHost = '127.0.0.1' | '0.0.0.0';

export interface OpenTigUtilityConfig {
  profile?: ApplicationProfile;
  appVersion: string;
  desktopSecret: string;
  settingsPath: string;
  aiLogPath: string;
  serverDataPath: string;
  clientRoot: string;
  trashModulePath?: string;
  platform: OpenTigPlatform;
  host: OpenTigServerHost;
  browserAccessEnabled: boolean;
  port: number;
}

export type OpenTigUtilityControlAction =
  | 'status'
  | 'set-browser-access'
  | 'create-pairing-link';

export type OpenTigUtilityControlResult =
  | { action: 'status'; connectedSessionCount: number; browserAccessEnabled: boolean }
  | { action: 'set-browser-access'; browserAccessEnabled: boolean }
  | { action: 'create-pairing-link'; url: string; expiresAt: string };

export type OpenTigUtilityParentMessage =
  | {
      type: 'bootstrap';
      protocolVersion: typeof OPEN_TIG_UTILITY_PROTOCOL_VERSION;
      config: OpenTigUtilityConfig;
    }
  | { type: 'control'; requestId: string; action: 'status' | 'create-pairing-link' }
  | { type: 'control'; requestId: string; action: 'set-browser-access'; enabled: boolean }
  | { type: 'shutdown' };

export type OpenTigUtilityChildMessage =
  | ({ type: 'ready'; host: string; port: number; origin: string } & OpenTigServerIdentity)
  | { type: 'control-result'; requestId: string; ok: true; result: OpenTigUtilityControlResult }
  | { type: 'control-result'; requestId: string; ok: false; message: string }
  | { type: 'error'; code: string; message: string; stack?: string }
  | { type: 'stopped' };
