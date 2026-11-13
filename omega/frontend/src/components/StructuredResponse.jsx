import { useState, useMemo } from 'react';
import {
  Copy,
  Check,
  BookOpen,
  Clock,
  ChevronDown,
  ChevronUp,
  Activity,
} from 'lucide-react';
import { MarkdownMessage, formatTextWithTechAndCitations } from './MarkdownMessage';

const CVE_RE = /\bCVE[-\u2010-\u2015\u2212]\d{4}[-\u2010-\u2015\u2212]\d{4,7}\b/gi;
const SHA256_RE = /\b[a-f0-9]{64}\b/gi;
const DOMAIN_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ca|uk|xyz|top|info|me|co|gov|edu|online|site)\b/gi;

export function StructuredResponse({
  message,
  activeCitation,
  onSelectCitation,
  onToggleSources,
  isSourcesOpen,
}) {
  const [viewMode, setViewMode] = useState('structured'); // 'structured' | 'markdown'
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedIoc, setCopiedIoc] = useState('');

  const citations = message.citations || [];
  const citationMap = useMemo(
    () => new Map(citations.map((c) => [c.index, c])),
    [citations]
  );

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
      confidence: trace?.overall_confidence || (maxSim >= 0.72 ? 'Alta' : maxSim >= 0.5 ? 'Media' : 'Referencial'),
    };
  }, [citations, message.analysis]);

  // Extraer CVEs, hashes y dominios para acceso rápido
  const technicalIndicators = useMemo(() => {
    const text = message.content || '';
    const cves = Array.from(
      new Set(
        (text.match(CVE_RE) || []).map((c) => c.replace(/[\u2010-\u2015\u2212]/g, '-').toUpperCase())
      )
    );
    const hashes = Array.from(new Set(text.match(SHA256_RE) || [])).map((h) => h.toLowerCase());
    const domains = Array.from(
      new Set(
        (text.match(DOMAIN_RE) || []).filter(
          (d) =>
            !d.includes('citizenlab') &&
            !d.includes('amnesty') &&
            !d.includes('blog.google') &&
            !d.includes('github.com')
        )
      )
    );
    return { cves, hashes, domains };
  }, [message.content]);

  // Separar respuesta principal y puntos clave
  const parsedSections = useMemo(() => {
    const lines = (message.content || '').split(/\r?\n/);
    const execLines = [];
    const findings = [];
    let isParsingFindings = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (/^\*\*[^*]{2,48}:?\*\*:?$/.test(trimmed)) continue;

      const indentLen = line.length - line.trimStart().length;
      const bulletMatch = trimmed.match(/^(?:[-*•]|\d+\.)\s+(?:\*\*([^*]+?)\*\*\s*:?\s*)?(.*)$/);
      if (bulletMatch) {
        isParsingFindings = true;
        let title = (bulletMatch[1] || '').trim().replace(/:$/, '');
        let body = (bulletMatch[2] || '').trim().replace(/^:\s*/, '');

        if (indentLen >= 2 && findings.length > 0) {
          const subLine = title ? (body ? `**${title}:** ${body}` : `**${title}**`) : body;
          const prev = findings[findings.length - 1];
          prev.body = prev.body ? `${prev.body}\n${subLine}` : subLine;
          continue;
        }

        if (!title && body.includes(':') && body.indexOf(':') < 64) {
          const splitIdx = body.indexOf(':');
          title = body.slice(0, splitIdx).trim().replace(/\*\*/g, '');
          body = body.slice(splitIdx + 1).trim();
        }
        findings.push({
          title: title || '',
          body,
        });
      } else if (!isParsingFindings && !trimmed.startsWith('#') && !trimmed.startsWith('>')) {
        const cleanedLine = trimmed.replace(
          /^\*\*(?:Conclusi[oó]n|Resumen)\s+ejecutiv[ao]:?\*\*\s*/i,
          ''
        );
        if (cleanedLine) execLines.push(cleanedLine);
      } else if (isParsingFindings && findings.length > 0 && !trimmed.startsWith('#')) {
        const prev = findings[findings.length - 1];
        prev.body = prev.body ? `${prev.body}\n${trimmed}` : trimmed;
      }
    }

    return {
      executive: execLines.join(' ').trim() || lines[0] || '',
      findings: findings.filter((f) => f.body || f.title),
    };
  }, [message.content]);

  function handleCopy() {
    navigator.clipboard.writeText(message.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function handleCopyIoc(value) {
    navigator.clipboard?.writeText(value);
    setCopiedIoc(value);
    setTimeout(() => setCopiedIoc(''), 1400);
  }

  const hasStructuredContent = parsedSections.findings.length > 0;
  const isExtractiveFallback = message.model === 'omega-extractive-fallback';
  const allIocs = [
    ...technicalIndicators.cves,
    ...technicalIndicators.domains.slice(0, 4),
    ...technicalIndicators.hashes.slice(0, 2),
  ];

  return (
    <div className="space-y-4">
      {/* Barra compacta superior */}
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
              }`}
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

            {hasStructuredContent && (
              <div className="apple-segmented inline-flex rounded-[8px] p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('structured')}
                  className={`px-2.5 py-0.5 rounded-[6px] text-[12px] font-medium transition-all duration-150 cursor-pointer ${
                    viewMode === 'structured'
                      ? 'apple-segmented-active'
                      : 'text-[#8E8E93] hover:text-[#F5F5F7]'
                  }`}
                >
                  Tarjetas
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('markdown')}
                  className={`px-2.5 py-0.5 rounded-[6px] text-[12px] font-medium transition-all duration-150 cursor-pointer ${
                    viewMode === 'markdown'
                      ? 'apple-segmented-active'
                      : 'text-[#8E8E93] hover:text-[#F5F5F7]'
                  }`}
                >
                  Texto
                </button>
              </div>
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

      {/* Respuesta directa sin bordes laterales decorativos */}
      {viewMode === 'markdown' || !hasStructuredContent ? (
        <div className="py-0.5">
          <MarkdownMessage
            content={message.content}
            citations={citations}
            onSelectCitation={onSelectCitation}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="max-w-[68ch] text-[15.5px] leading-[1.72] tracking-[-0.008em] text-[#F5F5F7]">
            {formatTextWithTechAndCitations(parsedSections.executive, citationMap, onSelectCitation)}
          </p>

          {/* Puntos clave en tarjetas agrupadas Apple */}
          {parsedSections.findings.length > 0 && (
            <div className="grid gap-2.5">
              {parsedSections.findings.map((f, i) => (
                <div
                  key={i}
                  className="apple-group rounded-[12px] px-4 py-3.5 space-y-1.5 hover:border-white/[0.14] transition-colors duration-200"
                >
                  {f.title && (
                    <div className="text-[14.5px] font-semibold tracking-[-0.01em] leading-[1.4] text-[#F5F5F7]">
                      {f.title.replace(/`/g, '')}
                    </div>
                  )}
                  <div className="max-w-[68ch] text-[14px] leading-[1.68] text-[#D1D1D6] space-y-1.5">
                    {f.body
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean)
                      .map((line, lineIdx) => (
                        <div key={lineIdx}>
                          {formatTextWithTechAndCitations(line, citationMap, onSelectCitation)}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* IOCs clicables */}
          {allIocs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[11.5px] font-medium text-[#8E8E93] mr-0.5">IOCs</span>
              {allIocs.map((ioc) => (
                <button
                  key={ioc}
                  type="button"
                  onClick={() => handleCopyIoc(ioc)}
                  title="Clic para copiar indicador"
                  className="font-tech inline-flex items-center gap-1 rounded-[7px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[12px] text-[#F5F5F7] hover:border-[#2F6FED]/45 hover:bg-white/[0.07] transition-colors cursor-pointer max-w-[230px] truncate"
                >
                  <span className="truncate">{ioc}</span>
                  {copiedIoc === ioc && <Check className="h-3.5 w-3.5 text-[#5E9BFF] shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Citas compactas al pie */}
      {citations.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
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
