const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('omegaDesktop', {
  isDesktop: true,
  platform: process.platform,
  checkAdbStatus: () => ipcRenderer.invoke('omega:adb-status'),
  collectDeviceSnapshot: () => ipcRenderer.invoke('omega:adb-collect'),
  hardenPrivateDns: () => ipcRenderer.invoke('omega:adb-harden-dns', { confirmed: true }),
});

