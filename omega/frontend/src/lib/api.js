const LEGACY_CLIENT_STORAGE_KEYS = [
  'omega_auth_session_v1',
  'omega_sandbox_creds_v1',
  'omega_workspace_id',
  'omega_research_sessions_v2',
  'omega_custom_adb_path',
];

// Estado estrictamente volátil en RAM para tokens/credenciales (cero persistencia en disco del cliente)
let inMemoryAuthSession = null;
let inMemoryWorkspaceId = null;

function scrubLegacyDiskStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      LEGACY_CLIENT_STORAGE_KEYS.forEach((k) => {
        try {
          localStorage.removeItem(k);
        } catch {
          // ignore
        }
      });
    }
  } catch {
    // ignore
  }
}

scrubLegacyDiskStorage();

function isTauriDesktopContext() {
  if (typeof window === 'undefined') return false;
  const proto = window.location?.protocol || '';
  const host = window.location?.hostname || '';
  return (
    Boolean(window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') ||
    proto === 'tauri:' ||
    host === 'tauri.localhost'
  );
}

function shouldIncludeCredentials() {
  return typeof window !== 'undefined' && window.location?.protocol !== 'file:';
}

function resolveApiOrigin() {
  if (typeof window !== 'undefined' && (window.location?.protocol === 'file:' || isTauriDesktopContext())) {
    const params = new URLSearchParams(window.location?.search || '');
    const rawCloud = params.get('omegaCloudOrigin');
    if (rawCloud) {
      try {
        const parsed = new URL(rawCloud);
        if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) {
          return parsed.origin;
        }
      } catch {
        // Ignore invalid cloud origin and fall back to local port
      }
    }
    const raw = params.get('omegaBackendPort');
    const port = /^\d{4,5}$/.test(raw || '') && Number(raw) >= 1024 && Number(raw) <= 65535 ? Number(raw) : 8080;
    return `http://127.0.0.1:${port}`;
  }
  const envOrigin = import.meta?.env?.VITE_API_ORIGIN;
  if (envOrigin) {
    return String(envOrigin).replace(/\/+$/, '');
  }
  return '';
}

const API_ORIGIN = resolveApiOrigin();
const API_V1 = `${API_ORIGIN}/api/v1`;

export async function prepareDesktopHostSensor() {
  const status = await getHostRealtimeStatus();
  return { ready: status?.scope === 'native-host', status };
}

export function getHostRealtimeStatus() {
  return apiFetch('/forensics/host/realtime/status');
}

export function toggleHostRealtime(enabled) {
  return apiFetch('/forensics/host/realtime/toggle', {
    method: 'POST', body: { enabled },
  });
}

export function auditHostPersistence() {
  return apiFetch('/forensics/host/persistence/audit', { method: 'POST', body: {} });
}

export function previewContainment(candidate) {
  return apiFetch('/forensic/containment/execute', { method: 'POST', body: { ...candidate, dryRun: true } });
}

export function executeContainment(candidate, previewToken, credentials) {
  return apiFetch('/forensic/containment/execute', { method: 'POST', body: { ...candidate, dryRun: false, previewToken, ...credentials } });
}

export function containmentChallenge(currentPassword) {
  return apiFetch('/forensic/containment/challenge', { method: 'POST', body: { currentPassword } });
}

export function containmentHistory() {
  return apiFetch('/forensic/containment/history');
}

export function rollbackContainment(actionId, credentials) {
  return apiFetch(`/forensic/containment/rollback/${encodeURIComponent(actionId)}`, { method: 'POST', body: credentials });
}

function emitAuthChanged(session) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('omega:auth-changed', { detail: session || null }));
  }
}

function emitAuthRequired(path) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('omega:auth-required', { detail: { path } }));
  }
}

function parseJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json);
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.sub || !payload.tid || !payload.email || payload.authn !== 'credentials-v1') return null;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now() + 15_000) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function getAuthSession() {
  const session = inMemoryAuthSession;
  if (!session) return null;
  if (session.accessToken && !parseJwtPayload(session.accessToken)) {
    inMemoryAuthSession = null;
    return null;
  }
  if (session.expiresAtMs && Date.now() >= session.expiresAtMs - 15_000) {
    inMemoryAuthSession = null;
    return null;
  }
  return session;
}

export function isAuthenticated() {
  const s = getAuthSession();
  return Boolean(s && (s.accessToken || s.cookieBacked));
}

export function saveAuthSession(tokenResponse) {
  const expiresInSec = Number(tokenResponse?.expiresInSeconds || 3600);
  const session = {
    accessToken: tokenResponse.accessToken || '',
    cookieBacked: Boolean(tokenResponse.cookieBacked),
    tokenType: tokenResponse.tokenType || 'Bearer',
    expiresAtMs: Date.now() + expiresInSec * 1000,
    userId: tokenResponse.userId,
    tenantId: tokenResponse.tenantId,
    tenantSlug: tokenResponse.tenantSlug,
    email: tokenResponse.email,
    role: tokenResponse.role,
  };
  inMemoryAuthSession = session;
  scrubLegacyDiskStorage();
  emitAuthChanged(session);
  return session;
}

