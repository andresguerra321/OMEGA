import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;

async function runAdb(args, timeout = 12000) {
  const { stdout } = await execFileAsync('adb', args, {
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

function parseAdbDevices(raw) {
  return raw
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        line,
        serial: parts[0] || '',
        state: parts[1] || '',
      };
    });
}

// 1. Detectar si hay un dispositivo Android autorizado por USB (solo lectura)
ipcMain.handle('omega:adb-status', async () => {
  try {
    const raw = await runAdb(['devices', '-l'], 5000);
    const devices = parseAdbDevices(raw);
    const authorized = devices.find((d) => d.state === 'device');

    if (!authorized) {
      const unauthorized = devices.find((d) => d.state === 'unauthorized');
      return {
        available: true,
        connected: false,
        reason: unauthorized
          ? 'Dispositivo conectado pero sin autorizar. Acepta la huella RSA en la pantalla del teléfono.'
          : 'Ningún dispositivo Android conectado por USB.',
      };
    }

    const modelMatch = authorized.line.match(/model:([^\s]+)/);
    return {
      available: true,
      connected: true,
      serial: authorized.serial,
      model: modelMatch ? modelMatch[1].replace(/_/g, ' ') : 'Android Device',
    };
  } catch {
    return {
      available: false,
      connected: false,
      reason: 'ADB no encontrado en el PATH del sistema. Instala Android Platform Tools.',
    };
  }
});

// 2. Extracción forense volátil de solo lectura (procesos, paquetes y postura de seguridad)
ipcMain.handle('omega:adb-collect', async () => {
  const [
    model,
    manufacturer,
    androidVersion,
    securityPatch,
    privateDnsMode,
    privateDnsSpecifier,
    unknownSourcesRaw,
    packagesRaw,
    processesRaw,
  ] = await Promise.all([
    runAdb(['shell', 'getprop', 'ro.product.model']).catch(() => 'Desconocido'),
    runAdb(['shell', 'getprop', 'ro.product.manufacturer']).catch(() => ''),
    runAdb(['shell', 'getprop', 'ro.build.version.release']).catch(() => 'N/D'),
    runAdb(['shell', 'getprop', 'ro.build.version.security_patch']).catch(() => 'N/D'),
    runAdb(['shell', 'settings', 'get', 'global', 'private_dns_mode']).catch(() => 'off'),
    runAdb(['shell', 'settings', 'get', 'global', 'private_dns_specifier']).catch(() => ''),
    runAdb(['shell', 'settings', 'get', 'secure', 'install_non_market_apps']).catch(() => ''),
    runAdb(['shell', 'pm', 'list', 'packages', '-3']).catch(() => ''),
    runAdb(['shell', 'ps', '-A', '-o', 'USER,PID,PPID,NAME,ARGS']).catch(() => ''),
  ]);

  const cleanPackages = packagesRaw
    .split(/\r?\n/)
    .map((line) => line.replace(/^package:/, '').trim())
    .filter(Boolean)
    .join('\n');

  return {
    device: {
      manufacturer: manufacturer.trim(),
      model: model.trim(),
      android_version: androidVersion.trim(),
      security_patch: securityPatch.trim(),
      private_dns_mode: privateDnsMode.trim(),
      private_dns_specifier: privateDnsSpecifier.trim(),
      install_non_market_apps: unknownSourcesRaw.trim(),
    },
    packages_text: cleanPackages,
    processes_text: processesRaw,
  };
});

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0A0A0C',
    title: 'OMEGA — Cyber Threat Intelligence',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0A0A0C',
      symbolColor: '#8E8E96',
      height: 48,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL(process.env.OMEGA_RENDERER_URL || 'http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createMainWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
