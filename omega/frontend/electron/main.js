import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'ascii');

function normalizeAdbCandidate(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return null;
  const resolved = path.resolve(trimmed);
  try {
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isFile()) return resolved;
      if (stat.isDirectory()) {
        const exeName = process.platform === 'win32' ? 'adb.exe' : 'adb';
        const nested = path.join(resolved, exeName);
        if (fs.existsSync(nested)) return nested;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function isRunnableBinary(binPath, args = ['version']) {
  try {
    await execFileAsync(binPath, args, { timeout: 2500, maxBuffer: 512 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function resolveAdbBinary(customPath = '') {
  const custom = normalizeAdbCandidate(customPath);
  if (custom && (await isRunnableBinary(custom, ['version']))) {
    return custom;
  }
  if (await isRunnableBinary('adb', ['version'])) {
    return 'adb';
  }

  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [];
  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || '';
    const userProf = process.env.USERPROFILE || os.homedir();
    if (localApp) candidates.push(path.join(localApp, 'Android', 'Sdk', 'platform-tools', exe));
    candidates.push(path.join(userProf, 'platform-tools', exe));
    candidates.push(path.join('C:\\', 'platform-tools', exe));
    candidates.push(path.join('C:\\', 'Android', 'platform-tools', exe));
  } else {
    candidates.push(path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', exe));
    candidates.push(path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', exe));
    candidates.push('/opt/homebrew/bin/adb', '/usr/local/bin/adb', '/usr/bin/adb');
  }
  candidates.push(path.join(app.getPath('userData'), 'tools', 'platform-tools', exe));
  candidates.push(path.join(__dirname, '..', '..', 'tools', 'platform-tools', exe));

  for (const cand of candidates) {
    if (cand && fs.existsSync(cand) && (await isRunnableBinary(cand, ['version']))) {
      return cand;
    }
  }
  return null;
}

async function runAdb(args, timeout = 12000, customPath = '') {
  const adbBin = await resolveAdbBinary(customPath);
  if (!adbBin) {
    throw new Error('ADB_NOT_FOUND');
  }
  const { stdout } = await execFileAsync(adbBin, args, {
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
      const modelMatch = line.match(/model:([^\s]+)/);
      const productMatch = line.match(/product:([^\s]+)/);
      return {
        line,
        serial: parts[0] || '',
        state: parts[1] || '',
        model: modelMatch ? modelMatch[1].replace(/_/g, ' ') : productMatch ? productMatch[1] : 'Android',
      };
    });
}

// 1. Detectar si hay un dispositivo Android autorizado por USB (solo lectura)
ipcMain.handle('omega:adb-status', async (_event, customPath = '') => {
  try {
    const adbBin = await resolveAdbBinary(customPath);
    if (!adbBin) {
      return {
        available: false,
        connected: false,
        status_code: 'ADB_NOT_FOUND',
        adb_path: null,
        devices: [],
        reason: 'Tu computadora aún no tiene instalado el conector gratuito de Google para leer teléfonos Android.',
      };
    }

    const { stdout } = await execFileAsync(adbBin, ['devices', '-l'], {
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const devices = parseAdbDevices(stdout.trim());
    const authorized = devices.find((d) => d.state === 'device');

    if (!authorized) {
      const unauthorized = devices.find((d) => d.state === 'unauthorized');
      const offline = devices.find((d) => d.state === 'offline');
      let status_code = 'NO_DEVICE';
      let reason = 'Computadora lista. Ahora enchufa tu teléfono Android con el cable USB (como en la imagen 2).';
      if (unauthorized) {
        status_code = 'UNAUTHORIZED';
        reason = '¡Teléfono detectado! Desbloquéalo y toca "Permitir" en el aviso que acaba de salir en su pantalla.';
      } else if (offline) {
        status_code = 'OFFLINE';
        reason = 'El cable respondió lento. Desconéctalo, elige "Transferencia de archivos" en tu teléfono y vuelve a enchufar.';
      }
      return {
        available: true,
        connected: false,
        status_code,
        adb_path: adbBin,
        devices,
        reason,
      };
    }

    return {
      available: true,
      connected: true,
      status_code: 'READY',
      adb_path: adbBin,
      serial: authorized.serial,
      model: authorized.model || 'Android Device',
      devices,
    };
  } catch (err) {
    return {
      available: false,
      connected: false,
      status_code: 'ADB_NOT_FOUND',
      adb_path: null,
      devices: [],
      reason: err?.message || 'No se pudo iniciar el conector de Android en esta computadora.',
    };
  }
});

// 1b. Selector nativo de binario o carpeta platform-tools (adb.exe / adb)
ipcMain.handle('omega:adb-pick-binary', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const pick = await dialog.showOpenDialog(win, {
    title: 'Seleccionar ejecutable adb (Android Platform Tools)',
    properties: ['openFile'],
    filters:
      process.platform === 'win32'
        ? [{ name: 'Android Debug Bridge (adb.exe)', extensions: ['exe'] }]
        : undefined,
  });
  if (pick.canceled || !pick.filePaths?.length) {
    return { canceled: true, valid: false };
  }
  const chosen = normalizeAdbCandidate(pick.filePaths[0]);
  if (!chosen) {
    return { canceled: false, valid: false, error: 'El archivo seleccionado no es válido.' };
  }
  try {
    const { stdout } = await execFileAsync(chosen, ['version'], { timeout: 3000 });
    return {
      canceled: false,
      valid: true,
      adb_path: chosen,
      version: stdout.split(/\r?\n/)[0]?.trim() || 'ADB verificado',
    };
  } catch (err) {
    return {
      canceled: false,
      valid: false,
      error: err?.message || 'El ejecutable seleccionado no respondió a "adb version".',
    };
  }
});

// 2. Extracción forense volátil de solo lectura (sockets kernel, DNS, accesibilidad, SELinux, procesos y paquetes)
ipcMain.handle('omega:adb-collect', async (_event, opts = {}) => {
  const customPath = typeof opts === 'string' ? opts : opts?.customPath || '';
  const serial = typeof opts === 'object' && opts?.serial ? String(opts.serial).trim() : '';
  const targetPrefix = serial ? ['-s', serial] : [];
  const execScoped = (args, timeout = 12000) => runAdb([...targetPrefix, ...args], timeout, customPath);

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
    apkPathsRaw,
    caCertsRaw,
    httpProxyRaw,
  ] = await Promise.all([
    execScoped(['shell', 'getprop', 'ro.product.model']).catch(() => 'Desconocido'),
    execScoped(['shell', 'getprop', 'ro.product.manufacturer']).catch(() => ''),
    execScoped(['shell', 'getprop', 'ro.build.version.release']).catch(() => 'N/D'),
    execScoped(['shell', 'getprop', 'ro.build.version.security_patch']).catch(() => 'N/D'),
    execScoped(['shell', 'settings', 'get', 'global', 'private_dns_mode']).catch(() => 'off'),
    execScoped(['shell', 'settings', 'get', 'global', 'private_dns_specifier']).catch(() => ''),
    execScoped(['shell', 'settings', 'get', 'secure', 'install_non_market_apps']).catch(() => ''),
    execScoped(['shell', 'getenforce']).catch(() => 'Unknown'),
    execScoped(['shell', 'getprop', 'ro.boot.verifiedbootstate']).catch(() => 'unknown'),
    execScoped(['shell', 'settings', 'get', 'secure', 'enabled_accessibility_services']).catch(() => 'null'),
    execScoped(['shell', 'dumpsys', 'device_policy']).catch(() => ''),
    execScoped(['shell', 'pm', 'list', 'packages', '-3']).catch(() => ''),
    execScoped(['shell', 'ps', '-A', '-o', 'USER,PID,PPID,NAME,ARGS']).catch(() => ''),
    execScoped(['shell', 'cat', '/proc/net/tcp']).catch(() => ''),
    execScoped(['shell', 'cat', '/proc/net/tcp6']).catch(() => ''),
    execScoped(['shell', 'dumpsys', 'dnsresolver']).catch(() => ''),
    execScoped(['shell', 'pm', 'list', 'packages', '-3', '-f']).catch(() => ''),
    execScoped(['shell', 'ls', '/data/misc/user/0/cacerts-added']).catch(() => ''),
    execScoped(['shell', 'settings', 'get', 'global', 'http_proxy']).catch(() => ''),
  ]);

  const cleanPackages = packagesRaw
    .split(/\r?\n/)
    .map((line) => line.replace(/^package:/, '').trim())
    .filter(Boolean)
    .join('\n');

  const apkFilePaths = apkPathsRaw
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(/^package:(\/data\/app\/[^\s=]+\.apk)=/);
      return m ? m[1] : '';
    })
    .filter((p) => p && /^\/data\/app\/[A-Za-z0-9._/~=+@-]+\.apk$/.test(p))
    .slice(0, 18);

  let apkHashesRaw = '';
  if (apkFilePaths.length > 0) {
    apkHashesRaw = await execScoped(['shell', 'sha256sum', ...apkFilePaths]).catch(() => '');
  }

  const proxyClean = httpProxyRaw.trim();

  return {
    platform: 'android',
    device: {
      platform: 'android',
      serial,
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
    apk_hashes_raw: apkHashesRaw,
    ca_certs_raw: caCertsRaw && !/no such file/i.test(caCertsRaw) ? caCertsRaw : '',
    proxy_raw: proxyClean && proxyClean.toLowerCase() !== 'null' ? `http_proxy=${proxyClean}` : '',
  };
});

// 3. Contramedida defensiva explícita: forzar DNS-over-TLS cifrado (Quad9)
ipcMain.handle('omega:adb-harden-dns', async (_event, opts = {}) => {
  if (!opts?.confirmed) {
    throw new Error('Se requiere confirmación explícita del analista antes de modificar ajustes de red.');
  }
  const customPath = opts?.customPath || '';
  const serial = opts?.serial ? String(opts.serial).trim() : '';
  const targetPrefix = serial ? ['-s', serial] : [];
  const execScoped = (args, timeout = 5000) => runAdb([...targetPrefix, ...args], timeout, customPath);

  await execScoped(['shell', 'settings', 'put', 'global', 'private_dns_mode', 'hostname'], 5000);
  await execScoped(['shell', 'settings', 'put', 'global', 'private_dns_specifier', 'dns.quad9.net'], 5000);
  const [appliedMode, appliedSpecifier] = await Promise.all([
    execScoped(['shell', 'settings', 'get', 'global', 'private_dns_mode'], 4000).catch(() => ''),
    execScoped(['shell', 'settings', 'get', 'global', 'private_dns_specifier'], 4000).catch(() => ''),
  ]);
  return {
    applied: appliedMode.trim() === 'hostname' && appliedSpecifier.trim() === 'dns.quad9.net',
    mode: appliedMode.trim(),
    specifier: appliedSpecifier.trim(),
    provider: 'dns.quad9.net (DNS-over-TLS)',
  };
});

// =====================================================================
// Puente iOS (usbmuxd / pymobiledevice3 / libimobiledevice + Backups locales)
// =====================================================================
function hasAppleMobileDeviceSupport() {
  if (process.platform === 'darwin') return true;
  if (process.platform !== 'win32') return true;
  const dirs = [
    'C:\\Program Files\\Common Files\\Apple\\Mobile Device Support',
    'C:\\Program Files (x86)\\Common Files\\Apple\\Mobile Device Support',
  ];
  return dirs.some((d) => fs.existsSync(d));
}

async function resolveIosTools() {
  if (await isRunnableBinary('idevice_id', ['--version'])) {
    const hasCrash = await isRunnableBinary('idevicecrashreport', ['--help']).catch(() => false);
    return { kind: 'libimobiledevice', cmd: 'idevice_id', prefix: [], hasCrash };
  }
  if (await isRunnableBinary('pymobiledevice3', ['--help'])) {
    return { kind: 'pymobiledevice3', cmd: 'pymobiledevice3', prefix: [], hasCrash: true };
  }
  for (const pyBin of ['python', 'python3', 'py']) {
    if (await isRunnableBinary(pyBin, ['-m', 'pymobiledevice3', '--help'])) {
      return { kind: 'pymobiledevice3', cmd: pyBin, prefix: ['-m', 'pymobiledevice3'], hasCrash: true };
    }
  }
  return null;
}

function readXmlPlistString(text, key) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`<key>${esc}</key>\\s*<(?:string|date)>([^<]+)</(?:string|date)>`, 'i'));
  return m ? m[1].trim() : '';
}

function readBackupMetadata(backupDir) {
  const infoPath = path.join(backupDir, 'Info.plist');
  const manifestDbPath = path.join(backupDir, 'Manifest.db');
  const manifestPlistPath = path.join(backupDir, 'Manifest.plist');
  if (!fs.existsSync(infoPath) && !fs.existsSync(manifestDbPath) && !fs.existsSync(manifestPlistPath)) {
    return null;
  }

  let deviceName = path.basename(backupDir);
  let productType = '';
  let iosVersion = '';
  let lastBackupDate = '';

  if (fs.existsSync(infoPath)) {
    try {
      const infoRaw = fs.readFileSync(infoPath, 'utf8');
      deviceName = readXmlPlistString(infoRaw, 'Device Name') || deviceName;
      productType = readXmlPlistString(infoRaw, 'Product Type');
      iosVersion = readXmlPlistString(infoRaw, 'Product Version');
      lastBackupDate = readXmlPlistString(infoRaw, 'Last Backup Date');
    } catch {
      // Binary plist fallback keeps directory basename
    }
  }

  const hasManifestDb = fs.existsSync(manifestDbPath);
  let encrypted = false;
  if (hasManifestDb) {
    try {
      const fd = fs.openSync(manifestDbPath, 'r');
      const header = Buffer.alloc(16);
      const bytesRead = fs.readSync(fd, header, 0, 16, 0);
      fs.closeSync(fd);
      encrypted = bytesRead < 16 || !header.equals(SQLITE_MAGIC);
    } catch {
      encrypted = true;
    }
  } else if (fs.existsSync(manifestPlistPath)) {
    try {
      const mText = fs.readFileSync(manifestPlistPath, 'utf8');
      if (/<key>IsEncrypted<\/key>\s*<true\s*\/>/i.test(mText)) encrypted = true;
    } catch {
      // ignore
    }
  }

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(backupDir).mtimeMs;
  } catch {
    mtimeMs = 0;
  }

  return {
    id: path.basename(backupDir),
    path: backupDir,
    deviceName,
    productType,
    iosVersion,
    lastBackupDate,
    hasManifestDb,
    encrypted,
    mtimeMs,
  };
}

function discoverLocalIosBackups() {
  const roots = [];
  if (process.platform === 'win32') {
    if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'Apple Computer', 'MobileSync', 'Backup'));
    const home = process.env.USERPROFILE || os.homedir();
    roots.push(path.join(home, 'Apple', 'MobileSync', 'Backup'));
  } else if (process.platform === 'darwin') {
    roots.push(path.join(os.homedir(), 'Library', 'Application Support', 'MobileSync', 'Backup'));
  } else {
    roots.push(path.join(os.homedir(), '.local', 'share', 'MobileSync', 'Backup'));
  }

  const found = [];
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const meta = readBackupMetadata(path.join(root, entry.name));
        if (meta) found.push(meta);
      }
    } catch {
      // ignore inaccessible dirs
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 8);
}

