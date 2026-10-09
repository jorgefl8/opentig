import type { OpenTigPlatform } from './contracts';
import type { OpenTigServerIdentity } from './server-protocol';
import type { ApplicationProfile } from './application-profile';
import type { OpenTigWebAccessStatus } from './desktop-api';
import type { OpenTigWebAccessPatch } from './web-access';

export const OPEN_TIG_UTILITY_PROTOCOL_VERSION = 2;

export type OpenTigServerHost = string;

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
  | 'web-access-status'
  | 'update-web-access'
  | 'set-browser-access'
  | 'create-pairing-link';

export type OpenTigUtilityControlResult =
  | { action: 'web-access-status' | 'update-web-access'; status: OpenTigWebAccessStatus }
  | { action: 'status'; connectedSessionCount: number; browserAccessEnabled: boolean }
  | { action: 'set-browser-access'; browserAccessEnabled: boolean }
  | { action: 'create-pairing-link'; url: string; expiresAt: string };

export type OpenTigUtilityParentMessage =
  | {
      type: 'bootstrap';
      protocolVersion: typeof OPEN_TIG_UTILITY_PROTOCOL_VERSION;
      config: OpenTigUtilityConfig;
    }
  | { type: 'control'; requestId: string; action: 'status' | 'create-pairing-link' | 'web-access-status' }
  | { type: 'control'; requestId: string; action: 'update-web-access'; patch: OpenTigWebAccessPatch }
  | { type: 'control'; requestId: string; action: 'set-browser-access'; enabled: boolean }
  | { type: 'shutdown' };

export type OpenTigUtilityChildMessage =
  | { type: 'network-changed'; host: string; port: number; browserAccessEnabled: boolean }
  | ({ type: 'ready'; host: string; port: number; origin: string } & OpenTigServerIdentity)
  | { type: 'control-result'; requestId: string; ok: true; result: OpenTigUtilityControlResult }
  | { type: 'control-result'; requestId: string; ok: false; message: string }
  | { type: 'error'; code: string; message: string; stack?: string }
  | { type: 'stopped' };
