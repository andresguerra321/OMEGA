import { useEffect, useRef, useState } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Trash2,
  Radar,
  FileCode2,
} from 'lucide-react';
import {
  fetchOsintAssets,
  createOsintAsset,
  scanOsintAsset,
  deleteOsintAsset,
} from '../lib/api';

const ASSET_TYPE_OPTIONS = [
  {
    value: 'domain',
    label: 'Dominio propio',
    badge: 'DOMINIO',
    placeholder: 'ej. midominio.org',
  },
  {
    value: 'institutional_email',
    label: 'Correo institucional',
    badge: 'CORREO',
    placeholder: 'ej. prensa@organizacion.org',
  },
  {
    value: 'organization',
    label: 'Organización',
    badge: 'ORG',
    placeholder: 'ej. Fundación Prensa Libre',
  },
];

const SAMPLE_AUDIT_ASSET = {
  id: 'sample-demo-asset',
  asset_type: 'institutional_email',
  asset_value: 'seguridad@prensalibre-investigacion.org',
  explicit_consent: true,
  consented_at: '2026-11-12T18:30:00Z',
  last_checked_at: '2026-11-12T22:45:00Z',
  isSample: true,
};

const SAMPLE_AUDIT_REPORT = {
  asset_id: 'sample-demo-asset',
  asset_type: 'institutional_email',
  asset_value: 'seguridad@prensalibre-investigacion.org',
  checked_at: '2026-11-12T22:45:00Z',
  dns_posture: {
    domain_evaluated: 'prensalibre-investigacion.org',
    spf_configured: true,
    spf_record: 'v=spf1 include:_spf.google.com include:spf.protection.outlook.com -all',
    dmarc_configured: true,
    dmarc_record:
      'v=DMARC1; p=reject; rua=mailto:dmarc@prensalibre-investigacion.org; pct=100; adkim=s',
  },
  email_breaches: {
    source: 'XposedOrNot Public Breach Intelligence',
    status: 'exposed',
    breach_count: 2,
    breaches: [
      {
        breach_name: 'Redacción Editorial CMS (2021)',
        breach_date: '2021-08-19',
        domain: 'cms.prensalibre-investigacion.org',
        exposed_data: 'Correo institucional, hash de sesión y metadatos editoriales',
      },
      {
        breach_name: 'Directorio Conferencia Prensa Regional',
        breach_date: '2023-03-11',
        domain: 'eventos.prensalibre-investigacion.org',
        exposed_data: 'Correo electrónico institucional, nombre completo y cargo',
      },
    ],
  },
  exposed_subdomains: [
    'prensalibre-investigacion.org',
    'correo.prensalibre-investigacion.org',
    'vpn.prensalibre-investigacion.org',
    'portal.prensalibre-investigacion.org',
    'archivos.prensalibre-investigacion.org',
    'cdn.prensalibre-investigacion.org',
  ],
  cti_ioc_matches: [],
  ethical_notice:
    'Auditoría de ejemplo en modo demostrativo (sin consultas externas). El modo real ejecuta verificación 100% pasiva tras registrar consentimiento RNF8.',
};

function getAssetTypeMeta(assetType) {
  return (
    ASSET_TYPE_OPTIONS.find((opt) => opt.value === assetType) || {
      value: assetType,
      label: assetType,
      badge: String(assetType || 'ACTIVO').toUpperCase(),
      placeholder: 'ej. activo autorizado',
    }
  );
}