function parseKeyValueLines(raw) {
  const out = {};
  for (const line of String(raw || '').split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

ipcMain.handle('omega:ios-status', async () => {
  const localBackups = discoverLocalIosBackups();
  const appleSupport = hasAppleMobileDeviceSupport();
  const tools = await resolveIosTools();

  if (!tools) {
    return {
      tools_available: false,
      tool_name: null,
      apple_driver_present: appleSupport,
      connected: false,
      status_code: 'TOOLS_MISSING',
      device: null,
      local_backups: localBackups,
      reason:
        process.platform === 'win32' && !appleSupport
          ? 'Por seguridad de Apple, un iPhone no deja revisar archivos por cable sin drivers de iTunes/Dispositivos Apple. No pasa nada: puedes revisarlo igual con un reporte rápido (Paso 1 abajo) o una copia de seguridad en esta PC.'
          : 'No hace falta instalar cables extra para revisar tu iPhone: genera el reporte rápido en tu teléfono o elige abajo una copia de seguridad guardada en esta computadora.',
    };
  }

  try {
    let udids = [];
    if (tools.kind === 'libimobiledevice') {
      const { stdout } = await execFileAsync('idevice_id', ['-l'], { timeout: 4000 });
      udids = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } else {
      const { stdout } = await execFileAsync(tools.cmd, [...tools.prefix, 'usbmux', 'list'], { timeout: 5000 });
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        udids = parsed
          .filter((d) => !d.ConnectionType || String(d.ConnectionType).toUpperCase() === 'USB')
          .map((d) => d.UniqueDeviceID || d.Identifier)
          .filter(Boolean);
      }
    }

    if (!udids.length) {
      return {
        tools_available: true,
        tool_name: tools.kind,
        apple_driver_present: appleSupport,
        connected: false,
        status_code: 'NO_DEVICE',
        device: null,
        local_backups: localBackups,
        reason: 'Computadora lista para iPhone. Conéctalo por cable y toca "Confiar" en su pantalla (como en la imagen 2), o elige abajo una copia de seguridad.',
      };
    }

    const udid = udids[0];
    let infoObj = {};
    let backupInfo = {};
    try {
      if (tools.kind === 'libimobiledevice') {
        const [{ stdout: mainOut }, { stdout: bakOut }] = await Promise.all([
          execFileAsync('ideviceinfo', ['-u', udid], { timeout: 5000 }),
          execFileAsync('ideviceinfo', ['-u', udid, '-q', 'com.apple.mobile.backup'], { timeout: 4000 }).catch(() => ({ stdout: '' })),
        ]);
        infoObj = parseKeyValueLines(mainOut);
        backupInfo = parseKeyValueLines(bakOut);
      } else {
        const { stdout } = await execFileAsync(tools.cmd, [...tools.prefix, 'lockdown', 'info', '--udid', udid], { timeout: 5000 });
        infoObj = JSON.parse(stdout);
        try {
          const { stdout: bakOut } = await execFileAsync(
            tools.cmd,
            [...tools.prefix, 'lockdown', 'info', '--udid', udid, '--domain', 'com.apple.mobile.backup'],
            { timeout: 4000 },
          );
          backupInfo = JSON.parse(bakOut);
        } catch {
          backupInfo = {};
        }
      }
    } catch (err) {
      return {
        tools_available: true,
        tool_name: tools.kind,
        apple_driver_present: appleSupport,
        connected: false,
        status_code: 'UNPAIRED',
        device: { udid },
        local_backups: localBackups,
        reason:
          err?.message?.includes('Pair') || err?.message?.includes('Trust') || err?.message?.includes('InvalidHostID')
            ? '¡iPhone conectado! Desbloquea su pantalla y toca "Confiar" cuando pregunte si confías en esta computadora.'
            : `Tu iPhone aún no autoriza a esta computadora (${err?.message || 'toca "Confiar" en la pantalla del iPhone'}).`,
      };
    }

    return {
      tools_available: true,
      tool_name: tools.kind,
      apple_driver_present: appleSupport,
      connected: true,
      status_code: 'READY',
      local_backups: localBackups,
      device: {
        platform: 'ios',
        udid,
        name: infoObj.DeviceName || 'iPhone / iPad',
        model: infoObj.ProductType || infoObj.DeviceClass || 'iOS Device',
        ios_version: infoObj.ProductVersion || '',
        build_version: infoObj.BuildVersion || '',
        backup_encrypted: backupInfo.WillEncrypt ?? infoObj.WillEncrypt ?? null,
        developer_mode: infoObj.DeveloperModeStatus ?? null,
      },
      reason: 'iPhone emparejado por Lockdown en modo solo lectura.',
    };
  } catch (err) {
    return {
      tools_available: true,
      tool_name: tools.kind,
      apple_driver_present: appleSupport,
      connected: false,
      status_code: 'NO_DEVICE',
      device: null,
      local_backups: localBackups,
      reason: err?.message || 'Error consultando dispositivo iOS por USB.',
    };
  }
});

ipcMain.handle('omega:ios-collect', async (_event, opts = {}) => {
  const tools = await resolveIosTools();
  if (!tools) {
    throw new Error('No se encontró pymobiledevice3 ni libimobiledevice para extracción USB directa en iOS.');
  }
  const udid = opts?.udid ? String(opts.udid).trim() : '';

  let infoObj = {};
  let backupInfo = {};
  if (tools.kind === 'libimobiledevice') {
    const scope = udid ? ['-u', udid] : [];
    const [{ stdout: mainOut }, { stdout: bakOut }] = await Promise.all([
      execFileAsync('ideviceinfo', scope, { timeout: 6000 }),
      execFileAsync('ideviceinfo', [...scope, '-q', 'com.apple.mobile.backup'], { timeout: 4000 }).catch(() => ({ stdout: '' })),
    ]);
    infoObj = parseKeyValueLines(mainOut);
    backupInfo = parseKeyValueLines(bakOut);
  } else {
    const scope = udid ? ['--udid', udid] : [];
    const { stdout } = await execFileAsync(tools.cmd, [...tools.prefix, 'lockdown', 'info', ...scope], { timeout: 6000 });
    infoObj = JSON.parse(stdout);
    try {
      const { stdout: bakOut } = await execFileAsync(
        tools.cmd,
        [...tools.prefix, 'lockdown', 'info', ...scope, '--domain', 'com.apple.mobile.backup'],
        { timeout: 4000 },
      );
      backupInfo = JSON.parse(bakOut);
    } catch {
      backupInfo = {};
    }
  }

  // Extraer crashlogs (.ips/.crash) a un buffer efímero limpio en RAM (sin persistencia al finalizar)
  const crashlogs = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-ios-ram-'));
  try {
    if (tools.kind === 'libimobiledevice' && tools.hasCrash) {
      const args = udid ? ['-u', udid, '-e', tmpDir] : ['-e', tmpDir];
      await execFileAsync('idevicecrashreport', args, { timeout: 15000 }).catch(() => {});
    } else if (tools.kind === 'pymobiledevice3') {
      const args = [...tools.prefix, 'crash', 'pull', tmpDir];
      if (udid) args.push('--udid', udid);
      await execFileAsync(tools.cmd, args, { timeout: 15000 }).catch(() => {});
    }

    const walkLogs = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (crashlogs.length >= 25) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkLogs(full);
        } else if (/\.(ips|crash|log|json)$/i.test(entry.name)) {
          try {
            const st = fs.statSync(full);
            if (st.size > 0 && st.size <= 3 * 1024 * 1024) {
              crashlogs.push({
                filename: entry.name,
                content: fs.readFileSync(full, 'utf8'),
              });
            }
          } catch {
            // ignore unreadable item
          }
        }
      }
    };
    walkLogs(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return {
    platform: 'ios',
    device: {
      platform: 'ios',
      name: infoObj.DeviceName || 'iPhone / iPad',
      model: infoObj.ProductType || infoObj.DeviceClass || 'iOS Device',
      ios_version: infoObj.ProductVersion || '',
      build_version: infoObj.BuildVersion || '',
      backup_encrypted: backupInfo.WillEncrypt ?? infoObj.WillEncrypt ?? null,
      developer_mode: infoObj.DeveloperModeStatus ?? null,
    },
    crashlogs,
  };
});

