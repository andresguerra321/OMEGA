/**
 * Adaptador unificado de escritorio (Tauri v2 + Sensor Rust <-> Web CLOUD_MANAGED).
 */

export function detectDesktopRuntime(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return 'web';
  if (win.__TAURI_INTERNALS__ && typeof win.__TAURI_INTERNALS__.invoke === 'function') {
    return 'tauri-v2';
  }
  return 'web';
}

export function isDesktopApp(win = typeof window !== 'undefined' ? window : null) {
  return detectDesktopRuntime(win) === 'tauri-v2';
}

export async function openBillingCheckout(url, win = typeof window !== 'undefined' ? window : null) {
  if (!isDesktopApp(win)) return false;
  await win.__TAURI_INTERNALS__.invoke('open_billing_checkout', { url });
  return true;
}

export function openGoogleAuthorization(url) {
  return window.__TAURI_INTERNALS__.invoke('open_google_authorization', { url });
}

export function getMobileDesktopBridge(win = typeof window !== 'undefined' ? window : null) {
  if (!isDesktopApp(win)) return null;
  const invoke = (command, args = {}) => win.__TAURI_INTERNALS__.invoke(command, args);
  return {
    checkAdbStatus: (customPath = '', waitForUsb = false) => invoke('check_adb_status', waitForUsb ? { customPath, waitForUsb } : { customPath }),
    checkIosStatus: () => invoke('check_ios_status'),
    pickAdbBinary: () => invoke('pick_adb_binary'),
    installPortableAdb: () => invoke('install_portable_adb'),
    installIosConnector: () => invoke('install_ios_connector'),
    openIosPrerequisite: prerequisite => invoke('open_ios_prerequisite', { prerequisite }),
    collectDeviceSnapshot: (customPath, serial) => invoke('collect_device_snapshot', { customPath, serial }),
    collectIosSnapshot: (udid) => invoke('collect_ios_snapshot', { udid }),
    pickIosBackupDir: () => invoke('pick_ios_backup_dir'),
    readIosBackupManifest: (backupPath) => invoke('read_ios_backup_manifest', { backupPath }),
    readIosBackupArtifacts: (backupPath, encrypted, targets) =>
      invoke('read_ios_backup_artifacts', { backupPath, encrypted, targets }),
    hardenPrivateDns: (customPath, serial) => invoke('harden_private_dns', { customPath, serial, confirmed: true }),
  };
}

export async function getDesktopRuntimeInfo(win = typeof window !== 'undefined' ? window : null) {
  if (detectDesktopRuntime(win) === 'tauri-v2') {
    return win.__TAURI_INTERNALS__.invoke('get_desktop_runtime_info');
  }
  return {
    runtime: 'web',
    deploymentMode: 'CLOUD_MANAGED',
    requiresDocker: false,
  };
}

export async function getBootstrapStatus(win = typeof window !== 'undefined' ? window : null) {
  if (detectDesktopRuntime(win) === 'tauri-v2') {
    return win.__TAURI_INTERNALS__.invoke('get_bootstrap_status');
  }
  return null;
}

export async function retrySelfHostedBootstrap(win = typeof window !== 'undefined' ? window : null) {
  if (detectDesktopRuntime(win) === 'tauri-v2') {
    return win.__TAURI_INTERNALS__.invoke('retry_self_hosted_bootstrap');
  }
  return null;
}

export async function getDesktopRuntimeConfig(win = typeof window !== 'undefined' ? window : null) {
  if (detectDesktopRuntime(win) !== 'tauri-v2') {
    return { ok: false, config: null };
  }
  return win.__TAURI_INTERNALS__.invoke('get_desktop_runtime_config');
}

export async function saveDesktopRuntimeConfig(
  payload = {},
  win = typeof window !== 'undefined' ? window : null,
) {
  if (detectDesktopRuntime(win) !== 'tauri-v2') {
    return { ok: false, error: 'Disponible solo en OMEGA Desktop (Tauri v2).' };
  }
  return win.__TAURI_INTERNALS__.invoke('save_desktop_runtime_config', { payload });
}

export async function collectNativeHostSnapshot(win = typeof window !== 'undefined' ? window : null) {
  if (detectDesktopRuntime(win) === 'tauri-v2') {
    const snapshot = await win.__TAURI_INTERNALS__.invoke('collect_host_telemetry_snapshot');
    return { ok: true, runtime: 'tauri-v2', snapshot };
  }
  return {
    ok: false,
    runtime: 'web',
    error: 'La telemetría local del host requiere la app de escritorio OMEGA (Tauri v2 / Sensor Rust).',
  };
}

export async function registerLocalPdfSource(
  { documentId, sha256, localPath },
  win = typeof window !== 'undefined' ? window : null,
) {
  if (detectDesktopRuntime(win) !== 'tauri-v2') {
    return null;
  }
  return win.__TAURI_INTERNALS__.invoke('register_local_pdf_source', {
    documentId,
    sha256,
    localPath,
  });
}

export async function resolveLocalPdfSource(
  { documentId, sha256 = '', page = null },
  win = typeof window !== 'undefined' ? window : null,
) {
  if (detectDesktopRuntime(win) !== 'tauri-v2') {
    return {
      found: false,
      fileExists: false,
      documentId,
      sha256,
      localPath: null,
      page,
      notice: 'Índice local de PDFs disponible en la app de escritorio Tauri v2.',
    };
  }
  return win.__TAURI_INTERNALS__.invoke('resolve_local_pdf_source', {
    documentId,
    sha256,
    page,
  });
}

export async function listLocalPdfSources(win = typeof window !== 'undefined' ? window : null) {
  if (detectDesktopRuntime(win) !== 'tauri-v2') {
    return [];
  }
  return win.__TAURI_INTERNALS__.invoke('list_local_pdf_sources');
}
