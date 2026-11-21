import { useCallback, useState } from 'react';
import { legalApi } from '../lib/legalApi.js';
import { useLegalData } from '../lib/useLegalData.js';
import { DOCUMENT_STATES, LEGAL_PRIMARY, LegalLoadState, LegalPagination } from './LegalWorkspacePrimitives';

export function LegalDocumentsPreview({ value }) {
  const [page, setPage] = useState(0);
  const load = useCallback(() => legalApi.documents(value.id, { page, size: 20 }), [value.id, page]);
  const request = useLegalData(load);
  return <LegalLoadState request={request} label="Cargando documentos…">{data => <>
    {data.content.length === 0 ? <p className="py-5 text-sm text-white/60">Este expediente aún no tiene documentos. Revisa la política de IA antes de cargar el primero.</p> : <ul className="divide-y divide-white/[0.06]">{data.content.map(item => <li key={item.metadata.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
      <span className="break-all text-white">{item.metadata.originalFilename}</span><span className="text-white/60">{DOCUMENT_STATES[item.metadata.status] || 'Estado pendiente'}</span>
      {item.reason && <p className="w-full text-xs text-amber-400">{item.reason}</p>}
    </li>)}</ul>}
    <LegalPagination value={data} onPage={setPage} label="Páginas de documentos" />
  </>}</LegalLoadState>;
}

export function LegalAccessPreview({ value }) {
  const load = useCallback(() => value.canManagePermissions ? legalApi.permissions(value.id) : Promise.resolve([]), [value.id, value.canManagePermissions]);
  const request = useLegalData(load);
  if (!value.canManagePermissions) return <p className="py-4 text-sm text-white/60">El propietario y los administradores gestionan quién puede acceder a este expediente.</p>;
  return <LegalLoadState request={request} label="Cargando acceso…">{data => data.length === 0 ? <p className="py-4 text-sm text-white/60">No hay permisos adicionales. El propietario y los administradores conservan acceso.</p> : <ul className="divide-y divide-white/[0.06]">{data.map(item => <li key={item.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span className="break-all text-white/70">Miembro {item.userId}</span><span className="text-white">{item.permission === 'WRITE' ? 'Puede editar' : 'Solo lectura'}</span></li>)}</ul>}</LegalLoadState>;
}

export const LEGAL_ACTIONS = { EXPEDIENTE_CREATED: 'Expediente creado', EXPEDIENTE_UPDATED: 'Expediente actualizado', DOCUMENT_INGEST_QUEUED: 'Documento recibido', DOCUMENT_INDEXED_AND_PURGED: 'Documento indexado y temporal eliminado', DOCUMENT_INGEST_FAILED_AND_PURGED: 'Procesamiento finalizado con error', DOCUMENT_REJECTED_UNSAFE_PDF: 'Documento rechazado', DOCUMENT_VIEWED: 'Ficha de documento consultada', DOCUMENT_TEXT_VIEWED: 'Texto consultado', DOCUMENT_DELETED: 'Documento eliminado', DOCUMENT_REINDEXED: 'Índice actualizado', EXPEDIENTE_PERMISSION_GRANTED: 'Acceso concedido o actualizado', EXPEDIENTE_PERMISSION_REVOKED: 'Acceso revocado', RAG_QUERY_EXECUTED: 'Consulta del asistente', RAG_QUERY_BLOCKED: 'Consulta sin documentos listos', EXPORT_FORENSIC_DOSSIER: 'Dossier exportado', EXPEDIENTE_VIEWED: 'Expediente consultado' };

export function LegalActivityPreview({ value, currentUserId }) {
  const [page, setPage] = useState(0);
  const load = useCallback(() => legalApi.activity(value.id, { page, size: 20 }), [value.id, page]);
  const request = useLegalData(load);
  return <LegalLoadState request={request} label="Cargando actividad…">{data => <>
    {data.content.length === 0 ? <p className="py-4 text-sm text-white/60">Aún no hay actividad registrada para este expediente.</p> : <ol className="divide-y divide-white/[0.06]">{data.content.map(item => <li key={item.id} className="space-y-2 py-4 text-sm">
      <p className="text-white">{LEGAL_ACTIONS[item.action] || 'Actividad registrada'}</p>
      <p className="text-xs text-white/60">{item.actorUserId === currentUserId ? 'Tú' : 'Miembro del despacho'} · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('es-CO')}</time></p>
      <details className="text-xs text-white/50"><summary className="cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-white">Detalle técnico</summary><dl className="mt-2 space-y-1 break-all"><dt>Registro</dt><dd>{item.id}</dd><dt>Usuario</dt><dd>{item.actorUserId || 'Sistema'}</dd><dt>Hash del registro</dt><dd>{item.hash}</dd><dt>Acción</dt><dd>{item.action}</dd></dl></details>
    </li>)}</ol>}
    <LegalPagination value={data} onPage={setPage} label="Páginas de actividad" />
  </>}</LegalLoadState>;
}

export function LegalAssistantPreview({ value, onOpenAssistant }) {
  return <div className="space-y-4 py-4"><p className="text-sm text-white/70">Consulta únicamente los documentos de este expediente. Cada respuesta debe incluir sus fuentes o indicar que no hay sustento suficiente.</p><p className="text-xs text-white/60">No es asesoría legal.</p>{onOpenAssistant && <button type="button" className={LEGAL_PRIMARY} onClick={() => onOpenAssistant(value.id)}>Consultar este expediente</button>}</div>;
}