ipcMain.handle('omega:ios-pick-backup-dir', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const pick = await dialog.showOpenDialog(win, {
    title: 'Seleccionar carpeta de respaldo iOS (contiene Manifest.db)',
    properties: ['openDirectory'],
  });
  if (pick.canceled || !pick.filePaths?.length) {
    return { canceled: true };
  }
  const backupPath = pick.filePaths[0];
  const meta = readBackupMetadata(backupPath);
  if (!meta) {
    return {
      canceled: false,
      valid: false,
      error: 'La carpeta seleccionada no contiene Info.plist ni Manifest.db de un respaldo iOS.',
    };
  }
  return { canceled: false, valid: true, backup: meta };
});

ipcMain.handle('omega:ios-read-backup-manifest', async (_event, backupPath) => {
  const resolvedDir = path.resolve(String(backupPath || ''));
  const manifestPath = path.join(resolvedDir, 'Manifest.db');
  const manifestPlistPath = path.join(resolvedDir, 'Manifest.plist');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('No se encontró Manifest.db en la carpeta de respaldo seleccionada.');
  }
  const stat = fs.statSync(manifestPath);
  if (stat.size > 64 * 1024 * 1024) {
    throw new Error('Manifest.db supera el límite de 64 MB en memoria.');
  }
  const raw = fs.readFileSync(manifestPath);
  const meta = readBackupMetadata(resolvedDir);
  const isEncrypted = raw.length < 16 || !raw.subarray(0, 16).equals(SQLITE_MAGIC);
  const manifestPlistB64 = fs.existsSync(manifestPlistPath)
    ? fs.readFileSync(manifestPlistPath).toString('base64')
    : '';
  return {
    backup: meta,
    encrypted: isEncrypted,
    manifest_b64: raw.toString('base64'),
    manifest_plist_b64: manifestPlistB64,
  };
});

