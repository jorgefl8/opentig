import type { DesktopServerConfig } from './DesktopServerSettings';

/** Persist intent before enabling; failed transitions always close browser access. */
export async function setBrowserAccess(
  enabled: boolean,
  config: DesktopServerConfig,
  save: (config: DesktopServerConfig) => Promise<void>,
  apply: (enabled: boolean) => Promise<void>,
): Promise<DesktopServerConfig> {
  const next = { ...config, webAccessEnabled: enabled };
  try {
    await save(next);
    await apply(enabled);
    return next;
  } catch (error) {
    const failures = await Promise.allSettled([apply(false), save({ ...next, webAccessEnabled: false })]);
    const messages = [error, ...failures.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])]
      .map((failure) => failure instanceof Error ? failure.message : String(failure));
    throw new Error(messages.join(' '), { cause: error });
  }
}
