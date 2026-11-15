import { Suspense } from 'react';
import { lazyWithRetry } from '@/lib/lazy-with-retry';
import { Toaster } from 'sileo';
import { QueryClientProvider } from '@tanstack/react-query';
import { LowEndDevice } from './LowEndDevice';
import { MobileViewport } from './MobileViewport';
import { ServerConnectionBoundary } from './ServerConnectionBoundary';
import { SplashScreen } from './SplashScreen';
import { appDisplayName } from '../lib/app-identity';
import { queryClient } from '../lib/query-client';

const App = lazyWithRetry(() => import('../app/App'));
const PairingPage = lazyWithRetry(() => import('../features/auth/PairingPage'));

export function RendererRoot() {
  const application = window.location.pathname === '/pair'
    ? <PairingPage />
    // The web build gives each place an address; the desktop app keeps its trail without one.
    : <ServerConnectionBoundary><App addresses={!window.opentigDesktop} /></ServerConnectionBoundary>;
  return <>
    <MobileViewport />
    <LowEndDevice />
    {/* Keep one shared viewport mounted through loading and authentication.
        Sileo's light theme keeps toasts dark regardless of the app theme. */}
    <Toaster theme="light" position="bottom-right" />
    <QueryClientProvider client={queryClient}>
      {/* Until the app's code is in, the loading screen index.html drew stays in its place instead of a blank frame. */}
      <Suspense fallback={<SplashScreen heading={appDisplayName} detail="Starting…" />}>{application}</Suspense>
    </QueryClientProvider>
  </>;
}
