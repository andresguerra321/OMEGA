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
  extractTimeline: id => apiFetch(`${casePath(id)}/timeline/extract`, { method: 'POST' }),
  reviewTimelineEvent: (id, eventId, body) => apiFetch(`${casePath(id)}/timeline/${encodeURIComponent(eventId)}`, { method: 'PATCH', body }),
};
