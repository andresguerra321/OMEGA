import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Shield,
  Users,
  Globe,
  Calendar,
  ExternalLink,
  Copy,
  Check,
  MessageSquare,
  FileCheck2,
  Download,
  Layers,
  AlertCircle,
} from 'lucide-react';
import { fetchCampaigns, fetchCampaignDetail } from '../lib/api';

const PRIORITY_FAMILIES = ['Pegasus', 'Predator', 'Candiru'];

const DEMO_DETAILS_BY_ID = {
  'demo-forcedentry': {
    id: 'demo-forcedentry',
    name: 'FORCEDENTRY — Explotación Zero-Click en iMessage (NSO Group)',
    spyware_family: 'Pegasus',
    suspected_actor: 'NSO Group / Operadores estatales',
    target_sector: 'Periodistas, activistas de derechos humanos y abogados',
    target_regions: ['Bahréin', 'Polonia', 'El Salvador', 'Cataluña'],
    first_seen_date: '2021-09-13',
    summary:
      'Cadena de explotación zero-click que aprovecha un desbordamiento de enteros en el decodificador JBIG2 de CoreGraphics al recibir PDFs disfrazados como GIFs en iMessage, evadiendo la jaula de aislamiento BlastDoor introducida en iOS 14.',
    cves: [
      {
        cve_code: 'CVE-2021-30860',
        description: 'Desbordamiento de enteros en CoreGraphics (PDF/JBIG2) con ejecución remota.',
        cvss_score: 9.8,
      },
      {
        cve_code: 'CVE-2021-31010',
        description: 'Escalamiento de privilegios y escape del sandbox en macOS/iOS.',
        cvss_score: 7.8,
      },
    ],
    iocs: [
      {
        ioc_type: 'process',
        ioc_value: 'IMTranscoderAgent',
        context: 'Proceso afectado durante el procesamiento inicial del adjunto PassKit/GIF',
      },
      {
        ioc_type: 'process',
        ioc_value: 'roleaccountd',
        context: 'Binario anómalo observado tras el escape del sandbox en dispositivos comprometidos',
      },
      {
        ioc_type: 'domain',
        ioc_value: 'free247downloads.com',
        context: 'Dominio de entrega/señuelo documentado en telemetría de red relacionada',
      },
      {
        ioc_type: 'sha256',
        ioc_value: 'f1c9645dbc14efddc7d8a322685f26eb2c3b55f6e8655e71d0f1320b9f6e5c1a',
        context: 'Muestra de artefacto PDF malicioso capturado en dispositivo objetivo',
      },
    ],
    ioc_breakdown: { process: 2, domain: 1, sha256: 1 },
    reports: [
      {
        id: 'demo-rep-1',
        title: 'FORCEDENTRY: NSO Group iMessage Zero-Click Exploit Captured in the Wild',
        organization: 'Citizen Lab',
        publication_date: '2021-09-13',
        source_url:
          'https://citizenlab.ca/2021/09/forcedentry-nso-group-imessage-zero-click-exploit-captured-in-the-wild/',
        file_hash: 'a84c92d41e09b71c22e84a90b7d139c441f87a02bc9e18f75d24c9b2e839a110',
        ingested_at: '2026-11-12T17:03:00Z',
      },
    ],
  },
  'demo-predator': {
    id: 'demo-predator',
    name: 'The Predator Files — Operaciones Intellexa Alliance',
    spyware_family: 'Predator',
    suspected_actor: 'Intellexa Alliance / Cytrox',
    target_sector: 'Funcionarios gubernamentales, periodistas y diplomáticos',
    target_regions: ['Egipto', 'Grecia', 'Vietnam', 'Unión Europea'],
    first_seen_date: '2023-10-09',
    summary:
      'Investigación técnica coordinada sobre el despliegue comercial del spyware Predator mediante enlaces de 1-click enviados por SMS y mensajería, combinados con inyección táctica de red y exploits de día cero en Chrome y Android.',
    cves: [
      {
        cve_code: 'CVE-2021-38000',
        description: 'Validación insuficiente de entrada no confiable en Intents de Android.',
        cvss_score: 6.1,
      },
      {
        cve_code: 'CVE-2021-38003',
        description: 'Implementación incorrecta en V8 (Chrome) explotada en cadena 1-click.',
        cvss_score: 8.8,
      },
      {
        cve_code: 'CVE-2021-1048',
        description: 'Use-after-free en el subsistema epoll del kernel Linux/Android.',
        cvss_score: 7.8,
      },
    ],
    iocs: [
      {
        ioc_type: 'domain',
        ioc_value: 'smscentro.com',
        context: 'Dominio señuelo utilizado en campañas de entrega vía SMS',
      },
      {
        ioc_type: 'domain',
        ioc_value: 'shorten.fi',
        context: 'Acortador táctico vinculado a redirecciones hacia la cadena de infección',
      },
      {
        ioc_type: 'ip',
        ioc_value: '185.141.63.120',
        context: 'Nodo de infraestructura C2 correlacionado con servidores de entrega Intellexa',
      },
    ],
    ioc_breakdown: { domain: 2, ip: 1 },
    reports: [
      {
        id: 'demo-rep-2',
        title: 'The Predator Files: Technical Deep-Dive into Intellexa Alliance Surveillance Products',
        organization: 'Amnesty International Security Lab',
        publication_date: '2023-10-09',
        source_url: 'https://securitylab.amnesty.org/',
        file_hash: '6c1bc2133a6f5bee8212fe7ae8a66ffb46832ea8f60513b6f08f77cb7da9f791',
        ingested_at: '2026-11-12T17:03:00Z',
      },
    ],
  },
  'demo-candiru': {
    id: 'demo-candiru',
    name: 'Hooking Candiru — Vigilancia contra disidentes y sociedad civil',
    spyware_family: 'Candiru',
    suspected_actor: 'Saito Tech Ltd. (Candiru)',
    target_sector: 'Disidentes políticos, ONG y periodistas de investigación',
    target_regions: ['Oriente Medio', 'Europa', 'Sudeste Asiático'],
    first_seen_date: '2021-07-15',
    summary:
      'Campaña atribuida al proveedor Candiru orientada a comprometer navegadores y sistemas Windows mediante enlaces personalizados de watering hole, suplantación de portales activistas y persistencia con módulos firmados.',
    cves: [
      {
        cve_code: 'CVE-2021-31979',
        description: 'Escalamiento de privilegios en el kernel de Windows empleado para persistencia.',
        cvss_score: 7.8,
      },
      {
        cve_code: 'CVE-2021-33771',
        description: 'Vulnerabilidad de corrupción en kernel Windows explotada en cadena DevilsTongue.',
        cvss_score: 7.8,
      },
    ],
    iocs: [
      {
        ioc_type: 'domain',
        ioc_value: 'tabnak-news.com',
        context: 'Dominio de suplantación vinculado a infraestructura de vigilancia Candiru',
      },
      {
        ioc_type: 'sha256',
        ioc_value: '9c7d841a5f422b8e110c4c2f891a2d33b84d210b3a7f5e1692c88e0b22014c9d',
        context: 'Hash de binario loader DevilsTongue analizado en Windows',
      },
    ],
    ioc_breakdown: { domain: 1, sha256: 1 },
    reports: [
      {
        id: 'demo-rep-3',
        title: 'Hooking Candiru: Another Mercenary Spyware Vendor Comes into Focus',
        organization: 'Citizen Lab',
        publication_date: '2021-07-15',
        source_url: 'https://citizenlab.ca/2021/07/hooking-candiru-another-mercenary-spyware-vendor-comes-into-focus/',
        file_hash: '3f19d07bc25a82441e91d64053fa9211b785f0e2c3481a92bb4e09a282c57e12',
        ingested_at: '2026-11-12T17:03:00Z',
      },
    ],
  },
};