export function restoreCookieAuthSession(principalMe) {
  if (!principalMe?.userId || !principalMe?.tenantId) return null;
  const existing = getAuthSession();
  const session = {
    accessToken: existing?.accessToken || '',
    cookieBacked: true,
    tokenType: 'Cookie',
    expiresAtMs: existing?.expiresAtMs || Date.now() + 3600 * 1000,
    userId: principalMe.userId,
    tenantId: principalMe.tenantId,
    tenantSlug: principalMe.tenantSlug || existing?.tenantSlug || '',
    email: principalMe.email,
    role: principalMe.role,
  };
  inMemoryAuthSession = session;
  emitAuthChanged(session);
  return session;
}

export function clearAuthSession() {
  inMemoryAuthSession = null;
  scrubLegacyDiskStorage();
  emitAuthChanged(null);
}

function generateLocalUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getWorkspaceId() {
  const session = getAuthSession();
  if (session?.tenantId) {
    return session.tenantId;
  }
  if (!inMemoryWorkspaceId) {
    inMemoryWorkspaceId = generateLocalUuid();
  }
  return inMemoryWorkspaceId;
}

export function rotateWorkspaceId() {
  inMemoryWorkspaceId = generateLocalUuid();
  return inMemoryWorkspaceId;
}

function buildFriendlyError(status, payload, fallbackMessage) {
  const detail = payload?.detail || payload?.message || payload?.error;
  if (status === 401) {
    return detail || 'Se requiere iniciar sesión en tu tenant OMEGA para acceder a esta función.';
  }
  if (status === 403) {
    return detail || 'Tu rol actual no tiene permisos suficientes para ejecutar esta operación.';
  }
  if (status === 404) {
    return detail || 'El recurso solicitado no existe en este tenant o no tienes acceso.';
  }
  if (status === 409) {
    return detail || 'Conflicto de integridad o recurso duplicado.';
  }
  if (status === 422) {
    return detail || 'Contenido bloqueado por las reglas de seguridad de OMEGA.';
  }
  if (status === 429) {
    return detail || 'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo.';
  }
  return detail || payload?.title || fallbackMessage || `Error HTTP ${status}`;
}

async function apiFetch(path, { method = 'GET', body, headers = {}, skipAuth = false, rawUrl = false, responseType = 'json' } = {}) {
  const url = rawUrl ? path : `${API_V1}${path}`;
  const reqHeaders = new Headers(headers);
  const session = getAuthSession();
  const bearerOnly = isTauriDesktopContext()
    || (typeof window !== 'undefined' && window.location?.protocol === 'file:');
  if (bearerOnly) reqHeaders.set('X-Omega-Auth-Mode', 'bearer');

  if (!skipAuth && session?.accessToken) {
    reqHeaders.set('Authorization', `Bearer ${session.accessToken}`);
  }

  if (!['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method.toUpperCase())
      && !bearerOnly && !/^Bearer \S/.test(reqHeaders.get('Authorization') || '')) {
    const csrf = await apiFetch('/auth/csrf', { skipAuth: true });
    if (!csrf?.token || csrf.headerName !== 'X-XSRF-TOKEN') {
      throw new Error('No se pudo obtener la protección de la sesión. Vuelve a intentarlo.');
    }
    reqHeaders.set(csrf.headerName, csrf.token);
  }

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  let finalBody = body;
  if (body !== undefined && !isFormData && typeof body !== 'string') {
    if (!reqHeaders.has('Content-Type')) {
      reqHeaders.set('Content-Type', 'application/json');
    }
    finalBody = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: reqHeaders,
      body: finalBody,
      credentials: bearerOnly ? 'omit' : shouldIncludeCredentials() ? 'include' : 'same-origin',
    });
  } catch (networkErr) {
    const err = new Error(
      'No se pudo conectar con el núcleo backend (:8080). Si acabas de guardar ajustes o iniciar OMEGA, espera unos segundos a que termine de arrancar e inténtalo de nuevo.'
    );
    err.cause = networkErr;
    err.isNetworkError = true;
    throw err;
  }

  if (response.ok && responseType === 'blob') return response.blob();

  let parsed = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json') || contentType.includes('application/problem+json')) {
    parsed = await response.json().catch(() => null);
  } else {
    const txt = await response.text().catch(() => '');
    parsed = txt ? { message: txt } : null;
  }

  if (!response.ok) {
    if (response.status === 401 && !skipAuth && session && inMemoryAuthSession === session) {
      clearAuthSession();
      emitAuthRequired(path);
    }
    const err = new Error(buildFriendlyError(response.status, parsed));
    err.status = response.status;
    err.requiresAuth = response.status === 401;
    err.problem = parsed;
    throw err;
  }

  return parsed;
}

