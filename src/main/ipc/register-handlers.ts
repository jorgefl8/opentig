import type { BrowserWindow } from 'electron';
import type { Preferences } from '../../shared/contracts';
import type { OpenTigRuntimeServices } from '../runtime/OpenTigRuntime';
import { CommandRegistry } from '../runtime/CommandRegistry';
import { registerServerCommands } from '../runtime/registerServerCommands';
import { createElectronHostAdapter } from './ElectronHostAdapter';
import { registerDesktopHandlers } from './registerDesktopHandlers';
import { registerServerIpcAdapter } from './registerServerIpcAdapter';

interface Services extends OpenTigRuntimeServices {
  window: BrowserWindow;
  onPreferencesChanged?: (preferences: Preferences) => void;
}

export function registerHandlers(services: Services): () => void {
  const registry = new CommandRegistry();
  const host = createElectronHostAdapter(services.window, services.onPreferencesChanged);
  registerServerCommands(registry, services, host);
  const removeServerHandlers = registerServerIpcAdapter(registry);
  const removeDesktopHandlers = registerDesktopHandlers(registry, services.repositories, host);
  return () => {
    removeServerHandlers();
    removeDesktopHandlers();
    registry.clear();
  };
}