ipcMain.handle('omega:ios-read-backup-artifacts', async (_event, opts = {}) => {
  const resolvedDir = path.resolve(String(opts?.backupPath || ''));
  const targets = Array.isArray(opts?.targets) ? opts.targets.slice(0, 35) : [];
  const manifestPath = path.join(resolvedDir, 'Manifest.db');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Carpeta de respaldo iOS no válida.');
  }

  const artifacts = [];
  let totalBytes = 0;
  const isEncryptedBackup = Boolean(opts?.encrypted);
  const manifestBuf = isEncryptedBackup ? Buffer.alloc(0) : fs.readFileSync(manifestPath);
  if (!isEncryptedBackup && manifestBuf.length > 0 && manifestBuf.length <= 25 * 1024 * 1024) {
    totalBytes += manifestBuf.length;
    artifacts.push({
      filename: 'Manifest.db',
      content_b64: manifestBuf.toString('base64'),
    });
  }

  for (const tgt of targets) {
    const fileId = String(tgt?.file_id || '').trim();
    if (!/^[a-f0-9]{32,64}$/i.test(fileId)) continue;
    const subPath = path.join(resolvedDir, fileId.slice(0, 2), fileId);
    const flatPath = path.join(resolvedDir, fileId);
    const chosen = fs.existsSync(subPath) ? subPath : fs.existsSync(flatPath) ? flatPath : null;
    if (!chosen) continue;
    try {
      const st = fs.statSync(chosen);
      if (!st.isFile() || st.size <= 0 || st.size > 25 * 1024 * 1024) continue;
      if (totalBytes + st.size > 85 * 1024 * 1024) break;
      totalBytes += st.size;
      const rel = String(tgt?.relative_path || fileId).replace(/^\/+/, '');
      artifacts.push({
        file_id: fileId,
        filename: path.posix.basename(rel) || fileId,
        content_b64: fs.readFileSync(chosen).toString('base64'),
      });
    } catch {
      // ignore single unreadable target
    }
  }

  const meta = readBackupMetadata(resolvedDir);
  return {
    platform: 'ios',
    device: {
      platform: 'ios',
      name: meta?.deviceName || 'Respaldo iOS',
      model: meta?.productType || 'iPhone Backup',
      ios_version: meta?.iosVersion || '',
      backup_encrypted: Boolean(opts?.encrypted ?? meta?.encrypted),
    },
    binary_artifacts: artifacts,
  };
});

