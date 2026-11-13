import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Copy,
  Database,
  FileText,
  Fingerprint,
  Layers,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { deriveInvestigationAnalysis, formatRelativeTimestamp } from '../lib/investigationParser';
import { MarkdownMessage, RichInlineText } from './MarkdownMessage';

function ConfidenceBadge({ level }) {
  const isHigh = level === 'Alta';
  const isMedium = level === 'Media';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#262B33] bg-[#13161B] px-2 py-0.5 text-[11px] font-medium text-[#F0F2F5]">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isHigh ? 'bg-[#3978F6]' : isMedium ? 'bg-[#929BAA]' : 'bg-[#565E6D]'
        }`}
      />
      <span>Confianza {level}</span>
    </span>
  );
}

export function InvestigationDossier({
  message,
  onSelectCitation,
  onNavigateToCampaigns,
}) {
  const [viewMode, setViewMode] = useState('dossier');
  const [copiedKey, setCopiedKey] = useState(null);

  const citations = message?.citations || [];
  const analysis = useMemo(() => deriveInvestigationAnalysis(message), [message]);
  const timestampLabel = formatRelativeTimestamp(message?.createdAt);

  function copyText(key, text) {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1600);
    }).catch(() => {});
  }

  const groupedFindings = useMemo(() => {
    const groups = new Map();
    for (const f of analysis.findings || []) {
      const cat = f.category || 'Hallazgo analítico';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(f);
    }
    return Array.from(groups.entries());
  }, [analysis.findings]);

  const indicators = analysis.related_indicators || {};
  const hasAnyIndicator =
    (indicators.cves?.length || 0) > 0 ||
    (indicators.iocs?.length || 0) > 0 ||
    (indicators.actors_families?.length || 0) > 0 ||
    (indicators.campaigns?.length || 0) > 0;

  return (
    <article className="space-y-3">
      {/* Cabecera analítica de la respuesta */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#929BAA]">
          <span className="inline-flex items-center gap-1.5 font-medium uppercase tracking-wider text-[#F0F2F5]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#3978F6]" />
            <span>Informe de Inteligencia</span>
          </span>
          <span className="text-[#262B33]">|</span>
          <ConfidenceBadge level={analysis.traceability?.overall_confidence || 'Referencial'} />
          {message?.createdAt && (
            <>
              <span className="text-[#262B33]">|</span>
              <span className="font-tech text-[11px] text-[#929BAA]">{timestampLabel}</span>
            </>
          )}
          {message?.model && (
            <>
              <span className="text-[#262B33]">|</span>
              <span className="font-tech text-[11px] text-[#929BAA]">{message.model}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-[5px] border border-[#262B33] bg-[#13161B] p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode('dossier')}
              className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors duration-150 cursor-pointer ${
                viewMode === 'dossier'
                  ? 'bg-[#171A20] text-[#F0F2F5]'
                  : 'text-[#929BAA] hover:text-[#F0F2F5]'
              }`}
            >
              Dossier analítico
            </button>
            <button
              type="button"
              onClick={() => setViewMode('markdown')}
              className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors duration-150 cursor-pointer ${
                viewMode === 'markdown'
                  ? 'bg-[#171A20] text-[#F0F2F5]'
                  : 'text-[#929BAA] hover:text-[#F0F2F5]'
              }`}
            >
              Texto completo
            </button>
          </div>

          <button
            type="button"
            onClick={() => copyText('summary', message?.content || '')}
            title="Copiar contenido completo en Markdown"
            className="inline-flex items-center gap-1.5 rounded-[5px] border border-[#262B33] bg-[#171A20] px-2.5 py-1 text-[11px] text-[#929BAA] hover:border-[#353C47] hover:text-[#F0F2F5] transition-colors duration-150 cursor-pointer"
          >
            {copiedKey === 'summary' ? (
              <>
                <Check className="h-3 w-3 text-[#3978F6]" />
                <span className="text-[#F0F2F5]">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>Copiar</span>
              </>
            )}
          </button>
        </div>
      </div>

      {analysis.insufficient_evidence ? (
        <div className="rounded-[6px] border border-[#262B33] border-l-2 border-l-[#929BAA] bg-[#171A20] p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-[#929BAA] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-[13px] font-semibold text-[#F0F2F5]">
              Sin evidencia suficiente en el corpus indexado
            </p>
            <p className="text-[13px] leading-relaxed text-[#929BAA]">
              {analysis.executive_summary}
            </p>
          </div>
        </div>
      ) : viewMode === 'markdown' ? (
        <div className="rounded-[6px] border border-[#262B33] border-l-2 border-l-[#3978F6] bg-[#171A20] p-5 space-y-4">
          <MarkdownMessage
            content={message.content}
            citations={citations}
            onSelectCitation={onSelectCitation}
          />
        </div>
      ) : (
        <div className="space-y-3.5">
          {/* 1. Respuesta ejecutiva */}
          <section className="rounded-[6px] border border-[#262B33] border-l-2 border-l-[#3978F6] bg-[#171A20] p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#929BAA]">
                Respuesta ejecutiva
              </p>
              <span className="font-tech text-[11px] text-[#929BAA]">
                {citations.length} {citations.length === 1 ? 'fuente' : 'fuentes'}
              </span>
            </div>
            <p className="text-[14px] leading-[1.65] text-[#F0F2F5]">
              <RichInlineText
                text={analysis.executive_summary}
                citations={citations}
                onSelectCitation={onSelectCitation}
              />
            </p>
          </section>

          {/* 2. Hallazgos organizados por categorías */}
          {groupedFindings.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#929BAA]">
                  Hallazgos por categoría
                </h3>
                <span className="font-tech text-[11px] text-[#929BAA]">
                  {analysis.findings.length} identificados
                </span>
              </div>

              <div className="rounded-[6px] border border-[#262B33] bg-[#171A20] divide-y divide-[#262B33]">
                {groupedFindings.map(([category, items]) => (
                  <div key={category} className="p-3.5 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <Layers className="h-3.5 w-3.5 text-[#3978F6]" />
                      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-[#929BAA]">
                        {category}
                      </span>
                    </div>

                    <div className="space-y-2.5 pl-5">
                      {items.map((item, fIdx) => (
                        <div
                          key={`${category}-${fIdx}`}
                          className="rounded-[5px] border border-[#262B33] bg-[#13161B] p-3 space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[13px] font-semibold text-[#F0F2F5]">
                              {item.title}
                            </p>
                            <div className="flex items-center gap-1.5">
                              <ConfidenceBadge level={item.confidence} />
                            </div>
                          </div>
                          <p className="text-[13px] leading-relaxed text-[#F0F2F5]/90">
                            <RichInlineText
                              text={item.summary}
                              citations={citations}
                              onSelectCitation={onSelectCitation}
                            />
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 3. Evidencias: fragmentos recuperados con citas y referencias */}
          {citations.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#929BAA]">
                  Evidencias recuperadas
                </h3>
                <span className="text-[11px] text-[#929BAA]">
                  Clic en cualquier fragmento para ver contexto
                </span>
              </div>

              <div className="grid gap-2.5 md:grid-cols-2">
                {citations.map((cit) => (
                  <button
                    key={cit.index}
                    type="button"
                    onClick={() => onSelectCitation(cit)}
                    className="group flex flex-col justify-between rounded-[6px] border border-[#262B33] bg-[#171A20] p-3.5 text-left hover:border-[#3978F6]/60 hover:bg-[#1A1E26] transition-colors duration-150 cursor-pointer space-y-2.5"
                  >
                    <div className="space-y-1.5 w-full">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="rounded-[4px] border border-[#262B33] bg-[#13161B] px-1.5 py-0.5 font-medium text-[#3978F6]">
                            [{cit.index}]
                          </span>
                          <span className="font-medium text-[#F0F2F5] truncate">
                            {cit.organization}
                          </span>
                          <span className="font-tech text-[#929BAA] shrink-0">
                            · p.{cit.page}
                          </span>
                        </div>
                        <span className="font-tech text-[11px] text-[#929BAA] shrink-0">
                          {(Number(cit.similarity || 0) * 100).toFixed(1)}%
                        </span>
                      </div>

                      <p className="text-[12.5px] font-medium text-[#F0F2F5] line-clamp-1">
                        {cit.title}
                      </p>

                      <p className="text-[12px] leading-relaxed text-[#929BAA] line-clamp-2">
                        “{cit.snippet}”
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-1.5 border-t border-[#262B33] w-full text-[11px] text-[#929BAA]">
                      <span>{cit.retrieval_method || 'Híbrido (Vector + Exacto)'}</span>
                      <span className="inline-flex items-center gap-1 font-medium text-[#929BAA] group-hover:text-[#3978F6] transition-colors duration-150">
                        <span>Auditar fuente</span>
                        <ArrowUpRight className="h-3 w-3" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* 4. Indicadores relacionados: CVEs, IOCs, actores y campañas */}
          {hasAnyIndicator && (
            <section className="rounded-[6px] border border-[#262B33] bg-[#171A20] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Fingerprint className="h-3.5 w-3.5 text-[#3978F6]" />
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#929BAA]">
                    Indicadores relacionados
                  </h3>
                </div>
                {(indicators.cves?.length || 0) + (indicators.iocs?.length || 0) > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        'all-iocs',
                        [
                          ...(indicators.cves || []),
                          ...(indicators.iocs || []).map((i) => i.value),
                        ].join('\n')
                      )
                    }
                    className="inline-flex items-center gap-1 text-[11px] text-[#929BAA] hover:text-[#F0F2F5] transition-colors duration-150 cursor-pointer"
                  >
                    {copiedKey === 'all-iocs' ? (
                      <>
                        <Check className="h-3 w-3 text-[#3978F6]" />
                        <span>Indicadores copiados</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copiar lista técnica</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {indicators.cves?.length > 0 && (
                  <div className="rounded-[5px] border border-[#262B33] bg-[#13161B] p-3 space-y-2">
                    <p className="text-[11px] font-medium text-[#929BAA]">
                      Vulnerabilidades (CVEs)
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {indicators.cves.map((cve) => (
                        <button
                          key={cve}
                          type="button"
                          onClick={() => copyText(`cve-${cve}`, cve)}
                          title="Copiar identificador CVE"
                          className="font-tech inline-flex items-center gap-1.5 rounded-[4px] border border-[#262B33] bg-[#171A20] px-2 py-1 text-[11.5px] text-[#F0F2F5] hover:border-[#3978F6]/60 transition-colors duration-150 cursor-pointer"
                        >
                          <span>{cve}</span>
                          {copiedKey === `cve-${cve}` && (
                            <Check className="h-3 w-3 text-[#3978F6]" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {indicators.actors_families?.length > 0 && (
                  <div className="rounded-[5px] border border-[#262B33] bg-[#13161B] p-3 space-y-2">
                    <p className="text-[11px] font-medium text-[#929BAA]">
                      Actores y familias de spyware
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {indicators.actors_families.map((actor) => (
                        <span
                          key={actor}
                          className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#262B33] bg-[#171A20] px-2.5 py-1 text-[12px] font-medium text-[#F0F2F5]"
                        >
                          <ShieldAlert className="h-3 w-3 text-[#3978F6]" />
                          <span>{actor}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {indicators.iocs?.length > 0 && (
                  <div className="rounded-[5px] border border-[#262B33] bg-[#13161B] p-3 space-y-2 md:col-span-2">
                    <p className="text-[11px] font-medium text-[#929BAA]">
                      IOCs y artefactos asociados
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {indicators.iocs.map((ioc) => (
                        <button
                          key={`${ioc.type}-${ioc.value}`}
                          type="button"
                          onClick={() => copyText(`ioc-${ioc.value}`, ioc.value)}
                          title={`${ioc.type} · ${ioc.source || 'Corpus CTI'} (clic para copiar)`}
                          className="inline-flex items-center gap-2 rounded-[4px] border border-[#262B33] bg-[#171A20] px-2 py-1 text-[11.5px] hover:border-[#3978F6]/60 transition-colors duration-150 cursor-pointer"
                        >
                          <span className="text-[10px] uppercase tracking-wider text-[#929BAA]">
                            {ioc.type}
                          </span>
                          <span className="font-tech text-[#F0F2F5] break-all">
                            {ioc.value}
                          </span>
                          {copiedKey === `ioc-${ioc.value}` && (
                            <Check className="h-3 w-3 text-[#3978F6]" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {indicators.campaigns?.length > 0 && (
                  <div className="rounded-[5px] border border-[#262B33] bg-[#13161B] p-3 space-y-2 md:col-span-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-medium text-[#929BAA]">
                        Campañas correlacionadas en base CTI
                      </p>
                      {onNavigateToCampaigns && (
                        <button
                          type="button"
                          onClick={onNavigateToCampaigns}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#3978F6] hover:underline cursor-pointer"
                        >
                          <span>Explorar en Amenazas</span>
                          <ArrowUpRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {indicators.campaigns.map((camp) => (
                        <div
                          key={camp.id}
                          className="rounded-[4px] border border-[#262B33] bg-[#171A20] px-3 py-2 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="text-[12.5px] font-medium text-[#F0F2F5] truncate">
                              {camp.name}
                            </p>
                            <p className="text-[11px] text-[#929BAA] truncate">
                              {camp.spyware_family}
                              {camp.target_sector ? ` · ${camp.target_sector}` : ''}
                            </p>
                          </div>
                          <Database className="h-3.5 w-3.5 text-[#929BAA] shrink-0" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 5. Trazabilidad: fuentes utilizadas y nivel de confianza */}
          {analysis.traceability?.sources?.length > 0 && (
            <section className="rounded-[6px] border border-[#262B33] bg-[#13161B] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#262B33] flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-[#3978F6]" />
                  <span className="font-semibold uppercase tracking-wider text-[#929BAA]">
                    Trazabilidad y confianza
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[#929BAA]">
                  <span>
                    Fuentes:{' '}
                    <strong className="font-tech font-medium text-[#F0F2F5]">
                      {analysis.traceability.sources_count}
                    </strong>
                  </span>
                  <span className="text-[#262B33]">|</span>
                  <span>
                    Coincidencia híbrida:{' '}
                    <strong className="font-tech font-medium text-[#F0F2F5]">
                      {analysis.traceability.hybrid_count}/{analysis.traceability.sources_count}
                    </strong>
                  </span>
                  <span className="text-[#262B33]">|</span>
                  <span>
                    Similitud máx.:{' '}
                    <strong className="font-tech font-medium text-[#F0F2F5]">
                      {(Number(analysis.traceability.max_similarity || 0) * 100).toFixed(1)}%
                    </strong>
                  </span>
                </div>
              </div>

              <div className="divide-y divide-[#262B33]">
                {analysis.traceability.sources.map((src, idx) => {
                  const rawCit = citations[idx] || src;
                  return (
                    <button
                      key={`${src.index}-${src.page}`}
                      type="button"
                      onClick={() => onSelectCitation(rawCit)}
                      className="w-full px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-[#171A20] transition-colors duration-150 cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="text-[11px] font-medium text-[#3978F6] shrink-0">
                          [{src.index}]
                        </span>
                        <span className="text-[12px] text-[#F0F2F5] truncate">
                          {src.title}
                        </span>
                        <span className="text-[11px] text-[#929BAA] shrink-0 hidden sm:inline">
                          {src.organization}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 text-[11px]">
                        <span className="text-[#929BAA] hidden md:inline">
                          {src.retrieval_method}
                        </span>
                        <span className="font-tech text-[#929BAA]">p.{src.page}</span>
                        <span className="font-tech text-[#F0F2F5]">
                          {(Number(src.similarity || 0) * 100).toFixed(1)}%
                        </span>
                        <ConfidenceBadge level={src.confidence} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </article>
  );
}

