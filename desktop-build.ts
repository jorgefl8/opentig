import type { ApplicationProfile } from './src/shared/application-profile';

export function desktopBuildProfile(): ApplicationProfile {
  const value = process.env.OPENTIG_BUILD_PROFILE ?? 'production';
  if (value !== 'production' && value !== 'dev') throw new Error('OPENTIG_BUILD_PROFILE must be production or dev.');
  return value;
}