export function exportExpedienteDossier(expedienteId, format = 'pdf') {
  if (!expedienteId || !['pdf', 'json'].includes(format)) throw new Error('Selecciona un expediente y un formato válido.');
  return apiFetch(`/expedientes/${encodeURIComponent(expedienteId)}/export/${format}`, { responseType: 'blob' });
}

function base64ToBlob(base64Str, mimeType = 'application/octet-stream') {
  const clean = String(base64Str || '').replace(/^data:.*;base64,/, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function normalizeRagResponse(data, expedienteId = null) {
  const rawCitations = Array.isArray(data?.citations) ? data.citations : [];
  let hybridCount = 0;
  let lexicalCount = 0;
  let semanticCount = 0;
  let maxSim = 0;

  const citations = rawCitations.map((c, idx) => {
    const vScore = Number(c.vectorScore || 0);
    const lScore = Number(c.lexicalScore || 0);
    const rScore = Number(c.rrfScore || 0);
    const sim = vScore > 0 ? vScore : Math.min(0.99, lScore > 0 ? lScore : rScore);
    if (sim > maxSim) maxSim = sim;

    let method = 'Híbrido RRF';
    if (vScore > 0 && lScore > 0) {
      hybridCount += 1;
      method = 'Híbrido RRF';
    } else if (lScore > 0) {
      lexicalCount += 1;
      method = 'Exacta Léxica';
    } else {
      semanticCount += 1;
      method = 'Semántica Vectorial';
    }

    return {
      index: idx + 1,
      report_id: c.documentId,
      title: c.originalFilename || 'Documento indexado',
      organization: c.sectionTitle || (expedienteId ? 'Documentos privados' : 'Corpus Público CTI'),
      page: c.pageNumber || 1,
      section: c.sectionTitle || `Pág. ${c.pageNumber || 1}`,
      citationLabel: c.citationLabel,
      excerpt: c.excerpt || '',
      sha256: c.sha256Hash || '',
      retrieval_method: method,
      similarity: Number(sim.toFixed(4)),
      lexicalScore: Number(lScore.toFixed(4)),
      rrfScore: Number(rScore.toFixed(4)),
    };
  });

  return {
    status: data?.status || 'OK',
    generalMode: data?.status === 'GENERAL_MODE',
    answer: data?.answer || '',
    model: data?.activeEmbeddingModel || 'omega-rag-v1',
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
    reindexRequiredDocuments: Array.isArray(data?.reindexRequiredDocuments)
      ? data.reindexRequiredDocuments
      : [],
    citations,
    analysis: {
      trace: {
        hybrid_count: hybridCount,
        lexical_count: lexicalCount,
        vector_count: semanticCount,
        max_similarity: maxSim,
      },
      warnings: Array.isArray(data?.warnings) ? data.warnings : [],
    },
  };
}

// ---------- Autenticación & Tenants Multi-Tenant ----------

export async function getAuthConfig() {
  return apiFetch('/auth/config', { skipAuth: true });
}

export async function loginWithPassword({ tenantSlug, email, password, rememberMe = true }) {
  const normalizedSlug = String(tenantSlug || '').trim().toLowerCase();
  const tokenRes = await apiFetch('/auth/login', {
    method: 'POST',
    skipAuth: true,
    body: {
      ...(normalizedSlug ? { tenantSlug: normalizedSlug } : {}),
      email: String(email || '').trim().toLowerCase(),
      password,
      rememberMe: Boolean(rememberMe),
    },
  });
  if (tokenRes?.mfaRequired) {
    return {
      mfaRequired: true,
      mfaChallengeToken: tokenRes.mfaChallengeToken,
      mfaMethod: tokenRes.mfaMethod,
      maskedEmail: tokenRes.maskedEmail,
      email: tokenRes.email,
    };
  }
  return saveAuthSession(tokenRes);
}

export async function verifyMfaLogin({ challengeToken, code, rememberDevice = true } = {}) {
  const tokenRes = await apiFetch('/auth/mfa/verify', {
    method: 'POST',
    skipAuth: true,
    body: {
      challengeToken: String(challengeToken || '').trim(),
      code: String(code || '').trim(),
      rememberDevice: Boolean(rememberDevice),
    },
  });
  return saveAuthSession(tokenRes);
}

export async function resendMfaEmail(challengeToken) {
  return apiFetch('/auth/mfa/resend-email', {
    method: 'POST',
    skipAuth: true,
    body: {
      challengeToken: String(challengeToken || '').trim(),
    },
  });
}

export async function fetchMfaStatus() {
  return apiFetch('/auth/mfa/status');
}

export async function setupTotpMfa() {
  return apiFetch('/auth/mfa/totp/setup', { method: 'POST' });
}

export async function confirmTotpMfa(code) {
  return apiFetch('/auth/mfa/totp/confirm', {
    method: 'POST',
    body: { code: String(code || '').trim() },
  });
}

export async function setupEmailMfa() {
  return apiFetch('/auth/mfa/email/setup', { method: 'POST' });
}

export async function confirmEmailMfa(code) {
  return apiFetch('/auth/mfa/email/confirm', {
    method: 'POST',
    body: { code: String(code || '').trim() },
  });
}

export async function disableMfa(password) {
  return apiFetch('/auth/mfa/disable', {
    method: 'POST',
    body: { password },
  });
}

export async function requestPasswordReset({ email, tenantSlug } = {}) {
  const normalizedSlug = String(tenantSlug || '').trim().toLowerCase();
  return apiFetch('/auth/password-reset/request', {
    method: 'POST',
    skipAuth: true,
    body: {
      email: String(email || '').trim().toLowerCase(),
      ...(normalizedSlug ? { tenantSlug: normalizedSlug } : {}),
    },
  });
}

export async function createRecoveryKey(password) {
  return apiFetch('/auth/recovery-key', {
    method: 'POST', body: { password },
  });
}

export async function confirmPasswordReset({ email, code, newPassword, tenantSlug } = {}) {
  const normalizedSlug = String(tenantSlug || '').trim().toLowerCase();
  return apiFetch('/auth/password-reset/confirm', {
    method: 'POST',
    skipAuth: true,
    body: {
      email: String(email || '').trim().toLowerCase(),
      code: String(code || '').trim(),
      newPassword,
      ...(normalizedSlug ? { tenantSlug: normalizedSlug } : {}),
    },
  });
}

export async function registerAccount({
  fullName,
  email,
  password,
  organizationName,
  bootstrapSecret,
  profile,
}) {
  const headers = {};
  if (bootstrapSecret && String(bootstrapSecret).trim()) {
    headers['X-Omega-Bootstrap-Secret'] = String(bootstrapSecret).trim();
  }
  const normalizedOrg = String(organizationName || '').trim();
  const normalizedProfile = ['GENERAL', 'DEVELOPER', 'LEGAL'].includes(
    String(profile || '').trim().toUpperCase(),
  )
    ? String(profile).trim().toUpperCase()
    : 'GENERAL';
  const tokenRes = await apiFetch('/auth/register', {
    method: 'POST',
    skipAuth: true,
    headers,
    body: {
      fullName: String(fullName || '').trim(),
      email: String(email || '').trim().toLowerCase(),
      password,
      profile: normalizedProfile,
      ...(normalizedOrg ? { organizationName: normalizedOrg } : {}),
    },
  });
  return tokenRes;
}

export async function fetchProfileConfig() {
  return apiFetch('/profile/config');
}

export async function updateTenantProfile(profile, confirmed = false) {
  return apiFetch('/profile', {
    method: 'PUT',
    body: {
      profile,
      confirmed: Boolean(confirmed),
    },
  });
}

export async function scanRepositoryArchive(file) {
  if (!file) throw new Error('Selecciona un archivo comprimido para analizar.');
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch('/repo/scan', {
    method: 'POST',
    body: formData,
  });
}

export async function scanRepositoryUrl({ repoUrl, branch = '', githubToken = '' }) {
  const cleanUrl = String(repoUrl || '').trim();
  if (!cleanUrl) throw new Error('Ingresa el enlace del repositorio de GitHub para analizar.');
  return apiFetch('/repo/scan-url', {
    method: 'POST',
    body: {
      repoUrl: cleanUrl,
      branch: String(branch || '').trim(),
      githubToken: String(githubToken || '').trim(),
    },
  });
}

export async function getRepoScanStatus(scanId) {
  return apiFetch(`/repo/scan/${encodeURIComponent(scanId)}`);
}

export async function listDevProjects() {
  return apiFetch('/dev/projects');
}

export async function createDevProject({ name, repoUrl = '', defaultBranch = '', sourceType = 'GITHUB_URL' }) {
  return apiFetch('/dev/projects', {
    method: 'POST',
    body: {
      name: String(name || '').trim(),
      repoUrl: String(repoUrl || '').trim() || undefined,
      defaultBranch: String(defaultBranch || '').trim() || undefined,
      sourceType,
    },
  });
}

export async function getDevProjectDetail(projectId) {
  return apiFetch(`/dev/projects/${encodeURIComponent(projectId)}`);
}

export async function compareDevScans(projectId, baseScanId, headScanId) {
  return apiFetch(
    `/dev/projects/${encodeURIComponent(projectId)}/compare?baseScanId=${encodeURIComponent(baseScanId)}&headScanId=${encodeURIComponent(headScanId)}`
  );
}

export async function deleteDevProject(projectId) {
  return apiFetch(`/dev/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
}

export async function listDevFindings({ projectId = '', severity = '', ruleId = '', triageStatus = '' } = {}) {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (severity) params.set('severity', severity);
  if (ruleId) params.set('ruleId', ruleId);
  if (triageStatus) params.set('triageStatus', triageStatus);
  const qs = params.toString();
  return apiFetch(`/dev/findings${qs ? `?${qs}` : ''}`);
}

export async function updateDevFindingTriage(findingId, { status, comment = '' }) {
  return apiFetch(`/dev/findings/${encodeURIComponent(findingId)}/triage`, {
    method: 'PATCH',
    body: { status, comment: String(comment || '').trim() || undefined },
  });
}

export async function listDevFindingComments(findingId) {
  return apiFetch(`/dev/findings/${encodeURIComponent(findingId)}/comments`);
}

export async function addDevFindingComment(findingId, body) {
  return apiFetch(`/dev/findings/${encodeURIComponent(findingId)}/comments`, {
    method: 'POST',
    body: { body: String(body || '').trim() },
  });
}

export async function listDevSuppressions(projectId) {
  return apiFetch(`/dev/projects/${encodeURIComponent(projectId)}/suppressions`);
}

export async function createDevSuppression(projectId, { ruleId, fingerprint = '', reason, expiresInDays = 30 }) {
  return apiFetch(`/dev/projects/${encodeURIComponent(projectId)}/suppressions`, {
    method: 'POST',
    body: {
      ruleId: String(ruleId || '').trim(),
      fingerprint: String(fingerprint || '').trim() || undefined,
      reason: String(reason || '').trim(),
      expiresInDays: Number(expiresInDays || 0),
    },
  });
}

export async function revokeDevSuppression(suppressionId) {
  return apiFetch(`/dev/suppressions/${encodeURIComponent(suppressionId)}`, {
    method: 'DELETE',
  });
}

export async function listDevDependencies(projectId, { ecosystem = '', q = '' } = {}) {
  const params = new URLSearchParams();
  if (ecosystem) params.set('ecosystem', ecosystem);
  if (q) params.set('q', q);
  const qs = params.toString();
  return apiFetch(
    `/dev/projects/${encodeURIComponent(projectId)}/dependencies${qs ? `?${qs}` : ''}`
  );
}

export async function exportDevSbom(projectId, format = 'cyclonedx') {
  return apiFetch(
    `/dev/projects/${encodeURIComponent(projectId)}/sbom?format=${encodeURIComponent(format)}`
  );
}

export async function getDevTenantPolicy() {
  return apiFetch('/dev/policies');
}

export async function updateDevTenantPolicy({
  failOnSeverity = 'HIGH',
  actionOnViolation = 'FAIL_PIPELINE',
  allowedPackages = [],
  blockedPackages = [],
} = {}) {
  return apiFetch('/dev/policies', {
    method: 'PUT',
    body: {
      failOnSeverity,
      actionOnViolation,
      allowedPackages,
      blockedPackages,
    },
  });
}

export async function getDevProjectPolicy(projectId) {
  return apiFetch(`/dev/projects/${encodeURIComponent(projectId)}/policy`);
}

export async function updateDevProjectPolicy(
  projectId,
  {
    failOnSeverity = 'HIGH',
    actionOnViolation = 'FAIL_PIPELINE',
    allowedPackages = [],
    blockedPackages = [],
  } = {}
) {
  return apiFetch(`/dev/projects/${encodeURIComponent(projectId)}/policy`, {
    method: 'PUT',
    body: {
      failOnSeverity,
      actionOnViolation,
      allowedPackages,
      blockedPackages,
    },
  });
}

export async function deleteDevProjectPolicyOverride(projectId) {
  return apiFetch(`/dev/projects/${encodeURIComponent(projectId)}/policy`, {
    method: 'DELETE',
  });
}

export async function listDevSupplyChainAdvisories({
  ecosystem = '',
  q = '',
  projectId = '',
} = {}) {
  const params = new URLSearchParams();
  if (ecosystem) params.set('ecosystem', ecosystem);
  if (q) params.set('q', q);
  if (projectId) params.set('projectId', projectId);
  const qs = params.toString();
  return apiFetch(`/dev/supply-chain/advisories${qs ? `?${qs}` : ''}`);
}

export async function queryDevSupplyChainIntel(question) {
  return apiFetch('/dev/supply-chain/query', {
    method: 'POST',
    body: { question: String(question || '').trim() },
  });
}

export async function listApiTokens() {
  return apiFetch('/api-tokens');
}

export async function createApiToken({ name, expiresInDays, maxUses } = {}) {
  const body = { name: String(name || '').trim() };
  if (expiresInDays !== undefined && expiresInDays !== '' && expiresInDays !== null) {
    body.expiresInDays = Number(expiresInDays);
  }
  if (maxUses !== undefined && maxUses !== '' && maxUses !== null) {
    body.maxUses = Number(maxUses);
  }
  return apiFetch('/api-tokens', { method: 'POST', body });
}

export async function revokeApiToken(tokenId) {
  return apiFetch(`/api-tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE' });
}

export async function getGitHubIntegrationStatus() {
  return apiFetch('/integrations/github/status');
}

export async function createGitHubLinkState() {
  return apiFetch('/integrations/github/state', { method: 'POST', body: {} });
}

export async function linkGitHubInstallation({ state, installationId, userAccessToken, accountLogin }) {
  return apiFetch('/integrations/github/link', {
    method: 'POST',
    body: {
      state: String(state || '').trim(),
      installationId: Number(installationId),
      userAccessToken: String(userAccessToken || '').trim(),
      accountLogin: String(accountLogin || '').trim(),
    },
  });
}

export async function unlinkGitHubInstallation() {
  return apiFetch('/integrations/github/link', { method: 'DELETE' });
}

export async function registerTenant({
  tenantSlug,
  tenantName,
  adminEmail,
  adminPassword,
  adminFullName,
  bootstrapSecret,
}) {
  const headers = {};
  if (bootstrapSecret && String(bootstrapSecret).trim()) {
    headers['X-Omega-Bootstrap-Secret'] = String(bootstrapSecret).trim();
  }
  const tokenRes = await apiFetch('/auth/tenants/register', {
    method: 'POST',
    skipAuth: true,
    headers,
    body: {
      tenantSlug: String(tenantSlug || '').trim().toLowerCase(),
      tenantName: String(tenantName || '').trim(),
      adminEmail: String(adminEmail || '').trim().toLowerCase(),
      adminPassword,
      adminFullName: String(adminFullName || '').trim(),
    },
  });
  return saveAuthSession(tokenRes);
}

export async function logoutSession() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // Asegurar limpieza local incluso si el servidor está offline o el token ya caducó
  } finally {
    clearAuthSession();
  }
}

export async function panicPurgeClient() {
  await logoutSession();
  rotateWorkspaceId();
  scrubLegacyDiskStorage();
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
  } catch {
    // ignore
  }
  try {
    if (typeof window !== 'undefined' && 'caches' in window && window.caches?.keys) {
      const names = await window.caches.keys();
      await Promise.all(names.map((n) => window.caches.delete(n)));
    }
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('omega:panic-purge'));
  }
}

