import fs from 'node:fs';
import path from 'node:path';

export const DEPLOYMENT_MODES = Object.freeze({
  CLOUD_MANAGED: 'CLOUD_MANAGED',
  SELF_HOSTED: 'SELF_HOSTED',
});

/**
 * Valida que la URL del backend gestionado en la nube use estrictamente HTTPS,
 * sin credenciales embebidas y sin rutas extrañas.
 */
export function normalizeCloudApiOrigin(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  if (!parsed.hostname || parsed.hostname.length > 253) {
    return null;
  }
  return parsed.origin;
}

export function readPersistedDeploymentConfig(userDataDir) {
  if (!userDataDir) return {};
  const filePath = path.join(userDataDir, 'deployment-mode.json');
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function resolveDeploymentConfig({ env = process.env, userDataDir = '' } = {}) {
  const persisted = readPersistedDeploymentConfig(userDataDir);
  const rawMode = String(env.OMEGA_DEPLOYMENT_MODE || persisted.mode || '').trim().toUpperCase();
  const rawCloudUrl = env.OMEGA_CLOUD_API_URL || persisted.cloudApiUrl || '';
  const cloudApiUrl = normalizeCloudApiOrigin(rawCloudUrl);

  const wantsCloud =
    rawMode === DEPLOYMENT_MODES.CLOUD_MANAGED ||
    (!rawMode && Boolean(cloudApiUrl));

  if (wantsCloud && cloudApiUrl) {
    return {
      mode: DEPLOYMENT_MODES.CLOUD_MANAGED,
      requiresDocker: false,
      cloudApiUrl,
    };
  }

  return {
    mode: DEPLOYMENT_MODES.SELF_HOSTED,
    requiresDocker: true,
    cloudApiUrl: null,
  };
}

export async function probeCloudBackendHealth(cloudApiUrl, { fetchFn = fetch, timeoutMs = 8000 } = {}) {
  const origin = normalizeCloudApiOrigin(cloudApiUrl);
  if (!origin) {
    return { ok: false, error: 'URL de OMEGA Cloud inválida (se requiere HTTPS).' };
  }
  try {
    const res = await fetchFn(`${origin}/actuator/health`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return { ok: false, statusCode: res.status, error: `OMEGA Cloud respondió HTTP ${res.status}.` };
    }
    return { ok: true, statusCode: res.status, cloudApiUrl: origin };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'No se pudo contactar con el backend OMEGA Cloud por HTTPS.',
    };
  }
}
