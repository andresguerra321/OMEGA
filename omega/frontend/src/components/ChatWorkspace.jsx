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
    tag: 'iOS · Pegasus',
    title: 'CVEs zero-click FORCEDENTRY y BLASTPASS',
    prompt:
      '¿Qué vulnerabilidades zero-click (CVEs) se documentan para Pegasus y qué versiones de iOS afectaron?',
  },
  {
    tag: 'Predator · Candiru',
    title: 'Campañas, sectores objetivo e infraestructura C2',
    prompt:
      '¿Qué sectores y regiones fueron objetivo en las campañas de Predator e Intellexa?',
  },
  {
    tag: 'Forense · MVT',
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
      className="apple-segmented inline-flex flex-wrap items-center gap-0.5 rounded-[9px] p-0.5"
    >
      {SOURCE_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-[7px] font-medium tracking-[-0.01em] transition-[background-color,color,box-shadow] duration-200 ease-apple cursor-pointer ${
              compact ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1 text-[12px]'
            } ${
              active
                ? 'apple-segmented-active'
                : 'text-[#8E8E93] hover:text-[#F5F5F7]'
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
      <div className="apple-well mt-2.5 rounded-[11px] p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
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
            className="font-tech flex-1 min-w-[180px] rounded-[8px] border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-[12.5px] text-[#F5F5F7] placeholder-[#6E6E73] focus:border-[#2F6FED]/70 focus:outline-none transition-colors"
          />
          <button
            type="button"
            onClick={() => insertIocValue(iocDraft)}
            disabled={!iocDraft.trim()}
            className="rounded-[8px] bg-[#2F6FED] px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-[#3B7BF2] disabled:bg-white/[0.06] disabled:text-[#6E6E73] active:scale-[0.96] transition-all cursor-pointer"
          >
            Usar
          </button>
          <button
            type="button"
            onClick={handlePasteClipboardIoc}
            title="Pegar desde el portapapeles"
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-white/[0.08] bg-white/[0.045] px-2.5 py-1.5 text-[12px] text-[#E5E5EA] hover:bg-white/[0.08] active:scale-[0.96] transition-all cursor-pointer"
          >
            <ClipboardPaste className="h-3.5 w-3.5 text-[#5E9BFF]" />
            <span>Pegar</span>
          </button>
          <button
            type="button"
            onClick={() => setIocPopoverOpen(false)}
            aria-label="Cerrar"
            className="p-1.5 rounded-full text-[#8E8E93] hover:bg-white/[0.07] hover:text-[#F5F5F7] transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
          {SAMPLE_IOCS.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => insertIocValue(sample)}
              className="font-tech rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-0.5 text-[#8AB4FF] hover:border-[#2F6FED]/50 hover:bg-[#2F6FED]/15 transition-colors cursor-pointer"
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
             ESTADO INICIAL: Minimalismo Apple — Emblema, pregunta y 3 tiles
             ============================================================ */
          <main className="flex-1 overflow-y-auto flex flex-col items-center justify-between px-6 pt-4 pb-6">
            <div className="flex-1 min-h-[16px] max-h-[84px]" />

            <div className="w-full max-w-[700px] flex flex-col items-center">
              {/* Emblema luminoso + Título directo sin ruido superior */}
              <div className="omega-fade-up flex flex-col items-center text-center mb-7">
                <div className="relative flex items-center justify-center">
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full blur-2xl bg-[#2F6FED]/20 scale-125 pointer-events-none"
                  />
                  <OmegaLogo size={62} isThinking={loading} />
                </div>
                <h1 className="mt-5 text-[28px] sm:text-[32px] font-semibold tracking-[-0.028em] leading-[1.15] text-[#F5F5F7]">
                  ¿Qué amenaza analizamos?
                </h1>
                <p className="mt-2 text-[14.5px] tracking-[-0.01em] text-[#8E8E93]">
                  Inteligencia técnica sobre spyware comercial respaldada con citas verificables.
                </p>
              </div>

              {/* Composer Spotlight Obsidian */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitQuery();
                }}
                style={{ animationDelay: '60ms' }}
                className="omega-fade-up omega-capsule w-full rounded-[16px] p-4"
              >
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Pregunta por Pegasus, un CVE, dominio o artefacto forense..."
                  className="w-full resize-none bg-transparent px-1 pt-0.5 pb-2.5 text-[15px] leading-[1.58] tracking-[-0.008em] text-[#F5F5F7] placeholder-[#6E6E73] focus:outline-none"
                />

                {(detectedIoc || iocFeedback) && (
                  <div className="px-1 pb-2.5 flex flex-wrap items-center gap-2 text-[12px]">
                    {detectedIoc && (
                      <span className="font-tech inline-flex items-center gap-1.5 rounded-full border border-[#2F6FED]/40 bg-[#2F6FED]/15 px-2.5 py-0.5 text-[#8AB4FF]">
                        <Fingerprint className="h-3 w-3 text-[#5E9BFF]" />
                        {detectedIoc}
                      </span>
                    )}
                    {iocFeedback && (
                      <span className="font-tech text-[#8E8E93]">{iocFeedback}</span>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/[0.065]">
                  <SourceScopePills value={sourceScope} onChange={onChangeSourceScope} />

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIocPopoverOpen((v) => !v)}
                      title="Pegar o insertar un CVE, dominio o hash"
                      className={`inline-flex items-center gap-1 rounded-[8px] border px-2.5 py-1.5 font-tech text-[11.5px] active:scale-[0.96] transition-all duration-150 cursor-pointer ${
                        iocPopoverOpen
                          ? 'border-[#2F6FED]/55 bg-[#2F6FED]/16 text-[#8AB4FF]'
                          : 'border-white/[0.08] bg-white/[0.04] text-[#98989D] hover:bg-white/[0.08] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <Plus className="h-3.5 w-3.5 text-[#5E9BFF]" />
                      <span>IOC</span>
                    </button>

                    <button
                      type="submit"
                      disabled={loading || !input.trim()}
                      title="Analizar (Enter)"
                      aria-label="Analizar"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#2F6FED] text-white shadow-[0_4px_14px_rgba(47,111,237,0.38),inset_0_1px_0_rgba(255,255,255,0.28)] hover:bg-[#3B7BF2] disabled:bg-white/[0.07] disabled:text-[#6E6E73] disabled:shadow-none active:scale-[0.94] transition-all duration-200 ease-apple cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {renderIocHelperBar()}
              </form>

              {/* 3 Accesos Directos Aireados */}
              <div className="w-full mt-4 grid gap-3 sm:grid-cols-3">
                {QUICK_BRIEFS.map((item, idx) => (
                  <button
                    key={item.tag}
                    type="button"
                    onClick={() => submitQuery(item.prompt)}
                    style={{ animationDelay: `${110 + idx * 45}ms` }}
                    className="omega-prompt-tile omega-fade-up group flex flex-col justify-between rounded-[13px] px-4 py-3.5 text-left cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] font-medium tracking-[-0.01em] text-[#5E9BFF]">
                        {item.tag}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-[#6E6E73] group-hover:text-[#F5F5F7] group-hover:translate-x-0.5 transition-all duration-200 ease-apple" />
                    </div>
                    <p className="mt-1.5 text-[13.5px] font-medium tracking-[-0.01em] leading-[1.42] text-[#D1D1D6] group-hover:text-[#F5F5F7] transition-colors">
                      {item.title}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-[16px] max-h-[84px]" />

            <footer className="h-6 flex items-center justify-center text-[12px] text-[#8E8E93]">
              {hasHistory && (
                <button
                  type="button"
                  onClick={onResumeLastSession}
                  className="hover:text-[#F5F5F7] transition-colors cursor-pointer"
                >
                  Retomar última investigación →
                </button>
              )}
            </footer>
          </main>
        ) : (
          /* ============================================================
             ESTADO ACTIVO: Hilo de conversación + evidencia
             ============================================================ */
          <>
            <main className="flex-1 overflow-y-auto px-6 py-7">
              <div className="mx-auto max-w-[780px] space-y-7">
                {messages.map((msg, idx) =>
                  msg.role === 'user' ? (
                    <div key={idx} className="omega-fade-up flex justify-end">
                      <div className="max-w-[80%] rounded-[16px] rounded-br-[6px] border border-[#2F6FED]/28 bg-[#2F6FED]/15 px-4 py-3 space-y-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                        {msg.sourceScope && msg.sourceScope !== 'Todas las fuentes' && (
                          <span className="inline-block rounded-full border border-[#2F6FED]/35 bg-[#2F6FED]/18 px-2 py-0.5 text-[11px] font-medium text-[#8AB4FF]">
                            {msg.sourceScope}
                          </span>
                        )}
                        <p className="text-[15px] leading-[1.6] tracking-[-0.008em] text-[#F5F5F7] whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                  ) : msg.isError ? (
                    <div
                      key={idx}
                      className="omega-fade-up rounded-[12px] border border-[#FF453A]/30 bg-[#FF453A]/10 px-4 py-3.5 flex items-center justify-between gap-4"
                    >
                      <div className="space-y-0.5 text-[14px]">
                        <p className="font-medium text-[#FFDAD6]">Error al consultar el motor</p>
                        <p className="text-[13px] text-[#FFDAD6]/80">{msg.content}</p>
                      </div>
                      {msg.retryQuery && (
                        <button
                          type="button"
                          onClick={() => onRetryFailedTurn(idx, msg.retryQuery, msg.sourceScope)}
                          className="shrink-0 h-8 px-3 rounded-[8px] border border-[#FF453A]/35 bg-[#FF453A]/15 text-[12px] font-medium text-[#FFDAD6] hover:bg-[#FF453A]/25 transition-colors cursor-pointer"
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
                  <div className="omega-fade-up apple-group inline-flex items-center gap-3 rounded-[12px] px-4 py-3 text-[14px] text-[#F5F5F7]">
                    <OmegaLogo size={24} isThinking={true} />
                    <span className="tracking-[-0.01em]">
                      {sourceScope === 'Todas las fuentes'
                        ? 'Buscando en reportes...'
                        : `Buscando en ${sourceScope}...`}
                    </span>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </main>

            {/* Composer Inferior Flotante */}
            <div className="shrink-0 border-t border-white/[0.05] bg-[#08080A]/75 backdrop-blur-xl px-6 py-3.5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitQuery();
                }}
                className="omega-capsule mx-auto max-w-[780px] rounded-[15px] p-3"
              >
                <div className="flex items-end gap-2.5">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Haz una pregunta de seguimiento..."
                    className="flex-1 resize-none bg-transparent px-1.5 py-1 text-[15px] leading-[1.55] tracking-[-0.008em] text-[#F5F5F7] placeholder-[#6E6E73] focus:outline-none"
                  />

                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    aria-label="Enviar"
                    className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#2F6FED] text-white shadow-[0_4px_14px_rgba(47,111,237,0.38),inset_0_1px_0_rgba(255,255,255,0.28)] hover:bg-[#3B7BF2] disabled:bg-white/[0.07] disabled:text-[#6E6E73] disabled:shadow-none active:scale-[0.94] transition-all duration-200 ease-apple cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-2.5 pt-2.5 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                  <SourceScopePills value={sourceScope} onChange={onChangeSourceScope} compact />

                  <div className="flex items-center gap-2">
                    {detectedIoc && (
                      <span className="font-tech text-[11.5px] text-[#8AB4FF]">
                        {detectedIoc}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setIocPopoverOpen((v) => !v)}
                      title="Pegar o insertar un CVE, dominio o hash"
                      className={`inline-flex items-center gap-1 rounded-[7px] border px-2.5 py-1 font-tech text-[11.5px] active:scale-[0.96] transition-all cursor-pointer ${
                        iocPopoverOpen
                          ? 'border-[#2F6FED]/55 bg-[#2F6FED]/16 text-[#8AB4FF]'
                          : 'border-white/[0.08] bg-white/[0.04] text-[#98989D] hover:bg-white/[0.08] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <Plus className="h-3 w-3 text-[#5E9BFF]" />
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
