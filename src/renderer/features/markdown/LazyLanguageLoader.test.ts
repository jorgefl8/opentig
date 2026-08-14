import { describe, expect, it, vi } from 'vitest';
import { LazyLanguageLoader } from './LazyLanguageLoader';

describe('LazyLanguageLoader', () => {
  it('coalesces concurrent requests for the same language', async () => {
    let resolveImport: ((value: string) => void) | undefined;
    const importer = vi.fn(() => new Promise<string>((resolve) => { resolveImport = resolve; }));
    const register = vi.fn(async () => undefined);
    const loader = new LazyLanguageLoader({ typescript: importer });

    const first = loader.ensure('typescript', () => false, register);
    const second = loader.ensure('typescript', () => false, register);
    resolveImport?.('grammar');
    await Promise.all([first, second]);

    expect(importer).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith('grammar');
  });

  it('does not import a language already present in the highlighter', async () => {
    const importer = vi.fn(async () => 'grammar');
    const register = vi.fn(async () => undefined);
    const loader = new LazyLanguageLoader({ python: importer });

    await loader.ensure('python', () => true, register);

    expect(importer).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('clears a failed request so a later render can retry', async () => {
    const importer = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('grammar');
    const register = vi.fn(async () => undefined);
    const loader = new LazyLanguageLoader({ rust: importer });

    await expect(loader.ensure('rust', () => false, register)).rejects.toThrow('transient');
    await expect(loader.ensure('rust', () => false, register)).resolves.toBeUndefined();

    expect(importer).toHaveBeenCalledTimes(2);
    expect(register).toHaveBeenCalledOnce();
  });
});
