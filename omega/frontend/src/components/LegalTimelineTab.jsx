import { useCallback, useState } from 'react';
import { Calendar, Check, EyeOff, FileText, Pencil, RefreshCw, X } from 'lucide-react';
import { legalApi } from '../lib/legalApi.js';
import { useLegalData } from '../lib/useLegalData.js';
import { LEGAL_INPUT, LEGAL_PRIMARY, LEGAL_SECONDARY } from '../lib/legalPresentation.js';
import { LegalLoadState } from './LegalWorkspacePrimitives';
import { LegalTextReader } from './LegalDocumentsPanel';

const STATUS_LABELS = {
  EXTRACTED: 'Extraído automáticamente, verifique',
  CONFIRMED: 'Confirmado',
  CORRECTED: 'Corregido',
  HIDDEN: 'Oculto',
};

const CONFIDENCE_META = {
  HIGH: {
    label: 'Confianza alta',
    cls: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  },
  MEDIUM: {
    label: 'Confianza media',
    cls: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  },
  LOW: {
    label: 'Confianza baja',
    cls: 'border-rose-400/35 bg-rose-400/10 text-rose-300',
  },
};

const STATUS_FILTERS = [
  ['', 'Activos'],
  ['EXTRACTED', 'Por verificar'],
  ['CONFIRMED', 'Confirmados'],
  ['CORRECTED', 'Corregidos'],
  ['HIDDEN', 'Ocultos'],
];

