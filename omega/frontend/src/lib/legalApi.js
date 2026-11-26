import { apiFetch } from './api.js';

const casePath = id => `/expedientes/${encodeURIComponent(id)}`;
const documentPath = (id, documentId) => `${casePath(id)}/documents/${encodeURIComponent(documentId)}`;
function params(values) {
  return new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '' && value != null)).toString();
}
function page(value) {
  if (!value || !Array.isArray(value.content) || !Number.isFinite(value.totalElements)) throw new Error('Respuesta de lista no válida');
  return value;
}
export const legalApi = {
  cases: options => apiFetch(`/expedientes/page?${params(options)}`).then(page),
  create: body => apiFetch('/expedientes/full', { method: 'POST', body }),
  metadata: id => apiFetch(`${casePath(id)}/metadata`),
  update: (id, body) => apiFetch(`${casePath(id)}/metadata`, { method: 'PUT', body }),
  deleteCase: id => apiFetch(casePath(id), { method: 'DELETE' }),
  documents: (id, options) => apiFetch(`${casePath(id)}/documents/page?${params(options)}`).then(page),
  document: (id, documentId) => apiFetch(`${documentPath(id, documentId)}/detail`),
  text: (id, documentId, pageNumber) => apiFetch(`${documentPath(id, documentId)}/text?${params({ pageNumber })}`),
  upload: (id, file) => { const body = new FormData(); body.append('file', file); return apiFetch(`${casePath(id)}/documents`, { method: 'POST', body }); },
  deleteDocument: (id, documentId) => apiFetch(documentPath(id, documentId), { method: 'DELETE' }),
  reindex: (id, documentId) => apiFetch(`${documentPath(id, documentId)}/reindex`, { method: 'POST' }),
  query: (id, body) => apiFetch(`${casePath(id)}/query`, { method: 'POST', body }),
  permissions: id => apiFetch(`${casePath(id)}/permissions`),
  grant: (id, body) => apiFetch(`${casePath(id)}/permissions`, { method: 'POST', body }),
  revoke: (id, userId) => apiFetch(`${casePath(id)}/permissions/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  activity: (id, options) => apiFetch(`${casePath(id)}/activity/page?${params(options)}`).then(page),
  timeline: (id, options = {}) => apiFetch(`${casePath(id)}/timeline?${params(options)}`),
  observations: id => apiFetch(`${casePath(id)}/observations`).then(value => {
    if (!Array.isArray(value?.items) || !Number.isFinite(value.total)) throw new Error('Respuesta de observaciones no válida');
    return value;
  }),
  extractObservations: id => apiFetch(`${casePath(id)}/observations/extract`, { method: 'POST' }),
  reviewObservation: (id, observationId, body) => apiFetch(`${casePath(id)}/observations/${encodeURIComponent(observationId)}`, { method: 'PATCH', body }),
  extractTimeline: id => apiFetch(`${casePath(id)}/timeline/extract`, { method: 'POST' }),
  reviewTimelineEvent: (id, eventId, body) => apiFetch(`${casePath(id)}/timeline/${encodeURIComponent(eventId)}`, { method: 'PATCH', body }),
  adminDocumentIssues: () => apiFetch('/legal/admin/documents/issues'),
  firmSearch: (options = {}) => apiFetch(`/expedientes/search?${params(options)}`).then(page),
  conflicts: ({ name, excludeCaseId } = {}) => apiFetch(`/legal/conflicts?${params({ name, excludeCaseId })}`),
};

export async function queryCasePartyConflicts({ clientName, counterpartyName }, excludeCaseId) {
  const candidates = [
    ['Cliente', (clientName || '').trim()],
    ['Contraparte', (counterpartyName || '').trim()],
  ].filter(([, text]) => text.length >= 4);
  if (candidates.length === 0) return [];
  const checks = await Promise.all(candidates.map(async ([fieldLabel, query]) => {
    try {
      const response = await legalApi.conflicts({ name: query, excludeCaseId });
      if (!response || !(response.totalMatches > 0)) return null;
      return {
        fieldLabel,
        totalMatches: response.totalMatches,
        restrictedMatches: response.restrictedMatches || 0,
        matches: Array.isArray(response.matches) ? response.matches : [],
      };
    } catch {
      return null;
    }
  }));
  return checks.filter(Boolean);
}
