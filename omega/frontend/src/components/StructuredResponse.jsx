import { useState, useMemo } from 'react';
import {
  ShieldCheck,
  Layers,
  FileText,
  Copy,
  Check,
  Fingerprint,
  BookOpen,
} from 'lucide-react';
import { MarkdownMessage, formatTextWithTechAndCitations } from './MarkdownMessage';

const CVE_RE = /\bCVE[-\u2010-\u2015\u2212]\d{4}[-\u2010-\u2015\u2212]\d{4,7}\b/gi;
const SHA256_RE = /\b[a-f0-9]{64}\b/gi;
const DOMAIN_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ca|uk|xyz|top|info|me|co|gov|edu|online|site)\b/gi;

export function StructuredResponse({
  message,
  onSelectCitation,
  onToggleSources,
  isSourcesOpen,
}) {
  const [viewMode, setViewMode] = useState('structured'); // 'structured' | 'markdown'
  const [copied, setCopied] = useState(false);

  const citations = message.citations || [];
  const citationMap = useMemo(
    () => new Map(citations.map((c) => [c.index, c])),
    [citations]
  );

  // Extraer CVEs y dominios técnicos
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
          (d) => !d.includes('citizenlab') && !d.includes('amnesty') && !d.includes('blog.google')
        )
      )
    );
    return { cves, hashes, domains };
  }, [message.content]);

  // Desglosar en resumen ejecutivo y hallazgos
  const parsedSections = useMemo(() => {
    const lines = (message.content || '').split(/\r?\n/);
    const execLines = [];
    const findings = [];
    let isParsingFindings = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Omitir subtítulos sueltos de sección tipo "**Detalles técnicos:**" o "**Conclusión ejecutiva:**"
      if (/^\*\*[^*]{2,48}:?\*\*:?$/.test(trimmed)) continue;

      const indentLen = line.length - line.trimStart().length;
      const bulletMatch = trimmed.match(/^(?:[-*•]|\d+\.)\s+(?:\*\*([^*]+?)\*\*\s*:?\s*)?(.*)$/);
      if (bulletMatch) {
        isParsingFindings = true;
        let title = (bulletMatch[1] || '').trim().replace(/:$/, '');
        let body = (bulletMatch[2] || '').trim().replace(/^:\s*/, '');

        // Si es sub-viñeta indentada y hay un hallazgo padre previo, agruparla dentro de ese hallazgo
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
          title: title || 'Evidencia documentada',
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
      findings: findings.filter((f) => f.body || f.title !== 'Evidencia documentada'),
    };
  }, [message.content]);

  function handleCopy() {
    navigator.clipboard.writeText(message.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const hasStructuredContent = parsedSections.findings.length > 0;
  const isExtractiveFallback = message.model === 'omega-extractive-fallback';

  return (
    <div className="space-y-4">
      {/* Barra de metadatos y herramientas de respuesta */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[#929BAA] pb-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 font-medium text-[#F0F2F5]">
            <span className={`h-1.5 w-1.5 rounded-full ${isExtractiveFallback ? 'bg-amber-400' : 'bg-[#3978F6]'}`} />
            <span>Respuesta Verificada CTI</span>
          </span>
          <span className="text-white/15">·</span>
          <span className="font-tech text-[11px] text-[#8E98A8]">
            {citations.length} {citations.length === 1 ? 'fuente' : 'fuentes'}
          </span>
          {isExtractiveFallback && (
            <span className="font-tech text-[10px] px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
              Extractivo local
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Botón de panel de fuentes */}
          {citations.length > 0 && (
            <button
              type="button"
              onClick={onToggleSources}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium active:scale-[0.96] transition-all duration-150 ease-kowalski cursor-pointer ${
                isSourcesOpen
                  ? 'border-[#3978F6]/50 bg-[#16243D]/90 text-[#8BB3FF]'
                  : 'border-white/[0.08] bg-white/[0.03] text-[#929BAA] hover:border-white/[0.15] hover:text-[#F0F2F5]'
              }`}
            >
              <BookOpen className="h-3 w-3" />
              <span>{isSourcesOpen ? 'Ocultar fuentes' : `Ver fuentes (${citations.length})`}</span>
            </button>
          )}

          {/* Toggle de vista */}
          {hasStructuredContent && (
            <div className="inline-flex rounded-full border border-white/[0.07] bg-[#111318] p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('structured')}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium active:scale-[0.96] transition-all duration-150 ease-kowalski cursor-pointer ${
                  viewMode === 'structured'
                    ? 'bg-[#1C2029] text-[#F0F2F5] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                    : 'text-[#8E98A8] hover:text-[#F0F2F5]'
                }`}
              >
                Estructurada
              </button>
              <button
                type="button"
                onClick={() => setViewMode('markdown')}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium active:scale-[0.96] transition-all duration-150 ease-kowalski cursor-pointer ${
                  viewMode === 'markdown'
                    ? 'bg-[#1C2029] text-[#F0F2F5] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                    : 'text-[#8E98A8] hover:text-[#F0F2F5]'
                }`}
              >
                Markdown
              </button>
            </div>
          )}

          {/* Copiar */}
          <button
            type="button"
            onClick={handleCopy}
            title="Copiar respuesta"
            aria-label="Copiar respuesta"
            className="h-6 w-6 inline-flex items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-[#929BAA] hover:border-white/[0.15] hover:text-[#F0F2F5] active:scale-[0.92] transition-all duration-150 ease-kowalski cursor-pointer"
          >
            {copied ? <Check className="h-3 w-3 text-[#3978F6]" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Vista de contenido */}
      {viewMode === 'markdown' || !hasStructuredContent ? (
        <MarkdownMessage
          content={message.content}
          citations={citations}
          onSelectCitation={onSelectCitation}
        />
      ) : (
        <div className="space-y-4">
          {/* 1. Resumen Ejecutivo */}
          <div className="rounded-[14px] border border-white/[0.075] bg-[#13161C]/90 p-4 space-y-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[#8E98A8]">
              <FileText className="h-3.5 w-3.5 text-[#3978F6]" />
              <span>Resumen Ejecutivo</span>
            </div>
            <p className="text-[14px] leading-[1.65] text-[#F0F2F5]">
              {formatTextWithTechAndCitations(parsedSections.executive, citationMap, onSelectCitation)}
            </p>
          </div>

          {/* 2. Hallazgos Técnicos */}
          {parsedSections.findings.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[#8E98A8] px-0.5">
                <Layers className="h-3.5 w-3.5 text-[#3978F6]" />
                <span>Hallazgos de Inteligencia</span>
              </div>
              <div className="grid gap-2">
                {parsedSections.findings.map((f, i) => (
                  <div
                    key={i}
                    className="rounded-[12px] border border-white/[0.065] bg-[#111318]/90 p-3.5 space-y-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:border-white/[0.11] transition-colors duration-150 ease-kowalski"
                  >
                    <div className="text-[13px] font-semibold text-[#F0F2F5]">
                      {f.title.replace(/`/g, '')}
                    </div>
                    <div className="text-[13px] leading-[1.6] text-[#9BA3B2] space-y-1.5">
                      {f.body
                        .split("\n")
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
            </div>
          )}

          {/* 3. Indicadores Técnicos Identificados (CVEs, dominios, hashes) */}
          {(technicalIndicators.cves.length > 0 ||
            technicalIndicators.domains.length > 0 ||
            technicalIndicators.hashes.length > 0) && (
            <div className="rounded-[12px] border border-white/[0.07] bg-[#13161C]/90 p-3.5 space-y-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[#8E98A8]">
                <Fingerprint className="h-3.5 w-3.5 text-[#3978F6]" />
                <span>Indicadores Técnicos Vinculados</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {technicalIndicators.cves.map((cve) => (
                  <span
                    key={cve}
                    className="font-tech text-[11.5px] px-2 py-0.5 rounded-[6px] border border-white/[0.08] bg-[#0D0F12] text-[#F0F2F5]"
                  >
                    {cve}
                  </span>
                ))}
                {technicalIndicators.domains.slice(0, 4).map((dom) => (
                  <span
                    key={dom}
                    className="font-tech text-[11.5px] px-2 py-0.5 rounded-[6px] border border-white/[0.08] bg-[#0D0F12] text-[#9BA3B2]"
                  >
                    {dom}
                  </span>
                ))}
                {technicalIndicators.hashes.slice(0, 2).map((h) => (
                  <span
                    key={h}
                    className="font-tech text-[11.5px] px-2 py-0.5 rounded-[6px] border border-white/[0.08] bg-[#0D0F12] text-[#9BA3B2] truncate max-w-[200px]"
                  >
                    {h}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

