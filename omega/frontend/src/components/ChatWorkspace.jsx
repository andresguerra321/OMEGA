import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
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
    tag: 'IOS · PEGASUS',
    title: 'CVEs zero-click FORCEDENTRY y BLASTPASS',
    prompt:
      '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus y qué versiones de iOS afectaron?',
  },
  {
    tag: 'PREDATOR · CANDIRU',
    title: 'Campañas, sectores objetivo e infraestructura C2',
    prompt:
      '¿Qué sectores y regiones fueron objetivo en las campañas de Predator e Intellexa?',
  },
  {
    tag: 'FORENSE · MVT',
    title: 'Artefactos de infección en backups iOS',
    prompt:
      'Resume los principales artefactos forenses e indicadores de compromiso descritos en los reportes.',
  },
];

const SOURCE_OPTIONS = [
  { value: 'Todas las fuentes', label: 'Todas' },
  { value: 'Citizen Lab', label: 'Citizen Lab' },
  { value: 'Amnesty Tech', label: 'Amnesty' },
  { value: 'Google TAG', label: 'Google TAG' },
];

const SAMPLE_IOCS = ['CVE-2021-30860', 'CVE-2023-41064', 'shorten.fi'];

const DETECT_IOC_RE =
  /(\bCVE-\d{4}-\d{4,7}\b|\b[a-f0-9]{64}\b|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ca|uk|xyz|top|info|me|co|gov|edu|online|site|fi|page)\b)/i;

