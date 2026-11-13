import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ShieldCheck,
  Layers,
  Database,
  Fingerprint,
  ClipboardPaste,
  X,
  Plus,
} from 'lucide-react';
import { OmegaLogo } from './OmegaLogo';
import { StructuredResponse } from './StructuredResponse';
import { SourcesPanel } from './SourcesPanel';

const QUICK_BRIEFS = [
  {
    tag: 'ZERO-CLICK · IOS',
    title: 'Exploits FORCEDENTRY y BLASTPASS',
    subtitle: 'Vectores sin interacción en iMessage y adjuntos PassKit/WebP.',
    prompt:
      '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus y qué versiones de iOS afectaron?',
  },
  {
    tag: 'ACTORES · CAMPAÑAS',
    title: 'Operaciones de Predator y Candiru',
    subtitle: 'Sectores vigilados, regiones objetivo e infraestructura táctica.',
    prompt:
      '¿Qué sectores y regiones fueron objetivo en las campañas de Predator e Intellexa?',
  },
  {
    tag: 'FORENSE · MVT',
    title: 'Artefactos de infección en dispositivos',
    subtitle: 'Rastros en shutdown.log, procesos anómalos e historial Safari.',
    prompt:
      'Resume los principales artefactos forenses e indicadores de compromiso descritos en los reportes.',
  },
];

const SOURCE_FILTERS = ['Todas las fuentes', 'Citizen Lab', 'Amnesty Tech', 'Google TAG'];

const SAMPLE_IOCS = ['CVE-2021-30860', 'CVE-2021-1048', 'shorten.fi'];

const DETECT_IOC_RE =
  /(\bCVE-\d{4}-\d{4,7}\b|\b[a-f0-9]{64}\b|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ca|uk|xyz|top|info|me|co|gov|edu|online|site|fi|page)\b)/i;

