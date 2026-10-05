import { describe, expect, it, vi } from 'vitest';
import { setBrowserAccess } from './setBrowserAccess';

const config = { webAccessEnabled: false, lanAccessEnabled: true, publicOrigin: 'https://git.example.com' };
describe('desktop browser access transitions', () => {
  it('persists before opening access and preserves LAN and URL preferences', async () => {
    const order: string[] = [];
    const result = await setBrowserAccess(true, config, async () => { order.push('save'); }, async (enabled) => { order.push(String(enabled)); });
    expect(order).toEqual(['save', 'true']);
    expect(result).toEqual({ ...config, webAccessEnabled: true });
  });
  it.each(['save', 'control'])('closes the gate and persists OFF after a failed %s', async (failure) => {
    const save = vi.fn(async () => undefined);
    const apply = vi.fn(async () => undefined);
    (failure === 'save' ? save : apply).mockRejectedValueOnce(new Error('Failed'));
    await expect(setBrowserAccess(true, config, save, apply)).rejects.toThrow('Failed');
    expect(apply).toHaveBeenLastCalledWith(false);
    expect(save).toHaveBeenLastCalledWith({ ...config, webAccessEnabled: false });
    if (failure === 'save') expect(apply).not.toHaveBeenCalledWith(true);
  });
  it('still closes live access when saving OFF fails and reports rollback failures', async () => {
    const save = vi.fn(async () => { throw new Error('Disk failed'); });
    const apply = vi.fn(async () => { throw new Error('Server offline'); });
    await expect(setBrowserAccess(false, { ...config, webAccessEnabled: true }, save, apply)).rejects.toThrow('Server offline');
    expect(apply).toHaveBeenCalledWith(false);
  });
});
