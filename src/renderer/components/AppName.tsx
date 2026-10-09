import { appDisplayName, isDevProfile } from '@/lib/app-identity';

export function AppName() {
  return <span className={isDevProfile ? 'app-name app-name-dev' : 'app-name'}>{appDisplayName}</span>;
}