export async function createTenantUser({ email, password, fullName, role }) {
  return apiFetch('/auth/users', {
    method: 'POST',
    body: { email, password, fullName, role },
  });
}

export async function fetchCurrentPrincipal() {
  return apiFetch('/auth/me');
}

// ---------- Expedientes & Zero-Retention PDFs ----------

export async function listExpedientes() {
  return apiFetch('/expedientes');
}

/**
 * Garantiza silenciosamente el espacio privado por defecto para almacenar PDFs
 * con Zero-Retention sin exponer el concepto interno de "expediente" en la UI.
 */
export async function ensurePersonalWorkspace() {
  const list = await listExpedientes();
  const existing = Array.isArray(list) ? list : [];
  if (existing.length > 0) {
    return existing[0];
  }
  try {
    return await createExpediente({
      title: 'Espacio personal',
      classification: 'CONFIDENTIAL',
    });
  } catch (err) {
    if (err?.status === 403) {
      return null;
    }
    throw err;
  }
}

export async function createExpediente({ title, classification = 'CONFIDENTIAL' }) {
  return apiFetch('/expedientes', {
    method: 'POST',
    body: {
      title: String(title || '').trim(),
      classification: classification || 'CONFIDENTIAL',
    },
  });
}

export async function listExpedienteDocuments(expedienteId) {
  return apiFetch(`/expedientes/${expedienteId}/documents`);
}

