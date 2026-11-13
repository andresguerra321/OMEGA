import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Globe,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  createOsintAsset,
  deleteOsintAsset,
  fetchOsintAssets,
  scanOsintAsset,
} from '../lib/api';

const INSTITUTIONAL_SIMULATION = {
  asset_id: 'sim-inst-001',
  asset_type: 'domain',
  asset_value: 'red-prensa-andina.org',
  checked_at: '2026-11-12T18:40:00Z',
  is_simulation: true,
  exposed_subdomains: [
    'mail.red-prensa-andina.org',
    'vpn-edge.red-prensa-andina.org',
    'redaccion.red-prensa-andina.org',
    'archivo-doc.red-prensa-andina.org',
    'webmail.red-prensa-andina.org',
    'staging-cms.red-prensa-andina.org',
    'smtp-relay.red-prensa-andina.org',
    'cloud-sync.red-prensa-andina.org',
  ],
  dns_posture: {
    domain_evaluated: 'red-prensa-andina.org',
    spf_configured: true,
    spf_record: 'v=spf1 include:_spf.protonmail.ch ~all',
    dmarc_configured: false,
    dmarc_record: null,
    notes: [
      'SPF en modo softfail (~all) sin política DMARC publicada (_dmarc.red-prensa-andina.org).',
      'Superficie susceptible a envío de correos falsificados de pretexto (phishing 1-click).',
    ],
  },
  email_breaches: {
    source: 'XposedOrNot (consulta pasiva)',
    status: 'EXPOSED_PUBLIC_BREACHES',
    breach_count: 2,
    breaches: [
      {
        breach_name: 'EditorialCloud-Dump-2023',
        breach_date: '2023-08-14',
        domain: 'red-prensa-andina.org',
        exposed_data: ['Email addresses', 'Hashed passwords', 'Job titles'],
      },
      {
        breach_name: 'PressWire-Portal-2021',
        breach_date: '2021-11-03',
        domain: 'red-prensa-andina.org',
        exposed_data: ['Email addresses', 'Phone numbers'],
      },
    ],
  },
  cti_ioc_matches: [],
  ethical_notice:
    'Simulación institucional defensiva. Consulta exclusivamente pasiva sobre Certificate Transparency (crt.sh), registros DNS públicos y compilaciones históricas abiertas (RNF8).',
};

const ASSET_TYPE_OPTIONS = [
  { id: 'email', label: 'Correo institucional', badge: 'EMAIL', placeholder: 'investigacion@organizacion.org' },
  { id: 'domain', label: 'Dominio propio', badge: 'DOMAIN', placeholder: 'organizacion.org' },
  { id: 'organization', label: 'Organización', badge: 'ORG', placeholder: 'Red de Periodismo Independiente' },
];

function computeSpoofingSummary(report) {
  if (!report) {
    return { label: '--', tone: 'neutral', detail: 'Sin auditoría activa' };
  }
  const dns = report.dns_posture;
  if (!dns || (!dns.domain_evaluated && report.asset_type === 'organization')) {
    return { label: 'N/A', tone: 'neutral', detail: 'Entidad sin dominio DNS directo' };
  }
  if (dns.spf_configured && dns.dmarc_configured) {
    return { label: 'COMPLETA', tone: 'clean', detail: 'SPF + DMARC publicados' };
  }
  if (dns.spf_configured || dns.dmarc_configured) {
    return {
      label: 'PARCIAL',
      tone: 'warn',
      detail: dns.spf_configured ? 'SPF presente · DMARC ausente' : 'DMARC presente · SPF ausente',
    };
  }
  return { label: 'AUSENTE', tone: 'critical', detail: 'Sin SPF ni DMARC configurados' };
}