export function LegalTimelineTab({ value, role, policyAccepted }) {
  const [statusFilter, setStatusFilter] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const canExtract = value.canWrite && ['ADMIN', 'ANALYST'].includes(role);
  const load = useCallback(
    () =>
      legalApi.timeline(value.id, {
        status: statusFilter,
        includeHidden: statusFilter === 'HIDDEN',
      }),
    [value.id, statusFilter]
  );
  const request = useLegalData(load);

  async function handleExtract() {
    if (!canExtract || !policyAccepted || extracting) return;
    setExtracting(true);
    setError('');
    setNotice('');
    try {
      const res = await legalApi.extractTimeline(value.id);
      setNotice(
        res.extractedCount > 0
          ? `Se extrajeron ${res.extractedCount} evento(s) nuevo(s) con cita verificable.`
          : 'No se encontraron fechas nuevas en los documentos indexados.'
      );
      request.reload();
    } catch (err) {
      setError(err?.message || 'No se pudo extraer la cronología. Revisa la política de IA y los documentos indexados.');
    } finally {
      setExtracting(false);
    }
  }

  async function handleReview(eventId, payload) {
    setBusyId(eventId);
    setError('');
    try {
      await legalApi.reviewTimelineEvent(value.id, eventId, payload);
      setEditing(null);
      request.reload();
    } catch (err) {
      setError(err?.message || 'No se pudo actualizar el evento de cronología.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar eventos de cronología">
          {STATUS_FILTERS.map(([id, label]) => (
            <button
              key={id || 'all'}
              type="button"
              onClick={() => setStatusFilter(id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                statusFilter === id
                  ? 'bg-[#2F6FED] text-white'
                  : 'border border-white/[0.08] bg-[#141923]/70 text-white/65 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {canExtract && (
          <button
            type="button"
            disabled={extracting || !policyAccepted}
            onClick={() => void handleExtract()}
            className={`${LEGAL_PRIMARY} inline-flex items-center gap-2`}
          >
            <RefreshCw size={14} strokeWidth={1.75} className={extracting ? 'animate-spin' : ''} aria-hidden="true" />
            <span>{extracting ? 'Extrayendo fechas…' : 'Extraer cronología'}</span>
          </button>
        )}
      </div>

      <p role="note" className="text-xs text-white/55">
        Cada evento requiere documento y página de origen. Los eventos marcados como «Extraído automáticamente, verifique» deben revisarse antes de usarse.
      </p>

      {notice && <p role="status" className="text-xs text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}

      <div className={`grid gap-5 ${viewer ? 'lg:grid-cols-12' : 'grid-cols-1'}`}>
        <div className={viewer ? 'lg:col-span-7' : ''}>
          <LegalLoadState request={request} label="Cargando cronología…">
            {(events) =>
              events.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/[0.08] bg-[#141923]/40 p-6 text-center space-y-1.5">
                  <Calendar size={18} strokeWidth={1.75} className="mx-auto text-white/40" aria-hidden="true" />
                  <p className="text-sm text-white/75">Sin eventos en esta vista de cronología</p>
                  <p className="text-xs text-white/50">
                    {canExtract
                      ? 'Pulsa «Extraer cronología» para detectar fechas con cita en los documentos indexados.'
                      : 'Aún no se han extraído eventos fechados para este expediente.'}
                  </p>
                </div>
              ) : (
                <ol className="divide-y divide-white/[0.06]">
                  {events.map((ev) => {
                    const isEditing = editing?.id === ev.id;
                    const confidenceMeta = CONFIDENCE_META[ev.confidence] || CONFIDENCE_META.HIGH;
                    return (
                      <li key={ev.id} className="py-4 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-[#60A5FA]">
                              {ev.eventDate}
                            </span>
                            <span
                              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                                ev.reviewStatus === 'CONFIRMED'
                                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                                  : ev.reviewStatus === 'CORRECTED'
                                  ? 'border-[#2F6FED]/40 bg-[#2F6FED]/15 text-[#93C5FD]'
                                  : ev.reviewStatus === 'HIDDEN'
                                  ? 'border-white/[0.1] bg-white/[0.04] text-white/50'
                                  : 'border-amber-400/35 bg-amber-400/10 text-amber-300'
                              }`}
                            >
                              {STATUS_LABELS[ev.reviewStatus] || ev.reviewStatus}
                            </span>
                            <span
                              title={ev.confidenceReason || confidenceMeta.label}
                              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${confidenceMeta.cls}`}
                            >
                              {confidenceMeta.label}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setViewer({
                                documentId: ev.documentId,
                                pageNumber: ev.pageNumber,
                              })
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#141923]/75 hover:border-[#2F6FED]/60 px-2.5 py-1 text-xs text-[#D9E6FF] cursor-pointer"
                          >
                            <FileText size={12} strokeWidth={1.75} aria-hidden="true" />
                            <span>Ver cita (Pág. {ev.pageNumber})</span>
                          </button>
                        </div>

                        {isEditing ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void handleReview(ev.id, {
                                reviewStatus: 'CORRECTED',
                                eventDate: editing.eventDate,
                                summary: editing.summary,
                              });
                            }}
                            className="space-y-2 rounded-xl border border-white/[0.08] bg-[#141923]/80 p-3"
                          >
                            <div className="grid gap-2 sm:grid-cols-3">
                              <input
                                type="date"
                                value={editing.eventDate}
                                onChange={(e) => setEditing((prev) => ({ ...prev, eventDate: e.target.value }))}
                                className={LEGAL_INPUT}
                                required
                              />
                              <input
                                type="text"
                                value={editing.summary}
                                onChange={(e) => setEditing((prev) => ({ ...prev, summary: e.target.value }))}
                                maxLength={500}
                                className={`${LEGAL_INPUT} sm:col-span-2`}
                                required
                              />
                            </div>
                            <div className="flex gap-2">
                              <button type="submit" disabled={busyId === ev.id} className={LEGAL_PRIMARY}>
                                Guardar corrección
                              </button>
                              <button type="button" onClick={() => setEditing(null)} className={LEGAL_SECONDARY}>
                                Cancelar
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-sm text-white/85 leading-relaxed">{ev.summary}</p>
                            {ev.confidence && ev.confidence !== 'HIGH' && ev.confidenceReason && (
                              <p className="text-[11px] text-white/55">{ev.confidenceReason}</p>
                            )}
                          </div>
                        )}

                        {value.canWrite && !isEditing && (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {ev.reviewStatus !== 'CONFIRMED' && (
                              <button
                                type="button"
                                disabled={busyId === ev.id}
                                onClick={() => void handleReview(ev.id, { reviewStatus: 'CONFIRMED' })}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-400/20 cursor-pointer"
                              >
                                <Check size={12} strokeWidth={1.75} aria-hidden="true" />
                                <span>Confirmar</span>
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busyId === ev.id}
                              onClick={() => setEditing({ id: ev.id, eventDate: ev.eventDate, summary: ev.summary })}
                              className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#141923]/75 px-2.5 py-1 text-xs text-white/75 hover:text-white cursor-pointer"
                            >
                              <Pencil size={12} strokeWidth={1.75} aria-hidden="true" />
                              <span>Corregir</span>
                            </button>
                            {ev.reviewStatus !== 'HIDDEN' && (
                              <button
                                type="button"
                                disabled={busyId === ev.id}
                                onClick={() => void handleReview(ev.id, { reviewStatus: 'HIDDEN' })}
                                className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#141923]/75 px-2.5 py-1 text-xs text-white/60 hover:text-rose-300 cursor-pointer"
                              >
                                <EyeOff size={12} strokeWidth={1.75} aria-hidden="true" />
                                <span>Ocultar</span>
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )
            }
          </LegalLoadState>
        </div>

        {viewer && (
          <aside
            aria-label="Visor de cita de cronología"
            className="lg:col-span-5 rounded-xl border border-white/[0.08] bg-[#0A0A0C]/90 p-4 space-y-3 self-start"
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
              <div>
                <p className="text-xs font-semibold text-white">Documento {viewer.documentId}</p>
                <p className="text-[11px] text-white/55">Página / segmento {viewer.pageNumber}</p>
              </div>
              <button
                type="button"
                aria-label="Cerrar visor de cita"
                onClick={() => setViewer(null)}
                className={`${LEGAL_SECONDARY} !p-1.5`}
              >
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <LegalTextReader
              key={`${viewer.documentId}:${viewer.pageNumber}`}
              caseId={value.id}
              documentId={viewer.documentId}
              totalPages={viewer.pageNumber}
              initialPage={viewer.pageNumber}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
