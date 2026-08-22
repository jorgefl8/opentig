import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { createApi } from './preload/api';

contextBridge.exposeInMainWorld('opentig', createApi(ipcRenderer, (factor) => webFrame.setZoomFactor(factor)));
