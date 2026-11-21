import { useCallback, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  FileText,
  MessageSquare,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { legalApi } from '../lib/legalApi.js';
import { useLegalData } from '../lib/useLegalData.js';
import { LEGAL_INPUT, LEGAL_PRIMARY, LEGAL_SECONDARY } from '../lib/legalPresentation.js';
import { LegalTextReader } from './LegalDocumentsPanel';

const QUICK_ACTIONS = [
  {
    id: 'summary',
    label: 'Resumen del expediente',
    prompt: 'Elabora un resumen objetivo de los hechos y cláusulas principales que constan en este expediente, citando documento y página en cada punto.',
  },
  {
    id: 'entities',
    label: 'Partes, fechas y montos',
    prompt: 'Enumera las partes involucradas, las fechas relevantes y los montos o valores mencionados en los documentos de este expediente, citando documento y página.',
  },
  {
    id: 'obligations',
    label: 'Obligaciones y plazos citados',
    prompt: 'Identifica las obligaciones, condiciones y plazos explícitamente escritos en los documentos de este expediente, citando documento y página.',
  },
];

export function LegalCaseAssistantTab({ value, policyAccepted }) {
  const [question, setQuestion] = useState('');
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [turns, setTurns] = useState([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [viewerTarget, setViewerTarget] = useState(null);

  const loadDocs = useCallback(() => legalApi.documents(value.id, { page: 0, size: 100 }), [value.id]);
  const docsRequest = useLegalData(loadDocs);
  const indexedDocs = (docsRequest.data?.content || []).filter((item) => item.metadata?.status === 'INDEXED');

  function toggleDocument(docId) {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  }

  async function submitQuestion(rawQuestion) {
    const q = String(rawQuestion ?? question).trim();
    if (!q || asking || !policyAccepted) return;
    setAsking(true);
    setError('');
    try {
      const payload = {
        question: q,
        topK: 6,
        ...(selectedDocIds.length > 0 ? { documentIds: selectedDocIds } : {}),
      };
      const res = await legalApi.query(value.id, payload);
      setTurns((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${prev.length}`,
          question: q,
          scopeCount: selectedDocIds.length,
          response: res,
        },
      ]);
      setQuestion('');
    } catch (err) {
      setError(err?.message || 'No se pudo consultar este expediente. Verifica la política de IA y los documentos indexados.');
    } finally {
      setAsking(false);
    }
  }

  function openCitationViewer(citation) {
    const matchedDoc = indexedDocs.find((d) => d.metadata?.id === citation.documentId);
    const totalPages = Math.max(citation.pageNumber || 1, matchedDoc?.metadata?.totalPages || 1);
    setViewerTarget({
      documentId: citation.documentId,
      label: citation.citationLabel || `Documento ${citation.documentId}`,
      pageNumber: citation.pageNumber || 1,
      totalPages,
    });
  }

  return (
    <div className="space-y-4">
      {/* Aviso permanente de no-asesoría y política efímera */}
      <div
        role="note"
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-[#141923]/70 px-4 py-2.5 text-xs text-white/70"
      >
        <span>
          <strong className="text-white">No es asesoría legal.</strong> Consulta únicamente los documentos de este expediente con citas obligatorias. Esta sesión no se guarda al salir.
        </span>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setTurns([]);
              setViewerTarget(null);
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] px-2.5 py-1 text-[11px] text-white/70 hover:text-white cursor-pointer"
          >
            <Trash2 size={12} strokeWidth={1.75} aria-hidden="true" />
            <span>Limpiar sesión</span>
          </button>
        )}
      </div>

      {!policyAccepted && (
        <p role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs text-amber-300">
          Un administrador debe aceptar la política de IA documental antes de realizar consultas sobre este expediente.
        </p>
      )}

      {/* Selector opcional de documentos del expediente */}
      {indexedDocs.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/60">
            <span>
              Alcance de la consulta:{' '}
              <strong className="text-white">
                {selectedDocIds.length === 0
                  ? `Todos los documentos indexados (${indexedDocs.length})`
                  : `${selectedDocIds.length} documento(s) seleccionado(s)`}
              </strong>
            </span>
            {selectedDocIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedDocIds([])}
                className="text-[#60A5FA] hover:underline cursor-pointer"
              >
                Usar todo el expediente
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Acotar consulta a documentos específicos">
            {indexedDocs.map((item) => {
              const id = item.metadata.id;
              const selected = selectedDocIds.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleDocument(id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors cursor-pointer ${
                    selected
                      ? 'border-[#2F6FED] bg-[#2F6FED]/20 text-white'
                      : 'border-white/[0.08] bg-[#141923]/60 text-white/65 hover:text-white'
                  }`}
                >
                  <FileText size={12} strokeWidth={1.75} aria-hidden="true" />
                  <span className="max-w-[200px] truncate">{item.metadata.originalFilename}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Acciones rápidas grounded */}
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={asking || !policyAccepted || indexedDocs.length === 0}
            onClick={() => void submitQuestion(action.prompt)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-[#141923]/75 hover:border-[#2F6FED]/60 px-3 py-1.5 text-xs text-white/80 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
          >
            <Sparkles size={12} strokeWidth={1.75} className="text-[#2F6FED]" aria-hidden="true" />
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      {/* Formulario de pregunta */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitQuestion(question);
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={asking || !policyAccepted}
          placeholder={
            indexedDocs.length === 0
              ? 'Carga e indexa al menos un documento en este expediente para consultar…'
              : 'Escribe tu consulta sobre este expediente (ej. cláusula de vigencia, montos, partes)…'
          }
          aria-label="Consulta al asistente del expediente"
          className={`${LEGAL_INPUT} flex-1`}
        />
        <button
          type="submit"
          disabled={asking || !policyAccepted || !question.trim()}
          className={`${LEGAL_PRIMARY} inline-flex items-center justify-center gap-2 shrink-0`}
        >
          <Send size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>{asking ? 'Consultando…' : 'Consultar'}</span>
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
          {error}
        </p>
      )}

      {/* Área principal: conversación efímera + visor lateral de citas */}
      <div className={`grid gap-5 ${viewerTarget ? 'lg:grid-cols-12' : 'grid-cols-1'}`}>
        <div className={viewerTarget ? 'lg:col-span-7 space-y-4' : 'space-y-4'}>
          {turns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.08] bg-[#141923]/40 p-6 text-center space-y-1.5">
              <MessageSquare size={18} strokeWidth={1.75} className="mx-auto text-white/40" aria-hidden="true" />
              <p className="text-sm text-white/75">Asistente acotado al expediente</p>
              <p className="text-xs text-white/50">
                Haz una consulta o usa una acción rápida. Cada afirmación citará documento y página, o indicará abstención por falta de sustento.
              </p>
            </div>
          ) : (
            turns.map((turn) => {
              const res = turn.response || {};
              const isAbstention =
                res.status === 'INSUFFICIENT_EVIDENCE' ||
                res.status === 'NO_INDEXED_DOCUMENTS' ||
                String(res.answer || '').includes('No hay fragmentos relevantes suficientes');
              const citations = Array.isArray(res.citations) ? res.citations : [];

              return (
                <article
                  key={turn.id}
                  className="rounded-xl border border-white/[0.07] bg-[#141923]/65 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
                    <p className="text-xs font-medium text-white">{turn.question}</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                        isAbstention
                          ? 'border-amber-400/35 bg-amber-400/10 text-amber-300'
                          : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                      }`}
                    >
                      {isAbstention ? (
                        <>
                          <AlertTriangle size={12} strokeWidth={1.75} aria-hidden="true" />
                          <span>Abstención: sin sustento suficiente</span>
                        </>
                      ) : (
                        <>
                          <BookOpen size={12} strokeWidth={1.75} aria-hidden="true" />
                          <span>{citations.length} cita(s) verificada(s)</span>
                        </>
                      )}
                    </span>
                  </div>

                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">
                    {res.answer}
                  </div>

                  {citations.length > 0 && (
                    <div className="space-y-2 border-t border-white/[0.06] pt-3">
                      <p className="text-[11px] font-medium text-white/60">
                        Fuentes citadas (clic para abrir el texto extraído de la página):
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {citations.map((cit, idx) => (
                          <button
                            key={`${turn.id}-cit-${idx}`}
                            type="button"
                            onClick={() => openCitationViewer(cit)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2F6FED]/35 bg-[#2F6FED]/10 hover:bg-[#2F6FED]/20 px-2.5 py-1.5 text-xs text-[#D9E6FF] transition-colors cursor-pointer"
                          >
                            <FileText size={12} strokeWidth={1.75} aria-hidden="true" />
                            <span>
                              [{idx + 1}] {cit.citationLabel || `Pág. ${cit.pageNumber}`}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>

        {/* Visor lateral de página citada */}
        {viewerTarget && (
          <aside
            aria-label="Visor de fuente citada"
            className="lg:col-span-5 rounded-xl border border-white/[0.08] bg-[#0A0A0C]/90 p-4 space-y-3 self-start"
          >
            <div className="flex items-start justify-between gap-2 border-b border-white/[0.06] pb-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{viewerTarget.label}</p>
                <p className="text-[11px] text-white/55">
                  Página / segmento {viewerTarget.pageNumber} de {viewerTarget.totalPages}
                </p>
              </div>
              <button
                type="button"
                aria-label="Cerrar visor de fuente"
                onClick={() => setViewerTarget(null)}
                className={`${LEGAL_SECONDARY} !p-1.5`}
              >
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <LegalTextReader
              key={`${viewerTarget.documentId}:${viewerTarget.pageNumber}`}
              caseId={value.id}
              documentId={viewerTarget.documentId}
              totalPages={viewerTarget.totalPages}
              initialPage={viewerTarget.pageNumber}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
