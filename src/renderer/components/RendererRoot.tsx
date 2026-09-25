import { lazy, Suspense } from 'react';
import { Toaster } from 'sileo';
import { QueryClientProvider } from '@tanstack/react-query';
import { MobileViewport } from './MobileViewport';
import { ServerConnectionBoundary } from './ServerConnectionBoundary';
import { queryClient } from '../lib/query-client';

const App = lazy(() => import('../app/App'));
const PairingPage = lazy(() => import('../features/auth/PairingPage'));

export function RendererRoot() {
  const application = window.location.pathname === '/pair'
    ? <PairingPage />
    : <ServerConnectionBoundary><App /></ServerConnectionBoundary>;
  return <>
    <MobileViewport />
    {/* Keep one shared viewport mounted through loading and authentication.
        Sileo's light theme keeps toasts dark regardless of the app theme. */}
    <Toaster theme="light" position="bottom-right" />
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>{application}</Suspense>
    </QueryClientProvider>
  </>;
}
