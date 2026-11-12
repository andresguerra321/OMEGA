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

export async function fetchOsintAssets() {
  const res = await fetch(`${API_BASE}/osint/assets`);
  if (!res.ok) throw new Error('Error cargando activos OSINT');
  return res.json();
}

export async function createOsintAsset(payload) {
  const res = await fetch(`${API_BASE}/osint/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  });
  if (!res.ok) throw new Error('Error ejecutando consulta OSINT pasiva');
  return res.json();
}

export async function deleteOsintAsset(assetId) {
  const res = await fetch(`${API_BASE}/osint/assets/${assetId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Error eliminando activo');
  return res.json();
}
