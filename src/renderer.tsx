/// <reference types="vite/client" />

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './renderer/app/App';
import PairingPage from './renderer/features/auth/PairingPage';
import { queryClient } from './renderer/lib/query-client';
import './renderer/styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root container not found.');
const application = window.location.pathname === '/pair' ? <PairingPage /> : <App />;
createRoot(root).render(<StrictMode><QueryClientProvider client={queryClient}>{application}</QueryClientProvider></StrictMode>);