function formatIsoStamp(rawIso) {
  if (!rawIso) return 'Sin auditar';
  const parsed = new Date(rawIso);
  if (Number.isNaN(parsed.getTime())) {
    return String(rawIso).slice(0, 19).replace('T', ' ');
  }
  return parsed.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export function OsintPanel() {
  const [assets, setAssets] = useState([]);
  const [sampleActive, setSampleActive] = useState(false);
  const [assetType, setAssetType] = useState('domain');
  const [assetValue, setAssetValue] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scanningId, setScanningId] = useState(null);
  const [report, setReport] = useState(null);
  const [copiedSubdomain, setCopiedSubdomain] = useState('');
  const reportRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    fetchOsintAssets()
      .then((d) => {
        if (mounted) setAssets(Array.isArray(d?.assets) ? d.assets : []);
      })
      .catch(() => {
        if (mounted) setAssets([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  function scrollToReport() {
    setTimeout(() => {
      reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  }

  async function handleRegisterAndAudit(e) {
    e.preventDefault();
    const cleanValue = assetValue.trim();
    if (!cleanValue || submitting || scanningId) return;

    setError('');
    if (!consent) {
      setError('Debes marcar el consentimiento explícito del titular antes de auditar (RNF8).');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createOsintAsset({
        asset_type: assetType,
        asset_value: cleanValue,
        explicit_consent: true,
      });

      setAssets((prev) => [created, ...prev.filter((a) => a.id !== created.id)]);
      setAssetValue('');
      setConsent(false);

      setScanningId(created.id);
      const scanReport = await scanOsintAsset(created.id);
      setReport(scanReport);
      setAssets((prev) =>
        prev.map((item) =>
          item.id === created.id
            ? { ...item, last_checked_at: scanReport.checked_at || new Date().toISOString() }
            : item
        )
      );
      scrollToReport();
    } catch (err) {
      const isNetworkOffline =
        err instanceof TypeError || /failed to fetch|networkerror/i.test(err?.message || '');
      if (isNetworkOffline) {
        const offlineAsset = {
          id: `offline-${Date.now()}`,
          asset_type: assetType,
          asset_value: cleanValue.toLowerCase(),
          explicit_consent: true,
          consented_at: new Date().toISOString(),
          last_checked_at: new Date().toISOString(),
          isOfflinePreview: true,
        };
        setAssets((prev) => [offlineAsset, ...prev]);
        setAssetValue('');
        setConsent(false);
        setReport({
          ...SAMPLE_AUDIT_REPORT,
          asset_id: offlineAsset.id,
          asset_type: offlineAsset.asset_type,
          asset_value: offlineAsset.asset_value,
          checked_at: offlineAsset.last_checked_at,
          email_breaches:
            offlineAsset.asset_type === 'institutional_email'
              ? SAMPLE_AUDIT_REPORT.email_breaches
              : null,
          ethical_notice:
            'Previsualización offline (API no accesible). Conecta el backend en http://localhost:8000 para auditoría OSINT real.',
        });
        scrollToReport();
      } else {
        setError(err?.message || 'Error registrando o auditando el activo.');
      }
    } finally {
      setSubmitting(false);
      setScanningId(null);
    }
  }

  async function handleScan(asset) {
    if (!asset || scanningId || submitting) return;
    setError('');

    if (asset.isSample) {
      setReport(SAMPLE_AUDIT_REPORT);
      scrollToReport();
      return;
    }

    if (asset.isOfflinePreview) {
      setReport({
        ...SAMPLE_AUDIT_REPORT,
        asset_id: asset.id,
        asset_type: asset.asset_type,
        asset_value: asset.asset_value,
        checked_at: new Date().toISOString(),
        email_breaches:
          asset.asset_type === 'institutional_email' ? SAMPLE_AUDIT_REPORT.email_breaches : null,
      });
      scrollToReport();
      return;
    }

    setScanningId(asset.id);
    try {
      const res = await scanOsintAsset(asset.id);
      setReport(res);
      setAssets((prev) =>
        prev.map((item) =>
          item.id === asset.id
            ? { ...item, last_checked_at: res.checked_at || new Date().toISOString() }
            : item
        )
      );
      scrollToReport();
    } catch (err) {
      setError(err?.message || 'Error ejecutando la auditoría pasiva.');
    } finally {
      setScanningId(null);
    }
  }

  async function handleDelete(asset) {
    if (!asset) return;
    setError('');

    if (asset.isSample) {
      setSampleActive(false);
      if (report?.asset_id === SAMPLE_AUDIT_ASSET.id) {
        setReport(null);
      }
      return;
    }

    if (asset.isOfflinePreview) {
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      if (report?.asset_id === asset.id) setReport(null);
      return;
    }

    try {
      await deleteOsintAsset(asset.id);
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      if (report?.asset_id === asset.id) setReport(null);
    } catch (err) {
      setError(err?.message || 'No se pudo revocar el activo.');
    }
  }

  function handleLoadSampleAudit() {
    setError('');
    setSampleActive(true);
    setReport(SAMPLE_AUDIT_REPORT);
    scrollToReport();
  }

  function handleCopySubdomain(sub) {
    navigator.clipboard?.writeText(sub);
    setCopiedSubdomain(sub);
    setTimeout(() => setCopiedSubdomain(''), 1500);
  }

  const activeTypeMeta = getAssetTypeMeta(assetType);
  const displayedAssets = sampleActive
    ? [SAMPLE_AUDIT_ASSET, ...assets.filter((a) => a.id !== SAMPLE_AUDIT_ASSET.id)]
    : assets;

  const isBusy = submitting || Boolean(scanningId);
  const showBreachesSection =
    Boolean(report) &&
    (report.asset_type === 'institutional_email' || Boolean(report.email_breaches));
  const showDnsSection =
    Boolean(report?.dns_posture?.domain_evaluated) || report?.asset_type !== 'organization';

  return (
    <div className="max-w-[880px] mx-auto space-y-5">
      {/* 1. Cabecera de Sección */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between border-b border-[#232329] pb-5">
        <div className="space-y-1.5 max-w-[60ch]">
          <h1 className="text-[20px] font-semibold tracking-[-0.015em] text-[#F2F2F4]">
            Mi exposición
          </h1>
          <p className="text-[13.5px] leading-[1.55] text-[#9CA3B0]">
            Auditoría OSINT 100% pasiva sobre tus propios dominios, correos institucionales u organizaciones autorizadas (Certificate Transparency, DNS y brechas públicas).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-2.5 py-1.5 text-[11.5px] font-medium text-[#7AA7FF]">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span>Consentimiento explícito · RNF8</span>
          </div>

          <button
            type="button"
            onClick={handleLoadSampleAudit}
            disabled={isBusy}
            className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED] disabled:opacity-50 transition-colors cursor-pointer"
          >
            <FileCode2 className="h-3.5 w-3.5 text-[#2F6FED]" />
            <span>Cargar auditoría de ejemplo</span>
          </button>
        </div>
      </div>

      {/* 2. Formulario de Registro con Consentimiento Obligatorio */}
      <form
        onSubmit={handleRegisterAndAudit}
        className="rounded-[6px] border border-[#232329] bg-[#141418] p-4 space-y-3"
      >
        <div className="flex flex-col sm:flex-row gap-2.5">
          <select
            aria-label="Tipo de activo propio"
            value={assetType}
            onChange={(e) => setAssetType(e.target.value)}
            className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-3 py-2 text-[12.5px] text-[#F2F2F4] focus:border-[#2F6FED] focus:outline-none"
          >
            {ASSET_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={assetValue}
            onChange={(e) => setAssetValue(e.target.value)}
            placeholder={activeTypeMeta.placeholder}
            className="flex-1 rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-3 py-2 font-tech text-[12.5px] text-[#F2F2F4] placeholder-[#8E8E96] focus:border-[#2F6FED] focus:outline-none"
          />

          <button
            type="submit"
            disabled={!assetValue.trim() || !consent || isBusy}
            className="rounded-[4px] bg-[#2F6FED] px-4 py-2 text-[12.5px] font-medium text-[#F2F2F4] hover:bg-[#255ED4] disabled:bg-[#1C1C22] disabled:text-[#8E8E96] transition-colors cursor-pointer disabled:cursor-not-allowed shrink-0"
          >
            {submitting ? 'Auditando...' : 'Registrar y auditar'}
          </button>
        </div>

        <label className="border-t border-[#232329] pt-3 flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded-[4px] border border-[#232329] bg-[#0A0A0C] accent-[#2F6FED] cursor-pointer"
          />
          <span className="text-[12.5px] leading-[1.5] text-[#9CA3B0]">
            Confirmo que soy el titular de este activo o cuento con autorización explícita para evaluar su exposición pública. Omega prohíbe consultas sobre terceros (RNF8).
          </span>
        </label>
      </form>

      {error && (
        <div className="rounded-[6px] border border-[#5C2128] bg-[#1F1215] px-4 py-3 flex items-center gap-2 text-[13px] text-[#F87171]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 3. Lista de Activos Autorizados en esta Sesión */}
      {displayedAssets.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8E8E96]">
            ACTIVOS AUTORIZADOS EN TU ESPACIO DE TRABAJO
          </h2>

          <div className="space-y-2">
            {displayedAssets.map((asset) => {
              const typeMeta = getAssetTypeMeta(asset.asset_type);
              const isSelected = report?.asset_id === asset.id;
              const isScanningThis = scanningId === asset.id;

              return (
                <div
                  key={asset.id}
                  className={`rounded-[6px] border bg-[#141418] px-4 py-2.5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between transition-colors ${
                    isSelected ? 'border-[#2F6FED]/60' : 'border-[#232329]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                    <span className="font-tech rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-2 py-0.5 text-[10.5px] font-medium text-[#7AA7FF] shrink-0">
                      {typeMeta.badge}
                    </span>

                    <span className="font-tech text-[13px] font-medium text-[#F2F2F4] break-all">
                      {asset.asset_value}
                    </span>

                    {asset.isSample && (
                      <span className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-1.5 py-0.5 text-[11px] text-[#8E8E96]">
                        Ejemplo
                      </span>
                    )}

                    <span className="font-tech text-[11.5px] text-[#8E8E96]">
                      {asset.last_checked_at
                        ? `Última auditoría: ${formatIsoStamp(asset.last_checked_at)}`
                        : `Autorizado: ${formatIsoStamp(asset.consented_at)}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleScan(asset)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2.5 py-1 text-[11.5px] font-medium text-[#F2F2F4] hover:border-[#2F6FED] disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      <Radar className="h-3.5 w-3.5 text-[#2F6FED]" />
                      <span>{isScanningThis ? 'Auditando...' : 'Auditar'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(asset)}
                      disabled={isBusy}
                      title="Revocar autorización y eliminar activo"
                      aria-label="Revocar y eliminar activo"
                      className="rounded-[4px] p-1.5 text-[#8E8E96] hover:bg-[#1F1215] hover:text-[#F87171] disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Reporte de Exposición Pasiva */}
      {report && (
        <div ref={reportRef} className="space-y-3.5 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[11.5px] font-semibold uppercase tracking-wider text-[#9CA3B0]">
                Reporte de exposición pasiva
              </h2>
              <span className="font-tech text-[12px] text-[#F2F2F4]">
                {report.asset_value}
              </span>
            </div>
            <span className="font-tech text-[11.5px] text-[#8E8E96]">
              {formatIsoStamp(report.checked_at)}
            </span>
          </div>

          {/* 4.1 Banner de Correlación con Inteligencia CTI */}
          {!report.cti_ioc_matches || report.cti_ioc_matches.length === 0 ? (
            <div className="rounded-[6px] border border-[#232329] bg-[#141418] px-4 py-3 flex items-center gap-2.5 text-[13px] text-[#F2F2F4]">
              <CheckCircle2 className="h-4 w-4 text-[#2F6FED] shrink-0" />
              <span>
                Ningún subdominio o activo vinculado coincide con infraestructura conocida de spyware comercial en la base de Omega.
              </span>
            </div>
          ) : (
            <div className="rounded-[6px] border border-[#5C2128] border-l-2 border-l-[#F87171] bg-[#1F1215] p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[#F87171]">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  Coincidencia con infraestructura documentada de spyware ({report.cti_ioc_matches.length})
                </span>
              </div>

              <div className="space-y-2">
                {report.cti_ioc_matches.map((match, idx) => (
                  <div
                    key={`${match.ioc_value}-${idx}`}
                    className="rounded-[4px] border border-[#5C2128] bg-[#0A0A0C] px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[12.5px]"
                  >
                    <div className="font-tech text-[#F2F2F4] break-all">
                      <span className="text-[#F87171]">
                        [{String(match.ioc_type || 'IOC').toUpperCase()}]
                      </span>{' '}
                      {match.ioc_value}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[12px]">
                      {match.spyware_family && (
                        <span className="font-tech rounded-[4px] border border-[#5C2128] bg-[#1F1215] px-2 py-0.5 text-[#F87171]">
                          {match.spyware_family}
                        </span>
                      )}
                      {match.source_report && (
                        <span className="text-[#9CA3B0]">{match.source_report}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4.2 Grid de Postura DNS */}
          {showDnsSection && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {report.dns_posture?.domain_evaluated ? (
                <>
                  {/* Tarjeta SPF */}
                  <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-[#F2F2F4]">
                        Registro SPF
                      </span>
                      <span
                        className={`rounded-[4px] border px-2 py-0.5 text-[11px] font-medium ${
                          report.dns_posture.spf_configured
                            ? 'border-[#2F6FED]/40 bg-[#15223D] text-[#7AA7FF]'
                            : 'border-[#52401E] bg-[#1C1810] text-[#FBBF24]'
                        }`}
                      >
                        {report.dns_posture.spf_configured ? 'Configurado' : 'Sin registro SPF'}
                      </span>
                    </div>

                    <div className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-3 py-2 font-tech text-[11.5px] leading-[1.5] text-[#F2F2F4] break-all">
                      {report.dns_posture.spf_record ||
                        'Sin registro TXT v=spf1 detectado en DNS público.'}
                    </div>
                  </div>

                  {/* Tarjeta DMARC */}
                  <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-[#F2F2F4]">
                        Política DMARC
                      </span>
                      <span
                        className={`rounded-[4px] border px-2 py-0.5 text-[11px] font-medium ${
                          report.dns_posture.dmarc_configured
                            ? 'border-[#2F6FED]/40 bg-[#15223D] text-[#7AA7FF]'
                            : 'border-[#52401E] bg-[#1C1810] text-[#FBBF24]'
                        }`}
                      >
                        {report.dns_posture.dmarc_configured
                          ? 'Configurado'
                          : 'Sin política DMARC'}
                      </span>
                    </div>

                    <div className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-3 py-2 font-tech text-[11.5px] leading-[1.5] text-[#F2F2F4] break-all">
                      {report.dns_posture.dmarc_record ||
                        'Sin política TXT _dmarc (v=DMARC1) detectada en DNS público.'}
                    </div>
                  </div>
                </>
              ) : (
                <div className="md:col-span-2 rounded-[6px] border border-[#232329] bg-[#141418] px-4 py-3 text-[12.5px] text-[#9CA3B0]">
                  {report.dns_posture?.notes?.[0] ||
                    'Consulta DNS directa omitida para activos de tipo organización.'}
                </div>
              )}
            </div>
          )}

          {/* 4.3 Sección de Brechas Públicas Documentadas (institutional_email) */}
          {showBreachesSection && report.email_breaches && (
            <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13.5px] font-semibold text-[#F2F2F4]">
                  {report.email_breaches.source || 'XposedOrNot Public Breach Intelligence'}
                </span>

                <span
                  className={`font-tech rounded-[4px] border px-2.5 py-0.5 text-[11px] font-medium ${
                    report.email_breaches.status === 'unavailable' ||
                    report.email_breaches.breach_count > 0
                      ? 'border-[#52401E] bg-[#1C1810] text-[#FBBF24]'
                      : 'border-[#2F6FED]/40 bg-[#15223D] text-[#7AA7FF]'
                  }`}
                >
                  {report.email_breaches.status === 'unavailable'
                    ? 'Servicio externo no disponible'
                    : report.email_breaches.breach_count > 0
                    ? `${report.email_breaches.breach_count} ${
                        report.email_breaches.breach_count === 1
                          ? 'brecha documentada'
                          : 'brechas documentadas'
                      }`
                    : '0 brechas'}
                </span>
              </div>

              {report.email_breaches.breaches?.length > 0 ? (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {report.email_breaches.breaches.map((b, idx) => (
                    <div
                      key={`${b.breach_name}-${idx}`}
                      className="rounded-[6px] border border-[#232329] bg-[#0A0A0C] p-3 space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13px] font-semibold text-[#F2F2F4] leading-snug">
                          {b.breach_name}
                        </span>
                        <span className="font-tech text-[11px] text-[#8E8E96] shrink-0">
                          {b.breach_date}
                        </span>
                      </div>
                      <p className="text-[12px] leading-[1.45] text-[#9CA3B0]">
                        {b.exposed_data}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                report.email_breaches.status !== 'unavailable' && (
                  <p className="text-[12.5px] text-[#9CA3B0]">
                    No figuran filtraciones históricas públicas para este correo en el índice consultado.
                  </p>
                )
              )}
            </div>
          )}

          {/* 4.4 Subdominios Públicos en Certificate Transparency (crt.sh) */}
          <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-semibold text-[#F2F2F4]">
                  Subdominios públicos detectados vía{' '}
                  <span className="font-tech">crt.sh</span>
                </span>
              </div>

              <span className="font-tech rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-0.5 text-[11.5px] text-[#7AA7FF]">
                {report.exposed_subdomains?.length ?? 0}
              </span>
            </div>

            {report.exposed_subdomains?.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {report.exposed_subdomains.map((sub) => (
                  <div
                    key={sub}
                    className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2.5 py-1.5 flex items-center justify-between gap-2"
                  >
                    <span
                      className="font-tech text-[12px] text-[#F2F2F4] truncate"
                      title={sub}
                    >
                      {sub}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleCopySubdomain(sub)}
                      title="Copiar subdominio"
                      aria-label={`Copiar ${sub}`}
                      className="shrink-0 text-[#8E8E96] hover:text-[#F2F2F4] transition-colors cursor-pointer"
                    >
                      {copiedSubdomain === sub ? (
                        <Check className="h-3.5 w-3.5 text-[#2F6FED]" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-[#8E8E96]">
                Sin subdominios públicos adicionales reportados en Certificate Transparency.
              </p>
            )}

            {report.ethical_notice && (
              <p className="border-t border-[#232329] pt-2.5 text-[11.5px] text-[#8E8E96]">
                {report.ethical_notice}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
