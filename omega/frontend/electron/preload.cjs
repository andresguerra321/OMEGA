const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('omegaDesktop', {
  isDesktop: true,
  platform: process.platform,
  checkAdbStatus: (customPath = '') => ipcRenderer.invoke('omega:adb-status', customPath),
  pickAdbBinary: () => ipcRenderer.invoke('omega:adb-pick-binary'),
  installPortableAdb: () => ipcRenderer.invoke('omega:adb-install-portable'),
  collectDeviceSnapshot: (opts = {}) => ipcRenderer.invoke('omega:adb-collect', opts),
  hardenPrivateDns: (opts = {}) =>
    ipcRenderer.invoke('omega:adb-harden-dns', { ...opts, confirmed: true }),
  checkIosStatus: () => ipcRenderer.invoke('omega:ios-status'),
  collectIosSnapshot: (opts = {}) => ipcRenderer.invoke('omega:ios-collect', opts),
  pickIosBackupDir: () => ipcRenderer.invoke('omega:ios-pick-backup-dir'),
  readIosBackupManifest: (backupPath) => ipcRenderer.invoke('omega:ios-read-backup-manifest', backupPath),
  readIosBackupArtifacts: (opts) => ipcRenderer.invoke('omega:ios-read-backup-artifacts', opts),
  collectPcAuditSnapshot: () => ipcRenderer.invoke('omega:pc-audit-collect'),
  openExternalUrl: (targetUrl) => ipcRenderer.invoke('omega:open-external', targetUrl),
  inspectLinkEphemeral: (targetUrl) => ipcRenderer.invoke('omega:ephemeral-link-inspect', targetUrl),
  setTitleBarTheme: (theme) => ipcRenderer.invoke('omega:set-titlebar-theme', theme),
});

