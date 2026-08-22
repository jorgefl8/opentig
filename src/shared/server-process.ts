import type { OpenTigPlatform } from './contracts';
import type { OpenTigServerIdentity } from './server-protocol';

export const OPEN_TIG_UTILITY_PROTOCOL_VERSION = 1;

export interface OpenTigUtilityConfig {
  appVersion: string;
  desktopSecret: string;
  settingsPath: string;
  aiLogPath: string;
  serverDataPath: string;
  clientRoot: string;
  trashModulePath?: string;
  platform: OpenTigPlatform;
  host: '127.0.0.1';
  port: number;
}

export type OpenTigUtilityParentMessage =
  | {
      type: 'bootstrap';
      protocolVersion: typeof OPEN_TIG_UTILITY_PROTOCOL_VERSION;
      config: OpenTigUtilityConfig;
    }
  | { type: 'shutdown' };

export type OpenTigUtilityChildMessage =
  | ({ type: 'ready'; host: string; port: number; origin: string } & OpenTigServerIdentity)
  | { type: 'error'; code: string; message: string }
  | { type: 'stopped' };
