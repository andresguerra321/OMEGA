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

// 2. Extracción forense volátil de solo lectura (sockets kernel, DNS, accesibilidad, SELinux, procesos y paquetes)
ipcMain.handle('omega:adb-collect', async () => {
  const [
    model,
    manufacturer,
    androidVersion,
    securityPatch,
    privateDnsMode,
    privateDnsSpecifier,
    unknownSourcesRaw,
    selinuxStatus,
    verifiedBootState,
    accessibilityServices,
    deviceAdmins,
    packagesRaw,
    processesRaw,
    procNetTcp,
    procNetTcp6,
    dnsResolverDump,
  ] = await Promise.all([
    runAdb(['shell', 'getprop', 'ro.product.model']).catch(() => 'Desconocido'),
    runAdb(['shell', 'getprop', 'ro.product.manufacturer']).catch(() => ''),
    runAdb(['shell', 'getprop', 'ro.build.version.release']).catch(() => 'N/D'),
    runAdb(['shell', 'getprop', 'ro.build.version.security_patch']).catch(() => 'N/D'),
    runAdb(['shell', 'settings', 'get', 'global', 'private_dns_mode']).catch(() => 'off'),
    runAdb(['shell', 'settings', 'get', 'global', 'private_dns_specifier']).catch(() => ''),
    runAdb(['shell', 'settings', 'get', 'secure', 'install_non_market_apps']).catch(() => ''),
    runAdb(['shell', 'getenforce']).catch(() => 'Unknown'),
    runAdb(['shell', 'getprop', 'ro.boot.verifiedbootstate']).catch(() => 'unknown'),
    runAdb(['shell', 'settings', 'get', 'secure', 'enabled_accessibility_services']).catch(() => 'null'),
    runAdb(['shell', 'dumpsys', 'device_policy']).catch(() => ''),
    runAdb(['shell', 'pm', 'list', 'packages', '-3']).catch(() => ''),
    runAdb(['shell', 'ps', '-A', '-o', 'USER,PID,PPID,NAME,ARGS']).catch(() => ''),
    runAdb(['shell', 'cat', '/proc/net/tcp']).catch(() => ''),
    runAdb(['shell', 'cat', '/proc/net/tcp6']).catch(() => ''),
    runAdb(['shell', 'dumpsys', 'dnsresolver']).catch(() => ''),
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
      selinux_status: selinuxStatus.trim(),
      verified_boot_state: verifiedBootState.trim(),
      accessibility_services: accessibilityServices.trim(),
    },
    device_admins_raw: deviceAdmins,
    packages_text: cleanPackages,
    processes_text: processesRaw,
    proc_net_raw: `${procNetTcp}\n${procNetTcp6}`,
    dns_resolver_raw: dnsResolverDump,
  };
});

// 3. Contramedida defensiva explícita: forzar DNS-over-TLS cifrado (Quad9)
ipcMain.handle('omega:adb-harden-dns', async (_event, opts) => {
  if (!opts?.confirmed) {
    throw new Error('Se requiere confirmación explícita del analista antes de modificar ajustes de red.');
  }
  await runAdb(['shell', 'settings', 'put', 'global', 'private_dns_mode', 'hostname'], 5000);
  await runAdb(['shell', 'settings', 'put', 'global', 'private_dns_specifier', 'dns.quad9.net'], 5000);
  const [appliedMode, appliedSpecifier] = await Promise.all([
    runAdb(['shell', 'settings', 'get', 'global', 'private_dns_mode'], 4000).catch(() => ''),
    runAdb(['shell', 'settings', 'get', 'global', 'private_dns_specifier'], 4000).catch(() => ''),
  ]);
  return {
    applied: appliedMode.trim() === 'hostname' && appliedSpecifier.trim() === 'dns.quad9.net',
    mode: appliedMode.trim(),
    specifier: appliedSpecifier.trim(),
    provider: 'dns.quad9.net (DNS-over-TLS)',
  };
});

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#08080A',
    title: 'OMEGA — Cyber Threat Intelligence',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#08080A',
      symbolColor: '#8E8E93',
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