ipcMain.handle('omega:open-external', async (_event, targetUrl) => {
  const raw = String(targetUrl || '').trim();
  if (!raw.startsWith('https://')) {
    throw new Error('Solo se permiten URLs HTTPS seguras.');
  }
  await shell.openExternal(raw);
  return { opened: true };
});

function isPublicRoutableIp(ip) {
  const cleanIp = String(ip || '').split('%')[0].toLowerCase();
  if (!cleanIp) return false;
  if (net.isIPv4(cleanIp)) {
    const parts = cleanIp.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a >= 224) return false;
    return true;
  }
  if (net.isIPv6(cleanIp)) {
    if (cleanIp === '::' || cleanIp === '::1') return false;
    if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd') || cleanIp.startsWith('fe80')) return false;
    if (cleanIp.startsWith('::ffff:')) return isPublicRoutableIp(cleanIp.slice(7));
    return true;
  }
  return false;
}

async function assertPublicHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('URL inválida para inspección en sandbox.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('Solo se permiten esquemas HTTP/HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('No se permiten credenciales incrustadas en la URL.');
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Bloqueado: destino local o interno.');
  }
  if (net.isIP(host)) {
    if (!isPublicRoutableIp(host)) {
      throw new Error('Bloqueado: dirección IP no enrutable o privada.');
    }
    return parsed.toString();
  }
  const records = await dns.lookup(host, { all: true }).catch(() => []);
  if (!records.length || records.some((r) => !isPublicRoutableIp(r.address))) {
    throw new Error('Bloqueado: el destino no resuelve a una IP pública válida.');
  }
  return parsed.toString();
}

