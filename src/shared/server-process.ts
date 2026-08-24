import type { OpenTigPlatform } from './contracts';
import type { OpenTigServerIdentity } from './server-protocol';

export const OPEN_TIG_UTILITY_PROTOCOL_VERSION = 1;

export type OpenTigServerHost = '127.0.0.1' | '0.0.0.0';

export interface OpenTigUtilityConfig {
  appVersion: string;
  desktopSecret: string;
  settingsPath: string;
  aiLogPath: string;
  serverDataPath: string;
  clientRoot: string;
  trashModulePath?: string;
  platform: OpenTigPlatform;
  host: OpenTigServerHost;
  port: number;
  allowedOrigins?: string[];
}

export type OpenTigUtilityControlAction =
  | 'status'
  | 'create-pairing-link';

export type OpenTigUtilityControlResult =
  | { action: 'status'; connectedSessionCount: number }
  | { action: 'create-pairing-link'; url: string; expiresAt: string };

export type OpenTigUtilityParentMessage =
  | {
      type: 'bootstrap';
      protocolVersion: typeof OPEN_TIG_UTILITY_PROTOCOL_VERSION;
      config: OpenTigUtilityConfig;
    }
  | { type: 'control'; requestId: string; action: OpenTigUtilityControlAction }
  | { type: 'shutdown' };

export type OpenTigUtilityChildMessage =
  | ({ type: 'ready'; host: string; port: number; origin: string } & OpenTigServerIdentity)
  | { type: 'control-result'; requestId: string; ok: true; result: OpenTigUtilityControlResult }
  | { type: 'control-result'; requestId: string; ok: false; message: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'stopped' };
