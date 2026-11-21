import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import { legalApi } from '../lib/legalApi.js';
import { useLegalData } from '../lib/useLegalData.js';
import { LEGAL_ACCEPT, validateLegalFile, verifyLegalFile } from '../lib/legalDocumentFiles.js';
import { DOCUMENT_STATES, LEGAL_PRIMARY, LEGAL_SECONDARY } from '../lib/legalPresentation.js';
import { LegalLoadState, LegalPagination } from './LegalWorkspacePrimitives';

export function LegalTextReader({ caseId, documentId, totalPages, initialPage = 1 }) {
  const [page, setPage] = useState(initialPage);
  const load = useCallback(() => legalApi.text(caseId, documentId, page), [caseId, documentId, page]);
  const request = useLegalData(load);
  return <section aria-label="Texto extraído" className="space-y-3">
    <p className="text-xs text-white/60">Texto extraído; el original no se conserva. En Word, las páginas son segmentos del texto y pueden diferir de la impresión.</p>
    <LegalLoadState request={request} label="Cargando texto…">{data => data.fragments.length ? <div className="space-y-4">{data.fragments.map(fragment => <article key={fragment.id} id={`fragment-${fragment.id}`} className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/85"><p className="mb-1 text-xs text-white/50">Fragmento {fragment.order + 1}</p>{fragment.text}</article>)}</div> : <p className="text-sm text-white/60">Esta página no tiene texto disponible.</p>}</LegalLoadState>
    <LegalPagination value={{ page: page - 1, totalPages, totalElements: totalPages }} onPage={value => setPage(value + 1)} label="Páginas de texto" />
  </section>;
}

function DocumentDetail({ value, documentId, canMutate, onBack, onDeleted, onChanged }) {
  const load = useCallback(() => legalApi.document(value.id, documentId), [value.id, documentId]);
  const request = useLegalData(load);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function remove() {
    setBusy(true); setError('');
    try { await legalApi.deleteDocument(value.id, documentId); onDeleted(); }
    catch { setError('No se pudo eliminar. Revisa tu acceso e intenta de nuevo.'); setBusy(false); }
  }
  async function reindex() {
    setBusy(true); setError('');
    try { await legalApi.reindex(value.id, documentId); request.reload(); onChanged(); setMessage('Índice actualizado desde el texto guardado.'); }
    catch { setError('No se pudo actualizar el índice. Revisa la política de IA y la configuración.'); }
    finally { setBusy(false); }
  }
  async function verify(event, hash) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (file.size > 64 * 1024 * 1024) { setError('La comprobación local admite archivos de hasta 64 MB.'); return; }
    setMessage('Calculando hash en tu equipo…'); setError('');
    try { setMessage(await verifyLegalFile(file, hash) ? 'El hash coincide: los bytes son idénticos al documento cargado.' : 'El hash no coincide: este archivo tiene otros bytes.'); }
    catch { setMessage(''); setError('No se pudo calcular el hash en este entorno.'); }
  }
  return <div className="space-y-5">
    <button type="button" onClick={onBack} className={LEGAL_SECONDARY}>Volver a documentos</button>
    <LegalLoadState request={request} label="Cargando ficha…">{data => <>
      <h3 className="break-all font-medium text-white">{data.metadata.originalFilename}</h3>
      <p className="text-sm text-white/60">{DOCUMENT_STATES[data.metadata.status]} · {data.metadata.totalPages} páginas o segmentos · {data.metadata.ocrApplied ? 'Se utilizó OCR' : 'Sin OCR'}</p>
      {data.reason && <p role="note" className="text-sm text-amber-400">{data.reason}</p>}
      <details className="text-xs text-white/60"><summary className="cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-white">Detalle técnico y verificación de integridad</summary><dl className="mt-3 space-y-2 break-all"><dt>SHA-256 del original</dt><dd>{data.metadata.sha256Hash}</dd><dt>Identificador</dt><dd>{data.metadata.id}</dd><dt>Modelo de indexación</dt><dd>{data.metadata.embeddingModel}</dd><dt>Temporal eliminado</dt><dd>{data.metadata.tempDeletedAt ? 'Sí' : 'Pendiente de confirmar'}</dd></dl>
        <p className="my-3">Verificación técnica de bytes; no es una firma ni acredita valor probatorio legal. El archivo elegido para comparar se lee en tu equipo y no se envía.</p>
        <label className={`${LEGAL_SECONDARY} inline-block cursor-pointer`}>Comparar con un archivo local<input type="file" className="mt-2 block max-w-full" aria-label="Archivo para comparar hash" onChange={event => verify(event, data.metadata.sha256Hash)} /></label>
      </details>
      {canMutate && <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || data.metadata.totalPages < 1} onClick={reindex} className={LEGAL_SECONDARY}>Actualizar índice desde el texto</button><button type="button" disabled={busy} className={LEGAL_SECONDARY} onClick={() => setConfirmDelete(true)}>Eliminar documento</button></div>}
      {confirmDelete && <section aria-label="Confirmar eliminación" className="space-y-3 border-t border-white/[0.06] pt-4"><p className="text-sm text-white/80">Se eliminarán el texto, los fragmentos y los vectores. Esta acción no se puede deshacer.</p><div className="flex gap-3"><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)} className={LEGAL_SECONDARY}>Cancelar</button><button type="button" disabled={busy} onClick={remove} className={LEGAL_PRIMARY}>{busy ? 'Eliminando…' : 'Confirmar eliminación'}</button></div></section>}
      {message && <p role="status" className="text-sm text-white/70">{message}</p>}{error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      {data.metadata.totalPages > 0 && <LegalTextReader key={documentId} caseId={value.id} documentId={documentId} totalPages={data.metadata.totalPages} />}
    </>}</LegalLoadState>
  </div>;
}

