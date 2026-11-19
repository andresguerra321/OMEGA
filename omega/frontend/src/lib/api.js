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

function shouldIncludeCredentials() {
  return typeof window !== 'undefined' && window.location?.protocol !== 'file:';
}

function resolveApiOrigin() {
  if (typeof window !== 'undefined' && (window.location?.protocol === 'file:' || window.omegaDesktop?.isDesktop)) {
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
  const bridge = typeof window !== 'undefined' ? window.omegaDesktop : null;
  if (!bridge?.prepareHostSensor) return { ready: true };
  const session = getAuthSession();
  if (!session?.accessToken || session.role !== 'ADMIN') throw new Error('Inicia sesión como administrador para proteger esta computadora.');
  const result = await bridge.prepareHostSensor({ accessToken: session.accessToken });
  if (!result?.ready) throw new Error(result?.message || 'No se pudo preparar la protección. Pulsa Reintentar.');
  return result;
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
    if (!payload.sub || !payload.tid || !payload.email) return null;
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

  if (!skipAuth && session?.accessToken) {
    reqHeaders.set('Authorization', `Bearer ${session.accessToken}`);
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
      credentials: shouldIncludeCredentials() ? 'include' : 'same-origin',
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
    if (response.status === 401 && !skipAuth) {
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

export async function loginWithPassword({ tenantSlug, email, password }) {
  const normalizedSlug = String(tenantSlug || '').trim().toLowerCase();
  const tokenRes = await apiFetch('/auth/login', {
    method: 'POST',
    skipAuth: true,
    body: {
      ...(normalizedSlug ? { tenantSlug: normalizedSlug } : {}),
      email: String(email || '').trim().toLowerCase(),
      password,
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

export async function verifyMfaLogin({ challengeToken, code } = {}) {
  const tokenRes = await apiFetch('/auth/mfa/verify', {
    method: 'POST',
    skipAuth: true,
    body: {
      challengeToken: String(challengeToken || '').trim(),
      code: String(code || '').trim(),
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
}) {
  const headers = {};
  if (bootstrapSecret && String(bootstrapSecret).trim()) {
    headers['X-Omega-Bootstrap-Secret'] = String(bootstrapSecret).trim();
  }
  const normalizedOrg = String(organizationName || '').trim();
  const tokenRes = await apiFetch('/auth/register', {
    method: 'POST',
    skipAuth: true,
    headers,
    body: {
      fullName: String(fullName || '').trim(),
      email: String(email || '').trim().toLowerCase(),
      password,
      ...(normalizedOrg ? { organizationName: normalizedOrg } : {}),
    },
  });
  return saveAuthSession(tokenRes);
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

export async function loginOrCreateSandboxDemo() {
  const suffix = Math.random().toString(36).slice(2, 8);
  const creds = {
    tenantSlug: `omega-lab-${suffix}`,
    tenantName: `Sandbox Forense ${suffix.toUpperCase()}`,
    adminEmail: `analista-${suffix}@omega.local`,
    adminPassword: `Omega!Lab#${suffix}2026`,
    adminFullName: 'Analista Sandbox Local',
  };

  return registerTenant(creds);
}

export async function logoutSession() {
  try {
    await apiFetch('/auth/logout', { method: 'POST', skipAuth: true });
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
  _history = [],
  topK = 6,
  sourceFilter = 'Todas las fuentes',
  _pinnedContext = null,
  options = {},
) {
  const expedienteId = options?.expedienteId || null;
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
      sensorVersion: sensorVersion || '1.10.1',
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
