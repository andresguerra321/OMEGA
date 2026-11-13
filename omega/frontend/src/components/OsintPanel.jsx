import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Loader2, RefreshCw, X } from 'lucide-react';
import {
  createOsintAsset,
  deleteOsintAsset,
  fetchOsintAssets,
  scanOsintAsset,
} from '../lib/api';

function formatExposedData(val) {
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'string' && val.trim()) return val;
  return 'Metadatos / Credenciales';
}

export function OsintPanel({ onAskInChat }) {
  const [assets, setAssets] = useState([]);
  const [assetType, setAssetType] = useState('institutional_email');
  const [assetValue, setAssetValue] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [activeAsset, setActiveAsset] = useState(null);
  const [report, setReport] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedSubdomain, setCopiedSubdomain] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadSessionAssets() {
      try {
        const res = await fetchOsintAssets();
        if (!cancelled) {
          setAssets(res.assets || []);
        }
      } catch {
        // Backend offline handled on explicit action
      }
    }
    loadSessionAssets();
    return () => {
      cancelled = true;
    };
  }, []);

  async function executeScan(asset) {
    setIsScanning(true);
    setErrorMsg('');
    try {
      const scanRes = await scanOsintAsset(asset.id);
      setActiveAsset(asset);
      setReport(scanRes);
    } catch (err) {
      setErrorMsg(err?.message || `No se pudo auditar ${asset.asset_value}.`);
    } finally {
      setIsScanning(false);
    }
  }

  async function handleSubmitAudit(e) {
    e.preventDefault();
    const cleaned = assetValue.trim();
    if (!cleaned || !consentChecked || isScanning) return;

    setIsScanning(true);
    setErrorMsg('');
    try {
      const created = await createOsintAsset({
        asset_type: assetType,
        asset_value: cleaned,
        explicit_consent: true,
      });
      setAssets((prev) => [created, ...prev.filter((a) => a.id !== created.id)]);
      setAssetValue('');
      setConsentChecked(false);
      await executeScan(created);
    } catch (err) {
      setErrorMsg(err?.message || 'Error registrando el activo autorizado.');
      setIsScanning(false);
    }
  }

  async function handleRevokeAsset(e, asset) {
    e.stopPropagation();
    setErrorMsg('');
    try {
      await deleteOsintAsset(asset.id);
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    } catch (err) {
      setErrorMsg(err?.message || 'No se pudo eliminar el activo.');
    }
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
      <div className="omega-fade-up w-full max-w-[700px] mx-auto pt-2 pb-12 space-y-6">
        {/* Cabecera */}
        <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.07]">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => {
                setReport(null);
                setErrorMsg('');
              }}
              className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12.5px] font-medium text-[#F5F5F7] hover:bg-white/[0.08] active:scale-[0.97] transition-all cursor-pointer shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-[#8E8E93]" />
              <span>Cambiar activo</span>
            </button>

            <span className="font-tech text-[14px] font-medium text-[#F5F5F7] truncate">
              {report.asset_value}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {onAskInChat && (
              <button
                type="button"
                onClick={() => {
                  const prompt = [
                    `Analiza defensivamente la exposición pública del activo ${report.asset_value}:`,
                    `- Coincidencias CTI spyware: ${(report.cti_ioc_matches || []).length}`,
                    `- SPF configurado: ${dns.spf_configured ? dns.spf_record || 'Sí' : 'No'}`,
                    `- DMARC configurado: ${dns.dmarc_configured ? dns.dmarc_record || 'Sí' : 'No'}`,
                    `- Subdominios crt.sh: ${subdomains.length}`,
                    `¿Cómo pueden abusar campañas de spyware 1-click o phishing de esta superficie y qué medidas defensivas priorizar?`,
                  ].join('\n');
                  onAskInChat(prompt);
                }}
                className="inline-flex items-center rounded-[9px] border border-[#2F6FED]/40 bg-[#2F6FED]/15 px-3 py-1.5 text-[12px] font-medium text-[#8AB4FF] hover:bg-[#2F6FED]/24 active:scale-[0.97] transition-all cursor-pointer"
              >
                Investigar en Preguntar
              </button>
            )}
            {activeAsset && (
              <button
                type="button"
                disabled={isScanning}
                onClick={() => executeScan(activeAsset)}
                className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12px] font-medium text-[#D1D1D6] hover:bg-white/[0.08] hover:text-[#F5F5F7] disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${isScanning ? 'animate-spin' : ''}`} />
                <span>Re-auditar</span>
              </button>
            )}
          </div>
        </header>

        {errorMsg && (
          <p className="text-[12.5px] text-[#FF453A]">{errorMsg}</p>
        )}

        {/* Secciones Agrupadas Apple Obsidian */}
        <div className="space-y-5">
          {/* 1. Cruce con Spyware */}
          <section className="space-y-2">
            <h2 className="px-1 text-[12.5px] font-semibold tracking-[-0.01em] text-[#8E8E93]">
              Cruce con infraestructura spyware
            </h2>

            <div className="apple-group rounded-[13px] overflow-hidden">
              {!hasCtiHits ? (
                <div className="px-4 py-3.5 flex items-center gap-2.5 text-[13px] text-[#D1D1D6]">
                  <span className="h-2 w-2 rounded-full bg-[#30D158]" />
                  <span>Sin coincidencias en infraestructura de spyware conocida</span>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  <div className="px-4 py-3 text-[13px] font-medium text-[#FF6961] bg-[#FF453A]/10">
                    Se detectaron {ctiMatches.length} coincidencia{ctiMatches.length === 1 ? '' : 's'} con infraestructura CTI pública
                  </div>
                  {ctiMatches.map((m, idx) => (
                    <div
                      key={`${m.ioc_value}-${idx}`}
                      className="px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="font-tech text-[13px] text-[#F5F5F7]">
                        {m.ioc_value}
                      </span>
                      <span className="text-[12px] text-[#8E8E93]">
                        {m.spyware_family} · {m.source_report}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* 2. Brechas Documentadas (si es correo) */}
          {isEmailReport && (
            <section className="space-y-2">
              <h2 className="px-1 text-[12.5px] font-semibold tracking-[-0.01em] text-[#8E8E93]">
                Brechas documentadas
              </h2>

              <div className="apple-group rounded-[13px] overflow-hidden">
                {report.email_breaches.status === 'unavailable' ? (
                  <p className="px-4 py-3.5 text-[13px] text-[#8E8E93]">
                    Fuente pública de brechas no disponible temporalmente durante esta consulta.
                  </p>
                ) : breaches.length === 0 ? (
                  <div className="px-4 py-3.5 flex items-center gap-2.5 text-[13px] text-[#D1D1D6]">
                    <span className="h-2 w-2 rounded-full bg-[#30D158]" />
                    <span>Sin brechas públicas documentadas para este correo</span>
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {breaches.map((b, idx) => (
                      <div
                        key={`${b.breach_name}-${idx}`}
                        className="px-4 py-3.5 flex flex-wrap items-baseline justify-between gap-3"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="text-[13.5px] font-medium tracking-[-0.01em] text-[#F5F5F7]">
                            {b.breach_name}
                          </div>
                          <div className="text-[12px] text-[#8E8E93]">
                            Datos expuestos: {formatExposedData(b.exposed_data)}
                          </div>
                        </div>

                        <span className="font-tech text-[11.5px] text-[#8E8E93] shrink-0">
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
          <section className="space-y-2">
            <h2 className="px-1 text-[12.5px] font-semibold tracking-[-0.01em] text-[#8E8E93]">
              Postura DNS y Certificate Transparency (<span className="font-tech">crt.sh</span>)
            </h2>

            <div className="apple-group rounded-[13px] divide-y divide-white/[0.06]">
              <div className="px-4 py-3 flex flex-wrap items-baseline gap-3 text-[13px]">
                <span className="font-tech text-[12px] font-semibold text-[#F5F5F7] w-14 shrink-0">
                  SPF
                </span>
                <span className={`font-medium ${dns.spf_configured ? 'text-[#30D158]' : 'text-[#8E8E93]'}`}>
                  {dns.spf_configured ? 'Configurado' : 'Ausente'}
                </span>
                {dns.spf_record && (
                  <span className="font-tech text-[12px] text-[#8E8E93] break-all">
                    {dns.spf_record}
                  </span>
                )}
              </div>

              <div className="px-4 py-3 flex flex-wrap items-baseline gap-3 text-[13px]">
                <span className="font-tech text-[12px] font-semibold text-[#F5F5F7] w-14 shrink-0">
                  DMARC
                </span>
                <span className={`font-medium ${dns.dmarc_configured ? 'text-[#30D158]' : 'text-[#8E8E93]'}`}>
                  {dns.dmarc_configured ? 'Configurado' : 'Ausente'}
                </span>
                {dns.dmarc_record && (
                  <span className="font-tech text-[12px] text-[#8E8E93] break-all">
                    {dns.dmarc_record}
                  </span>
                )}
              </div>
            </div>

            <div className="pt-2">
              <div className="px-1 text-[12px] text-[#8E8E93] mb-2">
                Subdominios públicos observados ({subdomains.length})
              </div>

              {subdomains.length === 0 ? (
                <div className="apple-group rounded-[13px] px-4 py-3.5 text-[12.5px] text-[#8E8E93]">
                  No se registraron subdominios en Certificate Transparency para este dominio.
                </div>
              ) : (
                <div className="apple-group rounded-[13px] divide-y divide-white/[0.06] overflow-hidden">
                  {subdomains.map((sub) => (
                    <div
                      key={sub}
                      className="px-4 py-2.5 flex items-center justify-between gap-3"
                    >
                      <span className="font-tech text-[12.5px] text-[#F5F5F7] truncate">
                        {sub}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleCopySubdomain(sub)}
                        className="shrink-0 inline-flex items-center gap-1 rounded-[7px] border border-white/[0.08] bg-white/[0.045] px-2.5 py-1 text-[11px] text-[#8E8E93] hover:text-[#F5F5F7] hover:bg-white/[0.08] active:scale-[0.96] transition-all cursor-pointer"
                      >
                        {copiedSubdomain === sub ? (
                          <>
                            <Check className="h-3 w-3 text-[#5E9BFF]" />
                            <span className="text-[#8AB4FF]">Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
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
    <div className="omega-fade-up flex-1 flex flex-col items-center justify-center py-6">
      <div className="w-full max-w-[620px]">
        <header className="text-center mb-7">
          <h1 className="text-[28px] sm:text-[31px] font-semibold tracking-[-0.028em] leading-[1.15] text-[#F5F5F7]">
            Auditar mi exposición pública
          </h1>
          <p className="mt-2.5 text-[14px] text-[#8E8E93] leading-[1.55] max-w-[500px] mx-auto">
            Revisa qué información pública existe sobre tu correo institucional o dominio propio sin interactuar con terceros.
          </p>
        </header>

        {/* Barra de Consulta Spotlight */}
        <form
          onSubmit={handleSubmitAudit}
          className="omega-capsule rounded-[16px] p-3"
        >
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
            <div className="apple-segmented inline-flex rounded-[9px] p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setAssetType('institutional_email')}
                className={`rounded-[7px] px-3 py-1.5 text-[12px] font-medium transition-all duration-150 cursor-pointer ${
                  assetType === 'institutional_email'
                    ? 'apple-segmented-active'
                    : 'text-[#8E8E93] hover:text-[#F5F5F7]'
                }`}
              >
                Correo
              </button>
              <button
                type="button"
                onClick={() => setAssetType('domain')}
                className={`rounded-[7px] px-3 py-1.5 text-[12px] font-medium transition-all duration-150 cursor-pointer ${
                  assetType === 'domain'
                    ? 'apple-segmented-active'
                    : 'text-[#8E8E93] hover:text-[#F5F5F7]'
                }`}
              >
                Dominio
              </button>
            </div>

            <input
              type="text"
              value={assetValue}
              onChange={(e) => setAssetValue(e.target.value)}
              placeholder={
                assetType === 'institutional_email'
                  ? 'prensa@organizacion.org'
                  : 'organizacion.org'
              }
              className="font-tech flex-1 min-w-[180px] h-9 bg-transparent px-2 text-[13.5px] text-[#F5F5F7] placeholder-[#9097A5] focus:outline-none"
            />

            <button
              type="submit"
              disabled={!assetValue.trim() || !consentChecked || isScanning}
              className="h-9 rounded-[10px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.35),inset_0_1px_0_rgba(255,255,255,0.24)] hover:bg-[#3B7BF2] disabled:bg-white/[0.07] disabled:text-[#9097A5] disabled:shadow-none px-4 text-[13px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer shrink-0 disabled:cursor-not-allowed"
            >
              {isScanning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Auditar</span>
            </button>
          </div>

          <div className="pt-2.5 mt-2.5 border-t border-white/[0.065]">
            <label className="inline-flex items-center gap-2.5 text-[12px] text-[#8E8E93] hover:text-[#D1D1D6] transition-colors cursor-pointer select-none">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="h-3.5 w-3.5 rounded-[4px] accent-[#2F6FED] cursor-pointer"
              />
              <span>Confirmo que soy titular de este activo o tengo autorización explícita.</span>
            </label>
          </div>
        </form>

        {errorMsg && (
          <p className="mt-3 text-[12.5px] text-[#FF453A] text-center">{errorMsg}</p>
        )}

        {assets.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {assets.map((asset) => (
              <div
                key={asset.id}
                onClick={() => executeScan(asset)}
                className="font-tech inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1 text-[11.5px] text-[#E5E5EA] hover:border-[#2F6FED]/50 hover:bg-white/[0.07] cursor-pointer transition-all"
              >
                <span>{asset.asset_value}</span>
                <button
                  type="button"
                  title="Eliminar de la sesión"
                  onClick={(e) => handleRevokeAsset(e, asset)}
                  className="text-[#8E8E93] hover:text-[#FF453A] cursor-pointer"
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
