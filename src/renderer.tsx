/// <reference types="vite/client" />

import './renderer/lib/boot-theme';
import './renderer/styles/index.css';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { MobileViewport } from './renderer/components/MobileViewport';
import { ServerConnectionBoundary } from './renderer/components/ServerConnectionBoundary';
import { queryClient } from './renderer/lib/query-client';

const App = lazy(() => import('./renderer/app/App'));
const PairingPage = lazy(() => import('./renderer/features/auth/PairingPage'));

const root = document.getElementById('root');
if (!root) throw new Error('Root container not found.');
const application = window.location.pathname === '/pair'
  ? <PairingPage />
  : <ServerConnectionBoundary><App /></ServerConnectionBoundary>;
createRoot(root).render(
  <StrictMode>
    <MobileViewport />
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>{application}</Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
