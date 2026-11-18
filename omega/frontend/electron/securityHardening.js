import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TRUSTED_PUBLIC_KEY = '';
export const SECURE_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
});

export function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function allowedNavigation(target, allowed) {
  try {
    const url = new URL(target);
    return allowed.some((entry) => {
      const base = new URL(entry);
      return base.protocol === 'file:' ? url.protocol === 'file:' && url.pathname === base.pathname && url.host === base.host
        : ['http:', 'https:'].includes(base.protocol) && url.origin === base.origin && url.pathname === base.pathname;
    });
  } catch { return false; }
}

export function assertTrustedIpcSender(event, mainWindow, rendererLocations) {
  const frame = event.senderFrame;
  if (!mainWindow || event.sender !== mainWindow.webContents || !frame ||
      frame !== event.sender.mainFrame || !allowedNavigation(frame.url, rendererLocations)) {
    throw new Error('Origen IPC no autorizado');
  }
}

export function validateIpc(channel, args) {
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

export function verifyRelease(root, publicKey = TRUSTED_PUBLIC_KEY) {
  const raw = fs.readFileSync(path.join(root, 'integrity-manifest.json'));
  const signature = Buffer.from(fs.readFileSync(path.join(root, 'integrity-manifest.sig'), 'utf8'), 'base64');
  const key = Buffer.from(publicKey, 'base64');
  if (key.length !== 32) throw new Error('Clave pública de release no configurada');
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]);
  if (!crypto.verify(null, raw, { key: der, format: 'der', type: 'spki' }, signature)) throw new Error('Firma de integridad inválida');
  const manifest = JSON.parse(raw);
  const files = {};
  const walk = (directory, folder) => {
    if (!fs.existsSync(directory)) return;
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error('Enlace inyectado');
      if (item.isDirectory()) walk(file, folder);
      else if (['corpus_mvp', 'sensor_runtime', 'scripts'].includes(folder) || /\.(py|pth)$/.test(item.name)) {
        files[path.relative(root, file).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      }
    }
  };
  for (const folder of ['api', 'rag_engine', 'corpus_mvp', 'sensor_runtime', 'scripts']) walk(path.join(root, folder), folder);
  if (manifest.version !== 1 || JSON.stringify(Object.entries(files).sort()) !== JSON.stringify(Object.entries(manifest.files || {}).sort())) {
    throw new Error('Archivo modificado, inyectado o faltante');
  }
  return true;
}

export function hmacSignature(secret, direction, method, target, stamp, nonce, body = Buffer.alloc(0)) {
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update([
    direction, method.toUpperCase(), target, stamp, nonce, crypto.createHash('sha256').update(body).digest('hex'),
  ].join('\n')).digest('hex');
}

export function encryptedStorage(safeStorage) {
  if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
    throw new Error('El almacén seguro del sistema no está disponible');
  }
  return {
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (text) => safeStorage.decryptString(Buffer.from(text, 'base64')),
  };
}