export async function uploadExpedientePdf(expedienteId, file) {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch(`/expedientes/${expedienteId}/documents`, {
    method: 'POST',
    body: formData,
  });
}

export async function getExpedienteDocument(expedienteId, documentId) {
  return apiFetch(`/expedientes/${expedienteId}/documents/${documentId}`);
}

// ---------- RAG Consultas ----------

export async function sendChatQuery(
  query,
  history = [],
  topK = 6,
  sourceFilter = 'Todas las fuentes',
  _pinnedContext = null,
  options = {},
) {
  const expedienteId = options?.expedienteId || null;
  const conversationHistory = (Array.isArray(history) ? history : [])
    .filter(turn => ['user', 'assistant'].includes(turn?.role) && typeof turn.content === 'string' && turn.content.trim())
    .slice(-6).map(turn => ({ role: turn.role, content: turn.content.slice(0, 4000) }));
  const analysisContext =
    typeof options?.analysisContext === 'string' && options.analysisContext.trim()
      ? options.analysisContext.trim().slice(0, 4000)
      : null;
  if (expedienteId) {
    const res = await apiFetch(`/expedientes/${expedienteId}/query`, {
      method: 'POST',
      body: {
        question: query,
        topK,
        history: conversationHistory,
        ...(analysisContext ? { analysis_context: analysisContext } : {}),
      },
    });
    return normalizeRagResponse(res, expedienteId);
  }

  const res = await apiFetch('/cti/query', {
    method: 'POST',
    body: {
      question: query,
      topK,
      history: conversationHistory,
      source_filter: sourceFilter || null,
      general_mode: Boolean(options?.generalMode),
      ...(analysisContext ? { analysis_context: analysisContext } : {}),
    },
  });
  return normalizeRagResponse(res, null);
}