// 4. Sandbox WebLoader volátil en RAM para seguir redirecciones sin JS, imágenes ni almacenamiento
ipcMain.handle('omega:ephemeral-link-inspect', async (_event, targetUrl) => {
  const safeTargetUrl = await assertPublicHttpUrl(targetUrl);

  // Sin prefijo 'persist:', Chromium mantiene cookies y caché estrictamente en RAM (RNF4)
  const partition = `ephemeral-net4-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const sandboxWin = new BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      javascript: false,
      images: false,
      plugins: false,
      webviewTag: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'user-gesture-required',
    },
  });

  const redirectChain = [];
  let blockedAttempt = '';
  let finalStatusCode = null;
  let finalContentType = '';
  const ses = sandboxWin.webContents.session;

  ses.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
  ses.on('will-download', (event) => event.preventDefault());
  sandboxWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  ses.webRequest.onBeforeRequest((details, callback) => {
    try {
      const reqUrl = new URL(details.url);
      if (!['http:', 'https:'].includes(reqUrl.protocol)) {
        blockedAttempt = `Esquema bloqueado: ${reqUrl.protocol}`;
        callback({ cancel: true });
        return;
      }
      const reqHost = reqUrl.hostname.toLowerCase();
      if (
        reqHost === 'localhost' ||
        reqHost.endsWith('.local') ||
        reqHost.endsWith('.internal') ||
        (net.isIP(reqHost) && !isPublicRoutableIp(reqHost))
      ) {
        blockedAttempt = `Destino privado bloqueado: ${reqHost}`;
        callback({ cancel: true });
        return;
      }
    } catch {
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  });

  ses.webRequest.onBeforeRedirect((details) => {
    redirectChain.push({
      from: details.url,
      to: details.redirectURL,
      statusCode: details.statusCode,
    });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType === 'mainFrame') {
      finalStatusCode = details.statusCode;
      const rawCt =
        details.responseHeaders?.['content-type'] || details.responseHeaders?.['Content-Type'];
      if (Array.isArray(rawCt) && rawCt.length > 0) {
        finalContentType = String(rawCt[0]).split(';')[0].trim();
      }
    }
    callback({ cancel: false });
  });

  let timeoutHandle;
  try {
    try {
      await Promise.race([
        sandboxWin.loadURL(safeTargetUrl, {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        }),
        new Promise((_resolve, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Tiempo de espera agotado (12s).')), 12000);
        }),
      ]);
    } catch (err) {
      if (!blockedAttempt && redirectChain.length === 0) {
        throw new Error(err?.message || 'No se pudo completar el trazado efímero en RAM.');
      }
    }

    const lastHop = redirectChain[redirectChain.length - 1]?.to || safeTargetUrl;
    const loadedUrl = sandboxWin.isDestroyed() ? '' : sandboxWin.webContents.getURL();
    const finalUrl = loadedUrl && loadedUrl.startsWith('http') ? loadedUrl : lastHop;
    const pageTitle = sandboxWin.isDestroyed() ? '' : sandboxWin.webContents.getTitle();

    return {
      initial_url: safeTargetUrl,
      final_url: finalUrl,
      title: pageTitle,
      status_code: finalStatusCode,
      content_type: finalContentType,
      redirects: redirectChain,
      blocked_attempt: blockedAttempt || null,
      ephemeral_ram: true,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    await ses.clearStorageData().catch(() => {});
    await ses.clearCache().catch(() => {});
    if (!sandboxWin.isDestroyed()) sandboxWin.destroy();
  }
});

// =====================================================================
// Instalador automático de ADB portátil (Google platform-tools)
// =====================================================================
ipcMain.handle('omega:adb-install-portable', async () => {
  const existing = await resolveAdbBinary();
  if (existing) {
    return { ok: true, adbPath: existing, alreadyInstalled: true };
  }

  const toolsDir = path.join(app.getPath('userData'), 'tools');
  const extractTarget = path.join(toolsDir, 'platform-tools');
  const exeName = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const urls = {
    win32: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
    darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
    linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip',
  };
  const zipUrl = urls[process.platform];
  if (!zipUrl) {
    return { ok: false, error: `Sistema no soportado para instalación automática (${process.platform}).` };
  }

  const tmpZip = path.join(toolsDir, 'platform-tools-tmp.zip');
  try {
    fs.mkdirSync(toolsDir, { recursive: true });
    const resp = await fetch(zipUrl, { signal: AbortSignal.timeout(45000) });
    if (!resp.ok) {
      throw new Error(`Google rechazó la descarga (HTTP ${resp.status})`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 100000 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      throw new Error('El paquete descargado no es un archivo ZIP válido.');
    }
    fs.writeFileSync(tmpZip, buf);

    if (process.platform === 'win32') {
      await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${toolsDir.replace(/'/g, "''")}' -Force`,
        ],
        { timeout: 45000 },
      );
    } else {
      await execFileAsync('unzip', ['-oq', tmpZip, '-d', toolsDir], { timeout: 45000 });
    }

    const adbBin = path.join(extractTarget, exeName);
    if (!fs.existsSync(adbBin)) {
      throw new Error('No se encontró el binario adb dentro del ZIP extraído.');
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(adbBin, 0o755);
    }
    const runnable = await isRunnableBinary(adbBin, ['version']);
    if (!runnable) {
      throw new Error('El binario ADB descargado no pudo ejecutarse en este equipo.');
    }
    return { ok: true, adbPath: adbBin, alreadyInstalled: false };
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo instalar ADB automáticamente: ${err?.message || err}`,
    };
  } finally {
    try {
      if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
    } catch {
      // ignore cleanup error
    }
  }
});

// =====================================================================
// Pilar 3: Auditoría Forense Local de Escritorio (Solo Lectura)
// =====================================================================
const WINDOWS_PC_AUDIT_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

$defRt = $null
try { $defRt = [bool](Get-MpComputerStatus).RealTimeProtectionEnabled } catch {}

$fwOn = $null
try {
  $profs = @(Get-NetFirewallProfile)
  if ($profs.Count -gt 0) { $fwOn = [bool]($profs | Where-Object { $_.Enabled -eq $true }).Count -gt 0 }
} catch {}

$uacOn = $null
try {
  $lua = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name EnableLUA).EnableLUA
  $uacOn = ([int]$lua -ne 0)
} catch {}

$smartOn = $null
try {
  $ss = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer' -Name SmartScreenEnabled).SmartScreenEnabled
  if ($ss) { $smartOn = ($ss -ne 'Off') }
} catch {}

$procList = @(Get-CimInstance Win32_Process | Select-Object ProcessId, Name, ExecutablePath, CommandLine)
$procMap = @{}
foreach ($p in $procList) { $procMap[[int]$p.ProcessId] = $p }

$tcpRaw = @(Get-NetTCPConnection -State Established,SynSent | Where-Object {
  $_.RemoteAddress -and $_.RemoteAddress -notmatch '^(127\\.|0\\.|::1$|::|fe80:|10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[0-1])\\.)'
} | Select-Object -First 60)

$tcpOut = @()
$netPids = @{}
foreach ($c in $tcpRaw) {
  $pidInt = [int]$c.OwningProcess
  $netPids[$pidInt] = $true
  $pinfo = $procMap[$pidInt]
  $tcpOut += [pscustomobject]@{
    local_addr = [string]$c.LocalAddress
    local_port = [int]$c.LocalPort
    remote_ip = [string]$c.RemoteAddress
    remote_port = [int]$c.RemotePort
    state = [string]$c.State
    pid = $pidInt
    process_name = if ($pinfo) { [string]$pinfo.Name } else { '' }
    exe_path = if ($pinfo) { [string]$pinfo.ExecutablePath } else { '' }
  }
}

$interestingProcs = @()
$sigCache = @{}
$riskyRe = '(\\\\appdata\\\\local\\\\temp\\\\|\\\\users\\\\public\\\\|\\\\windows\\\\temp\\\\|\\\\programdata\\\\|wmiutils|agentservice|svchost|lsass|csrss|winlogon)'
$checkedCount = 0

foreach ($p in $procList) {
  $pidInt = [int]$p.ProcessId
  if ($pidInt -eq $PID) { continue }
  $ep = [string]$p.ExecutablePath
  $pname = [string]$p.Name
  $cmd = [string]$p.CommandLine
  $needInspect = ($ep -and $ep -imatch $riskyRe) -or ($netPids.ContainsKey($pidInt)) -or ($cmd -and $cmd -imatch '(-enc|-encodedcommand|frombase64|mshta|wscript)')
  if (-not $needInspect) { continue }

  $sigStatus = ''
  $signer = ''
  $sha = ''
  if ($ep -and (Test-Path -LiteralPath $ep) -and $checkedCount -lt 35) {
    if ($sigCache.ContainsKey($ep)) {
      $sigStatus = $sigCache[$ep].status
      $signer = $sigCache[$ep].signer
      $sha = $sigCache[$ep].sha
    } else {
      $checkedCount++
      try {
        $sig = Get-AuthenticodeSignature -LiteralPath $ep
        $sigStatus = [string]$sig.Status
        if ($sig.SignerCertificate) { $signer = [string]$sig.SignerCertificate.Subject }
      } catch {}
      try {
        if ($ep -notmatch '^C:\\\\Windows\\\\System32\\\\') {
          $sha = [string](Get-FileHash -LiteralPath $ep -Algorithm SHA256).Hash.ToLower()
        }
      } catch {}
      $sigCache[$ep] = @{ status = $sigStatus; signer = $signer; sha = $sha }
    }
  }
  $interestingProcs += [pscustomobject]@{
    pid = $pidInt
    name = $pname
    exe_path = $ep
    command_line = if ($cmd.Length -gt 240) { $cmd.Substring(0, 240) } else { $cmd }
    signature_status = $sigStatus
    signer = $signer
    sha256 = $sha
  }
}

$wmiOut = @()
try {
  foreach ($f in @(Get-CimInstance -Namespace root\\subscription -ClassName __EventFilter)) {
    $wmiOut += [pscustomobject]@{ kind = 'Filter'; name = [string]$f.Name; query_or_target = [string]$f.Query; detail = [string]$f.QueryLanguage }
  }
  foreach ($c in @(Get-CimInstance -Namespace root\\subscription -ClassName CommandLineEventConsumer)) {
    $wmiOut += [pscustomobject]@{ kind = 'Consumer'; name = [string]$c.Name; query_or_target = [string]$c.CommandLineTemplate; detail = [string]$c.ExecutablePath }
  }
  foreach ($s in @(Get-CimInstance -Namespace root\\subscription -ClassName ActiveScriptEventConsumer)) {
    $wmiOut += [pscustomobject]@{ kind = 'Consumer'; name = [string]$s.Name; query_or_target = [string]$s.ScriptText; detail = [string]$s.ScriptingEngine }
  }
} catch {}

$tasksOut = @()
try {
  foreach ($t in @(Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\\Microsoft\\*' -and $_.State -ne 'Disabled' } | Select-Object -First 35)) {
    $act = $t.Actions | Select-Object -First 1
    $tasksOut += [pscustomobject]@{
      name = [string]$t.TaskName
      task_path = [string]$t.TaskPath
      execute = if ($act) { [string]$act.Execute } else { '' }
      arguments = if ($act) { [string]$act.Arguments } else { '' }
    }
  }
} catch {}

$startupOut = @()
foreach ($rk in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run')) {
  try {
    $item = Get-ItemProperty $rk
    foreach ($prop in $item.PSObject.Properties) {
      if ($prop.Name -in @('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider')) { continue }
      $startupOut += [pscustomobject]@{ hive = $rk; name = [string]$prop.Name; command = [string]$prop.Value }
    }
  } catch {}
}

[pscustomobject]@{
  platform = 'win32'
  host = @{
    hostname = $env:COMPUTERNAME
    os_version = [System.Environment]::OSVersion.VersionString
    defender_realtime = $defRt
    firewall_enabled = $fwOn
    uac_enabled = $uacOn
    smartscreen_enabled = $smartOn
  }
  tcp_connections = @($tcpOut)
  processes = @($interestingProcs)
  wmi_subscriptions = @($wmiOut)
  scheduled_tasks = @($tasksOut)
  startup_items = @($startupOut)
} | ConvertTo-Json -Depth 5 -Compress
`;

