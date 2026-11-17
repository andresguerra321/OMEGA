import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Link2,
  Loader2,
  RefreshCw,
  Shield,
  Smartphone,
  X,
} from 'lucide-react';
import {
  createOsintAsset,
  deleteOsintAsset,
  fetchOsintAssets,
  scanOsintAsset,
} from '../lib/api';
import { stripUnsafeChars, validateDomain, validateEmail } from '../lib/validators';
import { useSingleFlight } from '../lib/useSingleFlight';
import { useScrollReveal } from '../lib/useScrollReveal';
import {
  ActionConfirmationBanner,
  PanelErrorBanner,
  PanelSkeleton,
} from './PanelStatePrimitives';

function formatExposedData(val) {
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'string' && val.trim()) return val;
  return 'Metadatos / Credenciales';
}

export function OsintPanel({
  onAskInChat,
  onVerifyLink,
  onAuditDevice,
  onOpenThreat,
  initialAsset = null,
  initialJumpKey = 0,
}) {
  const [assets, setAssets] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [loadAssetsError, setLoadAssetsError] = useState('');
  const [assetType, setAssetType] = useState('institutional_email');
  const [assetValue, setAssetValue] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [activeAsset, setActiveAsset] = useState(null);
  const [report, setReport] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmationNote, setConfirmationNote] = useState(null);
  const [copiedSubdomain, setCopiedSubdomain] = useState(null);
  const guard = useSingleFlight();
  const lastJumpKeyRef = useRef(0);
  const reportContainerRef = useRef(null);

  useEffect(() => {
    if (!initialJumpKey || !initialAsset?.value || initialJumpKey === lastJumpKeyRef.current) {
      return undefined;
    }
    lastJumpKeyRef.current = initialJumpKey;
    const timer = setTimeout(() => {
      setReport(null);
      setActiveAsset(null);
      setErrorMsg('');
      setAssetType(initialAsset.type === 'institutional_email' ? 'institutional_email' : 'domain');
      setAssetValue(String(initialAsset.value).trim());
      setConsentChecked(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialJumpKey, initialAsset]);

  useScrollReveal(reportContainerRef, [report?.asset_value, isScanning]);

  async function loadSessionAssets() {
    setLoadingAssets(true);
    setLoadAssetsError('');
    try {
      const res = await fetchOsintAssets();
      setAssets(res.assets || []);
    } catch (err) {
      setLoadAssetsError(
        err?.message || 'No se pudieron cargar los activos autorizados de la sesión.',
      );
    } finally {
      setLoadingAssets(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchOsintAssets()
      .then((res) => {
        if (cancelled) return;
        setLoadAssetsError('');
        setAssets(res.assets || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadAssetsError(
          err?.message || 'No se pudieron cargar los activos autorizados de la sesión.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingAssets(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onAuthChanged = (e) => {
      if (e?.detail) {
        void loadSessionAssets();
      } else {
        setAssets([]);
        setActiveAsset(null);
        setReport(null);
      }
    };
    window.addEventListener('omega:auth-changed', onAuthChanged);
    return () => window.removeEventListener('omega:auth-changed', onAuthChanged);
  }, []);

  async function runScan(asset) {
    setIsScanning(true);
    setErrorMsg('');
    setConfirmationNote(null);
    try {
      const scanRes = await scanOsintAsset(asset.id);
      setActiveAsset(asset);
      setReport(scanRes);
      const hits = (scanRes.cti_ioc_matches || []).length;
      const spfOk = scanRes.dns_posture?.spf_configured;
      const dmarcOk = scanRes.dns_posture?.dmarc_configured;
      setConfirmationNote({
        tone: hits > 0 ? 'alert' : 'clean',
        message:
          hits > 0
            ? `Listo: auditoría completada para ${scanRes.asset_value} — encontramos ${hits} coincidencia(s) con infraestructura spyware.`
            : `Listo: auditoría pasiva completada para ${scanRes.asset_value} — sin coincidencias spyware (SPF: ${spfOk ? 'OK' : 'ausente'}, DMARC: ${dmarcOk ? 'OK' : 'ausente'}).`,
      });
    } catch (err) {
      setErrorMsg(err?.message || `No se pudo auditar ${asset.asset_value}.`);
    } finally {
      setIsScanning(false);
    }
  }

  function executeScan(asset) {
    if (isScanning) return;
    guard(() => runScan(asset));
  }

  async function handleSubmitAudit(e) {
    e.preventDefault();
    if (!consentChecked || isScanning) return;
    const validation =
      assetType === 'institutional_email'
        ? validateEmail(assetValue)
        : validateDomain(assetValue);
    if (!validation.valid) {
      setErrorMsg(validation.error);
      return;
    }

    await guard(async () => {
      setIsScanning(true);
      setErrorMsg('');
      setConfirmationNote(null);
      try {
        const created = await createOsintAsset({
          asset_type: assetType,
          asset_value: validation.value,
          explicit_consent: true,
        });
        setAssets((prev) => [created, ...prev.filter((a) => a.id !== created.id)]);
        setLoadAssetsError('');
        setAssetValue('');
        setConsentChecked(false);
        await runScan(created);
      } catch (err) {
        setErrorMsg(err?.message || 'Error registrando el activo autorizado.');
        setIsScanning(false);
      }
    });
  }

  async function handleRevokeAsset(e, asset) {
    e.stopPropagation();
    await guard(async () => {
      setErrorMsg('');
      try {
        await deleteOsintAsset(asset.id);
        setAssets((prev) => prev.filter((a) => a.id !== asset.id));
        if (activeAsset?.id === asset.id) {
          setActiveAsset(null);
          setReport(null);
        }
        setConfirmationNote({
          tone: 'info',
          message: `Listo: se eliminó ${asset.asset_value} de esta sesión.`,
        });
      } catch (err) {
        setErrorMsg(err?.message || 'No se pudo eliminar el activo.');
      }
    });
  }

  async function handleCopySubdomain(sub) {
    try {
      await navigator.clipboard.writeText(sub);
      setCopiedSubdomain(sub);
      setTimeout(() => setCopiedSubdomain(null), 1500);
    } catch {
      // Clipboard API unavailable
    }
  }

  // --- ESTADO 2: RESULTADO (Columna única centrada, max-w-[700px]) ---
  if (report) {
    const ctiMatches = report.cti_ioc_matches || [];
    const hasCtiHits = ctiMatches.length > 0;
    const isEmailReport = report.email_breaches !== null && report.email_breaches !== undefined;
    const breaches = report.email_breaches?.breaches || [];
    const dns = report.dns_posture || {};
    const subdomains = report.exposed_subdomains || [];

    return (
      <div
        ref={reportContainerRef}
        className="animate-fade-up w-full max-w-[700px] mx-auto pt-2 pb-12 space-y-6"
      >
        {/* Cabecera */}
        <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.07]">
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => {
                setReport(null);
                setErrorMsg('');
              }}
              className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12.5px] font-medium text-[#F2F2F4] hover:bg-white/[0.08] active:scale-[0.97] transition-all cursor-pointer shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-[#9A9AA2]" />
              <span>Cambiar activo</span>
            </button>

            <span className="font-tech text-[13.5px] sm:text-[14px] font-medium text-[#F2F2F4] break-all sm:truncate min-w-0">
              {report.asset_value}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onAskInChat && (
              <button
                type="button"
                onClick={() => {
                  const telemetry = [
                    `Activo OSINT auditado: ${report.asset_value}`,
                    `Coincidencias CTI spyware: ${ctiMatches.length}`,
                    ctiMatches.length > 0
                      ? `Detalle CTI: ${ctiMatches.slice(0, 5).map((m) => `${m.ioc_value} (${m.spyware_family || 'CTI'})`).join(', ')}`
                      : '',
                    `SPF configurado: ${dns.spf_configured ? dns.spf_record || 'Sí' : 'No'}`,
                    `DMARC configurado: ${dns.dmarc_configured ? dns.dmarc_record || 'Sí' : 'No'}`,
                    `Subdominios crt.sh: ${subdomains.length}`,
                    isEmailReport ? `Brechas de correo (HIBP): ${breaches.length}` : '',
                  ]
                    .filter(Boolean)
                    .join('\n');
                  const prompt = [
                    `Analiza defensivamente la exposición pública del activo ${report.asset_value}:`,
                    `- Coincidencias CTI spyware: ${ctiMatches.length}`,
                    `- SPF configurado: ${dns.spf_configured ? dns.spf_record || 'Sí' : 'No'}`,
                    `- DMARC configurado: ${dns.dmarc_configured ? dns.dmarc_record || 'Sí' : 'No'}`,
                    `- Subdominios crt.sh: ${subdomains.length}`,
                    `¿Cómo pueden abusar campañas de spyware 1-click o phishing de esta superficie y qué medidas defensivas priorizar?`,
                  ].join('\n');
                  onAskInChat(prompt, {
                    analysisContext: telemetry,
                    pinnedContext: report.asset_value,
                  });
                }}
                className="inline-flex items-center rounded-[9px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/75 hover:shadow-[0_0_24px_rgba(47,111,237,0.25)] active:scale-[0.97] transition-all cursor-pointer"
              >
                Consultar con Copiloto
              </button>
            )}
            {activeAsset && (
              <button
                type="button"
                disabled={isScanning}
                onClick={() => executeScan(activeAsset)}
                className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4]/85 hover:bg-white/[0.08] hover:text-[#F2F2F4] disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${isScanning ? 'animate-spin' : ''}`} />
                <span>Re-auditar</span>
              </button>
            )}
          </div>
        </header>

        {errorMsg && (
          <PanelErrorBanner
            message={errorMsg}
            onRetry={activeAsset ? () => executeScan(activeAsset) : undefined}
            onDismiss={() => setErrorMsg('')}
          />
        )}

        {confirmationNote && (
          <ActionConfirmationBanner
            message={confirmationNote.message}
            tone={confirmationNote.tone}
            onDismiss={() => setConfirmationNote(null)}
          />
        )}

        {/* Secciones Agrupadas Glass */}
        <div className="space-y-5">
          {/* 1. Cruce con Spyware */}
          <section className="animate-on-scroll space-y-2" data-delay="0">
            <h2 className="px-1 text-[12.5px] font-semibold tracking-[-0.01em] text-[#9A9AA2]">
              Cruce con infraestructura spyware
            </h2>

            <div className="omega-glass-panel rounded-[13px] overflow-hidden">
              {!hasCtiHits ? (
                <div className="px-4 py-3.5 flex items-center gap-2.5 text-[13px] text-[#F2F2F4]/90">
                  <span className="h-2 w-2 rounded-full bg-[#30D158] shrink-0" />
                  <span>Sin coincidencias en infraestructura de spyware conocida</span>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-[13px] font-medium text-[#FF6961] bg-[#FF453A]/10">
                    <span>
                      Se detectaron {ctiMatches.length} coincidencia{ctiMatches.length === 1 ? '' : 's'} con infraestructura CTI pública
                    </span>
                    {onAuditDevice && (
                      <button
                        type="button"
                        onClick={() => onAuditDevice('pc')}
                        className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#FF453A]/40 bg-[#FF453A]/15 px-2.5 py-1 text-[11.5px] font-medium text-[#FFD0CE] hover:bg-[#FF453A]/25 active:scale-[0.97] transition-all cursor-pointer"
                      >
                        <Smartphone className="h-3.5 w-3.5" />
                        <span>Revisar dispositivo</span>
                      </button>
                    )}
                  </div>
                  {ctiMatches.map((m, idx) => (
                    <div
                      key={`${m.ioc_value}-${idx}`}
                      className="px-4 py-3 flex flex-wrap items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <span className="font-tech text-[13px] text-[#F2F2F4] break-all block">
                          {m.ioc_value}
                        </span>
                        <span className="text-[12px] text-[#9A9AA2] break-words block">
                          {m.spyware_family} · {m.source_report}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {onVerifyLink && (
                          <button
                            type="button"
                            onClick={() => onVerifyLink(m.ioc_value)}
                            className="inline-flex items-center gap-1 rounded-[7px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-2.5 py-1 text-[11px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/75 hover:shadow-[0_0_24px_rgba(47,111,237,0.25)] active:scale-[0.96] transition-all cursor-pointer"
                          >
                            <Link2 className="h-3 w-3" />
                            <span>Inspeccionar enlace</span>
                          </button>
                        )}
                        {onOpenThreat && m.spyware_family && (
                          <button
                            type="button"
                            onClick={() => onOpenThreat(m.spyware_family)}
                            className="inline-flex items-center gap-1 rounded-[7px] border border-white/[0.08] bg-white/[0.045] px-2.5 py-1 text-[11px] text-[#F2F2F4]/85 hover:text-[#F2F2F4] hover:bg-white/[0.08] active:scale-[0.96] transition-all cursor-pointer"
                          >
                            <Shield className="h-3 w-3" />
                            <span>Ver campaña</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* 2. Brechas Documentadas (si es correo) */}
          {isEmailReport && (
            <section className="animate-on-scroll space-y-2" data-delay="60">
              <h2 className="px-1 text-[12.5px] font-semibold tracking-[-0.01em] text-[#9A9AA2]">
                Brechas documentadas
              </h2>

              <div className="apple-group rounded-[13px] overflow-hidden">
                {report.email_breaches.status === 'unavailable' ? (
                  <p className="px-4 py-3.5 text-[13px] text-[#9A9AA2]">
                    Fuente pública de brechas no disponible temporalmente durante esta consulta.
                  </p>
                ) : breaches.length === 0 ? (
                  <div className="px-4 py-3.5 flex items-center gap-2.5 text-[13px] text-[#F2F2F4]/90">
                    <span className="h-2 w-2 rounded-full bg-[#30D158] shrink-0" />
                    <span>Sin brechas públicas documentadas para este correo</span>
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {breaches.map((b, idx) => (
                      <div
                        key={`${b.breach_name}-${idx}`}
                        className="px-4 py-3.5 flex flex-wrap items-baseline justify-between gap-2 sm:gap-3"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="text-[13.5px] font-medium tracking-[-0.01em] text-[#F2F2F4] break-words">
                            {b.breach_name}
                          </div>
                          <div className="text-[12px] text-[#9A9AA2] break-words">
                            Datos expuestos: {formatExposedData(b.exposed_data)}
                          </div>
                        </div>

                        <span className="font-tech text-[11.5px] text-[#9A9AA2] shrink-0">
                          {b.breach_date || 'Fecha N/D'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 3. Postura DNS y Subdominios (crt.sh) */}
          <section className="animate-on-scroll space-y-2" data-delay="120">
            <h2 className="px-1 text-[12.5px] font-semibold tracking-[-0.01em] text-[#9A9AA2]">
              Postura DNS y Certificate Transparency (<span className="font-tech">crt.sh</span>)
            </h2>

            <div className="apple-group rounded-[13px] divide-y divide-white/[0.06]">
              <div className="px-4 py-3 flex flex-wrap items-baseline gap-2.5 sm:gap-3 text-[13px]">
                <span className="font-tech text-[12px] font-semibold text-[#F2F2F4] w-14 shrink-0">
                  SPF
                </span>
                <span className={`font-medium ${dns.spf_configured ? 'text-[#30D158]' : 'text-[#9A9AA2]'}`}>
                  {dns.spf_configured ? 'Configurado' : 'Ausente'}
                </span>
                {dns.spf_record && (
                  <span className="font-tech text-[12px] text-[#9A9AA2] break-all">
                    {dns.spf_record}
                  </span>
                )}
              </div>

              <div className="px-4 py-3 flex flex-wrap items-baseline gap-2.5 sm:gap-3 text-[13px]">
                <span className="font-tech text-[12px] font-semibold text-[#F2F2F4] w-14 shrink-0">
                  DMARC
                </span>
                <span className={`font-medium ${dns.dmarc_configured ? 'text-[#30D158]' : 'text-[#9A9AA2]'}`}>
                  {dns.dmarc_configured ? 'Configurado' : 'Ausente'}
                </span>
                {dns.dmarc_record && (
                  <span className="font-tech text-[12px] text-[#9A9AA2] break-all">
                    {dns.dmarc_record}
                  </span>
                )}
              </div>
            </div>

            <div className="pt-2">
              <div className="px-1 text-[12px] text-[#9A9AA2] mb-2">
                Subdominios públicos observados ({subdomains.length})
              </div>

              {subdomains.length === 0 ? (
                <div className="apple-group rounded-[13px] px-4 py-3.5 text-[12.5px] text-[#9A9AA2]">
                  No se registraron subdominios en Certificate Transparency para este dominio.
                </div>
              ) : (
                <div className="apple-group rounded-[13px] divide-y divide-white/[0.06] overflow-hidden">
                  {subdomains.map((sub) => (
                    <div
                      key={sub}
                      className="px-4 py-2.5 flex items-center justify-between gap-3"
                    >
                      <span className="font-tech text-[12.5px] text-[#F2F2F4] truncate min-w-0">
                        {sub}
                      </span>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {onVerifyLink && (
                          <button
                            type="button"
                            onClick={() => onVerifyLink(sub)}
                            title="Verificar subdominio en el módulo de enlaces sin contacto HTTP"
                            className="inline-flex items-center gap-1 rounded-[7px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-2.5 py-1 text-[11px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/75 hover:shadow-[0_0_24px_rgba(47,111,237,0.25)] active:scale-[0.96] transition-all cursor-pointer"
                          >
                            <Link2 className="h-3 w-3" />
                            <span>Verificar</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleCopySubdomain(sub)}
                          className="shrink-0 inline-flex items-center gap-1 rounded-[7px] border border-white/[0.08] bg-white/[0.045] px-2.5 py-1 text-[11px] text-[#9A9AA2] hover:text-[#F2F2F4] hover:bg-white/[0.08] active:scale-[0.96] transition-all cursor-pointer"
                        >
                          {copiedSubdomain === sub ? (
                            <>
                              <Check className="h-3 w-3 text-[#2F6FED]" />
                              <span className="text-[#F2F2F4]">Copiado</span>
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
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  // --- ESTADO 1: INICIAL (Centrado vertical y horizontalmente, max-w-[620px]) ---
  return (
    <div className="animate-fade-up flex-1 flex flex-col items-center justify-center py-6">
      <div className="w-full max-w-[620px]">
        <header className="text-center mb-6 sm:mb-7">
          <h1 className="text-[24px] sm:text-[31px] font-semibold tracking-[-0.028em] leading-[1.15] text-[#F2F2F4]">
            Exposición pública
          </h1>
          <p className="mt-2 text-[13.5px] text-[#9A9AA2] max-w-[440px] mx-auto">
            Consulta filtraciones y registros DNS autorizados.
          </p>
        </header>

        {/* Barra de Consulta Spotlight */}
        <form
          noValidate
          onSubmit={handleSubmitAudit}
          style={{ animationDelay: '60ms' }}
          className="animate-scale-in omega-capsule rounded-[16px] p-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-2.5">
            <div className="apple-segmented inline-flex self-start sm:self-auto rounded-[9px] p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setAssetType('institutional_email');
                  setErrorMsg('');
                }}
                className={`rounded-[7px] px-3 py-1.5 text-[12px] font-medium transition-all duration-150 cursor-pointer ${
                  assetType === 'institutional_email'
                    ? 'apple-segmented-active'
                    : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                }`}
              >
                Correo
              </button>
              <button
                type="button"
                onClick={() => {
                  setAssetType('domain');
                  setErrorMsg('');
                }}
                className={`rounded-[7px] px-3 py-1.5 text-[12px] font-medium transition-all duration-150 cursor-pointer ${
                  assetType === 'domain'
                    ? 'apple-segmented-active'
                    : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                }`}
              >
                Dominio
              </button>
            </div>

            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                type="text"
                maxLength={254}
                value={assetValue}
                onChange={(e) => {
                  setAssetValue(stripUnsafeChars(e.target.value, 254));
                  if (errorMsg) setErrorMsg('');
                }}
                aria-invalid={Boolean(errorMsg)}
                placeholder={
                  assetType === 'institutional_email'
                    ? 'prensa@organizacion.org'
                    : 'organizacion.org'
                }
                className="font-tech flex-1 min-w-0 h-9 bg-transparent px-2 text-[13.5px] text-[#F2F2F4] placeholder-[#9A9AA2] focus:outline-none"
              />

              <button
                type="submit"
                disabled={!assetValue.trim() || !consentChecked || isScanning}
                className="h-9 rounded-[10px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.28),inset_0_1px_0_rgba(255,255,255,0.22)] hover:bg-[#2F6FED]/90 hover:shadow-[0_0_24px_rgba(47,111,237,0.35)] disabled:bg-white/[0.07] disabled:text-[#9A9AA2] disabled:shadow-none px-4 text-[13px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer shrink-0 disabled:cursor-not-allowed"
              >
                {isScanning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Auditar</span>
              </button>
            </div>
          </div>

          <div className="pt-2.5 mt-2.5 border-t border-white/[0.065]">
            <label className="inline-flex items-start sm:items-center gap-2.5 text-[12px] text-[#9A9AA2] hover:text-[#F2F2F4] transition-colors cursor-pointer select-none">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 sm:mt-0 h-3.5 w-3.5 rounded-[4px] accent-[#2F6FED] cursor-pointer shrink-0"
              />
              <span>Confirmo titularidad o autorización explícita.</span>
            </label>
          </div>
        </form>

        {errorMsg && (
          <PanelErrorBanner
            message={errorMsg}
            onDismiss={() => setErrorMsg('')}
            className="mt-3"
          />
        )}

        {confirmationNote && (
          <ActionConfirmationBanner
            message={confirmationNote.message}
            tone={confirmationNote.tone}
            onDismiss={() => setConfirmationNote(null)}
            className="mt-3"
          />
        )}

        {loadingAssets ? (
          <PanelSkeleton
            label="Cargando activos autorizados en sesión..."
            lines={2}
            className="mt-5"
          />
        ) : loadAssetsError ? (
          <PanelErrorBanner
            message={loadAssetsError}
            onRetry={loadSessionAssets}
            className="mt-5"
          />
        ) : assets.length === 0 ? (
          <p className="mt-4 text-center text-[12px] text-[#9A9AA2]">
            Ingresa un correo o dominio autorizado para auditar.
          </p>
        ) : (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {assets.map((asset, idx) => (
              <div
                key={asset.id}
                onClick={() => executeScan(asset)}
                style={{ animationDelay: `${100 + idx * 35}ms` }}
                className="animate-fade-up font-tech inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1 text-[11.5px] text-[#F2F2F4] hover:border-[#2F6FED]/55 hover:bg-[rgba(28,36,56,0.65)] hover:shadow-[0_0_20px_rgba(47,111,237,0.2)] hover:-translate-y-0.5 active:scale-[0.97] cursor-pointer transition-all max-w-full"
              >
                <span className="truncate">{asset.asset_value}</span>
                <button
                  type="button"
                  title="Eliminar de la sesión"
                  onClick={(e) => handleRevokeAsset(e, asset)}
                  className="text-[#9A9AA2] hover:text-[#FF453A] cursor-pointer shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