export async function fetchCorpusDiscovery(status = 'PENDING') {
  return apiFetch(`/cti/discovery?status=${encodeURIComponent(status)}`);
}

export async function scanCorpusDiscovery() {
  return apiFetch('/cti/discovery/scan', { method: 'POST' });
}

export async function approveCorpusCandidate(id) {
  return apiFetch(`/cti/discovery/${id}/approve`, { method: 'POST' });
}

export async function rejectCorpusCandidate(id) {
  return apiFetch(`/cti/discovery/${id}/reject`, { method: 'POST' });
}

export async function lookupExternalReputation(indicator) {
  return apiFetch(`/cti/reputation?indicator=${encodeURIComponent(String(indicator || '').trim())}`);
}

export async function sendMultimodalQuery({ expedienteId = null, imageFile, question = '' }) {
  const formData = new FormData();
  formData.append('image', imageFile);
  if (question && String(question).trim()) {
    formData.append('question', String(question).trim());
  }
  const path = expedienteId
    ? `/expedientes/${expedienteId}/query/multimodal`
    : '/public/query/multimodal';
  const res = await apiFetch(path, {
    method: 'POST',
    body: formData,
  });
  return {
    status: 'OK',
    answer: res?.answer || '',
    citations: Array.isArray(res?.citations) ? res.citations : [],
    warnings: [],
    model: res?.vision_extraction?.providerModel || 'omega-multimodal',
    multimodal: res,
  };
}