export function LegalDocumentsPanel({ value, role, policyAccepted }) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const input = useRef(null);
  const load = useCallback(() => legalApi.documents(value.id, { page, size: 20 }), [value.id, page]);
  const request = useLegalData(load);
  const canMutate = value.canWrite && ['ADMIN', 'ANALYST'].includes(role);
  const pending = request.data?.content.some(item => item.metadata.status === 'PROCESSING');
  useEffect(() => { if (!pending) return; const timer = setInterval(request.reload, 3000); return () => clearInterval(timer); }, [pending, request.reload]);
  async function upload(files) {
    if (busy || !canMutate || !policyAccepted) return;
    setError(''); setMessage('');
    if (files.length !== 1) { setError('Carga un documento a la vez.'); return; }
    const file = files[0], invalid = validateLegalFile(file); if (invalid) { setError(invalid); return; }
    setBusy(true);
    try { await legalApi.upload(value.id, file); request.reload(); setMessage('Documento recibido. Su procesamiento continuará en segundo plano.'); }
    catch { setError('No se pudo cargar. Revisa el formato, el tamaño permitido y la política de IA.'); request.reload(); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  if (selected) return <DocumentDetail key={selected} value={value} documentId={selected} canMutate={canMutate} onBack={() => setSelected('')} onDeleted={() => { setSelected(''); request.reload(); }} onChanged={request.reload} />;
  return <div className="space-y-4">
    {canMutate && <div onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); upload([...event.dataTransfer.files]); }} className="space-y-3 border-b border-white/[0.06] pb-5">
      <p className="text-sm text-white/70">Arrastra aquí un PDF, Word, PNG o JPEG, o elígelo desde tu equipo. Máximo 64 MB; el servidor puede aplicar un límite menor.</p>
      <p className="text-xs text-white/60">Se guardan texto, metadatos y un hash. El original se elimina tras el procesamiento.</p>
      <input ref={input} type="file" accept={LEGAL_ACCEPT} aria-label="Documento del expediente" className="sr-only" onChange={event => upload([...event.target.files])} disabled={busy || !policyAccepted} />
      <button type="button" disabled={busy || !policyAccepted} onClick={() => input.current?.click()} className={`${LEGAL_PRIMARY} inline-flex items-center gap-2`}><Upload size={14} strokeWidth={1.75} aria-hidden="true" />{busy ? 'Enviando…' : 'Cargar documento'}</button>
      {!policyAccepted && <p className="text-xs text-amber-400">Un administrador debe aceptar la política de IA antes de cargar.</p>}
    </div>}
    {message && <p role="status" className="text-sm text-white/70">{message}</p>}{error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
    <LegalLoadState request={request} label="Cargando documentos…">{data => <>
      {data.content.length === 0 ? <p className="py-5 text-sm text-white/60">Este expediente aún no tiene documentos.</p> : <ul aria-label="Documentos del expediente" className="divide-y divide-white/[0.06]">{data.content.map(item => <li key={item.metadata.id} className="py-3"><button type="button" className="flex w-full items-center gap-2 rounded-lg py-2 text-left text-sm text-white focus-visible:outline-2 focus-visible:outline-white" onClick={() => setSelected(item.metadata.id)}><FileText size={14} strokeWidth={1.75} aria-hidden="true" /><span className="break-all">{item.metadata.originalFilename}</span></button><p className="text-xs text-white/60">{DOCUMENT_STATES[item.metadata.status]}</p>{item.reason && <p className="mt-1 text-xs text-amber-400">{item.reason}</p>}</li>)}</ul>}
      <LegalPagination value={data} onPage={setPage} label="Páginas de documentos" />
    </>}</LegalLoadState>
  </div>;
}
