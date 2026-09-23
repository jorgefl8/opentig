export type ApplicationProfile = 'production' | 'dev';

export function applicationName(profile: ApplicationProfile): string {
  return profile === 'dev' ? 'OpenTig Dev' : 'OpenTig';
}

export function sessionCookieName(profile: ApplicationProfile): string {
  return profile === 'dev' ? 'opentig_dev_session' : 'opentig_session';
}

export function preferredServerPort(profile: ApplicationProfile): number {
  return profile === 'dev' ? 6867 : 6767;
}
