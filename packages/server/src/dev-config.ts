import os from 'node:os';
import path from 'node:path';
import { prepareDevDirectory } from '../../../src/main/profile/DesktopProfile';
import { preferredServerPort } from '../../../src/shared/application-profile';
import { CliUsageError } from './cli-config';

/** Fixed source-development identity. Production CLI flags/env cannot redirect it. */
export function devCliArguments(args: readonly string[], environment: NodeJS.ProcessEnv = process.env, home = os.homedir(), platform: NodeJS.Platform = process.platform): string[] {
  const command = args[0] ?? 'serve';
  if (args.length > 1 || (command !== 'serve' && command !== 'pair')) {
    throw new CliUsageError('Use npm run start:web:dev or npm run pair:web:dev without additional options.');
  }
  const directory = path.join(home, '.opentig-dev');
  const appData = platform === 'win32'
    ? environment.APPDATA || path.join(home, 'AppData', 'Roaming')
    : platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : environment.XDG_CONFIG_HOME || path.join(home, '.config');
  const protectedDirectories = [
    path.join(home, '.opentig'),
    path.join(appData, 'OpenTig'),
    path.join(appData, 'OpenTig Dev'),
    ...(environment.OPENTIG_HOME ? [path.resolve(environment.OPENTIG_HOME)] : []),
  ];
  prepareDevDirectory(directory, protectedDirectories);
  return command === 'pair'
    ? ['pair', '--home', directory]
    : ['serve', '--home', directory, '--host', '127.0.0.1', '--port', String(preferredServerPort('dev'))];
}
