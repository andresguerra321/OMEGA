const API_BASE = 'http://localhost:8000/api';

export async function sendChatQuery(query, history = [], topK = 6) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, history, top_k: topK }),
  });
  if (!res.ok) throw new Error('Error consultando el motor RAG');
  return res.json();
}

export async function verifyMvtFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/ioc/verify/file`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Error analizando el archivo forense');
  return res.json();
}

export async function verifyMvtText(indicatorsText) {
  const res = await fetch(`${API_BASE}/ioc/verify/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indicators_text: indicatorsText }),
  });
  if (!res.ok) throw new Error('Error analizando los indicadores');
  return res.json();
}

export async function fetchCampaigns() {
  const res = await fetch(`${API_BASE}/campaigns`);
  if (!res.ok) throw new Error('Error cargando campañas');
  return res.json();
}

export async function fetchCampaignDetail(id) {
  const res = await fetch(`${API_BASE}/campaigns/${id}`);
  if (!res.ok) throw new Error('Error cargando detalle de campaña');
  return res.json();
}

// --- Servicios OSINT Defensivo (RF8, RNF8) ---

function getWorkspaceHeaders() {
  let wsId = localStorage.getItem('omega_workspace_id');
  if (!wsId) {
    wsId = `analyst_${crypto.randomUUID()}`;
    localStorage.setItem('omega_workspace_id', wsId);
  }
  return { 'X-Workspace-Id': wsId };
}

export async function fetchOsintAssets() {
  const res = await fetch(`${API_BASE}/osint/assets`, {
    headers: getWorkspaceHeaders(),
  });
  if (!res.ok) throw new Error('Error cargando activos OSINT');
  return res.json();
}

export async function createOsintAsset(payload) {
  const res = await fetch(`${API_BASE}/osint/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getWorkspaceHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Error registrando activo propio');
  }
  return res.json();
}

export async function scanOsintAsset(assetId) {
  const res = await fetch(`${API_BASE}/osint/assets/${assetId}/scan`, {
    method: 'POST',
    headers: getWorkspaceHeaders(),
  });
  if (!res.ok) throw new Error('Error ejecutando consulta OSINT pasiva');
  return res.json();
}

export async function deleteOsintAsset(assetId) {
  const res = await fetch(`${API_BASE}/osint/assets/${assetId}`, {
    method: 'DELETE',
    headers: getWorkspaceHeaders(),
  });
  if (!res.ok) throw new Error('Error eliminando activo');
  return res.json();
}

// --- Triage Paralelo e Ingeniería de Detección Defensiva (RF5, RF6, RNF7) ---

export async function runParallelTriage(fileList) {
  const formData = new FormData();
  for (const file of fileList) {
    formData.append('files', file);
  }
  const res = await fetch(`${API_BASE}/triage/parallel`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Error ejecutando el triage forense paralelo');
  return res.json();
}

export async function fetchCampaignYara(campaignId) {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}/yara`);
  if (!res.ok) throw new Error('Error generando regla YARA');
  return res.json();
}

export async function fetchCampaignMvtScript(campaignId) {
  const res = await fetch(`${API_BASE}/campaigns/${campaignId}/mvt-script`);
  if (!res.ok) throw new Error('Error generando script MVT');
  return res.json();
}

// --- Verificador Pasivo de Enlaces y Gobernanza (RF7, RNF4, RNF7, RNF8) ---

export async function verifySuspiciousLink(url) {
  const res = await fetch(`${API_BASE}/link/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Error verificando el enlace');
  }
  return res.json();
}

export async function fetchSystemGovernance() {
  const res = await fetch(`${API_BASE}/system/governance`, {
    headers: getWorkspaceHeaders(),
  });
  if (!res.ok) throw new Error('Error cargando estado de cuenta y permisos');
  return res.json();
}
