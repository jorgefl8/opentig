import { describe, expect, it, vi } from 'vitest';
import type { RepositoryInfo } from '@shared/contracts';
import { createRepositorySwitcher, type RepositorySwitchHandlers } from './repository-switch';

const repository = (id: string) => ({ id, name: id, repositoryName: id }) as RepositoryInfo;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup() {
  const opens = new Map<string, ReturnType<typeof deferred<RepositoryInfo | null>>[]>();
  const handlers: RepositorySwitchHandlers = {
    open: vi.fn((id: string) => {
      const request = deferred<RepositoryInfo | null>();
      opens.set(id, [...opens.get(id) ?? [], request]);
      return request.promise;
    }),
    apply: vi.fn(),
    fail: vi.fn(),
    pending: vi.fn(),
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const switcher = createRepositorySwitcher();
  switcher.connect(handlers);
  return { switcher, handlers, opens, settle };
}

describe('repository switching', () => {
  it('shows the pending choice, applies the result and clears the pending state', async () => {
    const { switcher, handlers, opens } = setup();
    const done = switcher.select('todor', 'launchpad');
    expect(handlers.pending).toHaveBeenLastCalledWith('todor');
    opens.get('todor')![0]!.resolve(repository('todor'));
    await done;
    expect(handlers.apply).toHaveBeenCalledWith(repository('todor'), 'todor');
    expect(handlers.pending).toHaveBeenLastCalledWith(null);
  });

  it('ignores choosing the repository that is already open', async () => {
    const { switcher, handlers } = setup();
    await switcher.select('launchpad', 'launchpad');
    expect(handlers.open).not.toHaveBeenCalled();
    expect(handlers.pending).not.toHaveBeenCalled();
  });

  it('runs one open at a time and ends on the latest choice even when an earlier open finishes last', async () => {
    const { switcher, handlers, opens, settle } = setup();
    const done = switcher.select('todor', 'launchpad');
    void switcher.select('monorepo', 'launchpad');
    expect(handlers.open).toHaveBeenCalledTimes(1);
    expect(handlers.pending).toHaveBeenLastCalledWith('monorepo');
    expect(switcher.accepts('todor')).toBe(false);
    expect(switcher.accepts('monorepo')).toBe(true);

    opens.get('todor')![0]!.resolve(repository('todor'));
    await settle();
    expect(handlers.apply).not.toHaveBeenCalled();
    expect(handlers.open).toHaveBeenLastCalledWith('monorepo');

    opens.get('monorepo')![0]!.resolve(repository('monorepo'));
    await done;
    expect(handlers.apply).toHaveBeenCalledTimes(1);
    expect(handlers.apply).toHaveBeenCalledWith(repository('monorepo'), 'monorepo');
    expect(handlers.pending).toHaveBeenLastCalledWith(null);
    expect(switcher.accepts('todor')).toBe(true);
  });

  it('reopens the current repository when the user returns to it during a switch', async () => {
    const { switcher, handlers, opens, settle } = setup();
    const done = switcher.select('todor', 'launchpad');
    void switcher.select('launchpad', 'launchpad');
    opens.get('todor')![0]!.resolve(repository('todor'));
    await settle();
    expect(handlers.open).toHaveBeenLastCalledWith('launchpad');
    opens.get('launchpad')![0]!.resolve(repository('launchpad'));
    await done;
    expect(handlers.apply).toHaveBeenCalledExactlyOnceWith(repository('launchpad'), 'launchpad');
  });

  it('reports only the failure of the latest choice', async () => {
    const { switcher, handlers, opens, settle } = setup();
    const done = switcher.select('todor', 'launchpad');
    void switcher.select('monorepo', 'launchpad');
    opens.get('todor')![0]!.reject(new Error('todor failed'));
    await settle();
    expect(handlers.fail).not.toHaveBeenCalled();
    opens.get('monorepo')![0]!.reject(new Error('monorepo failed'));
    await done;
    expect(handlers.fail).toHaveBeenCalledExactlyOnceWith(new Error('monorepo failed'));
    expect(handlers.apply).not.toHaveBeenCalled();
    expect(handlers.pending).toHaveBeenLastCalledWith(null);
  });

  it('leaves the current repository when the user cancels', async () => {
    const { switcher, handlers, opens } = setup();
    const done = switcher.select('todor', 'launchpad');
    opens.get('todor')![0]!.resolve(null);
    await done;
    expect(handlers.apply).not.toHaveBeenCalled();
    expect(handlers.fail).not.toHaveBeenCalled();
  });
});
