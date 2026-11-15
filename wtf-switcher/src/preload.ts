import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, SwitcherBridge } from './shared/types';

/** The window's only way to the main process: these calls, nothing of Node or Electron itself. */
const bridge: SwitcherBridge = {
  getState: () => ipcRenderer.invoke('state:get'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  create: (name, forScreens) => ipcRenderer.invoke('profile:create', name, forScreens),
  use: (name) => ipcRenderer.invoke('profile:use', name),
  openProfiles: () => ipcRenderer.invoke('profiles:open'),
  retry: () => ipcRenderer.invoke('switch:retry'),
  setBackground: (on) => ipcRenderer.invoke('background:set', on),
  setOpenAtLogin: (on) => ipcRenderer.invoke('login:set', on),
  fit: (height) => ipcRenderer.invoke('window:fit', height),
  onState: (listener) => {
    ipcRenderer.on('state', (_event, state: AppState) => listener(state));
  },
};

contextBridge.exposeInMainWorld('switcher', bridge);