function buildPhishingDiagnosis(report) {
  const dns = report?.dns_posture;
  if (!dns) return null;
  const spf = Boolean(dns.spf_configured);
  const dmarc = Boolean(dns.dmarc_configured);
  const softfail = typeof dns.spf_record === 'string' && dns.spf_record.includes('~all');

  if (spf && dmarc && !softfail) {
    return {
      severity: 'clean',
      title: 'Resistencia sólida contra suplantación directa de dominio',
      bullets: [
        'SPF restrictivo y política DMARC activos reducen la entrega de correos falsificados con tu dominio en bandeja de entrada.',
        'Mantén vigilancia frente a dominios homográficos (lookalike) empleados en campañas de spyware 1-click.',
      ],
    };
  }
  if (spf || dmarc) {
    return {
      severity: 'warn',
      title: 'Exposición media a pretextos 1-click por cobertura DNS incompleta',
      bullets: [
        !dmarc
          ? 'Ausencia de registro _dmarc permite que receptores sin validación estricta acepten remitentes falsificados.'
          : 'Ausencia de registro SPF completo deja sin lista autorizada los servidores SMTP salientes.',
        softfail
          ? 'SPF utiliza mecanismo softfail (~all); migrar gradualmente a -all tras validar remitentes legítimos.'
          : 'Activar reporte agregado DMARC (rua=) con política p=quarantine o p=reject.',
      ],
    };
  }
  return {
    severity: 'critical',
    title: 'Superficie abierta a suplantación directa de remitente',
    bullets: [
      'Ni SPF ni DMARC están configurados para el dominio evaluado.',
      'Cualquier atacante puede falsificar identidades del dominio para distribuir enlaces maliciosos de 1-click o pretextos de phishing.',
      'Remediar publicando TXT SPF (-all) y política DMARC inicial en monitoreo (p=none; rua=...).',
    ],
  };
}

