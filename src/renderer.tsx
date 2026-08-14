/// <reference types="vite/client" />

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './renderer/app/App';
import './renderer/styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root container not found.');
createRoot(root).render(<StrictMode><App /></StrictMode>);
