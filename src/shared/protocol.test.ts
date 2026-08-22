import { describe, expect, it } from 'vitest';
import { IPC, type OpenTigApi } from './contracts';
import type { OpenTigDesktopApi } from './desktop-api';
import {
  OPEN_TIG_NON_SERVER_IPC_KEYS,
  OPEN_TIG_SERVER_COMMANDS,
  type OpenTigServerCommandMap,
} from './protocol';
import type { OpenTigServerApi } from './server-api';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;

type SplitApi = OpenTigServerApi & OpenTigDesktopApi;

const TYPE_PROOF: readonly true[] = [
  true satisfies (OpenTigApi extends SplitApi ? true : false),
  true satisfies (SplitApi extends OpenTigApi ? true : false),
  true satisfies Equal<OpenTigServerCommandMap[typeof IPC.bootstrap]['args'], []>,
  true satisfies Equal<OpenTigServerCommandMap[typeof IPC.capabilities]['args'], []>,
  true satisfies Equal<OpenTigServerCommandMap[typeof IPC.repositoryOpenPath]['args'], [path: string]>,
  true satisfies Equal<
    OpenTigServerCommandMap[typeof IPC.preferences]['args'],
    Parameters<OpenTigApi['app']['setPreferences']>
  >,
  true satisfies Equal<
    OpenTigServerCommandMap[typeof IPC.repositoryWriteFile]['result'],
    Awaited<ReturnType<OpenTigApi['repository']['writeFile']>>
  >,
];

describe('OpenTig server protocol ownership', () => {
  it('keeps the combined compatibility API structurally exact', () => {
    expect(TYPE_PROOF).toEqual([true, true, true, true, true, true, true]);
  });

  it('partitions every IPC channel into one server command or non-server channel', () => {
    const serverChannels = Object.values(OPEN_TIG_SERVER_COMMANDS).map((definition) => definition.command);
    const nonServerChannels = OPEN_TIG_NON_SERVER_IPC_KEYS.map((key) => IPC[key]);
    const classified = [...serverChannels, ...nonServerChannels];

    expect(new Set(serverChannels).size).toBe(serverChannels.length);
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual(Object.values(IPC).sort());
  });

  it('gives every server method stable execution metadata', () => {
    const definitions = Object.values(OPEN_TIG_SERVER_COMMANDS);

    expect(definitions.length).toBeGreaterThan(60);
    for (const definition of definitions) {
      expect(definition.operation.length).toBeGreaterThan(0);
      expect(Number.isSafeInteger(definition.maxRequestBytes)).toBe(true);
      expect(definition.maxRequestBytes).toBeGreaterThan(0);
    }
  });

  it('marks representative reads and writes correctly', () => {
    expect(OPEN_TIG_SERVER_COMMANDS['repository.getStatus'].mutation).toBe(false);
    expect(OPEN_TIG_SERVER_COMMANDS['app.capabilities'].mutation).toBe(false);
    expect(OPEN_TIG_SERVER_COMMANDS['repository.openPath'].mutation).toBe(true);
    expect(OPEN_TIG_SERVER_COMMANDS['repository.writeFile'].mutation).toBe(true);
    expect(OPEN_TIG_SERVER_COMMANDS['commits.list'].mutation).toBe(false);
    expect(OPEN_TIG_SERVER_COMMANDS['commits.create'].mutation).toBe(true);
    expect(OPEN_TIG_SERVER_COMMANDS['github.getPullRequest'].mutation).toBe(false);
    expect(OPEN_TIG_SERVER_COMMANDS['github.createPullRequest'].mutation).toBe(true);
  });

  it('reserves larger request budgets only for content-bearing mutations', () => {
    const normal = OPEN_TIG_SERVER_COMMANDS['repository.getStatus'].maxRequestBytes;
    const conflict = OPEN_TIG_SERVER_COMMANDS['index.updateConflict'].maxRequestBytes;
    const writeFile = OPEN_TIG_SERVER_COMMANDS['repository.writeFile'].maxRequestBytes;

    expect(conflict).toBeGreaterThan(normal);
    expect(writeFile).toBeGreaterThan(conflict);
  });
});