export function OsintPanel({ onAskInChat }) {
  const [assets, setAssets] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(true);

  const [assetType, setAssetType] = useState('email');
  const [assetValue, setAssetValue] = useState('');
  const [explicitConsent, setExplicitConsent] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [scanningAssetId, setScanningAssetId] = useState(null);
  const [activeAssetId, setActiveAssetId] = useState(null);
  const [reportCache, setReportCache] = useState({});
  const [activeReport, setActiveReport] = useState(null);

  const [subdomainFilter, setSubdomainFilter] = useState('');
  const [showPhishingDiag, setShowPhishingDiag] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadAssets() {
      setLoadingAssets(true);
      try {
        const res = await fetchOsintAssets();
        if (!cancelled) {
          setAssets(res.assets || []);
        }
      } catch {
        // Backend unreachable handled silently until user triggers action
      } finally {
        if (!cancelled) setLoadingAssets(false);
      }
    }
    loadAssets();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentTypeMeta = ASSET_TYPE_OPTIONS.find((t) => t.id === assetType) || ASSET_TYPE_OPTIONS[0];

  const filteredSubdomains = useMemo(() => {
    const list = activeReport?.exposed_subdomains || [];
    const q = subdomainFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((sub) => sub.toLowerCase().includes(q));
  }, [activeReport, subdomainFilter]);

  const ctiMatchedValues = useMemo(() => {
    return new Set((activeReport?.cti_ioc_matches || []).map((m) => m.ioc_value?.toLowerCase()));
  }, [activeReport]);

  const spoofingSummary = computeSpoofingSummary(activeReport);
  const phishingDiag = useMemo(() => buildPhishingDiagnosis(activeReport), [activeReport]);

  async function runAssetScan(asset) {
    setIsScanning(true);
    setScanningAssetId(asset.id);
    setActiveAssetId(asset.id);
    setErrorMsg('');
    setShowPhishingDiag(false);
    try {
      const scanRes = await scanOsintAsset(asset.id);
      setReportCache((prev) => ({ ...prev, [asset.id]: scanRes }));
      setActiveReport(scanRes);
      const refreshed = await fetchOsintAssets().catch(() => null);
      if (refreshed?.assets) setAssets(refreshed.assets);
    } catch (err) {
      setErrorMsg(
        err?.message || `No se pudo completar la auditoría pasiva sobre ${asset.asset_value}.`,
      );
    } finally {
      setIsScanning(false);
      setScanningAssetId(null);
    }
  }

  async function handleRegisterAndScan(e) {
    e.preventDefault();
    const cleaned = assetValue.trim();
    if (!cleaned || !explicitConsent || isScanning) return;
    setIsScanning(true);
    setErrorMsg('');
    setShowPhishingDiag(false);
    try {
      const created = await createOsintAsset({
        asset_type: assetType,
        asset_value: cleaned,
        explicit_consent: true,
      });
      setAssets((prev) => [created, ...prev.filter((a) => a.id !== created.id)]);
      setAssetValue('');
      setExplicitConsent(false);
      await runAssetScan(created);
    } catch (err) {
      setErrorMsg(err?.message || 'Error al registrar el activo autorizado (RNF8).');
      setIsScanning(false);
    }
  }

  async function handleRevokeAsset(e, asset) {
    e.stopPropagation();
    setErrorMsg('');
    try {
      await deleteOsintAsset(asset.id);
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      setReportCache((prev) => {
        const copy = { ...prev };
        delete copy[asset.id];
        return copy;
      });
      if (activeAssetId === asset.id) {
        setActiveAssetId(null);
        setActiveReport(null);
      }
    } catch (err) {
      setErrorMsg(err?.message || 'No se pudo revocar el activo del espacio de trabajo.');
    }
  }

  function handleSelectAssetChip(asset) {
    setActiveAssetId(asset.id);
    setShowPhishingDiag(false);
    setErrorMsg('');
    if (reportCache[asset.id]) {
      setActiveReport(reportCache[asset.id]);
    } else {
      runAssetScan(asset);
    }
  }

  function handleLoadSimulation() {
    setActiveAssetId('sim-inst-001');
    setActiveReport(INSTITUTIONAL_SIMULATION);
    setSubdomainFilter('');
    setShowPhishingDiag(false);
    setErrorMsg('');
  }

  async function copyToClipboard(key, value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      // Clipboard blocked
    }
  }

  function handleAskDnsInChat() {
    if (!activeReport || !onAskInChat) return;
    const dns = activeReport.dns_posture;
    const prompt = [
      `Evalúa defensivamente la postura OSINT del activo ${activeReport.asset_value}:`,
      `- SPF configurado: ${dns?.spf_configured ? dns.spf_record || 'Sí' : 'No'}`,
      `- DMARC configurado: ${dns?.dmarc_configured ? dns.dmarc_record || 'Sí' : 'No'}`,
      `- Subdominios observados en crt.sh: ${activeReport.exposed_subdomains?.length || 0}`,
      `¿Cómo aprovechan los operadores de spyware comercial las debilidades SPF/DMARC para phishing 1-click y qué endurecimiento prioritario recomiendas?`,
    ].join('\n');
    onAskInChat(prompt);
  }

  const ctiCount = activeReport?.cti_ioc_matches?.length ?? null;
  const breachCount = activeReport
    ? activeReport.email_breaches
      ? activeReport.email_breaches.breach_count ?? 0
      : null
    : null;
  const subdomainCount = activeReport ? activeReport.exposed_subdomains?.length ?? 0 : null;

  return (
    <div className="space-y-4">
      {/* 1. Cabecera y Barra RNF8 */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-semibold tracking-tight text-[#F2F2F4]">
            Mi exposición
          </h1>
          <span className="font-tech inline-flex items-center gap-1.5 rounded-[4px] bg-[#15223D] border border-[#2F6FED]/40 px-2.5 py-1 text-[11px] font-medium text-[#7AA7FF]">
            <Lock className="h-3 w-3 shrink-0" />
            CONSENTIMIENTO EXPLÍCITO · RNF8
          </span>
          {activeReport?.is_simulation && (
            <span className="font-tech inline-flex items-center rounded-[4px] bg-[#1A160E] border border-[#52401E] px-2 py-1 text-[11px] text-[#FBBF24]">
              SIMULACIÓN INSTITUCIONAL
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleLoadSimulation}
          className="h-8 rounded-[4px] bg-[#141418] border border-[#232329] hover:border-[#2F6FED]/50 px-3 text-[12.5px] font-medium text-[#F2F2F4] flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Sparkles className="h-3.5 w-3.5 text-[#7AA7FF]" />
          <span>Simular auditoría institucional</span>
        </button>
      </div>

      {/* Aviso de error operativo */}
      {errorMsg && (
        <div className="rounded-[6px] bg-[#1C1114] border border-[#5C2128] px-3.5 py-2.5 flex items-center justify-between gap-3 text-[12.5px] text-[#F87171]">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg('')}
            className="text-[11.5px] text-[#F87171]/80 hover:text-[#F87171] cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* 2. Barra de Registro y Verificación */}
      <section className="rounded-[6px] bg-[#141418] border border-[#232329] p-4 space-y-3">
        <form onSubmit={handleRegisterAndScan} className="flex flex-wrap items-center gap-2.5">
          {/* Selector de tipo de activo */}
          <div className="inline-flex rounded-[4px] bg-[#0E0E12] border border-[#232329] p-0.5 shrink-0">
            {ASSET_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setAssetType(opt.id)}
                className={`rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer ${
                  assetType === opt.id
                    ? 'bg-[#15223D] text-[#7AA7FF] border border-[#2F6FED]/40'
                    : 'text-[#8E8E96] hover:text-[#F2F2F4] border border-transparent'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Input mono de activo */}
          <input
            type="text"
            value={assetValue}
            onChange={(e) => setAssetValue(e.target.value)}
            placeholder={currentTypeMeta.placeholder}
            className="font-tech flex-1 min-w-[220px] h-9 rounded-[4px] bg-[#0E0E12] border border-[#232329] px-3 text-[12.5px] text-[#F2F2F4] placeholder-[#8E8E96]/70 focus:outline-none focus:border-[#2F6FED]"
          />

          {/* Checkbox obligatorio RNF8 en línea */}
          <label className="inline-flex items-center gap-2 text-[12px] text-[#F2F2F4] cursor-pointer select-none px-1">
            <input
              type="checkbox"
              checked={explicitConsent}
              onChange={(e) => setExplicitConsent(e.target.checked)}
              className="h-3.5 w-3.5 rounded-[4px] accent-[#2F6FED] cursor-pointer"
            />
            <span>Certifico titularidad o autorización explícita (RNF8)</span>
          </label>

          <button
            type="submit"
            disabled={!assetValue.trim() || !explicitConsent || isScanning}
            className="h-9 rounded-[4px] bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-45 px-3.5 text-[12.5px] font-medium text-white flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
          >
            {isScanning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            <span>Auditar superficie</span>
          </button>
        </form>

        {/* Chips clicables de activos autorizados de la sesión */}
        <div className="pt-2 border-t border-[#232329] flex flex-wrap items-center gap-2">
          <span className="text-[11.5px] font-medium text-[#8E8E96]">
            Activos en sesión:
          </span>

          {loadingAssets ? (
            <span className="font-tech text-[11px] text-[#8E8E96]">Cargando sesión...</span>
          ) : assets.length === 0 ? (
            <span className="text-[12px] text-[#8E8E96]">
              Ninguno registrado aún. Registra un correo/dominio propio o usa la simulación institucional.
            </span>
          ) : (
            assets.map((asset) => {
              const isActive = activeAssetId === asset.id;
              const isBusy = scanningAssetId === asset.id;
              const typeBadge =
                ASSET_TYPE_OPTIONS.find((t) => t.id === asset.asset_type)?.badge || 'ASSET';
              return (
                <div
                  key={asset.id}
                  onClick={() => handleSelectAssetChip(asset)}
                  className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-1 cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-[#15223D] border-[#2F6FED]/50 text-[#7AA7FF]'
                      : 'bg-[#0E0E12] border-[#232329] text-[#F2F2F4] hover:border-[#2F6FED]/40'
                  }`}
                >
                  <span className="font-tech text-[10.5px] text-[#8E8E96]">[{typeBadge}]</span>
                  <span className="font-tech text-[11.5px]">{asset.asset_value}</span>

                  <button
                    type="button"
                    title="Re-auditar superficie"
                    onClick={(e) => {
                      e.stopPropagation();
                      runAssetScan(asset);
                    }}
                    className="p-0.5 text-[#8E8E96] hover:text-[#7AA7FF] cursor-pointer"
                  >
                    <RefreshCw className={`h-3 w-3 ${isBusy ? 'animate-spin text-[#7AA7FF]' : ''}`} />
                  </button>

                  <button
                    type="button"
                    title="Revocar consentimiento y eliminar activo"
                    onClick={(e) => handleRevokeAsset(e, asset)}
                    className="p-0.5 text-[#8E8E96] hover:text-[#F87171] cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* 3. Resumen de Superficie Externa (4 KPIs técnicos) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* KPI 1 */}
        <div className="rounded-[6px] bg-[#141418] border border-[#232329] p-3.5">
          <div className="text-[11.5px] font-medium text-[#8E8E96]">
            1. Cruce Infraestructura Spyware
          </div>
          <div
            className={`font-tech text-[20px] font-semibold mt-1 ${
              ctiCount === null
                ? 'text-[#8E8E96]'
                : ctiCount > 0
                  ? 'text-[#F87171]'
                  : 'text-[#7AA7FF]'
            }`}
          >
            {ctiCount === null ? '--' : `${ctiCount} ${ctiCount === 1 ? 'IOC' : 'IOCs'}`}
          </div>
          <div className="text-[11.5px] text-[#8E8E96] mt-0.5">
            {ctiCount === null
              ? 'Pendiente de auditoría'
              : ctiCount > 0
                ? 'Coincidencia con infraestructura CTI'
                : 'Sin coincidencia en corpus CTI'}
          </div>
        </div>

        {/* KPI 2 */}
        <div className="rounded-[6px] bg-[#141418] border border-[#232329] p-3.5">
          <div className="text-[11.5px] font-medium text-[#8E8E96]">
            2. Brechas Públicas (Email)
          </div>
          <div
            className={`font-tech text-[20px] font-semibold mt-1 ${
              breachCount === null
                ? 'text-[#8E8E96]'
                : breachCount > 0
                  ? 'text-[#FBBF24]'
                  : 'text-[#7AA7FF]'
            }`}
          >
            {!activeReport ? '--' : breachCount === null ? 'N/A' : breachCount}
          </div>
          <div className="text-[11.5px] text-[#8E8E96] mt-0.5">
            {!activeReport
              ? 'XposedOrNot en espera'
              : breachCount === null
                ? 'Aplica a consulta de correo o dominio'
                : breachCount > 0
                  ? 'Filtraciones históricas detectadas'
                  : 'Sin brechas públicas registradas'}
          </div>
        </div>

        {/* KPI 3 */}
        <div className="rounded-[6px] bg-[#141418] border border-[#232329] p-3.5">
          <div className="text-[11.5px] font-medium text-[#8E8E96]">
            3. Subdominios (crt.sh)
          </div>
          <div
            className={`font-tech text-[20px] font-semibold mt-1 ${
              subdomainCount === null ? 'text-[#8E8E96]' : 'text-[#F2F2F4]'
            }`}
          >
            {subdomainCount === null ? '--' : subdomainCount}
          </div>
          <div className="text-[11.5px] text-[#8E8E96] mt-0.5">
            {subdomainCount === null
              ? 'Logs Certificate Transparency'
              : `Activos observados en certificados TLS`}
          </div>
        </div>

        {/* KPI 4 */}
        <div className="rounded-[6px] bg-[#141418] border border-[#232329] p-3.5">
          <div className="text-[11.5px] font-medium text-[#8E8E96]">
            4. Protección Anti-Spoofing
          </div>
          <div
            className={`font-tech text-[20px] font-semibold mt-1 ${
              spoofingSummary.tone === 'clean'
                ? 'text-[#7AA7FF]'
                : spoofingSummary.tone === 'warn'
                  ? 'text-[#FBBF24]'
                  : spoofingSummary.tone === 'critical'
                    ? 'text-[#F87171]'
                    : 'text-[#8E8E96]'
            }`}
          >
            {spoofingSummary.label}
          </div>
          <div className="text-[11.5px] text-[#8E8E96] mt-0.5 truncate">
            {spoofingSummary.detail}
          </div>
        </div>
      </section>

      {/* 4. Grid de Resultados (7 + 5 columnas) */}
      {!activeReport ? (
        <section className="rounded-[6px] bg-[#141418] border border-[#232329] p-8 flex flex-col items-center justify-center text-center">
          <Shield className="h-6 w-6 text-[#7AA7FF] mb-2" />
          <div className="text-[14px] font-medium text-[#F2F2F4]">
            Superficie OSINT lista para auditoría pasiva
          </div>
          <p className="text-[12.5px] text-[#8E8E96] mt-1 max-w-[520px]">
            Registra un correo o dominio bajo titularidad explícita (RNF8), selecciona un activo de la sesión o ejecuta una simulación institucional para auditar registros DNS, brechas históricas y subdominios CT.
          </p>
        </section>
      ) : (
        <section className="grid grid-cols-12 gap-3 items-start">
          {/* Columna Izquierda (7 cols): Brechas Públicas + Postura DNS */}
          <div className="col-span-12 lg:col-span-7 space-y-3">
            {/* Módulo Brechas Históricas (XposedOrNot) */}
            <div className="rounded-[6px] bg-[#141418] border border-[#232329] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#232329]">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-[#7AA7FF]" />
                  <h2 className="text-[13.5px] font-medium text-[#F2F2F4]">
                    Exposición en brechas públicas
                  </h2>
                </div>
                <span className="font-tech rounded-[4px] bg-[#0E0E12] border border-[#232329] px-2 py-0.5 text-[11px] text-[#8E8E96]">
                  {activeReport.email_breaches?.source || 'XposedOrNot'}
                </span>
              </div>

              {!activeReport.email_breaches ? (
                <div className="rounded-[4px] bg-[#0E0E12] border border-[#232329] px-3 py-2.5 text-[12px] text-[#8E8E96]">
                  Sin consulta de correo asociada a este activo. Registra un correo institucional autorizado para verificar filtraciones históricas públicas.
                </div>
              ) : activeReport.email_breaches.breach_count === 0 ? (
                <div className="rounded-[4px] bg-[#15223D] border border-[#2F6FED]/40 px-3 py-2.5 flex items-center gap-2 text-[12.5px] text-[#7AA7FF]">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span>Sin registros en compilaciones públicas indexadas.</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {(activeReport.email_breaches.breaches || []).map((b, idx) => (
                    <div
                      key={`${b.breach_name}-${idx}`}
                      className="rounded-[4px] bg-[#1A160E] border border-[#52401E] p-3 flex flex-wrap items-start justify-between gap-2"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-[#F2F2F4]">
                            {b.breach_name}
                          </span>
                          <span className="font-tech text-[11px] text-[#FBBF24]">
                            {b.breach_date || 'Fecha N/D'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {(b.exposed_data || []).map((item, j) => (
                            <span
                              key={j}
                              className="rounded-[4px] bg-[#0E0E12] border border-[#52401E] px-1.5 py-0.5 text-[11px] text-[#FBBF24]"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                      {b.domain && (
                        <span className="font-tech text-[11px] text-[#8E8E96]">{b.domain}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Módulo Postura DNS (SPF & DMARC) */}
            <div className="rounded-[6px] bg-[#141418] border border-[#232329] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#232329]">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-[#7AA7FF]" />
                  <h2 className="text-[13.5px] font-medium text-[#F2F2F4]">
                    Postura DNS y anti-suplantación (SPF / DMARC)
                  </h2>
                </div>
                {activeReport.dns_posture?.domain_evaluated && (
                  <span className="font-tech text-[11.5px] text-[#7AA7FF]">
                    {activeReport.dns_posture.domain_evaluated}
                  </span>
                )}
              </div>

              {!activeReport.dns_posture ? (
                <div className="rounded-[4px] bg-[#0E0E12] border border-[#232329] px-3 py-2.5 text-[12px] text-[#8E8E96]">
                  No hay dominio evaluable en esta consulta pasiva.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* SPF Box */}
                    <div className="rounded-[4px] bg-[#0E0E12] border border-[#232329] p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-tech text-[11.5px] font-medium text-[#F2F2F4]">
                          TXT · SPF
                        </span>
                        <span
                          className={`font-tech rounded-[4px] border px-2 py-0.5 text-[10.5px] ${
                            activeReport.dns_posture.spf_configured
                              ? 'bg-[#15223D] border-[#2F6FED]/40 text-[#7AA7FF]'
                              : 'bg-[#1C1114] border-[#5C2128] text-[#F87171]'
                          }`}
                        >
                          {activeReport.dns_posture.spf_configured ? 'CONFIGURADO' : 'AUSENTE'}
                        </span>
                      </div>
                      <pre className="font-tech text-[11px] text-[#8E8E96] whitespace-pre-wrap break-all leading-relaxed">
                        {activeReport.dns_posture.spf_record || 'Registro TXT SPF no detectado en DNS público'}
                      </pre>
                    </div>

                    {/* DMARC Box */}
                    <div className="rounded-[4px] bg-[#0E0E12] border border-[#232329] p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-tech text-[11.5px] font-medium text-[#F2F2F4]">
                          TXT · _dmarc
                        </span>
                        <span
                          className={`font-tech rounded-[4px] border px-2 py-0.5 text-[10.5px] ${
                            activeReport.dns_posture.dmarc_configured
                              ? 'bg-[#15223D] border-[#2F6FED]/40 text-[#7AA7FF]'
                              : 'bg-[#1A160E] border-[#52401E] text-[#FBBF24]'
                          }`}
                        >
                          {activeReport.dns_posture.dmarc_configured ? 'CONFIGURADO' : 'AUSENTE'}
                        </span>
                      </div>
                      <pre className="font-tech text-[11px] text-[#8E8E96] whitespace-pre-wrap break-all leading-relaxed">
                        {activeReport.dns_posture.dmarc_record || 'Registro TXT _dmarc no detectado en DNS público'}
                      </pre>
                    </div>
                  </div>

                  {activeReport.dns_posture.notes?.length > 0 && (
                    <div className="space-y-1 text-[12px] text-[#8E8E96]">
                      {activeReport.dns_posture.notes.map((n, idx) => (
                        <div key={idx}>• {n}</div>
                      ))}
                    </div>
                  )}

                  {/* Diagnóstico de phishing en 1 clic */}
                  <div className="pt-2 border-t border-[#232329] flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPhishingDiag((v) => !v)}
                      className="h-8 rounded-[4px] bg-[#15223D] border border-[#2F6FED]/40 px-3 text-[12px] font-medium text-[#7AA7FF] hover:bg-[#1A2A4B] transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span>
                        {showPhishingDiag
                          ? 'Ocultar diagnóstico de phishing'
                          : 'Evaluar riesgo de suplantación (1 clic)'}
                      </span>
                    </button>

                    {onAskInChat && (
                      <button
                        type="button"
                        onClick={handleAskDnsInChat}
                        className="h-8 rounded-[4px] bg-[#0E0E12] border border-[#232329] hover:border-[#2F6FED]/50 px-3 text-[12px] font-medium text-[#F2F2F4] flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <MessageSquare className="h-3.5 w-3.5 text-[#7AA7FF]" />
                        <span>Consultar mitigación en Preguntar</span>
                      </button>
                    )}
                  </div>

                  {showPhishingDiag && phishingDiag && (
                    <div
                      className={`rounded-[4px] border p-3 space-y-1.5 ${
                        phishingDiag.severity === 'critical'
                          ? 'bg-[#1C1114] border-[#5C2128]'
                          : phishingDiag.severity === 'warn'
                            ? 'bg-[#1A160E] border-[#52401E]'
                            : 'bg-[#15223D] border-[#2F6FED]/40'
                      }`}
                    >
                      <div
                        className={`text-[12.5px] font-medium ${
                          phishingDiag.severity === 'critical'
                            ? 'text-[#F87171]'
                            : phishingDiag.severity === 'warn'
                              ? 'text-[#FBBF24]'
                              : 'text-[#7AA7FF]'
                        }`}
                      >
                        {phishingDiag.title}
                      </div>
                      <ul className="space-y-1 text-[12px] text-[#F2F2F4]/90">
                        {phishingDiag.bullets.map((b, i) => (
                          <li key={i}>• {b}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Columna Derecha (5 cols): Inventario Pasivo crt.sh + Cruce CTI */}
          <div className="col-span-12 lg:col-span-5 rounded-[6px] bg-[#141418] border border-[#232329] p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#232329]">
              <div>
                <h2 className="text-[13.5px] font-medium text-[#F2F2F4]">
                  Inventario pasivo crt.sh
                </h2>
                <div className="font-tech text-[11px] text-[#8E8E96]">
                  {activeReport.asset_value} · {activeReport.checked_at?.slice(0, 19).replace('T', ' ')} UTC
                </div>
              </div>
              <span className="font-tech rounded-[4px] bg-[#0E0E12] border border-[#232329] px-2 py-0.5 text-[11px] text-[#7AA7FF]">
                {filteredSubdomains.length}/{activeReport.exposed_subdomains?.length || 0}
              </span>
            </div>

            {/* Alertas CTI si hubiera coincidencia en infraestructura de spyware */}
            {activeReport.cti_ioc_matches?.length > 0 && (
              <div className="rounded-[4px] bg-[#1C1114] border border-[#5C2128] p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#F87171]">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                  <span>Coincidencia detectada con infraestructura de spyware</span>
                </div>
                {activeReport.cti_ioc_matches.map((m, idx) => (
                  <div
                    key={idx}
                    className="rounded-[4px] bg-[#0E0E12] border border-[#5C2128] px-2.5 py-1.5 text-[11.5px]"
                  >
                    <div className="font-tech text-[#F87171]">{m.ioc_value}</div>
                    <div className="text-[#8E8E96]">
                      {m.spyware_family} · {m.source_report}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Buscador rápido */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-[#8E8E96] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={subdomainFilter}
                onChange={(e) => setSubdomainFilter(e.target.value)}
                placeholder="Filtrar subdominio (vpn, mail, staging...)"
                className="font-tech w-full h-8 rounded-[4px] bg-[#0E0E12] border border-[#232329] pl-8 pr-3 text-[11.5px] text-[#F2F2F4] placeholder-[#8E8E96]/70 focus:outline-none focus:border-[#2F6FED]"
              />
            </div>

            {/* Lista scrolleable */}
            {filteredSubdomains.length === 0 ? (
              <div className="rounded-[4px] bg-[#0E0E12] border border-[#232329] py-8 px-4 text-center text-[12px] text-[#8E8E96]">
                {activeReport.exposed_subdomains?.length
                  ? 'Ningún subdominio coincide con el filtro.'
                  : 'No se observaron subdominios en Certificate Transparency para este activo.'}
              </div>
            ) : (
              <div className="rounded-[4px] bg-[#0E0E12] border border-[#232329] max-h-[340px] overflow-y-auto divide-y divide-[#232329]/70">
                {filteredSubdomains.map((sub) => {
                  const isCtiAlert = ctiMatchedValues.has(sub.toLowerCase());
                  return (
                    <div
                      key={sub}
                      className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-[#16161C] transition-colors"
                    >
                      <span className="font-tech text-[11.5px] text-[#F2F2F4] truncate">
                        {sub}
                      </span>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`font-tech rounded-[4px] border px-1.5 py-0.5 text-[10px] ${
                            isCtiAlert
                              ? 'bg-[#1C1114] border-[#5C2128] text-[#F87171]'
                              : 'bg-[#15223D] border-[#2F6FED]/40 text-[#7AA7FF]'
                          }`}
                        >
                          {isCtiAlert ? 'ALERTA CTI' : 'CTI LIMPIO'}
                        </span>

                        <button
                          type="button"
                          onClick={() => copyToClipboard(sub, sub)}
                          title="Copiar subdominio"
                          className="h-6 w-6 rounded-[4px] bg-[#141418] border border-[#232329] hover:border-[#2F6FED]/50 flex items-center justify-center cursor-pointer"
                        >
                          {copiedKey === sub ? (
                            <Check className="h-3 w-3 text-[#7AA7FF]" />
                          ) : (
                            <Copy className="h-3 w-3 text-[#8E8E96]" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-2 border-t border-[#232329] text-[11.5px] text-[#8E8E96] leading-relaxed">
              {activeReport.ethical_notice}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