ipcMain.handle('omega:pc-audit-collect', async () => {
  try {
    if (process.platform === 'win32') {
      const encoded = Buffer.from(WINDOWS_PC_AUDIT_PS, 'utf16le').toString('base64');
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
      );
      const parsed = JSON.parse(String(stdout || '{}').trim() || '{}');
      return { ok: true, snapshot: parsed };
    }

    // Respaldo macOS / Linux en solo lectura
    const hostInfo = {
      hostname: os.hostname(),
      os_version: `${os.type()} ${os.release()}`,
      sip_enabled: null,
      gatekeeper_enabled: null,
    };
    if (process.platform === 'darwin') {
      const sipOut = await execFileAsync('csrutil', ['status'], { timeout: 3000 }).then((r) => r.stdout).catch(() => '');
      const gkOut = await execFileAsync('spctl', ['--status'], { timeout: 3000 }).then((r) => r.stdout).catch(() => '');
      if (sipOut) hostInfo.sip_enabled = /enabled/i.test(sipOut);
      if (gkOut) hostInfo.gatekeeper_enabled = /assessments enabled/i.test(gkOut);
    }

    const psOut = await execFileAsync('ps', ['-axo', 'pid,comm,args'], { timeout: 5000 })
      .then((r) => r.stdout)
      .catch(() => '');
    const processes = psOut
      .split(/\r?\n/)
      .slice(1, 150)
      .map((line) => {
        const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
        if (!m) return null;
        return { pid: Number(m[1]), name: m[2], exe_path: m[2], command_line: m[3], signature_status: '' };
      })
      .filter(Boolean);

    return {
      ok: true,
      snapshot: {
        platform: process.platform,
        host: hostInfo,
        tcp_connections: [],
        processes,
        wmi_subscriptions: [],
        scheduled_tasks: [],
        startup_items: [],
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo recolectar telemetría local del equipo: ${err?.message || err}`,
    };
  }
});

ipcMain.handle('omega:set-titlebar-theme', (event, theme = 'light') => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && typeof win.setTitleBarOverlay === 'function') {
      if (theme === 'light') {
        win.setTitleBarOverlay({
          color: '#F5F7FB',
          symbolColor: '#090D16',
          height: 40,
        });
      } else {
        win.setTitleBarOverlay({
          color: '#090D16',
          symbolColor: '#A1A7B4',
          height: 40,
        });
      }
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#050811',
    title: 'OMEGA — Cyber Threat Intelligence',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#F5F7FB',
      symbolColor: '#090D16',
      height: 40,
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
