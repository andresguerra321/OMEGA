import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Search,
  Shield,
  ExternalLink,
  Copy,
  Check,
  MessageSquare,
  FileText,
  Download,
  Globe,
  Link2,
  Smartphone,
  FileCode2,
  Terminal,
} from 'lucide-react';
import {
  fetchCampaigns,
  fetchCampaignDetail,
  fetchCampaignYara,
  fetchCampaignMvtScript,
} from '../lib/api';
import { useScrollReveal } from '../lib/useScrollReveal';
import { sanitizeSearchInput } from '../lib/validators';
import { OmegaWebIntelCard } from './OmegaWebIntelCard';
import {
  ActionConfirmationBanner,
  PanelEmptyState,
  PanelErrorBanner,
  PanelSkeleton,
} from './PanelStatePrimitives';

export function CampaignsPanel({
  onAskInChat,
  onVerifyLink,
  onAuditDevice,
  initialSearch = '',
  initialSearchKey = 0,
}) {
  const [campaigns, setCampaigns] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [searchQuery, setSearchQuery] = useState(initialSearch || '');
  const [familyFilter, setFamilyFilter] = useState('ALL');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportingType, setExportingType] = useState('');

  const [dossierTab, setDossierTab] = useState('cves'); // 'cves' | 'iocs' | 'sources'
  const [cveSearch, setCveSearch] = useState('');
  const [iocSearch, setIocSearch] = useState('');
  const [iocTypeFilter, setIocTypeFilter] = useState('ALL');
  const [copiedValue, setCopiedValue] = useState('');
  const [showWebExtractor, setShowWebExtractor] = useState(false);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const lastSearchKeyRef = useRef(0);
  const dossierRef = useRef(null);

  useEffect(() => {
    if (!initialSearchKey || initialSearchKey === lastSearchKeyRef.current) return undefined;
    lastSearchKeyRef.current = initialSearchKey;
    const q = String(initialSearch || '').trim();
    const timer = setTimeout(() => {
      setFamilyFilter('ALL');
      setSearchQuery(q);
      if (q && campaigns.length > 0) {
        const lower = q.toLowerCase();
        const hit = campaigns.find(
          (c) =>
            (c.name || '').toLowerCase().includes(lower) ||
            (c.spyware_family || '').toLowerCase().includes(lower) ||
            (c.suspected_actor || '').toLowerCase().includes(lower),
        );
        if (hit) {
          setSelectedId(hit.id);
          setMobileShowDetail(true);
        }
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [initialSearchKey, initialSearch, campaigns]);

  useScrollReveal(dossierRef, [selectedId, dossierTab, showWebExtractor, loadingDetail, mobileShowDetail]);

  async function loadCampaigns() {
    setLoadingList(true);
    setListError('');
    try {
      const data = await fetchCampaigns();
      const list = Array.isArray(data?.campaigns) ? data.campaigns : [];
      setCampaigns(list);
      setSelectedId((prev) => {
        const nextId = prev && list.some((c) => c.id === prev) ? prev : list[0]?.id ?? null;
        if (nextId && nextId !== prev) {
          setLoadingDetail(true);
        }
        return nextId;
      });
    } catch (err) {
      setCampaigns([]);
      setSelectedId(null);
      setListError(err?.message || 'No se pudo cargar el catálogo de amenazas.');
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchCampaigns()
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.campaigns) ? data.campaigns : [];
        setListError('');
        setCampaigns(list);
        const firstId = list[0]?.id ?? null;
        if (firstId) {
          setLoadingDetail(true);
          setSelectedId(firstId);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setCampaigns([]);
        setSelectedId(null);
        setListError(err?.message || 'No se pudo cargar el catálogo de amenazas.');
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onAuthChanged = (e) => {
      if (e?.detail?.accessToken) {
        void loadCampaigns();
      }
    };
    window.addEventListener('omega:auth-changed', onAuthChanged);
    return () => window.removeEventListener('omega:auth-changed', onAuthChanged);
  }, []);

  async function loadDetail(campaignId) {
    if (!campaignId) return;
    setLoadingDetail(true);
    setDetailError('');
    try {
      const data = await fetchCampaignDetail(campaignId);
      setDetail(data || null);
      if (data) {
        if ((data.cves?.length || 0) > 0) setDossierTab('cves');
        else if ((data.iocs?.length || 0) > 0) setDossierTab('iocs');
        else if ((data.reports?.length || 0) > 0) setDossierTab('sources');
        else setDossierTab('cves');
      }
    } catch (err) {
      setDetail(null);
      setDetailError(err?.message || 'No se pudo cargar el perfil de la amenaza.');
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    fetchCampaignDetail(selectedId)
      .then((data) => {
        if (cancelled) return;
        setDetailError('');
        setDetail(data || null);
        if (data) {
          if ((data.cves?.length || 0) > 0) setDossierTab('cves');
          else if ((data.iocs?.length || 0) > 0) setDossierTab('iocs');
          else if ((data.reports?.length || 0) > 0) setDossierTab('sources');
          else setDossierTab('cves');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(err?.message || 'No se pudo cargar el perfil de la amenaza.');
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
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
        (c.spyware_family || '').toLowerCase().includes(q) ||
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

  function triggerTextDownload(filename, content, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function buildCampaignSlug() {
    return (detail?.spyware_family || detail?.name || 'amenaza')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'amenaza';
  }

  function handleExportDossier() {
    if (!detail) return;
    setExportError('');
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

    triggerTextDownload(`omega_${buildCampaignSlug()}.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
    setActionNote(`Listo: ficha de amenaza "${detail.name}" exportada a Markdown.`);
  }

  async function handleExportYara() {
    if (!detail?.id || exportingType) return;
    setExportingType('yara');
    setExportError('');
    try {
      const data = await fetchCampaignYara(detail.id);
      const yaraContent = data?.yara_rule || '';
      if (!yaraContent) {
        throw new Error('La campaña no devolvió contenido YARA exportable.');
      }
      const fname = data?.filename || `omega_${buildCampaignSlug()}.yar`;
      triggerTextDownload(fname, yaraContent, 'text/plain;charset=utf-8');
      setActionNote(
        `Regla YARA "${fname}" exportada (${Number(data?.ioc_count || 0)} indicadores compilados).`
      );
    } catch (err) {
      setExportError(err?.message || 'No se pudo generar la regla YARA de esta campaña.');
    } finally {
      setExportingType('');
    }
  }

  async function handleExportMvt() {
    if (!detail?.id || exportingType) return;
    setExportingType('mvt');
    setExportError('');
    try {
      const data = await fetchCampaignMvtScript(detail.id);
      const scriptContent = data?.script || '';
      if (!scriptContent) {
        throw new Error('El worker forense no devolvió script MVT exportable.');
      }
      const fname = data?.filename || `omega_${buildCampaignSlug()}_mvt.sh`;
      triggerTextDownload(fname, scriptContent, 'text/x-shellscript;charset=utf-8');
      setActionNote(
        `Script MVT "${fname}" exportado (${Number(data?.ioc_count || 0)} IOCs STIX2 incluidos).`
      );
    } catch (err) {
      setExportError(err?.message || 'No se pudo exportar el script MVT de esta campaña.');
    } finally {
      setExportingType('');
    }
  }

  if (loadingList) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <PanelSkeleton
          label="Cargando catálogo de amenazas e indicadores CTI..."
          lines={4}
          className="w-full max-w-[440px]"
        />
      </div>
    );
  }

  if (listError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-[480px] space-y-4">
          <PanelErrorBanner message={listError} onRetry={loadCampaigns} />
          <PanelEmptyState
            icon={Shield}
            title="Catálogo temporalmente no disponible"
            description="Comprueba que el servicio OMEGA esté activo y reintenta cargar las campañas."
            actionLabel="Reintentar carga"
            onAction={loadCampaigns}
          />
        </div>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <PanelEmptyState
          icon={Shield}
          title="Aún no hay amenazas indexadas"
          description="Sincroniza las fuentes STIX 2.1 desde Inicio o realiza una consulta en el Asistente para explorar reportes de spyware."
          actionLabel={onAskInChat ? 'Consultar en Asistente' : undefined}
          onAction={
            onAskInChat
              ? () => onAskInChat('Resume las principales campañas de spyware comercial y CVEs documentados.')
              : undefined
          }
          secondaryLabel="Actualizar lista"
          onSecondaryAction={loadCampaigns}
          className="max-w-[480px]"
        />
      </div>
    );
  }

  const hasAttribution =
    Boolean(detail?.suspected_actor) ||
    Boolean(detail?.target_sector) ||
    Boolean(detail?.target_regions?.length);

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
      {/* Master List estilo macOS Mail / Notes Split View — ancho completo en móvil hasta elegir campaña */}
      <aside
        className={`${
          mobileShowDetail ? 'hidden md:flex' : 'flex'
        } w-full md:w-[296px] lg:w-[316px] shrink-0 apple-vibrancy md:border-r border-white/[0.07] flex-col min-h-0`}
      >
        <div className="p-3 border-b border-white/[0.06] space-y-2.5">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[#9A9AA2]" />
            <input
              type="text"
              maxLength={120}
              value={searchQuery}
              onChange={(e) => setSearchQuery(sanitizeSearchInput(e.target.value, 120))}
              placeholder="Buscar amenaza o CVE..."
              className="apple-well w-full h-9 rounded-[9px] pl-8 pr-3 text-[13px] text-[#F2F2F4] placeholder-[#9A9AA2] focus:border-[#2F6FED]/70 focus:shadow-[0_0_24px_rgba(47,111,237,0.2)] focus:outline-none transition-all"
            />
          </div>

          {families.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {families.map((fam) => {
                const active = familyFilter === fam;
                return (
                  <button
                    key={fam}
                    type="button"
                    onClick={() => setFamilyFilter(fam)}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-all duration-150 active:scale-95 cursor-pointer ${
                      active
                        ? 'bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] ring-1 ring-inset ring-[#2F6FED]/55 shadow-[0_0_20px_rgba(47,111,237,0.2)]'
                        : 'text-[#9A9AA2] hover:bg-white/[0.06] hover:text-[#F2F2F4]'
                    }`}
                  >
                    {fam === 'ALL' ? `Todas (${campaigns.length})` : fam}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredCampaigns.length === 0 ? (
            <PanelEmptyState
              title="Sin amenazas coincidentes"
              description="Ajusta el término de búsqueda o selecciona Todas las familias."
              actionLabel="Limpiar filtros"
              onAction={() => {
                setSearchQuery('');
                setFamilyFilter('ALL');
              }}
              className="m-2"
            />
          ) : (
            filteredCampaigns.map((camp, idx) => {
              const isSelected = camp.id === selectedId;
              const stats = [];
              if (camp.cves?.length > 0) stats.push(`${camp.cves.length} CVEs`);
              if (camp.ioc_count > 0) stats.push(`${camp.ioc_count} IOCs`);

              return (
                <button
                  key={camp.id}
                  type="button"
                  onClick={() => {
                    setCveSearch('');
                    setIocSearch('');
                    setIocTypeFilter('ALL');
                    setActionNote('');
                    setDetailError('');
                    if (camp.id !== selectedId) setLoadingDetail(true);
                    setSelectedId(camp.id);
                    setMobileShowDetail(true);
                  }}
                  style={{ animationDelay: `${Math.min(idx * 25, 200)}ms` }}
                  className={`animate-fade-up w-full rounded-[10px] px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.985] cursor-pointer block ${
                    isSelected
                      ? 'bg-[rgba(28,36,56,0.65)] ring-1 ring-inset ring-[#2F6FED]/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(47,111,237,0.2)]'
                      : 'bg-transparent hover:bg-white/[0.05]'
                  }`}
                >
                  <p className="text-[13.5px] font-medium tracking-[-0.01em] leading-[1.4] text-[#F2F2F4] line-clamp-2">
                    {camp.name}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-2 font-tech text-[11px] text-[#9A9AA2]">
                    <span className="truncate">
                      <span className="text-[#F2F2F4]/90">{camp.spyware_family}</span>
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

      {/* Dossier derecho — ocupa pantalla completa en móvil con botón de regreso */}
      <section
        ref={dossierRef}
        className={`${
          mobileShowDetail ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col min-w-0 overflow-y-auto px-4 sm:px-6 md:px-8 py-5 md:py-7`}
      >
        {/* Regreso rápido a la lista en teléfonos */}
        <div className="md:hidden mb-4 pb-3 border-b border-white/[0.07] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setMobileShowDetail(false)}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.1] bg-white/[0.05] px-3 py-1.5 text-[12.5px] font-medium text-[#F2F2F4] hover:bg-white/[0.09] active:scale-[0.96] transition-all cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#2F6FED]" />
            <span>Todas las amenazas</span>
          </button>

          {detail?.spyware_family && (
            <span className="font-tech rounded-full border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-2.5 py-0.5 text-[11px] text-[#F2F2F4] truncate">
              {detail.spyware_family}
            </span>
          )}
        </div>

        {loadingDetail ? (
          <div className="max-w-[820px] w-full mx-auto py-8">
            <PanelSkeleton label="Cargando ficha técnica, CVEs e IOCs..." lines={5} />
          </div>
        ) : detailError ? (
          <div className="max-w-[640px] w-full mx-auto py-8">
            <PanelErrorBanner
              message={detailError}
              onRetry={() => loadDetail(selectedId)}
            />
          </div>
        ) : !detail ? (
          <div className="max-w-[520px] w-full mx-auto my-auto py-12">
            <PanelEmptyState
              icon={Shield}
              title="Selecciona una campaña para ver su ficha"
              description="Explora las vulnerabilidades CVE, indicadores IOC y reportes primarios desde la columna izquierda."
            />
          </div>
        ) : (
          <div className="animate-fade-up w-full max-w-[820px] mx-auto space-y-6 pb-8">
            {actionNote && (
              <ActionConfirmationBanner
                message={actionNote}
                tone="clean"
                onDismiss={() => setActionNote('')}
              />
            )}
            {exportError && (
              <PanelErrorBanner
                message={exportError}
                onDismiss={() => setExportError('')}
              />
            )}
            {/* Cabecera */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2.5 font-tech text-[12px]">
                  {detail.spyware_family && (
                    <span className="rounded-full border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-2.5 py-0.5 text-[#F2F2F4]">
                      {detail.spyware_family}
                    </span>
                  )}
                  {detail.first_seen_date && (
                    <span className="text-[#9A9AA2]">{detail.first_seen_date}</span>
                  )}
                </div>
                <h1 className="text-[21px] sm:text-[24px] font-semibold tracking-[-0.024em] leading-[1.2] text-[#F2F2F4] break-words">
                  {detail.name}
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowWebExtractor((prev) => !prev)}
                  title="Extraer IPv4, dominios y CVEs desde artículo web en RAM (WebBaseLoader RNF4)"
                  className={`inline-flex items-center gap-1.5 rounded-[9px] border px-3 py-1.5 text-[12.5px] active:scale-[0.97] transition-all cursor-pointer ${
                    showWebExtractor
                      ? 'border-[#2F6FED]/55 bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] shadow-[0_0_20px_rgba(47,111,237,0.2)]'
                      : 'border-white/[0.08] bg-white/[0.045] text-[#F2F2F4]/85 hover:bg-white/[0.08] hover:text-[#F2F2F4]'
                  }`}
                >
                  <Globe className="h-3.5 w-3.5" />
                  <span>URL (RAM)</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportDossier}
                  title="Exportar ficha en Markdown"
                  className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12.5px] text-[#F2F2F4]/85 hover:bg-white/[0.08] hover:text-[#F2F2F4] active:scale-[0.97] transition-all cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>.md</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportYara}
                  disabled={Boolean(exportingType)}
                  title="Descargar regla YARA-X para detección local"
                  className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12.5px] text-[#F2F2F4]/85 hover:bg-white/[0.08] hover:text-[#F2F2F4] disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  <FileCode2 className="h-3.5 w-3.5 text-[#2F6FED]" />
                  <span>{exportingType === 'yara' ? '...' : 'YARA'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportMvt}
                  disabled={Boolean(exportingType)}
                  title="Exportar script bash MVT con STIX2 embebidos"
                  className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12.5px] text-[#F2F2F4]/85 hover:bg-white/[0.08] hover:text-[#F2F2F4] disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  <Terminal className="h-3.5 w-3.5 text-[#30D158]" />
                  <span>{exportingType === 'mvt' ? '...' : 'MVT'}</span>
                </button>

                {onAuditDevice && (
                  <button
                    type="button"
                    onClick={() => onAuditDevice('android')}
                    title="Auditar tu móvil o equipo frente a los IOCs de esta campaña"
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12.5px] text-[#F2F2F4]/85 hover:bg-white/[0.08] hover:text-[#F2F2F4] active:scale-[0.97] transition-all cursor-pointer"
                  >
                    <Smartphone className="h-3.5 w-3.5 text-[#2F6FED]" />
                    <span>Revisar equipo</span>
                  </button>
                )}

                {onAskInChat && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskInChat(
                        `Analiza en detalle la campaña "${detail.name}"${detail.spyware_family ? ` (${detail.spyware_family})` : ''}.`
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.28),inset_0_1px_0_rgba(255,255,255,0.22)] px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-[#2F6FED]/90 hover:shadow-[0_0_24px_rgba(47,111,237,0.35)] active:scale-[0.97] transition-all cursor-pointer"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Investigar en chat</span>
                  </button>
                )}
              </div>
            </div>

            {showWebExtractor && (
              <OmegaWebIntelCard
                compact
                onAskInChat={onAskInChat}
                title="Extraer indicadores CTI desde artículo público (WebBaseLoader RAM)"
                subtitle="Pega una URL de Citizen Lab, Amnesty Tech o Google TAG para obtener IPv4 públicas, dominios C2 y CVEs sin descargar HTML a disco."
              />
            )}

            {detail.summary && (
              <p className="max-w-[68ch] text-[15px] leading-[1.7] text-[#F2F2F4]/85">
                {detail.summary}
              </p>
            )}

            {/* Ficha agrupada de atribución */}
            {hasAttribution && (
              <dl className="omega-glass-panel animate-on-scroll rounded-[13px] grid gap-4 sm:grid-cols-3 p-4 text-[13.5px]">
                {detail.suspected_actor && (
                  <div className="space-y-1 min-w-0">
                    <dt className="text-[11.5px] font-medium text-[#9A9AA2]">Actor</dt>
                    <dd className="font-medium text-[#F2F2F4] break-words">{detail.suspected_actor}</dd>
                  </div>
                )}
                {detail.target_sector && (
                  <div className="space-y-1 min-w-0">
                    <dt className="text-[11.5px] font-medium text-[#9A9AA2]">Objetivo</dt>
                    <dd className="font-medium text-[#F2F2F4] break-words">{detail.target_sector}</dd>
                  </div>
                )}
                {detail.target_regions?.length > 0 && (
                  <div className="space-y-1 min-w-0">
                    <dt className="text-[11.5px] font-medium text-[#9A9AA2]">Regiones</dt>
                    <dd
                      className="font-medium text-[#F2F2F4] break-words"
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

            {/* Control Segmentado Glass */}
            <div className="space-y-4">
              <div className="apple-segmented inline-flex flex-wrap max-w-full gap-0.5 rounded-[10px] p-0.5">
                <button
                  type="button"
                  onClick={() => setDossierTab('cves')}
                  className={`rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-medium transition-all duration-150 cursor-pointer ${
                    dossierTab === 'cves'
                      ? 'apple-segmented-active'
                      : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                  }`}
                >
                  CVEs ({detail.cves?.length || 0})
                </button>

                <button
                  type="button"
                  onClick={() => setDossierTab('iocs')}
                  className={`rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-medium transition-all duration-150 cursor-pointer ${
                    dossierTab === 'iocs'
                      ? 'apple-segmented-active'
                      : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                  }`}
                >
                  IOCs ({totalIocCount})
                </button>

                <button
                  type="button"
                  onClick={() => setDossierTab('sources')}
                  className={`rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-medium transition-all duration-150 cursor-pointer ${
                    dossierTab === 'sources'
                      ? 'apple-segmented-active'
                      : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                  }`}
                >
                  Fuentes ({detail.reports?.length || 0})
                </button>
              </div>

              {/* TAB 1: CVEs */}
              {dossierTab === 'cves' && (
                <div className="space-y-3">
                  {(detail.cves?.length || 0) > 10 && (
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-3 top-2 h-3.5 w-3.5 text-[#9A9AA2]" />
                      <input
                        type="text"
                        value={cveSearch}
                        onChange={(e) => setCveSearch(e.target.value)}
                        placeholder="Filtrar CVE..."
                        className="apple-well w-full h-8 rounded-[9px] pl-8 pr-3 font-tech text-[12px] text-[#F2F2F4] placeholder-[#9A9AA2] focus:border-[#2F6FED]/70 focus:outline-none"
                      />
                    </div>
                  )}

                  {filteredCves.length === 0 ? (
                    <p className="text-[13px] text-[#9A9AA2] py-2">Sin CVEs vinculados.</p>
                  ) : hasCveDescriptions ? (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {filteredCves.map((cve, idx) => (
                        <div
                          key={cve.cve_code}
                          style={{ animationDelay: `${Math.min(idx * 35, 180)}ms` }}
                          className="apple-group animate-fade-up rounded-[12px] px-4 py-3 flex items-center justify-between gap-2.5 hover:border-white/[0.16] hover:-translate-y-0.5 transition-all duration-200"
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
                                className="font-tech text-[13.5px] font-medium text-[#F2F2F4] hover:underline decoration-[#2F6FED] underline-offset-4 transition-colors cursor-pointer"
                              >
                                {cve.cve_code}
                              </button>
                              {cve.cvss_score != null && (
                                <span className="font-tech rounded-full border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-2 py-0.5 text-[11px] text-[#F2F2F4]">
                                  {cve.cvss_score}
                                </span>
                              )}
                            </div>
                            {cve.description && (
                              <p className="text-[12.5px] leading-[1.5] text-[#9A9AA2] line-clamp-2">
                                {cve.description}
                              </p>
                            )}
                          </div>

                          <a
                            href={`https://nvd.nist.gov/vuln/detail/${cve.cve_code}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Abrir en NIST NVD"
                            className="shrink-0 p-1.5 rounded-[7px] text-[#9A9AA2] hover:bg-white/[0.08] hover:text-[#F2F2F4] transition-colors"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid gap-2 grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                      {filteredCves.map((cve, idx) => (
                        <div
                          key={cve.cve_code}
                          style={{ animationDelay: `${Math.min(idx * 25, 160)}ms` }}
                          className="apple-group animate-fade-up group rounded-[10px] h-9 px-2.5 sm:px-3 flex items-center justify-between gap-1.5 hover:border-[#2F6FED]/50 hover:-translate-y-0.5 transition-all duration-200"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              onAskInChat?.(`¿Cómo se explotó ${cve.cve_code} en "${detail.name}"?`)
                            }
                            title={`Preguntar por ${cve.cve_code}`}
                            className="font-tech text-[12.5px] text-[#F2F2F4] group-hover:text-white truncate transition-colors cursor-pointer"
                          >
                            {cve.cve_code}
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            {cve.cvss_score != null && (
                              <span className="font-tech text-[11px] text-[#9A9AA2]">
                                {cve.cvss_score}
                              </span>
                            )}
                            <a
                              href={`https://nvd.nist.gov/vuln/detail/${cve.cve_code}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Ver en NIST NVD"
                              className="text-[#9A9AA2] hover:text-[#F2F2F4] transition-colors"
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
                    <p className="text-[12.5px] text-[#9A9AA2] py-2">Sin IOCs vinculados.</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1">
                          {['ALL', ...Object.keys(detail.ioc_breakdown || {})].map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setIocTypeFilter(t)}
                              className={`font-tech rounded-full px-2.5 py-0.5 text-[11px] uppercase transition-colors cursor-pointer ${
                                iocTypeFilter === t
                                  ? 'bg-[rgba(28,36,56,0.65)] text-[#F2F2F4] ring-1 ring-inset ring-[#2F6FED]/55 shadow-[0_0_18px_rgba(47,111,237,0.2)]'
                                  : 'bg-white/[0.04] text-[#9A9AA2] border border-white/[0.08] hover:text-[#F2F2F4]'
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>

                        <div className="relative w-full sm:w-56">
                          <Search className="absolute left-3 top-2 h-3.5 w-3.5 text-[#9A9AA2]" />
                          <input
                            type="text"
                            maxLength={120}
                            value={iocSearch}
                            onChange={(e) => setIocSearch(sanitizeSearchInput(e.target.value, 120))}
                            placeholder="Filtrar indicador..."
                            className="apple-well w-full h-8 rounded-[9px] pl-8 pr-3 font-tech text-[12px] text-[#F2F2F4] placeholder-[#9A9AA2] focus:border-[#2F6FED]/70 focus:outline-none"
                          />
                        </div>
                      </div>

                      {totalIocCount > (detail.iocs?.length || 0) && (
                        <p className="font-tech text-[11px] text-[#9A9AA2]">
                          Mostrando {detail.iocs.length} de {totalIocCount}.
                        </p>
                      )}

                      {filteredIocs.length === 0 ? (
                        <p className="text-[13px] text-[#9A9AA2] py-2">Sin coincidencias.</p>
                      ) : (
                        <div className="apple-group animate-fade-up rounded-[13px] overflow-hidden">
                          <div className="max-h-[360px] overflow-y-auto overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                              <thead className="sticky top-0 bg-[#141418]/95 border-b border-white/[0.08] text-[12px] font-medium text-[#9A9AA2]">
                                <tr>
                                  <th className="px-3 sm:px-4 py-2.5 w-20 sm:w-24">Tipo</th>
                                  <th className="px-3 sm:px-4 py-2.5">Indicador</th>
                                  <th className="px-3 sm:px-4 py-2.5 hidden md:table-cell">Contexto</th>
                                  <th className="px-3 sm:px-4 py-2.5 w-11 text-right" />
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/[0.06] text-[13px]">
                                {filteredIocs.map((ioc, idx) => (
                                  <tr
                                    key={`${ioc.ioc_type}-${ioc.ioc_value}-${idx}`}
                                    className="hover:bg-white/[0.035] transition-colors"
                                  >
                                    <td className="px-3 sm:px-4 py-2.5 font-tech text-[11px] sm:text-[11.5px] uppercase text-[#9A9AA2] whitespace-nowrap">
                                      {ioc.ioc_type}
                                    </td>
                                    <td className="px-3 sm:px-4 py-2.5 font-tech text-[12.5px] text-[#F2F2F4] break-all min-w-0">
                                      {ioc.ioc_value}
                                    </td>
                                    <td className="px-3 sm:px-4 py-2.5 text-[#9A9AA2] hidden md:table-cell">
                                      {ioc.context || ''}
                                    </td>
                                    <td className="px-3 sm:px-4 py-2.5 text-right whitespace-nowrap">
                                      <div className="inline-flex items-center justify-end gap-1">
                                        {onVerifyLink &&
                                          ['domain', 'url', 'hostname', 'fqdn', 'ipv4', 'ip'].includes(
                                            String(ioc.ioc_type || '').toLowerCase(),
                                          ) && (
                                            <button
                                              type="button"
                                              onClick={() => onVerifyLink(ioc.ioc_value)}
                                              title="Inspeccionar indicador en Enlaces sin contacto HTTP"
                                              className="inline-flex items-center justify-center rounded-[6px] p-1 text-[#2F6FED] hover:bg-[rgba(28,36,56,0.65)] hover:text-[#F2F2F4] transition-colors cursor-pointer"
                                            >
                                              <Link2 className="h-3.5 w-3.5" />
                                            </button>
                                          )}
                                        <button
                                          type="button"
                                          onClick={() => handleCopy(ioc.ioc_value)}
                                          title="Copiar"
                                          className="inline-flex items-center justify-center rounded-[6px] p-1 text-[#9A9AA2] hover:bg-white/[0.08] hover:text-[#F2F2F4] transition-colors cursor-pointer"
                                        >
                                          {copiedValue === ioc.ioc_value ? (
                                            <Check className="h-3.5 w-3.5 text-[#2F6FED]" />
                                          ) : (
                                            <Copy className="h-3.5 w-3.5" />
                                          )}
                                        </button>
                                      </div>
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
                    <p className="text-[13px] text-[#9A9AA2] py-2">Sin fuentes vinculadas.</p>
                  ) : (
                    detail.reports.map((rep, idx) => (
                      <div
                        key={rep.id}
                        style={{ animationDelay: `${Math.min(idx * 45, 220)}ms` }}
                        className="apple-group animate-fade-up rounded-[12px] px-4 py-3.5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between hover:border-white/[0.16] hover:-translate-y-0.5 transition-all duration-200"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-start sm:items-center gap-2">
                            <FileText className="h-4 w-4 text-[#2F6FED] shrink-0 mt-0.5 sm:mt-0" />
                            <p className="text-[14px] font-medium tracking-[-0.01em] text-[#F2F2F4] break-words sm:truncate">
                              {rep.title}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 font-tech text-[12px] text-[#9A9AA2]">
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
                            className="inline-flex shrink-0 self-start sm:self-auto items-center gap-1.5 rounded-[8px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12px] text-[#F2F2F4] hover:bg-white/[0.08] active:scale-[0.97] transition-all"
                          >
                            <span>Abrir</span>
                            <ExternalLink className="h-3.5 w-3.5 text-[#9A9AA2]" />
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
