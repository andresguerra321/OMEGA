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

const CVE_RE = /\bCVE-\d{4}-\d{4,7}\b/gi;
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
    const cves = Array.from(new Set(text.match(CVE_RE) || [])).map((c) => c.toUpperCase());
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

      const bulletMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(?:\*\*([^*]+?)\*\*\s*:?\s*)?(.*)$/);
      if (bulletMatch) {
        isParsingFindings = true;
        let title = (bulletMatch[1] || '').trim().replace(/:$/, '');
        let body = (bulletMatch[2] || '').trim();
        if (!title && body.includes(':')) {
          const splitIdx = body.indexOf(':');
          title = body.slice(0, splitIdx).trim();
          body = body.slice(splitIdx + 1).trim();
        }
        findings.push({
          title: title || 'Evidencia documentada',
          body,
        });
      } else if (!isParsingFindings && !trimmed.startsWith('#') && !trimmed.startsWith('>')) {
        execLines.push(trimmed);
      }
    }

    return {
      executive: execLines.join(' ').trim() || lines[0] || '',
      findings,
    };
  }, [message.content]);

  function handleCopy() {
    navigator.clipboard.writeText(message.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const hasStructuredContent = parsedSections.findings.length > 0;

  return (
    <div className="space-y-3.5">
      {/* Barra de metadatos y herramientas de respuesta */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#929BAA] pb-1 border-b border-[#262B33]">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 font-medium text-[#F0F2F5]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#3978F6]" />
            <span>Respuesta Verificada CTI</span>
          </span>
          <span className="text-[#262B33]">|</span>
          <span className="font-tech text-[#929BAA]">
            {citations.length} {citations.length === 1 ? 'fuente' : 'fuentes'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Botón de panel de fuentes */}
          {citations.length > 0 && (
            <button
              type="button"
              onClick={onToggleSources}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] border text-[11px] font-medium transition-colors cursor-pointer ${
                isSourcesOpen
                  ? 'border-[#3978F6] bg-[#16243D] text-[#3978F6]'
                  : 'border-[#262B33] bg-[#171A20] text-[#929BAA] hover:border-[#353C47] hover:text-[#F0F2F5]'
              }`}
            >
              <BookOpen className="h-3 w-3" />
              <span>{isSourcesOpen ? 'Ocultar fuentes' : `Ver fuentes (${citations.length})`}</span>
            </button>
          )}

          {/* Toggle de vista */}
          {hasStructuredContent && (
            <div className="inline-flex rounded-[4px] border border-[#262B33] bg-[#13161B] p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('structured')}
                className={`px-2 py-0.5 rounded-[3px] text-[10.5px] font-medium transition-colors cursor-pointer ${
                  viewMode === 'structured'
                    ? 'bg-[#171A20] text-[#F0F2F5]'
                    : 'text-[#929BAA] hover:text-[#F0F2F5]'
                }`}
              >
                Estructurada
              </button>
              <button
                type="button"
                onClick={() => setViewMode('markdown')}
                className={`px-2 py-0.5 rounded-[3px] text-[10.5px] font-medium transition-colors cursor-pointer ${
                  viewMode === 'markdown'
                    ? 'bg-[#171A20] text-[#F0F2F5]'
                    : 'text-[#929BAA] hover:text-[#F0F2F5]'
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
            className="p-1 rounded-[4px] border border-[#262B33] bg-[#171A20] text-[#929BAA] hover:text-[#F0F2F5] transition-colors cursor-pointer"
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
          <div className="rounded-[6px] border border-[#262B33] bg-[#171A20] p-4 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#929BAA]">
              <FileText className="h-3.5 w-3.5 text-[#3978F6]" />
              <span>Resumen Ejecutivo</span>
            </div>
            <p className="text-[14px] leading-relaxed text-[#F0F2F5]">
              {formatTextWithTechAndCitations(parsedSections.executive, citationMap, onSelectCitation)}
            </p>
          </div>

          {/* 2. Hallazgos Técnicos */}
          {parsedSections.findings.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#929BAA]">
                <Layers className="h-3.5 w-3.5 text-[#3978F6]" />
                <span>Hallazgos de Inteligencia</span>
              </div>
              <div className="grid gap-2">
                {parsedSections.findings.map((f, i) => (
                  <div
                    key={i}
                    className="rounded-[6px] border border-[#262B33] bg-[#14161C] p-3 space-y-1"
                  >
                    <div className="text-[13px] font-semibold text-[#F0F2F5]">
                      {f.title}
                    </div>
                    <div className="text-[13px] leading-relaxed text-[#929BAA]">
                      {formatTextWithTechAndCitations(f.body, citationMap, onSelectCitation)}
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
            <div className="rounded-[6px] border border-[#262B33] bg-[#171A20] p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#929BAA]">
                <Fingerprint className="h-3.5 w-3.5 text-[#3978F6]" />
                <span>Indicadores Técnicos Vinculados</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {technicalIndicators.cves.map((cve) => (
                  <span
                    key={cve}
                    className="font-tech text-[11.5px] px-2 py-0.5 rounded-[4px] border border-[#262B33] bg-[#13161B] text-[#F0F2F5]"
                  >
                    {cve}
                  </span>
                ))}
                {technicalIndicators.domains.slice(0, 4).map((dom) => (
                  <span
                    key={dom}
                    className="font-tech text-[11.5px] px-2 py-0.5 rounded-[4px] border border-[#262B33] bg-[#13161B] text-[#929BAA]"
                  >
                    {dom}
                  </span>
                ))}
                {technicalIndicators.hashes.slice(0, 2).map((h) => (
                  <span
                    key={h}
                    className="font-tech text-[11.5px] px-2 py-0.5 rounded-[4px] border border-[#262B33] bg-[#13161B] text-[#929BAA] truncate max-w-[200px]"
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
