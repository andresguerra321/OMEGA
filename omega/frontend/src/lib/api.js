const AUTH_STORAGE_KEY = 'omega_auth_session_v1';
const SANDBOX_CREDS_KEY = 'omega_sandbox_creds_v1';
const WORKSPACE_STORAGE_KEY = 'omega_workspace_id';

function resolveApiOrigin() {
  const envOrigin = import.meta?.env?.VITE_API_ORIGIN;
  if (envOrigin) {
    return String(envOrigin).replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location?.protocol === 'file:') {
    return 'http://127.0.0.1:8080';
  }
  return '';
}

const API_ORIGIN = resolveApiOrigin();
const API_V1 = `${API_ORIGIN}/api/v1`;

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
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.accessToken || !parseJwtPayload(parsed.accessToken)) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    if (parsed.expiresAtMs && Date.now() >= parsed.expiresAtMs - 15_000) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return Boolean(getAuthSession()?.accessToken);
}

export function saveAuthSession(tokenResponse) {
  const expiresInSec = Number(tokenResponse?.expiresInSeconds || 3600);
  const session = {
    accessToken: tokenResponse.accessToken,
    tokenType: tokenResponse.tokenType || 'Bearer',
    expiresAtMs: Date.now() + expiresInSec * 1000,
    userId: tokenResponse.userId,
    tenantId: tokenResponse.tenantId,
    tenantSlug: tokenResponse.tenantSlug,
    email: tokenResponse.email,
    role: tokenResponse.role,
  };
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // ignore storage errors
  }
  emitAuthChanged(session);
  return session;
}

export function clearAuthSession() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
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
  try {
    let wsId = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!wsId) {
      wsId = generateLocalUuid();
      localStorage.setItem(WORKSPACE_STORAGE_KEY, wsId);
    }
    return wsId;
  } catch {
    return generateLocalUuid();
  }
}

export function rotateWorkspaceId() {
  const nextId = generateLocalUuid();
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, nextId);
  } catch {
    // ignore
  }
  return nextId;
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

async function apiFetch(path, { method = 'GET', body, headers = {}, skipAuth = false, rawUrl = false } = {}) {
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

  const response = await fetch(url, {
    method,
    headers: reqHeaders,
    body: finalBody,
  });

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
  return saveAuthSession(tokenRes);
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
  try {
    const saved = localStorage.getItem(SANDBOX_CREDS_KEY);
    if (saved) {
      const creds = JSON.parse(saved);
      if (creds?.tenantSlug && creds?.email && creds?.password) {
        try {
          return await loginWithPassword(creds);
        } catch {
          localStorage.removeItem(SANDBOX_CREDS_KEY);
        }
      }
    }
  } catch {
    // ignore corrupted sandbox cache
  }

  const suffix = Math.random().toString(36).slice(2, 8);
  const creds = {
    tenantSlug: `omega-lab-${suffix}`,
    tenantName: `Sandbox Forense ${suffix.toUpperCase()}`,
    adminEmail: `analista-${suffix}@omega.local`,
    adminPassword: `Omega!Lab#${suffix}2026`,
    adminFullName: 'Analista Sandbox Local',
  };

  const session = await registerTenant(creds);
  try {
    localStorage.setItem(
      SANDBOX_CREDS_KEY,
      JSON.stringify({
        tenantSlug: creds.tenantSlug,
        email: creds.adminEmail,
        password: creds.adminPassword,
      }),
    );
  } catch {
    // ignore storage failure
  }
  return session;
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
  if (expedienteId) {
    const res = await apiFetch(`/expedientes/${expedienteId}/query`, {
      method: 'POST',
      body: { question: query, topK },
    });
    return normalizeRagResponse(res, expedienteId);
  }

  const res = await apiFetch('/cti/query', {
    method: 'POST',
    body: {
      question: query,
      topK,
      source_filter: sourceFilter || null,
    },
  });
  return normalizeRagResponse(res, null);
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

export async function verifySuspiciousLink(url, expedienteId = null) {
  return apiFetch('/forensics/link/verify', {
    method: 'POST',
    body: {
      url,
      expedienteId: expedienteId || undefined,
    },
  });
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
