import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Shield,
  ExternalLink,
  Copy,
  Check,
  MessageSquare,
  FileText,
  Download,
} from 'lucide-react';
import { fetchCampaigns, fetchCampaignDetail } from '../lib/api';

export function CampaignsPanel({ onAskInChat }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [familyFilter, setFamilyFilter] = useState('ALL');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [dossierTab, setDossierTab] = useState('cves'); // 'cves' | 'iocs' | 'sources'
  const [cveSearch, setCveSearch] = useState('');
  const [iocSearch, setIocSearch] = useState('');
  const [iocTypeFilter, setIocTypeFilter] = useState('ALL');
  const [copiedValue, setCopiedValue] = useState('');

  useEffect(() => {
    let active = true;
    fetchCampaigns()
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data?.campaigns) ? data.campaigns : [];
        setCampaigns(list);
        if (list.length > 0) {
          setSelectedId(list[0].id);
        }
      })
      .catch(() => {
        if (!active) return;
        setCampaigns([]);
        setSelectedId(null);
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    let active = true;
    setLoadingDetail(true);
    setCveSearch('');
    setIocSearch('');
    setIocTypeFilter('ALL');

    fetchCampaignDetail(selectedId)
      .then((data) => {
        if (!active) return;
        setDetail(data || null);
        if (data) {
          if ((data.cves?.length || 0) > 0) setDossierTab('cves');
          else if ((data.iocs?.length || 0) > 0) setDossierTab('iocs');
          else if ((data.reports?.length || 0) > 0) setDossierTab('sources');
          else setDossierTab('cves');
        }
      })
      .catch(() => {
        if (active) setDetail(null);
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });

    return () => {
      active = false;
    };
  }, [selectedId]);

  const families = useMemo(() => {
    const unique = Array.from(new Set(campaigns.map((c) => c.spyware_family).filter(Boolean)));
    return unique.length > 1 ? ['ALL', ...unique] : [];
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      const matchesFamily = familyFilter === 'ALL' || c.spyware_family === familyFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.suspected_actor || '').toLowerCase().includes(q) ||
        (c.target_sector || '').toLowerCase().includes(q) ||
        (c.cves || []).some((cve) => cve.toLowerCase().includes(q));
      return matchesFamily && matchesSearch;
    });
  }, [campaigns, familyFilter, searchQuery]);

  const filteredCves = useMemo(() => {
    const list = detail?.cves || [];
    const q = cveSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (cve) =>
        cve.cve_code.toLowerCase().includes(q) ||
        (cve.description || '').toLowerCase().includes(q)
    );
  }, [detail, cveSearch]);

  const hasCveDescriptions = useMemo(
    () => (detail?.cves || []).some((cve) => Boolean(cve.description)),
    [detail]
  );

  const filteredIocs = useMemo(() => {
    if (!detail?.iocs) return [];
    return detail.iocs.filter((ioc) => {
      const matchesType = iocTypeFilter === 'ALL' || ioc.ioc_type === iocTypeFilter;
      const q = iocSearch.trim().toLowerCase();
      const matchesText =
        !q ||
        ioc.ioc_value.toLowerCase().includes(q) ||
        (ioc.context || '').toLowerCase().includes(q);
      return matchesType && matchesText;
    });
  }, [detail, iocTypeFilter, iocSearch]);

  const totalIocCount = useMemo(() => {
    if (!detail) return 0;
    const sum = Object.values(detail.ioc_breakdown || {}).reduce((acc, n) => acc + Number(n || 0), 0);
    return sum || detail.iocs?.length || 0;
  }, [detail]);

  function handleCopy(value) {
    navigator.clipboard.writeText(value);
    setCopiedValue(value);
    setTimeout(() => setCopiedValue(''), 1500);
  }

  function handleExportDossier() {
    if (!detail) return;
    const lines = [`# ${detail.name}`, ''];
    if (detail.spyware_family) lines.push(`- **Familia:** ${detail.spyware_family}`);
    if (detail.suspected_actor) lines.push(`- **Actor:** ${detail.suspected_actor}`);
    if (detail.target_sector) lines.push(`- **Objetivo:** ${detail.target_sector}`);
    if (detail.target_regions?.length) {
      lines.push(`- **Regiones:** ${detail.target_regions.join(', ')}`);
    }
    if (detail.first_seen_date) lines.push(`- **Fecha:** ${detail.first_seen_date}`);
    if (detail.summary) lines.push('', detail.summary);
    if (detail.cves?.length) {
      lines.push('', '## CVEs', ...detail.cves.map((c) => `- \`${c.cve_code}\``));
    }
    if (detail.iocs?.length) {
      lines.push(
        '',
        '## IOCs',
        ...detail.iocs.map((i) => `- [${i.ioc_type.toUpperCase()}] \`${i.ioc_value}\``)
      );
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = (detail.spyware_family || 'amenaza').toLowerCase().replace(/\s+/g, '_');
    a.download = `omega_${slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loadingList) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0A0A0C] text-[12.5px] text-[#8E8E96]">
        Cargando amenazas...
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0A0A0C] px-6 text-center">
        <Shield className="h-5 w-5 text-[#8E8E96]/50 mb-2" />
        <p className="text-[13px] text-[#8E8E96]">No hay amenazas registradas.</p>
      </div>
    );
  }

  const hasAttribution =
    Boolean(detail?.suspected_actor) ||
    Boolean(detail?.target_sector) ||
    Boolean(detail?.target_regions?.length);

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#0A0A0C]">
      {/* Lista izquierda compacta */}
      <aside className="w-[316px] shrink-0 border-r border-[#232329] bg-[#0A0A0C] flex flex-col min-h-0">
        <div className="p-3 border-b border-[#232329] space-y-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#9CA3B0]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar amenaza o CVE..."
              className="w-full h-9 rounded-[4px] border border-[#232329] bg-[#141418] pl-8 pr-2.5 text-[13px] text-[#F2F4F8] placeholder-[#949CA9] focus:border-[#2F6FED] focus:outline-none"
            />
          </div>

          {families.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {families.map((fam) => {
                const active = familyFilter === fam;
                return (
                  <button
                    key={fam}
                    type="button"
                    onClick={() => setFamilyFilter(fam)}
                    className={`rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#15223D] text-[#8AB4FF]'
                        : 'text-[#9CA3B0] hover:bg-[#141418] hover:text-[#F2F4F8]'
                    }`}
                  >
                    {fam === 'ALL' ? `Todas (${campaigns.length})` : fam}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#232329]/70">
          {filteredCampaigns.length === 0 ? (
            <div className="p-4 text-[13px] text-[#9CA3B0]">Sin resultados.</div>
          ) : (
            filteredCampaigns.map((camp) => {
              const isSelected = camp.id === selectedId;
              const stats = [];
              if (camp.cves?.length > 0) stats.push(`${camp.cves.length} CVEs`);
              if (camp.ioc_count > 0) stats.push(`${camp.ioc_count} IOCs`);

              return (
                <button
                  key={camp.id}
                  type="button"
                  onClick={() => setSelectedId(camp.id)}
                  className={`w-full px-3.5 py-3.5 text-left transition-colors cursor-pointer block border-l-2 ${
                    isSelected
                      ? 'bg-[#15223D]/55 border-l-[#2F6FED]'
                      : 'bg-transparent border-l-transparent hover:bg-[#141418]'
                  }`}
                >
                  <p className="text-[13.5px] font-medium leading-[1.42] text-[#F5F7FA] line-clamp-2">
                    {camp.name}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-2 font-tech text-[11.5px] text-[#9CA3B0]">
                    <span className="truncate">
                      <span className="text-[#8AB4FF]">{camp.spyware_family}</span>
                      {stats.length > 0 && ` · ${stats.join(' · ')}`}
                    </span>
                    {camp.first_seen_date && (
                      <span className="shrink-0">{camp.first_seen_date}</span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Dossier derecho limpio y plano */}
      <section className="flex-1 overflow-y-auto bg-[#0A0A0C] px-8 py-6">
        {loadingDetail ? (
          <div className="max-w-[820px] mx-auto py-10 text-[13.5px] text-[#9CA3B0]">
            Cargando detalle...
          </div>
        ) : !detail ? (
          <div className="max-w-[820px] mx-auto py-16 text-center text-[14px] text-[#9CA3B0]">
            Selecciona una amenaza.
          </div>
        ) : (
          <div className="max-w-[820px] mx-auto space-y-5">
            {/* Cabecera */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-2 font-tech text-[12px]">
                  {detail.spyware_family && (
                    <span className="rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-2 py-0.5 text-[#8AB4FF]">
                      {detail.spyware_family}
                    </span>
                  )}
                  {detail.first_seen_date && (
                    <span className="text-[#9CA3B0]">{detail.first_seen_date}</span>
                  )}
                </div>
                <h1 className="text-[21px] font-semibold tracking-[-0.01em] leading-[1.3] text-[#F5F7FA]">
                  {detail.name}
                </h1>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportDossier}
                  title="Exportar ficha en Markdown"
                  className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-3 py-1.5 text-[12.5px] text-[#9CA3B0] hover:border-[#2F6FED] hover:text-[#F2F4F8] transition-colors cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>.md</span>
                </button>

                {onAskInChat && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskInChat(
                        `Analiza en detalle la campaña "${detail.name}"${detail.spyware_family ? ` (${detail.spyware_family})` : ''}.`
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#2F6FED] px-3.5 py-1.5 text-[13px] font-medium text-[#F5F7FA] hover:bg-[#255ED4] transition-colors cursor-pointer"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Investigar en chat</span>
                  </button>
                )}
              </div>
            </div>

            {/* Síntesis directa (sin caja extra) */}
            {detail.summary && (
              <p className="max-w-[68ch] text-[15px] leading-[1.7] text-[#DCE1EA]">
                {detail.summary}
              </p>
            )}

            {/* Ficha plana de atribución (líneas 1px, sin tarjetas apiladas) */}
            {hasAttribution && (
              <dl className="grid gap-4 sm:grid-cols-3 border-y border-[#232329] py-4 text-[13.5px]">
                {detail.suspected_actor && (
                  <div className="space-y-1">
                    <dt className="text-[12px] text-[#9CA3B0]">Actor</dt>
                    <dd className="font-medium text-[#F5F7FA]">{detail.suspected_actor}</dd>
                  </div>
                )}
                {detail.target_sector && (
                  <div className="space-y-1">
                    <dt className="text-[12px] text-[#9CA3B0]">Objetivo</dt>
                    <dd className="font-medium text-[#F5F7FA]">{detail.target_sector}</dd>
                  </div>
                )}
                {detail.target_regions?.length > 0 && (
                  <div className="space-y-1">
                    <dt className="text-[12px] text-[#9CA3B0]">Regiones</dt>
                    <dd
                      className="font-medium text-[#F5F7FA]"
                      title={detail.target_regions.join(', ')}
                    >
                      {detail.target_regions.length > 5
                        ? `${detail.target_regions.slice(0, 5).join(', ')} (+${detail.target_regions.length - 5})`
                        : detail.target_regions.join(', ')}
                    </dd>
                  </div>
                )}
              </dl>
            )}

            {/* Pestañas limpias */}
            <div className="space-y-4">
              <div className="flex items-center gap-5 border-b border-[#232329]">
                <button
                  type="button"
                  onClick={() => setDossierTab('cves')}
                  className={`pb-2.5 text-[13px] font-medium border-b-2 transition-colors cursor-pointer ${
                    dossierTab === 'cves'
                      ? 'border-[#2F6FED] text-[#F5F7FA]'
                      : 'border-transparent text-[#9CA3B0] hover:text-[#F5F7FA]'
                  }`}
                >
                  CVEs ({detail.cves?.length || 0})
                </button>

                <button
                  type="button"
                  onClick={() => setDossierTab('iocs')}
                  className={`pb-2.5 text-[13px] font-medium border-b-2 transition-colors cursor-pointer ${
                    dossierTab === 'iocs'
                      ? 'border-[#2F6FED] text-[#F5F7FA]'
                      : 'border-transparent text-[#9CA3B0] hover:text-[#F5F7FA]'
                  }`}
                >
                  IOCs ({totalIocCount})
                </button>

                <button
                  type="button"
                  onClick={() => setDossierTab('sources')}
                  className={`pb-2.5 text-[13px] font-medium border-b-2 transition-colors cursor-pointer ${
                    dossierTab === 'sources'
                      ? 'border-[#2F6FED] text-[#F5F7FA]'
                      : 'border-transparent text-[#9CA3B0] hover:text-[#F5F7FA]'
                  }`}
                >
                  Fuentes ({detail.reports?.length || 0})
                </button>
              </div>

              {/* TAB 1: CVEs compactos sin relleno */}
              {dossierTab === 'cves' && (
                <div className="space-y-3">
                  {(detail.cves?.length || 0) > 10 && (
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[#8E8E96]" />
                      <input
                        type="text"
                        value={cveSearch}
                        onChange={(e) => setCveSearch(e.target.value)}
                        placeholder="Filtrar CVE..."
                        className="w-full h-8 rounded-[4px] border border-[#232329] bg-[#141418] pl-8 pr-2.5 font-tech text-[12px] text-[#F2F2F4] placeholder-[#8E8E96] focus:border-[#2F6FED] focus:outline-none"
                      />
                    </div>
                  )}

                  {filteredCves.length === 0 ? (
                    <p className="text-[13px] text-[#9CA3B0] py-2">Sin CVEs vinculados.</p>
                  ) : hasCveDescriptions ? (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {filteredCves.map((cve) => (
                        <div
                          key={cve.cve_code}
                          className="rounded-[6px] border border-[#232329] bg-[#141418] px-3.5 py-3 flex items-center justify-between gap-2.5"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  onAskInChat?.(
                                    `¿Cómo se explotó ${cve.cve_code} en "${detail.name}"?`
                                  )
                                }
                                title="Preguntar en chat"
                                className="font-tech text-[13.5px] font-medium text-[#F5F7FA] hover:text-[#8AB4FF] transition-colors cursor-pointer"
                              >
                                {cve.cve_code}
                              </button>
                              {cve.cvss_score != null && (
                                <span className="font-tech rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-1.5 py-0.5 text-[11px] text-[#8AB4FF]">
                                  {cve.cvss_score}
                                </span>
                              )}
                            </div>
                            {cve.description && (
                              <p className="text-[12.5px] leading-[1.5] text-[#B6BDC9] line-clamp-2">
                                {cve.description}
                              </p>
                            )}
                          </div>

                          <a
                            href={`https://nvd.nist.gov/vuln/detail/${cve.cve_code}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Abrir en NIST NVD"
                            className="shrink-0 p-1.5 rounded-[4px] text-[#9CA3B0] hover:bg-[#0A0A0C] hover:text-[#F2F4F8] transition-colors"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                      {filteredCves.map((cve) => (
                        <div
                          key={cve.cve_code}
                          className="group rounded-[4px] border border-[#232329] bg-[#141418]/75 h-9 px-3 flex items-center justify-between gap-1.5 hover:border-[#2F6FED]/55 transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              onAskInChat?.(`¿Cómo se explotó ${cve.cve_code} en "${detail.name}"?`)
                            }
                            title={`Preguntar por ${cve.cve_code}`}
                            className="font-tech text-[12.5px] text-[#F5F7FA] group-hover:text-[#8AB4FF] truncate transition-colors cursor-pointer"
                          >
                            {cve.cve_code}
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            {cve.cvss_score != null && (
                              <span className="font-tech text-[11px] text-[#8AB4FF]">
                                {cve.cvss_score}
                              </span>
                            )}
                            <a
                              href={`https://nvd.nist.gov/vuln/detail/${cve.cve_code}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Ver en NIST NVD"
                              className="text-[#9CA3B0] hover:text-[#F2F4F8] transition-colors"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: IOCs */}
              {dossierTab === 'iocs' && (
                <div className="space-y-3">
                  {totalIocCount === 0 ? (
                    <p className="text-[12px] text-[#8E8E96] py-2">Sin IOCs vinculados.</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1">
                          {['ALL', ...Object.keys(detail.ioc_breakdown || {})].map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setIocTypeFilter(t)}
                              className={`font-tech rounded-[4px] px-2 py-0.5 text-[11px] uppercase transition-colors cursor-pointer ${
                                iocTypeFilter === t
                                  ? 'bg-[#15223D] text-[#7AA7FF]'
                                  : 'bg-[#141418] text-[#8E8E96] border border-[#232329] hover:text-[#F2F2F4]'
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>

                        <div className="relative w-full sm:w-56">
                          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[#8E8E96]" />
                          <input
                            type="text"
                            value={iocSearch}
                            onChange={(e) => setIocSearch(e.target.value)}
                            placeholder="Filtrar indicador..."
                            className="w-full h-8 rounded-[4px] border border-[#232329] bg-[#141418] pl-8 pr-2.5 font-tech text-[12px] text-[#F2F2F4] placeholder-[#8E8E96] focus:border-[#2F6FED] focus:outline-none"
                          />
                        </div>
                      </div>

                      {totalIocCount > (detail.iocs?.length || 0) && (
                        <p className="font-tech text-[11px] text-[#8E8E96]">
                          Mostrando {detail.iocs.length} de {totalIocCount}.
                        </p>
                      )}

                      {filteredIocs.length === 0 ? (
                        <p className="text-[13px] text-[#9CA3B0] py-2">Sin coincidencias.</p>
                      ) : (
                        <div className="rounded-[6px] border border-[#232329] overflow-hidden">
                          <div className="max-h-[360px] overflow-y-auto">
                            <table className="w-full text-left border-collapse">
                              <thead className="sticky top-0 bg-[#141418] border-b border-[#232329] text-[12px] font-medium text-[#9CA3B0]">
                                <tr>
                                  <th className="px-3.5 py-2.5 w-24">Tipo</th>
                                  <th className="px-3.5 py-2.5">Indicador</th>
                                  <th className="px-3.5 py-2.5 hidden md:table-cell">Contexto</th>
                                  <th className="px-3.5 py-2.5 w-12 text-right" />
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#232329] bg-[#0A0A0C] text-[13px]">
                                {filteredIocs.map((ioc, idx) => (
                                  <tr
                                    key={`${ioc.ioc_type}-${ioc.ioc_value}-${idx}`}
                                    className="hover:bg-[#141418]/70 transition-colors"
                                  >
                                    <td className="px-3.5 py-2.5 font-tech text-[11.5px] uppercase text-[#8AB4FF]">
                                      {ioc.ioc_type}
                                    </td>
                                    <td className="px-3.5 py-2.5 font-tech text-[#F5F7FA] break-all">
                                      {ioc.ioc_value}
                                    </td>
                                    <td className="px-3.5 py-2.5 text-[#B6BDC9] hidden md:table-cell">
                                      {ioc.context || ''}
                                    </td>
                                    <td className="px-3.5 py-2.5 text-right">
                                      <button
                                        type="button"
                                        onClick={() => handleCopy(ioc.ioc_value)}
                                        title="Copiar"
                                        className="inline-flex items-center justify-center rounded-[4px] p-1 text-[#9CA3B0] hover:bg-[#141418] hover:text-[#F2F4F8] transition-colors cursor-pointer"
                                      >
                                        {copiedValue === ioc.ioc_value ? (
                                          <Check className="h-3.5 w-3.5 text-[#2F6FED]" />
                                        ) : (
                                          <Copy className="h-3.5 w-3.5" />
                                        )}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* TAB 3: Fuentes reales */}
              {dossierTab === 'sources' && (
                <div className="space-y-2.5">
                  {!detail.reports || detail.reports.length === 0 ? (
                    <p className="text-[13px] text-[#9CA3B0] py-2">Sin fuentes vinculadas.</p>
                  ) : (
                    detail.reports.map((rep) => (
                      <div
                        key={rep.id}
                        className="rounded-[6px] border border-[#232329] bg-[#141418] px-4 py-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-[#2F6FED] shrink-0" />
                            <p className="text-[14px] font-medium text-[#F5F7FA] truncate">
                              {rep.title}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 font-tech text-[12px] text-[#9CA3B0]">
                            {rep.organization && <span>{rep.organization}</span>}
                            {rep.publication_date && <span>· {rep.publication_date}</span>}
                            {rep.file_hash && (
                              <span title={rep.file_hash}>· {rep.file_hash.slice(0, 12)}</span>
                            )}
                          </div>
                        </div>

                        {rep.source_url?.startsWith('http') && (
                          <a
                            href={rep.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-3 py-1.5 text-[12px] text-[#F2F4F8] hover:border-[#2F6FED] transition-colors"
                          >
                            <span>Abrir</span>
                            <ExternalLink className="h-3.5 w-3.5 text-[#9CA3B0]" />
                          </a>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
