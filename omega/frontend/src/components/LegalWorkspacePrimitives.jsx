import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PanelErrorBanner } from './PanelStatePrimitives';
import { LEGAL_SECONDARY } from '../lib/legalPresentation.js';

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
