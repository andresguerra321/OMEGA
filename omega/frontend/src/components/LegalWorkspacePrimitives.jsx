import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PanelErrorBanner } from './PanelStatePrimitives';

export const LEGAL_INPUT = 'w-full rounded-lg border border-white/[0.05] bg-[#141923]/75 px-3 py-2 text-sm text-white focus-visible:outline-2 focus-visible:outline-[#2F6FED]';
export const LEGAL_SECONDARY = 'rounded-lg border border-white/[0.07] px-3 py-2 text-sm text-white/80 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
export const LEGAL_PRIMARY = 'rounded-lg bg-[#2F6FED] px-4 py-2 text-sm font-medium text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
export const CASE_STATES = { OPEN: 'Abierto', CLOSED: 'Cerrado', ARCHIVED: 'Archivado' };
export const CASE_CLASSES = { PUBLIC: 'Público', INTERNAL: 'Interno', CONFIDENTIAL: 'Confidencial', RESTRICTED: 'Restringido' };
export const DOCUMENT_STATES = { PROCESSING: 'En proceso', INDEXED: 'Listo', FAILED: 'No se pudo procesar', REJECTED: 'Rechazado', REINDEX_REQUIRED: 'Actualizar índice' };

export function LegalLoadState({ request, children, label = 'Cargando…' }) {
  if (request.loading) return <p role="status" aria-busy="true" className="py-6 text-sm text-white/60">{label}</p>;
  if (request.error) return <PanelErrorBanner message={request.error} onRetry={request.reload} />;
  return children(request.data);
}
export function LegalPagination({ value, onPage, label = 'Paginación' }) {
  return <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs text-white/60">
    <span>{value.totalElements} resultados · Página {value.page + 1} de {Math.max(1, value.totalPages)}</span>
    <div className="flex gap-2">
      <button type="button" className={LEGAL_SECONDARY} disabled={value.page <= 0} onClick={() => onPage(value.page - 1)} aria-label="Página anterior"><ChevronLeft size={14} strokeWidth={1.75} /></button>
      <button type="button" className={LEGAL_SECONDARY} disabled={value.page + 1 >= value.totalPages} onClick={() => onPage(value.page + 1)} aria-label="Página siguiente"><ChevronRight size={14} strokeWidth={1.75} /></button>
    </div>
  </nav>;
}