function SourceScopePills({ value, onChange, compact = false }) {
  return (
    <div
      role="group"
      aria-label="Filtrar fuentes"
      className="inline-flex flex-wrap items-center gap-0.5 rounded-[5px] border border-[#232329] bg-[#0A0A0C] p-0.5"
    >
      {SOURCE_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-[4px] font-medium transition-colors cursor-pointer ${
              compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[11.5px]'
            } ${
              active
                ? 'bg-[#15223D] text-[#7AA7FF]'
                : 'text-[#8E8E96] hover:text-[#F2F2F4]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function ChatWorkspace({
  messages,
  loading,
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
        return `¿Qué reportes y campañas se asocian a ${cleaned}?`;
      }
      if (current.toLowerCase().includes(cleaned.toLowerCase())) {
        return prev;
      }
      return `${current} ${cleaned}`;
    });
    setIocDraft('');
    setIocFeedback(`+ ${cleaned}`);
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
      const firstToken = clip.split(/\s+/)[0].slice(0, 128);
      insertIocValue(firstToken);
    } catch {
      setIocFeedback('Pega el IOC abajo');
      setTimeout(() => setIocFeedback(''), 1800);
      iocInputRef.current?.focus();
    }
  }

  function renderIocHelperBar() {
    if (!iocPopoverOpen) return null;
    return (
      <div className="mt-2 rounded-[6px] border border-[#232329] bg-[#0A0A0C]/95 p-2.5 space-y-2">
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
            placeholder="CVE-2023-41064, dominio o hash..."
            className="font-tech flex-1 min-w-[180px] rounded-[4px] border border-[#232329] bg-[#141418] px-2.5 py-1 text-[12px] text-[#F2F2F4] placeholder-[#8E8E96]/70 focus:border-[#2F6FED] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => insertIocValue(iocDraft)}
            disabled={!iocDraft.trim()}
            className="rounded-[4px] bg-[#2F6FED] px-2.5 py-1 text-[11px] font-medium text-[#F2F2F4] hover:bg-[#255ED4] disabled:bg-[#1C1C22] disabled:text-[#8E8E96] transition-colors cursor-pointer"
          >
            Usar
          </button>
          <button
            type="button"
            onClick={handlePasteClipboardIoc}
            title="Pegar desde el portapapeles"
            className="inline-flex items-center gap-1 rounded-[4px] border border-[#232329] bg-[#141418] px-2 py-1 text-[11px] text-[#F2F2F4] hover:border-[#2F6FED]/55 transition-colors cursor-pointer"
          >
            <ClipboardPaste className="h-3 w-3 text-[#2F6FED]" />
            <span>Pegar</span>
          </button>
          <button
            type="button"
            onClick={() => setIocPopoverOpen(false)}
            aria-label="Cerrar"
            className="p-1 text-[#8E8E96] hover:text-[#F2F2F4] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
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
             ESTADO INICIAL: Directo al punto — Emblema, pregunta y 3 accesos
             ============================================================ */
          <main className="flex-1 overflow-y-auto flex flex-col items-center justify-between px-6 pt-4 pb-5">
            <div className="flex-1 min-h-[16px] max-h-[84px]" />

            <div className="w-full max-w-[700px] flex flex-col items-center">
              {/* Emblema + Una sola pregunta directa */}
              <div className="omega-fade-up flex flex-col items-center text-center mb-6">
                <OmegaLogo size={64} isThinking={loading} />
                <span className="mt-3 text-[11px] font-medium tracking-[0.22em] text-[#8E8E96]">
                  OMEGA · v1.0
                </span>
                <h1 className="mt-2 text-[25px] sm:text-[29px] font-medium tracking-[-0.025em] leading-[1.2] text-[#F2F2F4]">
                  ¿Qué amenaza analizamos?
                </h1>
              </div>

              {/* Composer Central Limpio */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitQuery();
                }}
                style={{ animationDelay: '60ms' }}
                className="omega-fade-up omega-capsule w-full rounded-[10px] p-3.5"
              >
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Pregunta por Pegasus, un CVE, dominio o artefacto forense..."
                  className="w-full resize-none bg-transparent px-1 pt-0.5 pb-2 text-[14px] leading-relaxed text-[#F2F2F4] placeholder-[#8E8E96] focus:outline-none"
                />

                {(detectedIoc || iocFeedback) && (
                  <div className="px-1 pb-2 flex flex-wrap items-center gap-2 text-[11px]">
                    {detectedIoc && (
                      <span className="font-tech inline-flex items-center gap-1 rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-2 py-0.5 text-[#7AA7FF]">
                        <Fingerprint className="h-3 w-3 text-[#2F6FED]" />
                        {detectedIoc}
                      </span>
                    )}
                    {iocFeedback && (
                      <span className="font-tech text-[#8E8E96]">{iocFeedback}</span>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[#232329]/80">
                  <SourceScopePills value={sourceScope} onChange={onChangeSourceScope} />

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setIocPopoverOpen((v) => !v)}
                      title="Pegar o insertar un CVE, dominio o hash"
                      className={`inline-flex items-center gap-1 rounded-[5px] border px-2.5 py-1.5 font-tech text-[11px] transition-colors cursor-pointer ${
                        iocPopoverOpen
                          ? 'border-[#2F6FED] bg-[#15223D] text-[#7AA7FF]'
                          : 'border-[#232329] bg-[#0A0A0C] text-[#8E8E96] hover:border-[#2F6FED]/55 hover:text-[#F2F2F4]'
                      }`}
                    >
                      <Plus className="h-3 w-3 text-[#2F6FED]" />
                      <span>IOC</span>
                    </button>

                    <button
                      type="submit"
                      disabled={loading || !input.trim()}
                      title="Analizar (Enter)"
                      aria-label="Analizar"
                      className="inline-flex items-center justify-center rounded-[5px] bg-[#2F6FED] p-2 text-[#F2F2F4] hover:bg-[#255ED4] disabled:bg-[#1C1C22] disabled:text-[#8E8E96] active:scale-[0.94] transition-all duration-150 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {renderIocHelperBar()}
              </form>

              {/* 3 Accesos Directos Compactos (1 clic y al grano) */}
              <div className="w-full mt-3.5 grid gap-2.5 sm:grid-cols-3">
                {QUICK_BRIEFS.map((item, idx) => (
                  <button
                    key={item.tag}
                    type="button"
                    onClick={() => submitQuery(item.prompt)}
                    style={{ animationDelay: `${110 + idx * 40}ms` }}
                    className="omega-prompt-tile omega-fade-up group flex flex-col justify-between rounded-[8px] px-3.5 py-3 text-left cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-tech text-[10px] font-medium tracking-wider text-[#2F6FED]">
                        {item.tag}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-[#8E8E96]/50 group-hover:text-[#F2F2F4] group-hover:translate-x-0.5 transition-all" />
                    </div>
                    <p className="mt-1.5 text-[12.5px] font-medium leading-snug text-[#F2F2F4]/90 group-hover:text-white">
                      {item.title}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-[16px] max-h-[84px]" />

            <footer className="h-6 flex items-center justify-center text-[11px] text-[#8E8E96]/70">
              {hasHistory && (
                <button
                  type="button"
                  onClick={onResumeLastSession}
                  className="hover:text-[#F2F2F4] transition-colors cursor-pointer"
                >
                  Retomar última sesión →
                </button>
              )}
            </footer>
          </main>
        ) : (
          /* ============================================================
             ESTADO ACTIVO: Hilo directo de conversación + fuentes
             ============================================================ */
          <>
            <main className="flex-1 overflow-y-auto px-6 py-6">
              <div className="mx-auto max-w-[760px] space-y-6">
                {messages.map((msg, idx) =>
                  msg.role === 'user' ? (
                    <div key={idx} className="omega-fade-up flex justify-end">
                      <div className="max-w-[82%] rounded-[8px] border border-[#232329] bg-[#141418] px-4 py-2.5 space-y-1">
                        {msg.sourceScope && msg.sourceScope !== 'Todas las fuentes' && (
                          <span className="font-tech inline-block rounded-[4px] border border-[#2F6FED]/35 bg-[#15223D] px-1.5 py-0.5 text-[10px] text-[#7AA7FF]">
                            {msg.sourceScope}
                          </span>
                        )}
                        <p className="text-[14px] leading-relaxed text-[#F2F2F4] whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                  ) : msg.isError ? (
                    <div
                      key={idx}
                      className="omega-fade-up rounded-[6px] border border-red-500/30 bg-red-950/20 px-4 py-3 flex items-center justify-between gap-4"
                    >
                      <div className="space-y-0.5 text-[13px]">
                        <p className="font-medium text-red-200">Error al consultar el motor</p>
                        <p className="text-[12px] text-red-200/75">{msg.content}</p>
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
                  <div className="omega-fade-up flex items-center gap-3 rounded-[6px] border border-[#232329] bg-[#141418] px-3.5 py-2.5 text-[13px] text-[#F2F2F4]">
                    <OmegaLogo size={24} isThinking={true} />
                    <span>
                      {sourceScope === 'Todas las fuentes'
                        ? 'Buscando en reportes...'
                        : `Buscando en ${sourceScope}...`}
                    </span>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </main>

            {/* Composer Inferior Limpio */}
            <div className="shrink-0 border-t border-[#232329] bg-[#0A0A0C]/95 px-6 py-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitQuery();
                }}
                className="mx-auto max-w-[760px] rounded-[8px] border border-[#232329] bg-[#141418] p-2.5 focus-within:border-[#2F6FED] transition-colors"
              >
                <div className="flex items-end gap-2">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Haz una pregunta de seguimiento..."
                    className="flex-1 resize-none bg-transparent px-1.5 py-1 text-[13.5px] leading-relaxed text-[#F2F2F4] placeholder-[#8E8E96] focus:outline-none"
                  />

                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    aria-label="Enviar"
                    className="shrink-0 inline-flex items-center justify-center rounded-[5px] bg-[#2F6FED] p-2 text-[#F2F2F4] hover:bg-[#255ED4] disabled:bg-[#1C1C22] disabled:text-[#8E8E96] transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-2 pt-2 border-t border-[#232329]/75 flex flex-wrap items-center justify-between gap-2">
                  <SourceScopePills value={sourceScope} onChange={onChangeSourceScope} compact />

                  <div className="flex items-center gap-2">
                    {detectedIoc && (
                      <span className="font-tech text-[10.5px] text-[#7AA7FF]">
                        {detectedIoc}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setIocPopoverOpen((v) => !v)}
                      title="Pegar o insertar un CVE, dominio o hash"
                      className={`inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 font-tech text-[11px] transition-colors cursor-pointer ${
                        iocPopoverOpen
                          ? 'border-[#2F6FED] bg-[#15223D] text-[#7AA7FF]'
                          : 'border-[#232329] bg-[#0A0A0C] text-[#8E8E96] hover:border-[#2F6FED]/55 hover:text-[#F2F2F4]'
                      }`}
                    >
                      <Plus className="h-3 w-3 text-[#2F6FED]" />
                      <span>IOC</span>
                    </button>
                  </div>
                </div>

                {renderIocHelperBar()}
              </form>
            </div>
          </>
        )}
      </div>

      {/* Panel Derecho de Evidencia */}
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
