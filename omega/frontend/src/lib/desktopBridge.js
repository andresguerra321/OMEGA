/**
 * Adaptador unificado de escritorio (Tauri v2 -> Electron legacy -> Web CLOUD_MANAGED).
 * Permite mantener la misma UI React durante la migración a Tauri v2 + Sensor Rust.
 */

export function detectDesktopRuntime(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return 'web';
  if (win.__TAURI_INTERNALS__ && typeof win.__TAURI_INTERNALS__.invoke === 'function') {
    return 'tauri-v2';
  }
  if (win.omegaDesktop) {
    return 'electron';
  }
  return 'web';
}

export async function getDesktopRuntimeInfo(win = typeof window !== 'undefined' ? window : null) {
  const runtime = detectDesktopRuntime(win);
  if (runtime === 'tauri-v2') {
    return win.__TAURI_INTERNALS__.invoke('get_desktop_runtime_info');
  }
  if (runtime === 'electron' && typeof win.omegaDesktop.getDeploymentMode === 'function') {
    const modeInfo = await win.omegaDesktop.getDeploymentMode();
    return {
      runtime: 'electron',
      deploymentMode: modeInfo?.mode || 'SELF_HOSTED',
      requiresDocker: Boolean(modeInfo?.requiresDocker),
    };
  }
  return {
    runtime: 'web',
    deploymentMode: 'CLOUD_MANAGED',
    requiresDocker: false,
  };
}

export async function collectNativeHostSnapshot(win = typeof window !== 'undefined' ? window : null) {
  const runtime = detectDesktopRuntime(win);
  if (runtime === 'tauri-v2') {
    const snapshot = await win.__TAURI_INTERNALS__.invoke('collect_host_telemetry_snapshot');
    return { ok: true, runtime: 'tauri-v2', snapshot };
  }
  if (runtime === 'electron' && typeof win.omegaDesktop.collectPcAuditSnapshot === 'function') {
    const res = await win.omegaDesktop.collectPcAuditSnapshot();
    return { ...res, runtime: 'electron' };
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
