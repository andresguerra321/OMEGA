import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import dns from 'node:dns/promises';
import net from 'node:net';
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