// ---------- CTI Campañas, STIX y WebLoader ----------

export async function fetchCampaigns() {
  return apiFetch('/cti/campaigns');
}

export async function fetchCampaignDetail(campaignId) {
  return apiFetch(`/cti/campaigns/${campaignId}`);
}

export async function fetchCampaignYara(campaignId) {
  return apiFetch(`/forensics/yara/campaigns/${campaignId}`);
}

export async function fetchCampaignMvtScript(campaignId) {
  return apiFetch(`/forensics/campaigns/${campaignId}/mvt-script`);
}

export async function syncStixFeeds() {
  return apiFetch('/cti/stix/sync', { method: 'POST' });
}

export async function lookupCtiIndicator(value) {
  return apiFetch(`/cti/indicators/lookup?value=${encodeURIComponent(value)}`);
}

export async function scanWebIntelUrl(url, activeNet4Ips = []) {
  return apiFetch('/cti/webloader-scan', {
    method: 'POST',
    body: {
      url,
      active_net4_ips: Array.isArray(activeNet4Ips) ? activeNet4Ips : [],
    },
  });
}

// ---------- Forense In-RAM vía Java Gateway -> forensic-worker ----------

export async function verifyMvtFile(file, expedienteId = null) {
  const formData = new FormData();
  formData.append('file', file);
  const qs = expedienteId ? `?expedienteId=${encodeURIComponent(expedienteId)}` : '';
  return apiFetch(`/forensics/ioc/verify/file${qs}`, {
    method: 'POST',
    body: formData,
  });
}

export async function runParallelTriage(files, expedienteId = null) {
  const formData = new FormData();
  Array.from(files || []).forEach((f) => formData.append('files', f));
  const qs = expedienteId ? `?expedienteId=${encodeURIComponent(expedienteId)}` : '';
  return apiFetch(`/forensics/triage${qs}`, {
    method: 'POST',
    body: formData,
  });
}

export async function scanArtifactsYara(files, expedienteId = null) {
  const formData = new FormData();
  Array.from(files || []).forEach((f) => formData.append('files', f));
  const qs = expedienteId ? `?expedienteId=${encodeURIComponent(expedienteId)}` : '';
  return apiFetch(`/forensics/yara/scan${qs}`, {
    method: 'POST',
    body: formData,
  });
}

export async function verifyMvtText(indicatorsText, expedienteId = null) {
  return apiFetch('/forensics/ioc/verify/text', {
    method: 'POST',
    body: {
      indicators_text: indicatorsText,
      expedienteId: expedienteId || undefined,
    },
  });
}

export async function analyzeLiveDeviceSnapshot(snapshot, expedienteId = null) {
  const qs = expedienteId ? `?expedienteId=${encodeURIComponent(expedienteId)}` : '';
  return apiFetch(`/forensics/triage/device-live${qs}`, {
    method: 'POST',
    body: snapshot,
  });
}

