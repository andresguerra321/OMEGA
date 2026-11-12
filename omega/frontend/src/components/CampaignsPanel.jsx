import { useEffect, useMemo, useState } from 'react';
import {
  Shield,
  Users,
  Globe,
  Calendar,
  Search,
  Copy,
  Check,
  MessageSquarePlus,
  FileCheck2,
  ExternalLink,
  ArrowLeft,
} from 'lucide-react';
import { fetchCampaigns, fetchCampaignDetail } from '../lib/api';

export function CampaignsPanel({ onAskInChat }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [familyFilter, setFamilyFilter] = useState('ALL');
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Filtros internos dentro del dossier de campaña
  const [iocSearch, setIocSearch] = useState('');
  const [iocTypeFilter, setIocTypeFilter] = useState('ALL');
  const [copiedValue, setCopiedValue] = useState('');

  useEffect(() => {
    fetchCampaigns()
      .then((data) => setCampaigns(data.campaigns || []))
      .catch(() => setCampaigns([]))
      .finally(() => setLoading(false));
  }, []);

  const families = useMemo(() => {
    const unique = new Set(campaigns.map((c) => c.spyware_family).filter(Boolean));
    return ['ALL', ...Array.from(unique)];
  }, [campaigns]);

  const visibleCampaigns = useMemo(() => {
    if (familyFilter === 'ALL') return campaigns;
    return campaigns.filter((c) => c.spyware_family === familyFilter);
  }, [campaigns, familyFilter]);

  async function handleOpenDossier(id) {
    setLoadingDetail(true);
    setIocSearch('');
    setIocTypeFilter('ALL');
    try {
      const detail = await fetchCampaignDetail(id);
      setSelectedDetail(detail);
    } finally {
      setLoadingDetail(false);
    }
  }

  function handleCopy(val) {
    navigator.clipboard.writeText(val);
    setCopiedValue(val);
    setTimeout(() => setCopiedValue(''), 1500);
  }

  const filteredIocs = useMemo(() => {
    if (!selectedDetail?.iocs) return [];
    return selectedDetail.iocs.filter((ioc) => {
      const matchesType = iocTypeFilter === 'ALL' || ioc.ioc_type === iocTypeFilter;
      const matchesText =
        !iocSearch.trim() ||
        ioc.ioc_value.toLowerCase().includes(iocSearch.toLowerCase()) ||
        (ioc.context || '').toLowerCase().includes(iocSearch.toLowerCase());
      return matchesType && matchesText;
    });
  }, [selectedDetail, iocTypeFilter, iocSearch]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center text-xs text-zinc-400">
        Cargando campañas normalizadas desde PostgreSQL...
      </div>
    );
  }

  // Vista de Dossier Detallado (RF6 + RF7)
  if (selectedDetail) {
    const iocTypes = ['ALL', ...Object.keys(selectedDetail.ioc_breakdown || {})];

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setSelectedDetail(null)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Volver al catálogo</span>
          </button>

          {onAskInChat && (
            <button
              type="button"
              onClick={() =>
                onAskInChat(
                  `Resume los vectores técnicos, exploits y hallazgos clave de la campaña "${selectedDetail.name}" (${selectedDetail.spyware_family}).`
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 px-3.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              <span>Investigar campaña en el Chat RAG</span>
            </button>
          )}
        </div>

        {/* Cabecera del Dossier */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-emerald-950/70 border border-emerald-700/40 px-2.5 py-1 text-xs font-semibold text-emerald-300">
              {selectedDetail.spyware_family}
            </span>
            {selectedDetail.first_seen_date && (
              <span className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-400">
                <Calendar className="h-3.5 w-3.5" />
                {selectedDetail.first_seen_date}
              </span>
            )}
          </div>

          <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
            {selectedDetail.name}
          </h2>
          <p className="text-sm leading-relaxed text-zinc-300">
            {selectedDetail.summary || 'Sin resumen ejecutivo registrado.'}
          </p>

          <div className="grid gap-3 pt-2 sm:grid-cols-3 text-xs">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 space-y-1">
              <div className="flex items-center gap-1.5 text-zinc-500">
                <Shield className="h-3.5 w-3.5" />
                <span>Actor / Operador presunto</span>
              </div>
              <p className="font-medium text-zinc-200">
                {selectedDetail.suspected_actor || 'No atribuido públicamente'}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 space-y-1">
              <div className="flex items-center gap-1.5 text-zinc-500">
                <Users className="h-3.5 w-3.5" />
                <span>Sector / Víctimas</span>
              </div>
              <p className="font-medium text-zinc-200">
                {selectedDetail.target_sector || 'No especificado'}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 space-y-1">
              <div className="flex items-center gap-1.5 text-zinc-500">
                <Globe className="h-3.5 w-3.5" />
                <span>Regiones documentadas</span>
              </div>
              <p className="font-medium text-zinc-200">
                {selectedDetail.target_regions?.length > 0
                  ? selectedDetail.target_regions.join(', ')
                  : 'Múltiples / N/D'}
              </p>
            </div>
          </div>
        </div>

        {/* Vulnerabilidades (CVEs) */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Vulnerabilidades Asociadas ({selectedDetail.cves?.length || 0})
          </h3>
          {selectedDetail.cves?.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedDetail.cves.map((c) => (
                <a
                  key={c.cve_code}
                  href={`https://nvd.nist.gov/vuln/detail/${c.cve_code}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-1.5 font-mono text-xs text-amber-300 hover:border-amber-600 transition"
                >
                  <span>{c.cve_code}</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No se registraron CVEs específicos en esta campaña.</p>
          )}
        </div>

        {/* Tabla Filtrable de IOCs Normalizados (RF6) */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Indicadores de Compromiso ({selectedDetail.iocs?.length || 0})
            </h3>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
                {iocTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setIocTypeFilter(t)}
                    className={`rounded px-2 py-0.5 font-mono text-[11px] uppercase transition ${
                      iocTypeFilter === t
                        ? 'bg-zinc-800 text-emerald-300'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
                <input
                  type="text"
                  value={iocSearch}
                  onChange={(e) => setIocSearch(e.target.value)}
                  placeholder="Filtrar IOC..."
                  className="rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {filteredIocs.length === 0 ? (
            <p className="text-xs text-zinc-500">Sin indicadores que coincidan con el filtro actual.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-xl border border-zinc-800">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-zinc-800 bg-zinc-950 text-zinc-400">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Tipo</th>
                    <th className="px-3 py-2.5 font-medium">Indicador</th>
                    <th className="px-3 py-2.5 font-medium">Contexto</th>
                    <th className="px-3 py-2.5 text-right font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70 bg-zinc-950/40">
                  {filteredIocs.map((ioc, idx) => (
                    <tr key={idx} className="hover:bg-zinc-900/50">
                      <td className="px-3 py-2 font-mono text-[11px] uppercase text-emerald-400">
                        {ioc.ioc_type}
                      </td>
                      <td className="px-3 py-2 font-mono text-zinc-200 break-all">
                        {ioc.ioc_value}
                      </td>
                      <td className="px-3 py-2 text-zinc-400">{ioc.context || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleCopy(ioc.ioc_value)}
                          title="Copiar indicador"
                          className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-700"
                        >
                          {copiedValue === ioc.ioc_value ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Trazabilidad de Reportes Fuente (RF7) */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Trazabilidad de Fuentes Ingeridas (RF7)
          </h3>
          <div className="space-y-2">
            {selectedDetail.reports?.map((rep) => (
              <div
                key={rep.id}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <FileCheck2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="font-medium text-zinc-100">{rep.title}</span>
                  </div>
                  <p className="font-mono text-[11px] text-zinc-500">
                    Org: {rep.organization} · Ingesta: {new Date(rep.ingested_at).toLocaleString()} · SHA-256:{' '}
                    {rep.file_hash?.slice(0, 16)}...
                  </p>
                </div>

                {rep.source_url?.startsWith('http') && (
                  <a
                    href={rep.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-300 hover:border-zinc-700"
                  >
                    <span>Fuente original</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Vista de Catálogo con Filtros por Familia
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Campañas Documentadas ({visibleCampaigns.length})</h2>
          <p className="text-xs text-zinc-400">
            Selecciona una campaña para inspeccionar actores, CVEs, tabla de IOCs y registro de ingesta.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-1">
          {families.map((fam) => (
            <button
              key={fam}
              type="button"
              onClick={() => setFamilyFilter(fam)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                familyFilter === fam
                  ? 'bg-zinc-800 text-emerald-300'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {fam === 'ALL' ? 'Todas' : fam}
            </button>
          ))}
        </div>
      </div>

      {loadingDetail && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400 animate-pulse">
          Cargando dossier técnico de la campaña...
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {visibleCampaigns.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => handleOpenDossier(c.id)}
            className="flex flex-col justify-between rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-left hover:border-emerald-500/40 hover:bg-zinc-900/70 transition"
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                  {c.spyware_family}
                </span>
                <span className="text-[11px] text-zinc-500">{c.first_seen_date || 'Fecha N/D'}</span>
              </div>
              <h3 className="text-sm font-semibold text-zinc-100">{c.name}</h3>
              <p className="line-clamp-2 text-xs text-zinc-400">{c.summary}</p>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-zinc-800/80 pt-2.5 text-[11px] text-zinc-400">
              <span>{c.cves?.length || 0} CVEs · {c.ioc_count} IOCs</span>
              <span className="text-emerald-400/90">Abrir dossier →</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

