const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export function getWorkspaceId() {
  let wsId = localStorage.getItem('omega_workspace_id');
  if (!wsId) {
    wsId = `analyst_${crypto.randomUUID()}`;
    localStorage.setItem('omega_workspace_id', wsId);
  }
  return wsId;
}

export function rotateWorkspaceId() {
  const nextId = `analyst_${crypto.randomUUID()}`;
  localStorage.setItem('omega_workspace_id', nextId);
  return nextId;
}

function workspaceHeaders(extra = {}) {
  return {
    'X-Workspace-Id': getWorkspaceId(),
    ...extra,
  };
}

async function parseJsonOrThrow(res, fallbackMsg) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || fallbackMsg);
  }
  return res.json();
}

// ============================================================================
// 1. PREGUNTAR (RAG Híbrido RRF + Citas Verificables)
// ============================================================================
export async function sendChatQuery(query, history = [], topK = 6, sourceFilter = null) {
  const payload = { query, history, top_k: topK };
  if (sourceFilter && !sourceFilter.toLowerCase().includes('todas')) {
    payload.source_filter = sourceFilter;
  }
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res, 'Error consultando el motor RAG de Omega');
}

// ============================================================================
// 2. AMENAZAS (Catálogo y Dossiers de Campañas, CVEs e IOCs)
// ============================================================================
export async function fetchCampaigns() {
  const res = await fetch(`${API_BASE}/campaigns`);
  return parseJsonOrThrow(res, 'Error cargando campañas normalizadas');
}

export async function fetchCampaignDetail(campaignId) {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}`);
  return parseJsonOrThrow(res, 'Error cargando dossier técnico de la campaña');
}

export async function fetchCampaignYara(campaignId) {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}/yara`);
  return parseJsonOrThrow(res, 'Error generando regla YARA');
}

export async function fetchCampaignMvtScript(campaignId) {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}/mvt-script`);
  return parseJsonOrThrow(res, 'Error generando script MVT');
}

// ============================================================================
// 3. REVISAR MI EQUIPO (Triage Forense Volátil en RAM)
// ============================================================================
export async function verifyMvtFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/ioc/verify/file`, {
    method: 'POST',
    body: formData,
  });
  return parseJsonOrThrow(res, 'Error procesando artefacto forense en RAM');
}

export async function runParallelTriage(files) {
  const formData = new FormData();
  for (const f of files) {
    formData.append('files', f);
  }
  const res = await fetch(`${API_BASE}/triage/parallel`, {
    method: 'POST',
    body: formData,
  });
  return parseJsonOrThrow(res, 'Error ejecutando triage paralelo');
}

export async function verifyMvtText(indicatorsText) {
  const res = await fetch(`${API_BASE}/ioc/verify/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indicators_text: indicatorsText }),
  });
  return parseJsonOrThrow(res, 'Error cruzando indicadores manuales');
}

export async function analyzeLiveDeviceSnapshot(snapshot) {
  const res = await fetch(`${API_BASE}/triage/device-live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
  return parseJsonOrThrow(res, 'Error analizando la captura viva del dispositivo');
}

// ============================================================================
// 4. MI EXPOSICIÓN (OSINT Pasivo con Consentimiento Explícito RNF8)
// ============================================================================
export async function fetchOsintAssets() {
  const res = await fetch(`${API_BASE}/osint/assets`, {
    headers: workspaceHeaders(),
  });
  return parseJsonOrThrow(res, 'Error cargando activos autorizados');
}

export async function createOsintAsset(payload) {
  const res = await fetch(`${API_BASE}/osint/assets`, {
    method: 'POST',
    headers: workspaceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res, 'Error registrando activo propio');
}

export async function scanOsintAsset(assetId) {
  const res = await fetch(`${API_BASE}/osint/assets/${assetId}/scan`, {
    method: 'POST',
    headers: workspaceHeaders(),
  });
  return parseJsonOrThrow(res, 'Error ejecutando auditoría OSINT pasiva');
}

export async function deleteOsintAsset(assetId) {
  const res = await fetch(`${API_BASE}/osint/assets/${assetId}`, {
    method: 'DELETE',
    headers: workspaceHeaders(),
  });
  return parseJsonOrThrow(res, 'Error revocando activo');
}

// ============================================================================
// 5. VERIFICAR ENLACE (Inspección Pasiva sin Contacto al Destino)
// ============================================================================
export async function verifySuspiciousLink(url) {
  const res = await fetch(`${API_BASE}/link/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return parseJsonOrThrow(res, 'Error verificando el enlace');
}

// ============================================================================
// 6. AJUSTES (Gobernanza, Permisos y Trazabilidad del Corpus RF7)
// ============================================================================
export async function fetchSystemGovernance() {
  const res = await fetch(`${API_BASE}/system/governance`, {
    headers: workspaceHeaders(),
  });
  return parseJsonOrThrow(res, 'Error cargando estado de gobernanza');
}
