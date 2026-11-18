const { contextBridge, ipcRenderer } = require('electron');

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function validateIpc(channel, args) {
  if (!Array.isArray(args) || args.length > 1) throw new Error('Argumentos IPC inválidos');
  const value = args[0];
  if (channel === 'omega:host-prepare') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 ||
        typeof value.accessToken !== 'string' || value.accessToken.length > 16384 || !/^[A-Za-z0-9_.-]+$/.test(value.accessToken)) {
      throw new Error('Sesión local inválida');
    }
    return;
  }
  const noArgs = new Set(['omega:adb-pick-binary', 'omega:adb-install-portable', 'omega:ios-status',
    'omega:ios-pick-backup-dir', 'omega:pc-audit-collect', 'omega:backend-status', 'omega:backend-skip', 'omega:ai-config-get']);
  if (noArgs.has(channel)) {
    if (args.length) throw new Error('Este canal no acepta argumentos');
    return;
  }
  const strings = new Set(['omega:adb-status', 'omega:ios-read-backup-manifest', 'omega:open-external',
    'omega:ephemeral-link-inspect', 'omega:set-titlebar-theme']);
  if (strings.has(channel)) {
    if (value === undefined && channel === 'omega:adb-status') return;
    if (typeof value !== 'string' || value.length > 4096 || /[\0\r\n]/.test(value)) throw new Error('Texto IPC inválido');
    if (channel === 'omega:open-external' && !httpsUrl(value)) throw new Error('Solo HTTPS');
    if (channel === 'omega:set-titlebar-theme' && !['dark', 'light'].includes(value)) throw new Error('Tema inválido');
    return;
  }
  const schemas = {
    'omega:adb-collect': { customPath: 'string', serial: 'string' },
    'omega:adb-harden-dns': { customPath: 'string', serial: 'string', confirmed: 'boolean' },
    'omega:ios-collect': { udid: 'string' },
    'omega:ios-read-backup-artifacts': { backupPath: 'string', encrypted: 'boolean', targets: 'object' },
    'omega:backend-retry': { prodMode: 'boolean' },
    'omega:ai-config-save': { groqApiKey: 'string', groqModel: 'string', clearGroqKey: 'boolean',
      openAiApiKey: 'string', openAiChatModel: 'string', clearOpenAiKey: 'boolean',
      customProvider: 'string', customBaseUrl: 'string', customApiKey: 'string', customModel: 'string',
      clearCustomProvider: 'boolean', clearCustomKey: 'boolean', omniRouteEnabled: 'boolean',
      omniRouteApiKey: 'string', omniRouteModel: 'string', clearOmniRouteKey: 'boolean' },
  };
  const schema = schemas[channel];
  if (!schema || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Canal o payload IPC inválido');
  for (const [key, field] of Object.entries(value)) {
    if (!Object.hasOwn(schema, key) || typeof field !== schema[key] || (typeof field === 'string' && (field.length > 4096 || /[\0\r\n]/.test(field)))) {
      throw new Error('Campo IPC inválido');
    }
  }
  if ('targets' in value && (!Array.isArray(value.targets) || value.targets.length > 35 || value.targets.some((target) =>
    !target || typeof target !== 'object' || !/^[a-f0-9]{32,64}$/i.test(target.file_id || '') ||
    (target.relative_path !== undefined && (typeof target.relative_path !== 'string' || target.relative_path.length > 4096))))) {
    throw new Error('Targets IPC inválidos');
  }
}


// Sandboxed preload cannot require local modules; main repeats this boundary check.
function invoke(channel, ...args) { validateIpc(channel, args); return ipcRenderer.invoke(channel, ...args); }

contextBridge.exposeInMainWorld('omegaDesktop', {
  isDesktop: true,
  prepareHostSensor: (payload) => invoke('omega:host-prepare', payload),
  platform: process.platform,
  checkAdbStatus: (customPath = '') => invoke('omega:adb-status', customPath),
  pickAdbBinary: () => invoke('omega:adb-pick-binary'),
  installPortableAdb: () => invoke('omega:adb-install-portable'),
  collectDeviceSnapshot: (opts = {}) => invoke('omega:adb-collect', opts),
  hardenPrivateDns: (opts = {}) =>
    invoke('omega:adb-harden-dns', { ...opts, confirmed: true }),
  checkIosStatus: () => invoke('omega:ios-status'),
  collectIosSnapshot: (opts = {}) => invoke('omega:ios-collect', opts),
  pickIosBackupDir: () => invoke('omega:ios-pick-backup-dir'),
  readIosBackupManifest: (backupPath) => invoke('omega:ios-read-backup-manifest', backupPath),
  readIosBackupArtifacts: (opts) => invoke('omega:ios-read-backup-artifacts', opts),
  collectPcAuditSnapshot: () => invoke('omega:pc-audit-collect'),
  openExternalUrl: (targetUrl) => invoke('omega:open-external', targetUrl),
  inspectLinkEphemeral: (targetUrl) => invoke('omega:ephemeral-link-inspect', targetUrl),
  setTitleBarTheme: (theme) => invoke('omega:set-titlebar-theme', theme),
  getBackendStatus: () => invoke('omega:backend-status'),
  retryBackendStartup: (opts = {}) => invoke('omega:backend-retry', opts),
  continueWithoutBackend: () => invoke('omega:backend-skip'),
  getAiEngineConfig: () => invoke('omega:ai-config-get'),
  saveAiEngineConfig: (payload = {}) => invoke('omega:ai-config-save', payload),
  onBackendStatus: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('omega:backend-status-event', listener);
    return () => {
      ipcRenderer.removeListener('omega:backend-status-event', listener);
    };
  },
});

