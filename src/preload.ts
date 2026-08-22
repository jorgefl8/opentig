import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { createDesktopApi } from './preload/api';

contextBridge.exposeInMainWorld('opentigDesktop', createDesktopApi(
  ipcRenderer,
  (factor) => webFrame.setZoomFactor(factor),
));
