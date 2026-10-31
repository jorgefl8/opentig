export interface DeviceHints {
  userAgent: string;
  hardwareConcurrency?: number;
  /** Only Chromium reports it, in GB. */
  deviceMemory?: number;
}

/** Android phones with 4 GB of memory or less, or 4 cores or less. iPhones keep costly effects: the system draws them the same everywhere. */
export function isLowEndDevice({ userAgent, hardwareConcurrency, deviceMemory }: DeviceHints): boolean {
  if (!/Android/i.test(userAgent)) return false;
  return (deviceMemory ?? 8) <= 4 || (hardwareConcurrency || 8) <= 4;
}
