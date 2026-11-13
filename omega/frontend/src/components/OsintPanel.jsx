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

export function OsintPanel() {
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
      <div className="w-full max-w-[700px] mx-auto pt-2 pb-12">
        {/* Cabecera */}
        <header className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-[#232329]">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => {
                setReport(null);
                setErrorMsg('');
              }}
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-3 py-1.5 text-[12.5px] font-medium text-[#F2F2F4] hover:border-[#2F6FED] transition-colors cursor-pointer shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-[#8E8E96]" />
              <span>Cambiar activo</span>
            </button>

            <span className="font-tech text-[14px] font-medium text-[#F2F2F4] truncate">
              {report.asset_value}
            </span>
          </div>

          {activeAsset && (
            <button
              type="button"
              disabled={isScanning}
              onClick={() => executeScan(activeAsset)}
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-3 py-1.5 text-[12px] font-medium text-[#8E8E96] hover:text-[#F2F2F4] hover:border-[#2F6FED] disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 ${isScanning ? 'animate-spin' : ''}`} />
              <span>Re-auditar</span>
            </button>
          )}
        </header>

        {errorMsg && (
          <p className="mt-4 text-[12.5px] text-[#F87171]">{errorMsg}</p>
        )}

        {/* 3 secciones apiladas con divisores 1px solid #232329 */}
        <div className="divide-y divide-[#232329]">
          {/* 1. Cruce con Spyware */}
          <section className="py-5">
            <h2 className="text-[13px] font-medium text-[#F2F2F4] mb-2">
              Cruce con Spyware
            </h2>

            {!hasCtiHits ? (
              <p className="text-[13px] text-[#8E8E96]">
                Sin coincidencias en infraestructura de spyware conocida
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-[13px] text-[#F87171]">
                  Se detectaron {ctiMatches.length} coincidencia{ctiMatches.length === 1 ? '' : 's'} con infraestructura CTI pública:
                </p>
                <div className="divide-y divide-[#232329] border-t border-b border-[#232329]">
                  {ctiMatches.map((m, idx) => (
                    <div
                      key={`${m.ioc_value}-${idx}`}
                      className="py-2.5 flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="font-tech text-[13px] text-[#F2F2F4]">
                        {m.ioc_value}
                      </span>
                      <span className="text-[12px] text-[#8E8E96]">
                        {m.spyware_family} · {m.source_report}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* 2. Brechas Documentadas (si es correo) */}
          {isEmailReport && (
            <section className="py-5">
              <h2 className="text-[13px] font-medium text-[#F2F2F4] mb-2">
                Brechas Documentadas
              </h2>

              {report.email_breaches.status === 'unavailable' ? (
                <p className="text-[13px] text-[#8E8E96]">
                  Fuente pública de brechas no disponible temporalmente durante esta consulta.
                </p>
              ) : breaches.length === 0 ? (
                <p className="text-[13px] text-[#8E8E96]">
                  Sin brechas públicas documentadas para este correo.
                </p>
              ) : (
                <div className="divide-y divide-[#232329] border-t border-b border-[#232329]">
                  {breaches.map((b, idx) => (
                    <div
                      key={`${b.breach_name}-${idx}`}
                      className="py-3 flex flex-wrap items-baseline justify-between gap-3"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="text-[13px] font-medium text-[#F2F2F4]">
                          {b.breach_name}
                        </div>
                        <div className="text-[12px] text-[#8E8E96]">
                          Datos expuestos: {formatExposedData(b.exposed_data)}
                        </div>
                      </div>

                      <span className="font-tech text-[11.5px] text-[#8E8E96] shrink-0">
                        {b.breach_date || 'Fecha N/D'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 3. Postura DNS y Subdominios (crt.sh) */}
          <section className="py-5 space-y-5">
            <div>
              <h2 className="text-[13px] font-medium text-[#F2F2F4] mb-3">
                Postura DNS y Subdominios (<span className="font-tech">crt.sh</span>)
              </h2>

              {/* Dos líneas limpias para SPF y DMARC */}
              <div className="space-y-2.5 text-[12.5px]">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span className="font-tech text-[12px] font-medium text-[#F2F2F4] w-14 shrink-0">
                    SPF
                  </span>
                  <span className={dns.spf_configured ? 'text-[#7AA7FF]' : 'text-[#8E8E96]'}>
                    {dns.spf_configured ? 'Configurado' : 'Ausente'}
                  </span>
                  {dns.spf_record && (
                    <span className="font-tech text-[12px] text-[#8E8E96] break-all">
                      {dns.spf_record}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span className="font-tech text-[12px] font-medium text-[#F2F2F4] w-14 shrink-0">
                    DMARC
                  </span>
                  <span className={dns.dmarc_configured ? 'text-[#7AA7FF]' : 'text-[#8E8E96]'}>
                    {dns.dmarc_configured ? 'Configurado' : 'Ausente'}
                  </span>
                  {dns.dmarc_record && (
                    <span className="font-tech text-[12px] text-[#8E8E96] break-all">
                      {dns.dmarc_record}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Lista compacta de subdominios públicos */}
            <div>
              <div className="text-[12px] text-[#8E8E96] mb-2">
                Subdominios públicos observados ({subdomains.length})
              </div>

              {subdomains.length === 0 ? (
                <p className="text-[12.5px] text-[#8E8E96]">
                  No se registraron subdominios en Certificate Transparency para este dominio.
                </p>
              ) : (
                <div className="divide-y divide-[#232329] border-t border-b border-[#232329]">
                  {subdomains.map((sub) => (
                    <div
                      key={sub}
                      className="py-2 flex items-center justify-between gap-3"
                    >
                      <span className="font-tech text-[12.5px] text-[#F2F2F4] truncate">
                        {sub}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleCopySubdomain(sub)}
                        className="shrink-0 inline-flex items-center gap-1 rounded-[4px] border border-[#232329] bg-[#141418] px-2 py-1 text-[11px] text-[#8E8E96] hover:text-[#F2F2F4] hover:border-[#2F6FED] transition-colors cursor-pointer"
                      >
                        {copiedSubdomain === sub ? (
                          <>
                            <Check className="h-3 w-3 text-[#7AA7FF]" />
                            <span className="text-[#7AA7FF]">Copiado</span>
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
    <div className="flex-1 flex flex-col items-center justify-center py-6">
      <div className="w-full max-w-[620px]">
        {/* Encabezado centrado */}
        <header className="text-center mb-6">
          <span className="font-tech inline-block rounded-[4px] border border-[#232329] bg-[#141418] px-2.5 py-1 text-[11px] text-[#8E8E96]">
            OSINT PASIVO · CONSENTIMIENTO OBLIGATORIO
          </span>
          <h1 className="mt-3 text-[24px] font-semibold tracking-tight text-[#F2F2F4]">
            Auditar mi exposición pública
          </h1>
          <p className="mt-2 text-[13px] text-[#8E8E96] leading-relaxed">
            Revisa qué información pública existe sobre tu correo institucional o dominio propio sin interactuar con terceros.
          </p>
        </header>

        {/* Barra de Consulta Única */}
        <form
          onSubmit={handleSubmitAudit}
          className="rounded-[6px] bg-[#141418] border border-[#232329] p-3"
        >
          {/* Fila principal */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            {/* Selector compacto Correo / Dominio */}
            <div className="inline-flex rounded-[4px] border border-[#232329] bg-[#0A0A0C] p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setAssetType('institutional_email')}
                className={`rounded-[4px] px-2.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
                  assetType === 'institutional_email'
                    ? 'bg-[#15223D] text-[#F2F2F4]'
                    : 'text-[#8E8E96] hover:text-[#F2F2F4]'
                }`}
              >
                Correo
              </button>
              <button
                type="button"
                onClick={() => setAssetType('domain')}
                className={`rounded-[4px] px-2.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
                  assetType === 'domain'
                    ? 'bg-[#15223D] text-[#F2F2F4]'
                    : 'text-[#8E8E96] hover:text-[#F2F2F4]'
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
              className="font-tech flex-1 min-w-[180px] h-9 rounded-[4px] bg-transparent px-2.5 text-[13px] text-[#F2F2F4] placeholder-[#8E8E96]/70 focus:outline-none"
            />

            <button
              type="submit"
              disabled={!assetValue.trim() || !consentChecked || isScanning}
              className="h-9 rounded-[4px] bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-45 px-4 text-[13px] font-medium text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              {isScanning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Auditar</span>
            </button>
          </div>

          {/* Línea inferior discreta con consentimiento */}
          <div className="pt-2.5 mt-2.5 border-t border-[#232329]">
            <label className="inline-flex items-center gap-2 text-[12px] text-[#8E8E96] cursor-pointer select-none">
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
          <p className="mt-2.5 text-[12px] text-[#F87171] text-center">{errorMsg}</p>
        )}

        {/* Chips clicables de activos autorizados en la sesión */}
        {assets.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {assets.map((asset) => (
              <div
                key={asset.id}
                onClick={() => executeScan(asset)}
                className="font-tech inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-2.5 py-1 text-[11px] text-[#F2F2F4] hover:border-[#2F6FED] cursor-pointer transition-colors"
              >
                <span>{asset.asset_value}</span>
                <button
                  type="button"
                  title="Eliminar de la sesión"
                  onClick={(e) => handleRevokeAsset(e, asset)}
                  className="text-[#8E8E96] hover:text-[#F87171] cursor-pointer"
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
