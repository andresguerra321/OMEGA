import { useCallback, useState } from 'react';
import { legalApi } from '../lib/legalApi.js';
import { useLegalData } from '../lib/useLegalData.js';
import { LEGAL_INPUT, LEGAL_PRIMARY, LEGAL_SECONDARY } from '../lib/legalPresentation.js';
import { LegalLoadState } from './LegalWorkspacePrimitives';
import { LegalTextReader } from './LegalDocumentsPanel';

const labels = { PENDING_REVIEW: 'Pendiente de revisión', CONFIRMED: 'Pasaje confirmado', REJECTED: 'Descartado' };
export function LegalObservationsTab({ value, policyAccepted }) {
  const load = useCallback(() => legalApi.observations(value.id), [value.id]);
  const request = useLegalData(load);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState('');
  const [viewer, setViewer] = useState(null);
  async function run(work) {
    if (busy) return; setBusy(true); setError('');
    try { await work(); request.reload(); } catch (err) { setError(err.message || 'No se pudo guardar la revisión.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-2xl text-sm text-white/65">Revisa menciones de obligaciones y valores con su fuente. Confirmar un pasaje registra tu revisión; no determina por sí solo una obligación exigible ni un importe adeudado.</p>
      {value.canWrite && <button type="button" disabled={busy || !policyAccepted} className={LEGAL_PRIMARY} onClick={() => run(async () => {
        const result = await legalApi.extractObservations(value.id);
        setNotice(`${result.created} pasajes nuevos; ${result.candidatesFound} candidatos en ${result.chunksReviewed} fragmentos.${result.truncated ? ' Se incluyeron hasta 200 pasajes: revise la cobertura.' : ''}`);
      })}>{busy ? 'Procesando…' : 'Identificar pasajes'}</button>}
    </div>
    <p className="text-xs text-white/50">La búsqueda es literal, utiliza texto ya indexado y no consume créditos adicionales. La cita original se conserva al revisar. Genera una nueva versión del informe para incluir las revisiones actuales en PDF y JSON.</p>
    {notice && <p role="status" className="text-xs text-emerald-400">{notice}</p>}
    {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
    <div className={viewer ? 'grid gap-6 lg:grid-cols-2' : ''}>
      <LegalLoadState request={request} label="Cargando pasajes…">{data => <div className="divide-y divide-white/[0.06]">
        {!data.items.length && <p className="py-5 text-sm text-white/50">Todavía no hay pasajes identificados. Indexa documentos y utiliza «Identificar pasajes».</p>}
        {data.items.map(item => <article key={item.id} className="space-y-3 py-5">
          <div className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-medium text-white/85">{item.category === 'POSIBLE_OBLIGACION' ? 'Posible obligación' : 'Mención monetaria'}</span><span className={item.review_status === 'PENDING_REVIEW' ? 'text-amber-400' : 'text-white/55'}>{labels[item.review_status]}</span></div>
          <blockquote className="whitespace-pre-wrap border-l-2 border-white/[0.08] pl-3 text-sm leading-relaxed text-white/80">{item.excerpt}</blockquote>
          <button type="button" className={`${LEGAL_SECONDARY} text-xs`} onClick={async () => {
            try { const document = await legalApi.document(value.id, item.document_id); setViewer({ ...item, totalPages: document.metadata.totalPages }); }
            catch (err) { setError(err.message || 'No se pudo abrir la fuente.'); }
          }}>Ver documento · página {item.page_number}</button>
          <p className="break-all text-[11px] text-white/40">Documento: {item.document_id} · Fragmento: {item.chunk_id}</p>
          {item.review_note && <div className="space-y-1 text-xs text-white/65"><p>Criterio registrado: {item.review_note}</p><p className="text-white/45">Revisado por {item.reviewed_by} · {new Date(item.reviewed_at).toLocaleString('es-CO')}</p></div>}
          {value.canWrite && <button type="button" className={LEGAL_SECONDARY} disabled={busy} onClick={() => { setEditing(item.id); setNote(item.review_note || ''); }}>Revisar pasaje</button>}
          {editing === item.id && <div className="space-y-3">
            <label className="block space-y-2 text-xs text-white/65"><span>Criterio de revisión</span><textarea className={`${LEGAL_INPUT} min-h-24 w-full`} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
            <div className="flex flex-wrap gap-2">{[['CONFIRMED', 'Confirmar pasaje'], ['REJECTED', 'Descartar'], ['PENDING_REVIEW', 'Dejar pendiente']].map(([status, label]) => <button key={status} type="button" disabled={busy || (status !== 'PENDING_REVIEW' && !note.trim())} className={LEGAL_SECONDARY}
              onClick={() => run(async () => { await legalApi.reviewObservation(value.id, item.id, { status, note, revision: item.revision }); setEditing(null); })}>{label}</button>)}
              <button type="button" className={LEGAL_SECONDARY} onClick={() => setEditing(null)}>Cancelar</button>
            </div>
          </div>}
        </article>)}
        {data.total > data.items.length && <p className="text-xs text-amber-400">Se muestran {data.items.length} de {data.total} observaciones guardadas.</p>}
      </div>}</LegalLoadState>
      {viewer && <aside className="space-y-3"><div className="flex justify-between text-sm text-white/70"><span>Fuente · página {viewer.page_number}</span><button type="button" className={LEGAL_SECONDARY} onClick={() => setViewer(null)}>Cerrar fuente</button></div>
        <LegalTextReader key={`${viewer.document_id}:${viewer.page_number}`} caseId={value.id} documentId={viewer.document_id} totalPages={viewer.totalPages} initialPage={viewer.page_number} />
      </aside>}
    </div>
  </div>;
}