export async function analyzePcLiveSnapshot(snapshot, expedienteId = null) {
  const qs = expedienteId ? `?expedienteId=${encodeURIComponent(expedienteId)}` : '';
  return apiFetch(`/forensics/triage/pc-live${qs}`, {
    method: 'POST',
    body: snapshot,
  });
}

export async function resolveIosManifestTargets(manifestBase64) {
  const formData = new FormData();
  formData.append('manifest', base64ToBlob(manifestBase64), 'Manifest.db');
  return apiFetch('/forensics/triage/ios-manifest-targets', {
    method: 'POST',
    body: formData,
  });
}

export async function resolveEncryptedIosManifestTargets(manifestPlistB64, manifestDbB64, password) {
  const formData = new FormData();
  formData.append('manifest_plist', base64ToBlob(manifestPlistB64), 'Manifest.plist');
  formData.append('manifest_db', base64ToBlob(manifestDbB64), 'Manifest.db');
  formData.append('password', String(password || ''));
  return apiFetch('/forensics/triage/ios-manifest-decrypt', {
    method: 'POST',
    body: formData,
  });
}

export async function verifySuspiciousLink(url, expedienteId = null, activeProbe = false) {
  return apiFetch('/forensics/link/verify', {
    method: 'POST',
    body: {
      url,
      expedienteId: expedienteId || undefined,
      activeProbe,
    },
  });
}

export async function fetchMobileUsbDevices() {
  return apiFetch('/forensic/mobile/devices');
}

export async function startMobileUsbAudit({
  platform,
  deviceId,
  backupPassword = '',
  asyncMode = false,
} = {}) {
  return apiFetch('/forensic/mobile/audit', {
    method: 'POST',
    body: {
      platform,
      device_id: deviceId,
      ...(backupPassword ? { backup_password: backupPassword } : {}),
      async_mode: Boolean(asyncMode),
    },
  });
}

export async function fetchMobileUsbAuditJob(jobId) {
  return apiFetch(`/forensic/mobile/audit/${encodeURIComponent(String(jobId || '').trim())}`);
}

// ---------- OSINT Multi-Tenant ----------

export async function fetchOsintAssets() {
  return apiFetch('/osint/assets');
}

export async function createOsintAsset(payload) {
  return apiFetch('/osint/assets', {
    method: 'POST',
    body: payload,
  });
}

export async function scanOsintAsset(assetId) {
  return apiFetch(`/osint/assets/${assetId}/scan`, { method: 'POST' });
}

export async function deleteOsintAsset(assetId) {
  return apiFetch(`/osint/assets/${assetId}`, { method: 'DELETE' });
}

// ---------- Gobernanza, Salud y Cadena de Auditoría ----------

export async function fetchSystemGovernance() {
  return apiFetch('/system/governance');
}

export async function testAiEngineConnection({ provider, baseUrl, apiKey, model } = {}) {
  return apiFetch('/system/ai-test', {
    method: 'POST',
    body: {
      provider: provider || 'groq',
      base_url: baseUrl || '',
      api_key: apiKey || '',
      model: model || '',
    },
  });
}

export async function fetchAuditLogs(limit = 30) {
  return apiFetch(`/audit-logs?limit=${encodeURIComponent(limit)}`);
}

export async function verifyAuditChain() {
  return apiFetch('/audit-logs/verify');
}

export async function fetchApiHealth() {
  try {
    const res = await fetch(`${API_ORIGIN}/actuator/health`);
    if (!res.ok) return { status: 'down' };
    const data = await res.json();
    const isUp = data?.status === 'UP' || data?.status === 'ok';
    return { status: isUp ? 'ok' : 'degraded', raw: data };
  } catch {
    return { status: 'down' };
  }
}

// ---------- Capa Comercial SaaS, Flota de Dispositivos y Alertas (Fase 8) ----------

export async function fetchSaasSummary() {
  return apiFetch('/saas/summary');
}

export async function sendDeviceHeartbeat({ deviceUid, hostname, osPlatform, sensorVersion } = {}) {
  return apiFetch('/saas/devices/heartbeat', {
    method: 'POST',
    body: {
      deviceUid,
      hostname: hostname || 'equipo-omega',
      osPlatform: osPlatform || 'web',
      sensorVersion: sensorVersion || '2.0.8',
    },
  });
}

export async function revokeFleetDevice(deviceId) {
  return apiFetch(`/saas/devices/${encodeURIComponent(deviceId)}/revoke`, {
    method: 'POST',
  });
}

export async function updateSubscriptionPlan(planCode) {
  return apiFetch('/saas/subscription', {
    method: 'PUT',
    body: { planCode },
  });
}

export async function dispatchTestAlert({ severity = 'HIGH', title, message, webhookUrl } = {}) {
  return apiFetch('/saas/alerts/dispatch', {
    method: 'POST',
    body: {
      severity,
      title: title || 'Prueba de alerta OMEGA',
      message: message || 'Verificación de canal externo de alertas críticas.',
      webhookUrl: webhookUrl || '',
    },
  });
}
