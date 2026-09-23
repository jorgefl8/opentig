export const isDevProfile = document.documentElement.dataset.opentigProfile === 'dev';
export const appDisplayName = isDevProfile ? 'OpenTig Dev' : 'OpenTig';