export function ChatWorkspace({
  messages,
  loading,
  topK,
  onChangeTopK,
  sourceScope,
  onChangeSourceScope,
  onSendMessage,
  onRetryFailedTurn,
  activeCitation,
  onSelectCitation,
  isSourcesOpen,
  onToggleSources,
  onCloseSources,
  allConversationCitations,
  hasHistory,
  onResumeLastSession,
  textareaRef,
}) {
  const [input, setInput] = useState('');
  const [iocPopoverOpen, setIocPopoverOpen] = useState(false);
  const [iocDraft, setIocDraft] = useState('');
  const [iocFeedback, setIocFeedback] = useState('');
  const bottomRef = useRef(null);
  const iocInputRef = useRef(null);

  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  useEffect(() => {
    if (iocPopoverOpen) {
      setTimeout(() => iocInputRef.current?.focus(), 40);
    }
  }, [iocPopoverOpen]);

  const detectedIoc = useMemo(() => {
    const match = input.match(DETECT_IOC_RE);
    return match ? match[0] : null;
  }, [input]);

  function submitQuery(rawPrompt) {
    const clean = (rawPrompt ?? input).trim();
    if (!clean || loading) return;
    setIocPopoverOpen(false);
    onSendMessage(clean, sourceScope);
    if (!rawPrompt) setInput('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitQuery();
    }
  }

  function insertIocValue(rawValue) {
    const cleaned = (rawValue || '').trim();
    if (!cleaned) return;

    setInput((prev) => {
      const current = prev.trim();
      if (!current) {
        return `Analiza campañas, reportes y evidencia técnica asociada a ${cleaned}`;
      }
      if (current.toLowerCase().includes(cleaned.toLowerCase())) {
        return prev;
      }
      return `${current} ${cleaned}`;
    });
    setIocDraft('');
    setIocFeedback(`Insertado ${cleaned}`);
    setIocPopoverOpen(false);
    setTimeout(() => setIocFeedback(''), 1800);
    setTimeout(() => textareaRef?.current?.focus(), 40);
  }

  async function handlePasteClipboardIoc() {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (!clip) {
        setIocFeedback('Portapapeles vacío');
        setTimeout(() => setIocFeedback(''), 1800);
        return;
      }
      const firstLine = clip.split(/\s+/)[0].slice(0, 128);
      insertIocValue(firstLine);
    } catch {
      setIocFeedback('Pega manualmente el IOC en el campo');
      setTimeout(() => setIocFeedback(''), 2000);
      iocInputRef.current?.focus();
    }
  }

  function renderIocHelperBar() {
    if (!iocPopoverOpen) return null;
    return (
      <div className="mt-2 rounded-[6px] border border-[#232329] bg-[#0A0A0C]/95 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2 text-[11px] text-[#8E8E96]">
          <span>Insertar indicador puntual (CVE, dominio o hash SHA-256)</span>
          <button
            type="button"
            onClick={() => setIocPopoverOpen(false)}
            aria-label="Cerrar selector de IOC"
            className="text-[#8E8E96] hover:text-[#F2F2F4] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={iocInputRef}
            type="text"
            value={iocDraft}
            onChange={(e) => setIocDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                insertIocValue(iocDraft);
              }
            }}
            placeholder="Ej. CVE-2023-41064 o shorten.fi"
            className="font-tech flex-1 min-w-[190px] rounded-[4px] border border-[#232329] bg-[#141418] px-2.5 py-1 text-[12px] text-[#F2F2F4] placeholder-[#8E8E96]/70 focus:border-[#2F6FED] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => insertIocValue(iocDraft)}
            disabled={!iocDraft.trim()}
            className="rounded-[4px] bg-[#2F6FED] px-2.5 py-1 text-[11px] font-medium text-[#F2F2F4] hover:bg-[#255ED4] disabled:bg-[#1C1C22] disabled:text-[#8E8E96] transition-colors cursor-pointer"
          >
            Insertar
          </button>
          <button
            type="button"
            onClick={handlePasteClipboardIoc}
            className="inline-flex items-center gap-1 rounded-[4px] border border-[#232329] bg-[#141418] px-2.5 py-1 text-[11px] text-[#F2F2F4] hover:border-[#2F6FED]/55 transition-colors cursor-pointer"
          >
            <ClipboardPaste className="h-3 w-3 text-[#2F6FED]" />
            <span>Portapapeles</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-[#8E8E96]">
          <span>Rápidos:</span>
          {SAMPLE_IOCS.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => insertIocValue(sample)}
              className="font-tech rounded-[4px] border border-[#232329] bg-[#141418] px-2 py-0.5 text-[#7AA7FF] hover:border-[#2F6FED]/55 hover:bg-[#15223D] transition-colors cursor-pointer"
            >
              + {sample}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 flex-1 flex min-h-0 overflow-hidden">
      {/* Columna Principal del Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {messages.length === 0 ? (
          /* ============================================================
             ESTADO INICIAL: Emblema SVG + Composer + 3 Cards sin truncar
             ============================================================ */
          <main className="flex-1 overflow-y-auto flex flex-col items-center justify-between px-6 pt-5 pb-5">
            <div className="flex-1 min-h-[12px] max-h-[68px]" />

            <div className="w-full max-w-[760px] flex flex-col items-center">
              {/* Bloque de Identidad Óptica */}
              <div className="omega-fade-up flex flex-col items-center text-center mb-7">
                <OmegaLogo size={68} isThinking={loading} />

                <div className="mt-3.5 inline-flex items-center gap-2">
                  <span className="text-[12.5px] font-semibold tracking-[0.22em] text-[#F2F2F4]">
                    OMEGA
                  </span>
                  <span className="font-tech rounded-[4px] border border-[#232329] bg-[#141418] px-1.5 py-0.5 text-[10px] text-[#8E8E96]">
                    v1.0
                  </span>
                </div>

                <h1 className="mt-3.5 text-[24px] sm:text-[28px] font-normal tracking-[-0.02em] leading-[1.22] text-[#8E8E96]">
                  Investigación Defensiva CTI.
                  <span className="block font-medium text-[#F2F2F4] mt-0.5">
                    ¿Qué amenaza deseas analizar?
                  </span>
                </h1>
              </div>

              {/* Composer Central con Selector de Corpus e Inserción de IOC */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitQuery();
                }}
                style={{ animationDelay: '70ms' }}
                className="omega-fade-up omega-capsule w-full rounded-[10px] p-3.5"
              >
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Pregunta sobre campañas, CVEs, dominios o vectores de infección..."
                  className="w-full resize-none bg-transparent px-1 pt-0.5 pb-2 text-[14px] leading-relaxed text-[#F2F2F4] placeholder-[#8E8E96] focus:outline-none"
                />

                {(detectedIoc || iocFeedback) && (
                  <div className="px-1 pb-2 flex flex-wrap items-center gap-2 text-[11px]">
                    {detectedIoc && (
                      <span className="font-tech inline-flex items-center gap-1 rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-2 py-0.5 text-[#7AA7FF]">
                        <Fingerprint className="h-3 w-3 text-[#2F6FED]" />
                        IOC en consulta: {detectedIoc}
                      </span>
                    )}
                    {iocFeedback && (
                      <span className="font-tech text-[#8E8E96]">{iocFeedback}</span>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#232329]/80">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-2.5 py-1 font-medium text-[#7AA7FF]">
                      <ShieldCheck className="h-3.5 w-3.5 text-[#2F6FED]" />
                      <span>Citas obligatorias</span>
                    </span>

                    <span className="hidden sm:inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2.5 py-1 text-[#8E8E96]">
                      <Layers className="h-3 w-3" />
                      <span>Híbrido RRF</span>
                    </span>

                    <select
                      value={sourceScope}
                      onChange={(e) => onChangeSourceScope(e.target.value)}
                      aria-label="Filtrar corpus por organización"
                      className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2.5 py-1 text-[#F2F2F4] hover:border-[#2F6FED]/55 focus:border-[#2F6FED] focus:outline-none cursor-pointer transition-colors"
                    >
                      {SOURCE_FILTERS.map((src) => (
                        <option key={src} value={src} className="bg-[#141418] text-[#F2F2F4]">
                          {src}
                        </option>
                      ))}
                    </select>

                    <div className="inline-flex items-center gap-1 rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-1 hover:border-[#2F6FED]/55 transition-colors">
                      <Database className="h-3 w-3 text-[#8E8E96]" />
                      <select
                        value={topK}
                        onChange={(e) => onChangeTopK(Number(e.target.value))}
                        aria-label="Cantidad de fuentes"
                        className="font-tech bg-transparent text-[#8E8E96] focus:outline-none cursor-pointer"
                      >
                        <option value={4} className="bg-[#141418] text-[#F2F2F4]">4 fuentes</option>
                        <option value={6} className="bg-[#141418] text-[#F2F2F4]">6 fuentes</option>
                        <option value={10} className="bg-[#141418] text-[#F2F2F4]">10 fuentes</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIocPopoverOpen((v) => !v)}
                      className={`inline-flex items-center gap-1 rounded-[4px] border px-2 py-1 font-tech transition-colors cursor-pointer ${
                        iocPopoverOpen
                          ? 'border-[#2F6FED] bg-[#15223D] text-[#7AA7FF]'
                          : 'border-[#232329] bg-[#0A0A0C] text-[#8E8E96] hover:border-[#2F6FED]/55 hover:text-[#F2F2F4]'
                      }`}
                      title="Pegar o insertar un IOC/CVE puntual"
                    >
                      <Plus className="h-3 w-3 text-[#2F6FED]" />
                      <span>IOC / CVE</span>
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    title="Ejecutar consulta (Enter)"
                    aria-label="Investigar"
                    className="inline-flex items-center justify-center rounded-[5px] bg-[#2F6FED] p-2 text-[#F2F2F4] hover:bg-[#255ED4] disabled:bg-[#1C1C22] disabled:text-[#8E8E96] active:scale-[0.94] transition-all duration-150 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>

                {renderIocHelperBar()}
              </form>

              {/* 3 Tarjetas de Escenarios CTI (Sin truncamiento) */}
              <div className="w-full mt-4 grid gap-3 sm:grid-cols-3">
                {QUICK_BRIEFS.map((item, idx) => (
                  <button
                    key={item.tag}
                    type="button"
                    onClick={() => submitQuery(item.prompt)}
                    style={{ animationDelay: `${130 + idx * 45}ms` }}
                    className="omega-prompt-tile omega-fade-up group flex flex-col justify-between rounded-[8px] p-4 text-left cursor-pointer"
                  >
                    <div className="space-y-1.5">
                      <span className="font-tech block text-[10px] font-medium tracking-wider text-[#2F6FED]">
                        {item.tag}
                      </span>
                      <p className="text-[13px] font-semibold leading-snug text-[#F2F2F4] group-hover:text-white">
                        {item.title}
                      </p>
                      <p className="text-[12px] leading-relaxed text-[#8E8E96]">
                        {item.subtitle}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-[16px] max-h-[68px]" />

            <footer
              className="omega-fade-up flex flex-wrap items-center justify-center gap-5 text-[11px] text-[#8E8E96]/70 pt-3"
              style={{ animationDelay: '280ms' }}
            >
              <span>Trazabilidad RNF1 · RNF3</span>
              <span>Corpus público indexado</span>
              {hasHistory && (
                <button
                  type="button"
                  onClick={onResumeLastSession}
                  className="underline underline-offset-4 decoration-[#232329] hover:text-[#F2F2F4] transition-colors cursor-pointer"
                >
                  Retomar última sesión
                </button>
              )}
            </footer>
          </main>
        ) : (
          /* ============================================================
             ESTADO ACTIVO: Hilo de Investigación + Telemetría RRF en vivo
             ============================================================ */
          <>
            <main className="flex-1 overflow-y-auto px-6 py-6">
              <div className="mx-auto max-w-[780px] space-y-6">
                {messages.map((msg, idx) =>
                  msg.role === 'user' ? (
                    <div key={idx} className="omega-fade-up flex justify-end">
                      <div className="max-w-[84%] rounded-[8px] border border-[#232329] bg-[#141418] px-4 py-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] font-medium uppercase tracking-wider text-[#8E8E96]">
                            Consulta del analista
                          </span>
                          {msg.sourceScope && msg.sourceScope !== 'Todas las fuentes' && (
                            <span className="font-tech rounded-[4px] border border-[#2F6FED]/35 bg-[#15223D] px-1.5 py-0.5 text-[10px] text-[#7AA7FF]">
                              {msg.sourceScope}
                            </span>
                          )}
                        </div>
                        <p className="text-[14px] leading-relaxed text-[#F2F2F4] whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                  ) : msg.isError ? (
                    <div
                      key={idx}
                      className="omega-fade-up rounded-[6px] border border-red-500/30 bg-red-950/20 px-4 py-3.5 flex items-start justify-between gap-4"
                    >
                      <div className="space-y-1 text-[13px]">
                        <p className="font-medium text-red-200">
                          No se pudo completar la consulta en el motor RAG
                        </p>
                        <p className="text-[12.5px] text-red-200/75 leading-relaxed">
                          {msg.content}
                        </p>
                      </div>
                      {msg.retryQuery && (
                        <button
                          type="button"
                          onClick={() => onRetryFailedTurn(idx, msg.retryQuery, msg.sourceScope)}
                          className="shrink-0 h-7 px-3 rounded-[4px] border border-red-400/35 bg-red-500/10 text-[11.5px] font-medium text-red-200 hover:bg-red-500/20 transition-colors cursor-pointer"
                        >
                          Reintentar
                        </button>
                      )}
                    </div>
                  ) : (
                    <div key={idx} className="omega-fade-up">
                      <StructuredResponse
                        message={msg}
                        activeCitation={activeCitation}
                        onSelectCitation={onSelectCitation}
                        onToggleSources={onToggleSources}
                        isSourcesOpen={isSourcesOpen}
                      />
                    </div>
                  )
                )}

                {loading && (
                  <div className="omega-fade-up flex items-center gap-3 rounded-[6px] border border-[#232329] bg-[#141418] px-4 py-3 text-[13px] text-[#8E8E96]">
                    <OmegaLogo size={26} isThinking={true} />
                    <div>
                      <p className="font-medium text-[#F2F2F4]">
                        Ejecutando búsqueda híbrida RRF y verificando citas...
                      </p>
                      <p className="text-[11.5px] text-[#8E8E96]">
                        {sourceScope === 'Todas las fuentes'
                          ? 'Indexando fragmentos verificados en Citizen Lab, Amnesty Tech y Google TAG.'
                          : `Priorizando evidencia verificada en el corpus de ${sourceScope}.`}
                      </p>
                    </div>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </main>

            {/* Composer Fijo Inferior */}
            <div className="shrink-0 border-t border-[#232329] bg-[#0A0A0C]/95 px-6 py-3.5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitQuery();
                }}
                className="mx-auto max-w-[780px] rounded-[8px] border border-[#232329] bg-[#141418] p-2.5 focus-within:border-[#2F6FED] transition-colors"
              >
                <div className="flex items-end gap-2">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Continúa la investigación sobre esta evidencia..."
                    className="flex-1 resize-none bg-transparent px-1.5 py-1 text-[13.5px] leading-relaxed text-[#F2F2F4] placeholder-[#8E8E96] focus:outline-none"
                  />

                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    aria-label="Preguntar"
                    className="shrink-0 inline-flex items-center justify-center rounded-[4px] bg-[#2F6FED] p-2 text-[#F2F2F4] hover:bg-[#255ED4] disabled:bg-[#1C1C22] disabled:text-[#8E8E96] transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-2 pt-2 border-t border-[#232329]/75 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8E8E96]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={sourceScope}
                      onChange={(e) => onChangeSourceScope(e.target.value)}
                      aria-label="Filtrar corpus por organización"
                      className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-0.5 text-[#F2F2F4] focus:border-[#2F6FED] focus:outline-none cursor-pointer"
                    >
                      {SOURCE_FILTERS.map((src) => (
                        <option key={src} value={src} className="bg-[#141418] text-[#F2F2F4]">
                          {src}
                        </option>
                      ))}
                    </select>

                    <select
                      value={topK}
                      onChange={(e) => onChangeTopK(Number(e.target.value))}
                      aria-label="Cantidad de fuentes"
                      className="font-tech rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-0.5 text-[#8E8E96] focus:border-[#2F6FED] focus:outline-none cursor-pointer"
                    >
                      <option value={4} className="bg-[#141418] text-[#F2F2F4]">4 fuentes</option>
                      <option value={6} className="bg-[#141418] text-[#F2F2F4]">6 fuentes</option>
                      <option value={10} className="bg-[#141418] text-[#F2F2F4]">10 fuentes</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => setIocPopoverOpen((v) => !v)}
                      className={`inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 font-tech transition-colors cursor-pointer ${
                        iocPopoverOpen
                          ? 'border-[#2F6FED] bg-[#15223D] text-[#7AA7FF]'
                          : 'border-[#232329] bg-[#0A0A0C] text-[#8E8E96] hover:border-[#2F6FED]/55 hover:text-[#F2F2F4]'
                      }`}
                    >
                      <Plus className="h-3 w-3 text-[#2F6FED]" />
                      <span>IOC / CVE</span>
                    </button>

                    {detectedIoc && (
                      <span className="font-tech text-[10.5px] text-[#7AA7FF]">
                        IOC: {detectedIoc}
                      </span>
                    )}
                  </div>

                  <span className="hidden sm:inline text-[#8E8E96]/70">
                    Enter para enviar · Shift+Enter nueva línea
                  </span>
                </div>

                {renderIocHelperBar()}
              </form>
            </div>
          </>
        )}
      </div>

      {/* Panel Dividido Derecho: Inspector de Evidencia (Split-Pane RNF2) */}
      {isSourcesOpen && (
        <SourcesPanel
          citations={allConversationCitations}
          selectedCitation={activeCitation}
          onSelectCitation={onSelectCitation}
          onClose={onCloseSources}
        />
      )}
    </div>
  );
}

