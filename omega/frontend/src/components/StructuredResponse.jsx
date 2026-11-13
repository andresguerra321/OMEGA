import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Copy,
  Check,
  BookOpen,
  Clock,
  ChevronDown,
  ChevronUp,
  Activity,
} from 'lucide-react';
import { MarkdownMessage } from './MarkdownMessage';

const completedTypingIds = new Set();

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  );
}

/** Avanza el corte de escritura hasta límites seguros de palabra y sintaxis Markdown inline. */
function snapMarkdownBoundary(fullText, rawIndex) {
  const total = fullText.length;
  if (rawIndex >= total) return total;

  let idx = Math.max(1, rawIndex);

  // Evitar partir palabras a la mitad
  let wordScan = 0;
  while (idx < total && !/\s/.test(fullText[idx]) && wordScan < 20) {
    idx += 1;
    wordScan += 1;
  }

  const lineStart = fullText.lastIndexOf('\n', idx - 1) + 1;
  let lineSlice = fullText.slice(lineStart, idx);

  // Evitar dejar viñetas o encabezados vacíos antes de la primera palabra
  if (/^(?:[-*•]|\d+\.|#{1,4}|>)\s*$/.test(lineSlice.trim())) {
    const lineEnd = fullText.indexOf('\n', idx);
    const limit = lineEnd === -1 ? total : lineEnd;
    while (idx < limit && /\s/.test(fullText[idx])) idx += 1;
    while (idx < limit && !/\s/.test(fullText[idx])) idx += 1;
    lineSlice = fullText.slice(lineStart, idx);
  }

  // Completar delimitadores inline abiertos en la misma línea (**negrita**, `código`, [cita/enlace])
  const lineEnd = fullText.indexOf('\n', lineStart);
  const maxLinePos = lineEnd === -1 ? total : lineEnd;

  const boldMatches = lineSlice.match(/\*\*/g);
  if (boldMatches && boldMatches.length % 2 === 1) {
    const closeBold = fullText.indexOf('**', idx);
    if (closeBold !== -1 && closeBold + 2 <= maxLinePos && closeBold - idx <= 72) {
      idx = closeBold + 2;
      lineSlice = fullText.slice(lineStart, idx);
    }
  }

  const tickMatches = lineSlice.match(/`/g);
  if (tickMatches && tickMatches.length % 2 === 1 && !lineSlice.includes('```')) {
    const closeTick = fullText.indexOf('`', idx);
    if (closeTick !== -1 && closeTick + 1 <= maxLinePos && closeTick - idx <= 72) {
      idx = closeTick + 1;
      lineSlice = fullText.slice(lineStart, idx);
    }
  }

  const lastOpenBracket = lineSlice.lastIndexOf('[');
  const lastCloseBracket = lineSlice.lastIndexOf(']');
  if (lastOpenBracket > lastCloseBracket) {
    const closeBracket = fullText.indexOf(']', idx);
    if (closeBracket !== -1 && closeBracket + 1 <= maxLinePos && closeBracket - idx <= 80) {
      idx = closeBracket + 1;
      if (fullText[idx] === '(') {
        const closeParen = fullText.indexOf(')', idx);
        if (closeParen !== -1 && closeParen + 1 <= maxLinePos && closeParen - idx <= 120) {
          idx = closeParen + 1;
        }
      }
    }
  }

  return Math.min(total, idx);
}

export function StructuredResponse({
  message,
  activeCitation,
  onSelectCitation,
  onToggleSources,
  isSourcesOpen,
  onTypingStep,
}) {
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [copied, setCopied] = useState(false);

  const fullText = message.content || '';
  const typingKey = useMemo(
    () => message.id || `${message.latency || 'hist'}:${fullText.slice(0, 64)}`,
    [message.id, message.latency, fullText]
  );

  const shouldAnimateInitial =
    Boolean(message.animateTyping) &&
    fullText.length > 0 &&
    !completedTypingIds.has(typingKey) &&
    !prefersReducedMotion();

  const [visibleLength, setVisibleLength] = useState(() =>
    shouldAnimateInitial ? 0 : fullText.length
  );
  const stepCallbackRef = useRef(onTypingStep);

  useEffect(() => {
    stepCallbackRef.current = onTypingStep;
  }, [onTypingStep]);

  useEffect(() => {
    if (!shouldAnimateInitial) {
      return undefined;
    }

    let rafId = 0;
    let cancelled = false;
    const durationMs = Math.min(2200, Math.max(850, fullText.length * 4.5));
    let startTime = null;
    let lastCommitted = 0;

    const tick = (now) => {
      if (cancelled) return;
      if (startTime === null) startTime = now;
      const elapsed = now - startTime;
      const linear = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - linear, 1.25);
      const rawIdx = Math.ceil(eased * fullText.length);
      const nextIdx =
        linear >= 1 ? fullText.length : snapMarkdownBoundary(fullText, rawIdx);

      if (nextIdx > lastCommitted) {
        lastCommitted = nextIdx;
        setVisibleLength(nextIdx);
        stepCallbackRef.current?.();
      }

      if (nextIdx < fullText.length) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        completedTypingIds.add(typingKey);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [shouldAnimateInitial, fullText, typingKey]);

  const isTyping = shouldAnimateInitial && visibleLength < fullText.length;
  const visibleContent = isTyping ? fullText.slice(0, visibleLength) : fullText;

  function finishTypingNow() {
    completedTypingIds.add(typingKey);
    setVisibleLength(fullText.length);
  }

  const citations = useMemo(() => message.citations || [], [message.citations]);

  // Telemetría colapsable derivada de las citas recuperadas
  const telemetry = useMemo(() => {
    const reportSet = new Set(citations.map((c) => c.report_id || c.title).filter(Boolean));
    const orgSet = Array.from(new Set(citations.map((c) => c.organization).filter(Boolean)));
    let hybridCount = 0;
    let exactCount = 0;
    let semanticCount = 0;
    let maxSim = 0;

    for (const c of citations) {
      const m = (c.retrieval_method || '').toLowerCase();
      if (m.includes('híbrido') || m.includes('hibrido')) hybridCount += 1;
      else if (m.includes('exacta') || m.includes('exacto')) exactCount += 1;
      else semanticCount += 1;
      const sim = Number(c.similarity || 0);
      if (sim > maxSim) maxSim = sim;
    }

    let modeLabel = 'RRF Híbrido';
    if (citations.length > 0 && hybridCount === 0 && exactCount > 0 && semanticCount === 0) {
      modeLabel = 'Coincidencia Exacta';
    } else if (citations.length > 0 && hybridCount === 0 && exactCount === 0) {
      modeLabel = 'Búsqueda Semántica';
    }

    const trace = message.analysis?.traceability;
    return {
      modeLabel,
      fragmentCount: citations.length,
      reportCount: reportSet.size,
      orgs: trace?.organizations?.length ? trace.organizations : orgSet,
      hybridCount,
      exactCount,
      semanticCount,
      maxSimilarity: trace?.max_similarity ?? maxSim,
    };
  }, [citations, message.analysis]);

  function handleCopy() {
    navigator.clipboard?.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const isExtractiveFallback = message.model === 'omega-extractive-fallback';

  return (
    <div className="space-y-4">
      {/* Barra compacta superior sin selector de tarjetas */}
      <div className="apple-group rounded-[11px] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-[12.5px] text-[#98989D]">
          <button
            type="button"
            onClick={() => setShowTelemetry((v) => !v)}
            aria-expanded={showTelemetry}
            title="Ver detalle de recuperación"
            className="flex flex-wrap items-center gap-1.5 text-left hover:text-[#F5F5F7] transition-colors cursor-pointer"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isExtractiveFallback ? 'bg-[#FF9F0A]' : 'bg-[#2F6FED]'
              } ${isTyping ? 'omega-core-pulse' : ''}`}
            />
            <span className="font-tech text-[#F5F5F7]">
              {telemetry.fragmentCount} {telemetry.fragmentCount === 1 ? 'fuente' : 'fuentes'}
            </span>
            <span className="text-white/25">·</span>
            <span className="font-tech">
              {telemetry.reportCount} {telemetry.reportCount === 1 ? 'reporte' : 'reportes'}
            </span>
            {message.latency && (
              <>
                <span className="text-white/25">·</span>
                <span className="font-tech inline-flex items-center gap-1 text-[#8AB4FF]">
                  <Clock className="h-3 w-3" />
                  {message.latency}s
                </span>
              </>
            )}
            {isExtractiveFallback && (
              <span className="font-tech ml-1 rounded-full border border-[#FF9F0A]/35 bg-[#FF9F0A]/12 px-2 py-0.5 text-[11px] text-[#FFD60A]">
                Sin LLM
              </span>
            )}
            {showTelemetry ? (
              <ChevronUp className="h-3.5 w-3.5 text-[#8E8E93]" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-[#8E8E93]" />
            )}
          </button>

          <div className="flex items-center gap-1.5">
            {isTyping && (
              <button
                type="button"
                onClick={finishTypingNow}
                className="px-2 py-1 rounded-[7px] text-[11.5px] text-[#8E8E93] hover:text-[#F5F5F7] transition-colors cursor-pointer"
              >
                Completar
              </button>
            )}

            {citations.length > 0 && (
              <button
                type="button"
                onClick={onToggleSources}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] border text-[12px] font-medium active:scale-[0.96] transition-all duration-150 cursor-pointer ${
                  isSourcesOpen
                    ? 'border-[#2F6FED]/55 bg-[#2F6FED]/16 text-[#8AB4FF]'
                    : 'border-white/[0.08] bg-white/[0.04] text-[#D1D1D6] hover:bg-white/[0.08] hover:text-[#F5F5F7]'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5 text-[#5E9BFF]" />
                <span>{isSourcesOpen ? 'Ocultar fuentes' : `Ver fuentes (${citations.length})`}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleCopy}
              title="Copiar respuesta"
              aria-label="Copiar respuesta"
              className="h-7 px-2.5 inline-flex items-center gap-1 rounded-[7px] border border-white/[0.08] bg-white/[0.04] text-[12px] text-[#8E8E93] hover:bg-white/[0.08] hover:text-[#F5F5F7] active:scale-[0.94] transition-all duration-150 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#5E9BFF]" />
                  <span className="text-[#F5F5F7]">Copiado</span>
                </>
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Telemetría técnica opcional */}
        {showTelemetry && (
          <div className="border-t border-white/[0.06] bg-black/25 px-3.5 py-2.5 text-[12px] text-[#8E8E93] grid gap-1.5 sm:grid-cols-2">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-[#5E9BFF] shrink-0" />
              <span>{telemetry.modeLabel}:</span>
              <span className="font-tech text-[#F5F5F7]">
                {telemetry.hybridCount} híbrido · {telemetry.exactCount} exacto · {telemetry.semanticCount} semántico
              </span>
            </div>
            <div className="flex items-center gap-1.5 sm:justify-end">
              <span>Similitud máx:</span>
              <span className="font-tech text-[#8AB4FF]">
                {(Number(telemetry.maxSimilarity || 0) * 100).toFixed(1)}%
              </span>
            </div>
            {telemetry.orgs.length > 0 && (
              <div className="sm:col-span-2 flex flex-wrap items-center gap-1.5">
                <span>Publicadores:</span>
                <span className="text-[#F5F5F7]">{telemetry.orgs.join(', ')}</span>
              </div>
            )}
            {message.standaloneQuery && (
              <div className="sm:col-span-2 flex flex-wrap items-center gap-1.5">
                <span>Consulta:</span>
                <span className="font-tech text-[#D1D1D6]">{message.standaloneQuery}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Respuesta editorial en solo texto con animación elegante de escritura */}
      <div className="py-0.5">
        <MarkdownMessage
          content={visibleContent}
          citations={citations}
          onSelectCitation={onSelectCitation}
          isTyping={isTyping}
        />
      </div>

      {/* Citas compactas al pie */}
      {citations.length > 0 && !isTyping && (
        <div className="omega-fade-up flex flex-wrap gap-1.5 pt-1">
          {citations.map((cit) => {
            const isSelected =
              activeCitation?.index === cit.index && activeCitation?.title === cit.title;
            return (
              <button
                key={`${cit.index}-${cit.title}-${cit.page}`}
                type="button"
                onClick={() => onSelectCitation?.(cit)}
                className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1 text-[12px] active:scale-[0.97] transition-all cursor-pointer ${
                  isSelected
                    ? 'border-[#2F6FED]/55 bg-[#2F6FED]/16 text-[#F5F5F7]'
                    : 'border-white/[0.08] bg-white/[0.03] text-[#A1A1A6] hover:bg-white/[0.07] hover:text-[#F5F5F7]'
                }`}
              >
                <span className="font-tech font-medium text-[#8AB4FF]">[{cit.index}]</span>
                <span className="max-w-[210px] truncate">{cit.title}</span>
                <span className="font-tech text-[#8E8E93]">p.{cit.page}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
