import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, UploaderBridge } from './shared/types';

/** The window's only way to the main process: these calls, nothing of Node or Electron itself. */
const bridge: UploaderBridge = {
  getState: () => ipcRenderer.invoke('state:get'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  saveKey: (key) => ipcRenderer.invoke('key:save', key),
  forgetKey: () => ipcRenderer.invoke('key:forget'),
  openKeyPage: () => ipcRenderer.invoke('key:open-page'),
  uploadNow: () => ipcRenderer.invoke('upload:now'),
  setBackground: (on) => ipcRenderer.invoke('background:set', on),
  setOpenAtLogin: (on) => ipcRenderer.invoke('login:set', on),
  onState: (listener) => {
    ipcRenderer.on('state', (_event, state: AppState) => listener(state));
  },
};

contextBridge.exposeInMainWorld('uploader', bridge);
