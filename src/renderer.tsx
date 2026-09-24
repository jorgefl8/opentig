/// <reference types="vite/client" />

import './renderer/lib/boot-theme';
import './renderer/styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RendererRoot } from './renderer/components/RendererRoot';

const root = document.getElementById('root');
if (!root) throw new Error('Root container not found.');
createRoot(root).render(
  <StrictMode>
    <RendererRoot />
  </StrictMode>,
);
