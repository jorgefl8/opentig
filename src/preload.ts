import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { createApi } from './preload/api';

contextBridge.exposeInMainWorld('justgit', createApi(ipcRenderer, (factor) => webFrame.setZoomFactor(factor)));