const DEMO_CAMPAIGNS = Object.values(DEMO_DETAILS_BY_ID).map((d) => ({
  id: d.id,
  name: d.name,
  spyware_family: d.spyware_family,
  suspected_actor: d.suspected_actor,
  target_sector: d.target_sector,
  target_regions: d.target_regions,
  first_seen_date: d.first_seen_date,
  summary: d.summary,
  ioc_count: d.iocs.length,
  cves: d.cves.map((c) => c.cve_code),
}));

export function CampaignsPanel({ onAskInChat }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [usingDemoData, setUsingDemoData] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [familyFilter, setFamilyFilter] = useState('ALL');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Pestaña activa dentro del dossier (Divulgación Progresiva RNF2)
  const [dossierTab, setDossierTab] = useState('cves'); // 'cves' | 'iocs' | 'sources'
  const [iocSearch, setIocSearch] = useState('');
  const [iocTypeFilter, setIocTypeFilter] = useState('ALL');
  const [copiedValue, setCopiedValue] = useState('');

  useEffect(() => {
    let active = true;
    fetchCampaigns()
      .then((data) => {
        if (!active) return;
        const list = data?.campaigns || [];
        if (list.length > 0) {
          setCampaigns(list);
          setSelectedId(list[0].id);
          setUsingDemoData(false);
        } else {
          setCampaigns(DEMO_CAMPAIGNS);
          setSelectedId(DEMO_CAMPAIGNS[0].id);
          setUsingDemoData(true);
        }
      })
      .catch(() => {
        if (!active) return;
        setCampaigns(DEMO_CAMPAIGNS);
        setSelectedId(DEMO_CAMPAIGNS[0].id);
        setUsingDemoData(true);
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
    setIocSearch('');
    setIocTypeFilter('ALL');

    if (DEMO_DETAILS_BY_ID[selectedId]) {
      setDetail(DEMO_DETAILS_BY_ID[selectedId]);
      setLoadingDetail(false);
      return () => {
        active = false;
      };
    }

    fetchCampaignDetail(selectedId)
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch(() => {
        if (active) setDetail(DEMO_DETAILS_BY_ID[selectedId] || null);
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });

    return () => {
      active = false;
    };
  }, [selectedId]);

  const families = useMemo(() => {
    const present = Array.from(new Set(campaigns.map((c) => c.spyware_family).filter(Boolean)));
    const ordered = [
      ...PRIORITY_FAMILIES.filter((f) => present.includes(f)),
      ...present.filter((f) => !PRIORITY_FAMILIES.includes(f)),
    ];
    return ['ALL', ...ordered];
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
    const lines = [
      `# Ficha Técnica de Amenaza — ${detail.name}`,
      '',
      `- **Familia de Spyware:** ${detail.spyware_family}`,
      `- **Actor / Operador presunto:** ${detail.suspected_actor || 'No atribuido'}`,
      `- **Sector objetivo:** ${detail.target_sector || 'No especificado'}`,
      `- **Regiones:** ${(detail.target_regions || []).join(', ') || 'N/D'}`,
      `- **Primera detección:** ${detail.first_seen_date || 'N/D'}`,
      '',
      `## Resumen Ejecutivo\n${detail.summary || 'Sin resumen disponible.'}`,
      '',
      `## Vulnerabilidades (CVEs)\n${
        detail.cves?.length
          ? detail.cves.map((c) => `- \`${c.cve_code}\``).join('\n')
          : '- Ningún CVE vinculado'
      }`,
      '',
      `## Indicadores de Compromiso (${totalIocCount})\n${
        detail.iocs?.length
          ? detail.iocs.map((i) => `- [${i.ioc_type.toUpperCase()}] \`${i.ioc_value}\``).join('\n')
          : '- Sin IOCs registrados'
      }`,
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omega_amenaza_${detail.spyware_family.toLowerCase().replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#0A0A0C]">
      {/* ===================================================================
          PANEL IZQUIERDO (Master List): Catálogo y Filtros de Campañas
          =================================================================== */}
      <aside className="w-[340px] shrink-0 border-r border-[#232329] bg-[#0A0A0C] flex flex-col min-h-0">
        {/* Buscador y Filtros */}
        <div className="p-3.5 border-b border-[#232329] space-y-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[#8E8E96]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar campaña, actor o CVE..."
              className="w-full h-8 rounded-[4px] border border-[#232329] bg-[#141418] pl-8 pr-3 text-[12px] text-[#F2F2F4] placeholder-[#8E8E96] focus:border-[#2F6FED] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            {families.map((fam) => {
              const active = familyFilter === fam;
              return (
                <button
                  key={fam}
                  type="button"
                  onClick={() => setFamilyFilter(fam)}
                  className={`shrink-0 rounded-[4px] px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#15223D] text-[#7AA7FF] border border-[#2F6FED]/40'
                      : 'bg-[#141418] text-[#8E8E96] border border-[#232329] hover:text-[#F2F2F4]'
                  }`}
                >
                  {fam === 'ALL' ? `Todas (${campaigns.length})` : fam}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lista de Campañas */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#232329]">
          {loadingList ? (
            <div className="p-5 text-[12px] text-[#8E8E96]">
              Cargando campañas normalizadas...
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="p-5 text-[12px] text-[#8E8E96]">
              No hay campañas que coincidan con el filtro aplicado.
            </div>
          ) : (
            filteredCampaigns.map((camp) => {
              const isSelected = camp.id === selectedId;
              return (
                <button
                  key={camp.id}
                  type="button"
                  onClick={() => setSelectedId(camp.id)}
                  className={`w-full p-4 text-left transition-colors cursor-pointer block ${
                    isSelected
                      ? 'bg-[#15223D]/60 border-l-2 border-l-[#2F6FED]'
                      : 'bg-transparent hover:bg-[#141418] border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="font-tech rounded-[4px] border border-[#232329] bg-[#141418] px-1.5 py-0.5 text-[10px] font-medium text-[#7AA7FF]">
                      {camp.spyware_family}
                    </span>
                    <span className="font-tech text-[11px] text-[#8E8E96]">
                      {camp.first_seen_date || 'N/D'}
                    </span>
                  </div>

                  <h3 className="text-[13px] font-medium leading-snug text-[#F2F2F4] line-clamp-2">
                    {camp.name}
                  </h3>

                  <div className="mt-2.5 flex items-center gap-2 font-tech text-[11px] text-[#8E8E96]">
                    <span>{camp.cves?.length || 0} CVEs</span>
                    <span>·</span>
                    <span>{camp.ioc_count || 0} IOCs</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ===================================================================
          PANEL DERECHO (Detail View): Dossier Técnico de la Campaña (RF6)
          =================================================================== */}
      <section className="flex-1 overflow-y-auto bg-[#0A0A0C] px-8 py-7">
        {loadingDetail ? (
          <div className="max-w-[840px] mx-auto py-12 text-[13px] text-[#8E8E96]">
            Cargando dossier técnico de la campaña...
          </div>
        ) : !detail ? (
          <div className="max-w-[840px] mx-auto py-16 text-center space-y-2">
            <Layers className="h-6 w-6 text-[#8E8E96] mx-auto" />
            <p className="text-[14px] font-medium text-[#F2F2F4]">
              Selecciona una campaña del catálogo
            </p>
            <p className="text-[12px] text-[#8E8E96]">
              Aquí podrás inspeccionar actores, víctimas, CVEs, indicadores de compromiso y trazabilidad de origen.
            </p>
          </div>
        ) : (
          <div className="max-w-[840px] mx-auto space-y-6">
            {/* Cabecera del Dossier */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b border-[#232329] pb-5">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-tech rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-2 py-0.5 text-[11px] font-medium text-[#7AA7FF]">
                    {detail.spyware_family}
                  </span>
                  {detail.first_seen_date && (
                    <span className="font-tech inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-2 py-0.5 text-[11px] text-[#8E8E96]">
                      <Calendar className="h-3 w-3" />
                      {detail.first_seen_date}
                    </span>
                  )}
                  {usingDemoData && (
                    <span className="font-tech rounded-[4px] border border-[#232329] bg-[#141418] px-2 py-0.5 text-[10px] text-[#8E8E96]">
                      Vista demo local
                    </span>
                  )}
                </div>
                <h1 className="text-[20px] font-semibold tracking-[-0.015em] leading-snug text-[#F2F2F4]">
                  {detail.name}
                </h1>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportDossier}
                  className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-3 py-1.5 text-[12px] text-[#F2F2F4] hover:border-[#2F6FED] transition-colors cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-[#8E8E96]" />
                  <span>Exportar ficha (.md)</span>
                </button>

                {onAskInChat && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskInChat(
                        `Analiza en detalle los vectores técnicos, exploits y hallazgos documentados en la campaña "${detail.name}" (${detail.spyware_family}).`
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#2F6FED] px-3.5 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:bg-[#255ED4] transition-colors cursor-pointer"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Investigar en chat</span>
                  </button>
                )}
              </div>
            </div>

            {/* Matriz de Atribución Normalizada (RF2, RF6) */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-3.5 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] text-[#8E8E96]">
                  <Shield className="h-3.5 w-3.5 text-[#2F6FED]" />
                  <span>Actor / Operador presunto</span>
                </div>
                <p className="text-[13px] font-medium text-[#F2F2F4]">
                  {detail.suspected_actor || 'No atribuido públicamente'}
                </p>
              </div>

              <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-3.5 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] text-[#8E8E96]">
                  <Users className="h-3.5 w-3.5 text-[#2F6FED]" />
                  <span>Sector / Perfil vigilado</span>
                </div>
                <p className="text-[13px] font-medium text-[#F2F2F4]">
                  {detail.target_sector || 'No especificado'}
                </p>
              </div>

              <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-3.5 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] text-[#8E8E96]">
                  <Globe className="h-3.5 w-3.5 text-[#2F6FED]" />
                  <span>Regiones documentadas</span>
                </div>
                <p className="text-[13px] font-medium text-[#F2F2F4]">
                  {detail.target_regions?.length > 0
                    ? detail.target_regions.join(', ')
                    : 'Múltiples / N/D'}
                </p>
              </div>
            </div>

            {/* Síntesis Técnica */}
            <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-4 space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-[#8E8E96]">
                Síntesis de la investigación
              </p>
              <p className="text-[13.5px] leading-[1.65] text-[#F2F2F4]/90">
                {detail.summary || 'Sin síntesis ejecutiva registrada para esta campaña.'}
              </p>
            </div>

            {/* Navegación Interna por Pestañas (Divulgación Progresiva RNF2) */}
            <div className="space-y-4">
              <div className="flex items-center gap-1 border-b border-[#232329]">
                <button
                  type="button"
                  onClick={() => setDossierTab('cves')}
                  className={`px-3.5 py-2 text-[12px] font-medium border-b-2 transition-colors cursor-pointer ${
                    dossierTab === 'cves'
                      ? 'border-[#2F6FED] text-[#F2F2F4]'
                      : 'border-transparent text-[#8E8E96] hover:text-[#F2F2F4]'
                  }`}
                >
                  Vulnerabilidades ({detail.cves?.length || 0})
                </button>

                <button
                  type="button"
                  onClick={() => setDossierTab('iocs')}
                  className={`px-3.5 py-2 text-[12px] font-medium border-b-2 transition-colors cursor-pointer ${
                    dossierTab === 'iocs'
                      ? 'border-[#2F6FED] text-[#F2F2F4]'
                      : 'border-transparent text-[#8E8E96] hover:text-[#F2F2F4]'
                  }`}
                >
                  Indicadores de Compromiso ({totalIocCount})
                </button>

                <button
                  type="button"
                  onClick={() => setDossierTab('sources')}
                  className={`px-3.5 py-2 text-[12px] font-medium border-b-2 transition-colors cursor-pointer ${
                    dossierTab === 'sources'
                      ? 'border-[#2F6FED] text-[#F2F2F4]'
                      : 'border-transparent text-[#8E8E96] hover:text-[#F2F2F4]'
                  }`}
                >
                  Fuentes Ingeridas ({detail.reports?.length || 0})
                </button>
              </div>

              {/* TAB 1: Vulnerabilidades (CVEs) */}
              {dossierTab === 'cves' && (
                <div>
                  {!detail.cves || detail.cves.length === 0 ? (
                    <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-5 text-[12px] text-[#8E8E96] flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>
                        No se documentaron códigos CVE explícitos en los reportes de esta campaña.
                      </span>
                    </div>
                  ) : (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {detail.cves.map((cve) => (
                        <div
                          key={cve.cve_code}
                          className="rounded-[6px] border border-[#232329] bg-[#141418] p-3.5 flex items-center justify-between gap-3"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-tech text-[13px] font-medium text-[#F2F2F4]">
                                {cve.cve_code}
                              </span>
                              {cve.cvss_score != null && (
                                <span className="font-tech rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-1.5 py-0.5 text-[10px] text-[#7AA7FF]">
                                  CVSS {cve.cvss_score}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-[#8E8E96] truncate">
                              {cve.description || 'Vulnerabilidad explotada en cadena de infección'}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            {onAskInChat && (
                              <button
                                type="button"
                                onClick={() =>
                                  onAskInChat(
                                    `¿Cómo fue explotada la vulnerabilidad ${cve.cve_code} en la campaña "${detail.name}"?`
                                  )
                                }
                                title="Consultar CVE en el chat"
                                className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-1 text-[11px] text-[#8E8E96] hover:border-[#2F6FED] hover:text-[#F2F2F4] transition-colors cursor-pointer"
                              >
                                Preguntar
                              </button>
                            )}
                            <a
                              href={`https://nvd.nist.gov/vuln/detail/${cve.cve_code}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Ver ficha oficial en NIST NVD"
                              className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] p-1.5 text-[#8E8E96] hover:border-[#2F6FED] hover:text-[#F2F2F4] transition-colors"
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

              {/* TAB 2: Tabla Buscable de IOCs (RF6) */}
              {dossierTab === 'iocs' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1">
                      {['ALL', ...Object.keys(detail.ioc_breakdown || {})].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setIocTypeFilter(t)}
                          className={`font-tech rounded-[4px] px-2 py-1 text-[11px] uppercase transition-colors cursor-pointer ${
                            iocTypeFilter === t
                              ? 'bg-[#15223D] text-[#7AA7FF] border border-[#2F6FED]/40'
                              : 'bg-[#141418] text-[#8E8E96] border border-[#232329] hover:text-[#F2F2F4]'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>

                    <div className="relative w-full sm:w-60">
                      <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[#8E8E96]" />
                      <input
                        type="text"
                        value={iocSearch}
                        onChange={(e) => setIocSearch(e.target.value)}
                        placeholder="Filtrar dominio, IP o hash..."
                        className="w-full h-8 rounded-[4px] border border-[#232329] bg-[#141418] pl-8 pr-2.5 text-[12px] text-[#F2F2F4] placeholder-[#8E8E96] focus:border-[#2F6FED] focus:outline-none"
                      />
                    </div>
                  </div>

                  {totalIocCount > (detail.iocs?.length || 0) && (
                    <p className="font-tech text-[11px] text-[#8E8E96]">
                      Mostrando los primeros {detail.iocs.length} de {totalIocCount} indicadores indexados.
                    </p>
                  )}

                  {filteredIocs.length === 0 ? (
                    <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-5 text-[12px] text-[#8E8E96]">
                      No se encontraron indicadores para el criterio seleccionado.
                    </div>
                  ) : (
                    <div className="rounded-[6px] border border-[#232329] overflow-hidden">
                      <div className="max-h-[340px] overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead className="sticky top-0 bg-[#141418] border-b border-[#232329] text-[11px] font-medium text-[#8E8E96]">
                            <tr>
                              <th className="px-3.5 py-2.5 w-24">Tipo</th>
                              <th className="px-3.5 py-2.5">Indicador</th>
                              <th className="px-3.5 py-2.5 hidden md:table-cell">Contexto</th>
                              <th className="px-3.5 py-2.5 w-14 text-right">Copiar</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#232329] bg-[#0A0A0C] text-[12px]">
                            {filteredIocs.map((ioc, idx) => (
                              <tr key={`${ioc.ioc_type}-${ioc.ioc_value}-${idx}`} className="hover:bg-[#141418]/70 transition-colors">
                                <td className="px-3.5 py-2.5 font-tech text-[11px] uppercase text-[#7AA7FF]">
                                  {ioc.ioc_type}
                                </td>
                                <td className="px-3.5 py-2.5 font-tech text-[#F2F2F4] break-all">
                                  {ioc.ioc_value}
                                </td>
                                <td className="px-3.5 py-2.5 text-[#8E8E96] hidden md:table-cell">
                                  {ioc.context || '—'}
                                </td>
                                <td className="px-3.5 py-2.5 text-right">
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(ioc.ioc_value)}
                                    title="Copiar indicador"
                                    className="inline-flex items-center justify-center rounded-[4px] border border-[#232329] bg-[#141418] p-1 text-[#8E8E96] hover:border-[#2F6FED] hover:text-[#F2F2F4] transition-colors cursor-pointer"
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
                </div>
              )}

              {/* TAB 3: Trazabilidad de Reportes Fuente (RF7) */}
              {dossierTab === 'sources' && (
                <div className="space-y-2.5">
                  {!detail.reports || detail.reports.length === 0 ? (
                    <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-5 text-[12px] text-[#8E8E96]">
                      No hay reportes fuente vinculados directamente a esta campaña.
                    </div>
                  ) : (
                    detail.reports.map((rep) => (
                      <div
                        key={rep.id}
                        className="rounded-[6px] border border-[#232329] bg-[#141418] p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <FileCheck2 className="h-4 w-4 text-[#2F6FED] shrink-0" />
                            <p className="text-[13px] font-medium text-[#F2F2F4] truncate">
                              {rep.title}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 font-tech text-[11px] text-[#8E8E96]">
                            <span>{rep.organization}</span>
                            <span>·</span>
                            <span>Pub: {rep.publication_date || 'N/D'}</span>
                            <span>·</span>
                            <span>
                              Ingesta: {rep.ingested_at ? new Date(rep.ingested_at).toLocaleDateString() : 'N/D'}
                            </span>
                            {rep.file_hash && (
                              <>
                                <span>·</span>
                                <span title={rep.file_hash}>SHA-256: {rep.file_hash.slice(0, 12)}...</span>
                              </>
                            )}
                          </div>
                        </div>

                        {rep.source_url?.startsWith('http') && (
                          <a
                            href={rep.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-3 py-1.5 text-[11px] text-[#F2F2F4] hover:border-[#2F6FED] transition-colors"
                          >
                            <span>Publicación original</span>
                            <ExternalLink className="h-3 w-3 text-[#8E8E96]" />
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
