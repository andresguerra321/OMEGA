import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { verifySuspiciousLink } from '../lib/api';
import { useScrollReveal } from '../lib/useScrollReveal';

function getVerdictPresentation(result) {
  if (result.risk_level === 'HIGH') {
    return {
      dotColor: 'bg-[#FF453A] shadow-[0_0_10px_rgba(255,69,58,0.55)]',
      titleColor: 'text-[#FF6961]',
      headline: 'Peligroso — Infraestructura Spyware',
    };
  }
  if (result.risk_level === 'MEDIUM') {
    return {
      dotColor: 'bg-[#FF9F0A] shadow-[0_0_10px_rgba(255,159,10,0.45)]',
      titleColor: 'text-[#FFD60A]',
      headline: 'Precaución — Señales estructurales sospechosas',
    };
  }
  return {
    dotColor: 'bg-[#30D158] shadow-[0_0_10px_rgba(48,209,88,0.45)]',
    titleColor: 'text-[#5E9BFF]',
    headline: 'Seguro / Sin registros',
  };
}

export function LinkVerifierPanel({
  onAskInChat,
  initialUrl = '',
  initialCheckKey = 0,
  onLinkVerified,
}) {
  const [urlInput, setUrlInput] = useState(initialUrl || '');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceResult, setTraceResult] = useState(null);
  const [traceError, setTraceError] = useState('');
  const [finalCheckResult, setFinalCheckResult] = useState(null);
  const lastCheckKeyRef = useRef(0);
  const resultContainerRef = useRef(null);

  useScrollReveal(resultContainerRef, [result?.normalized_url, traceResult?.final_url]);

  const canTraceInRam =
    typeof window !== 'undefined' && Boolean(window.omegaDesktop?.inspectLinkEphemeral);

  useEffect(() => {
    if (!initialCheckKey || !initialUrl || initialCheckKey === lastCheckKeyRef.current) {
      return undefined;
    }
    lastCheckKeyRef.current = initialCheckKey;
    const cleaned = initialUrl.trim();
    if (!cleaned) return undefined;
    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled) return;
      setUrlInput(cleaned);
      setLoading(true);
      setError('');
      setTraceResult(null);
      setTraceError('');
      setFinalCheckResult(null);

      verifySuspiciousLink(cleaned)
        .then((data) => {
          if (cancelled) return;
          setResult(data);
          onLinkVerified?.(data);
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err?.message || 'No se pudo inspeccionar el enlace.');
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [initialCheckKey, initialUrl, onLinkVerified]);

  async function handleCheck(e) {
    e.preventDefault();
    const cleaned = urlInput.trim();
    if (!cleaned || loading) return;
    setLoading(true);
    setError('');
    setTraceResult(null);
    setTraceError('');
    setFinalCheckResult(null);
    try {
      const data = await verifySuspiciousLink(cleaned);
      setResult(data);
      onLinkVerified?.(data);
    } catch (err) {
      setError(err?.message || 'No se pudo inspeccionar el enlace.');
    } finally {
      setLoading(false);
    }
  }

  async function handleTraceEphemeral() {
    if (!canTraceInRam || !result?.normalized_url || traceLoading) return;
    setTraceLoading(true);
    setTraceError('');
    setFinalCheckResult(null);
    try {
      const trace = await window.omegaDesktop.inspectLinkEphemeral(result.normalized_url);
      setTraceResult(trace);
      if (trace?.final_url && trace.final_url !== result.normalized_url) {
        try {
          const destCheck = await verifySuspiciousLink(trace.final_url);
          setFinalCheckResult(destCheck);
        } catch {
          // Ignore passive re-check error while keeping redirect trace visible
        }
      }
    } catch (err) {
      setTraceError(err?.message || 'No se pudo trazar el enlace en el sandbox volátil.');
    } finally {
      setTraceLoading(false);
    }
  }

  // --- ESTADO 2: RESULTADO ---
  if (result) {
    const verdictMeta = getVerdictPresentation(result);
    const heuristics = result.heuristics || [];
    const ctiMatches = result.cti_matches || [];

    return (
      <div
        ref={resultContainerRef}
        className="animate-fade-up w-full max-w-[660px] mx-auto pt-2 pb-12 space-y-5"
      >
        {/* Barra superior */}
        <header className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setError('');
              setTraceResult(null);
              setTraceError('');
              setFinalCheckResult(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12.5px] font-medium text-[#F5F5F7] hover:bg-white/[0.08] active:scale-[0.97] transition-all cursor-pointer shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#8E8E93]" />
            <span>Verificar otro enlace</span>
          </button>

          <span className="font-tech text-[12px] text-[#8E8E93] truncate max-w-full sm:max-w-[400px]">
            {result.normalized_url}
          </span>
        </header>

        {/* Bloque de Veredicto Apple Glass (sin bordes laterales de 2px) */}
        <section className="animate-fade-up apple-group rounded-[15px] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${verdictMeta.dotColor}`} />
              <h2 className={`text-[16px] sm:text-[17px] font-semibold tracking-[-0.015em] ${verdictMeta.titleColor}`}>
                {verdictMeta.headline}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0 max-w-full">
              {canTraceInRam && (
                <button
                  type="button"
                  disabled={traceLoading}
                  onClick={handleTraceEphemeral}
                  title="Sigue redirecciones HTTP en una sesión Electron sin JavaScript, sin imágenes y 100% en RAM"
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-white/[0.1] bg-white/[0.05] px-3 py-1 text-[11.5px] font-medium text-[#E5E5EA] hover:bg-white/[0.09] disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
                >
                  {traceLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                  <span>{traceResult ? 'Retrazar en RAM' : 'Trazar redirecciones (Sin JS)'}</span>
                </button>
              )}

              {onAskInChat && (
                <button
                  type="button"
                  onClick={() => {
                    const prompt = [
                      `Evalúa este enlace inspeccionado pasivamente en OMEGA:`,
                      `- URL / Host: ${result.normalized_url} (host: ${result.host})`,
                      traceResult?.final_url && traceResult.final_url !== result.normalized_url
                        ? `- Destino tras redirecciones (Sandbox sin JS): ${traceResult.final_url}`
                        : '',
                      `- Nivel de riesgo: ${result.risk_level} — ${result.verdict}`,
                      `- Coincidencias CTI: ${ctiMatches.length}`,
                      `¿Existe campaña o infraestructura de spyware asociada a este dominio o patrón en los reportes indexados?`,
                    ]
                      .filter(Boolean)
                      .join('\n');
                    onAskInChat(prompt);
                  }}
                  className="shrink-0 rounded-[8px] border border-[#2F6FED]/40 bg-[#2F6FED]/15 px-3 py-1 text-[11.5px] font-medium text-[#8AB4FF] hover:bg-[#2F6FED]/24 active:scale-[0.97] transition-all cursor-pointer"
                >
                  Investigar en Preguntar
                </button>
              )}
            </div>
          </div>
          <p className="mt-2.5 text-[14px] text-[#E5E5EA] leading-relaxed break-words">
            {result.recommendation}
          </p>
          <p className="mt-3 text-[12px] text-[#8E8E93] break-words">
            {result.privacy_notice}
          </p>
        </section>

        {/* Desglose Agrupado en 3 datos */}
        <section
          className="animate-on-scroll apple-group rounded-[13px] grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06] overflow-hidden"
          data-delay="40"
        >
          <div className="p-4 min-w-0">
            <div className="text-[11.5px] font-medium text-[#8E8E93]">Host</div>
            <div className="font-tech mt-1.5 text-[12.5px] text-[#F5F5F7] break-all">
              {result.host}
            </div>
          </div>

          <div className="p-4 min-w-0">
            <div className="text-[11.5px] font-medium text-[#8E8E93]">Dominio raíz</div>
            <div className="font-tech mt-1.5 text-[12.5px] text-[#F5F5F7] break-all">
              {result.root_domain || result.host}
            </div>
          </div>

          <div className="p-4 min-w-0">
            <div className="text-[11.5px] font-medium text-[#8E8E93]">Certificados crt.sh</div>
            <div className="font-tech mt-1.5 text-[12.5px] text-[#F5F5F7]">
              {result.passive_ct_certificates !== null && result.passive_ct_certificates !== undefined
                ? `${result.passive_ct_certificates} registros`
                : 'N/D'}
            </div>
          </div>
        </section>

        {/* Alertas estructurales */}
        {heuristics.length > 0 && (
          <section
            className="animate-on-scroll apple-group rounded-[13px] overflow-hidden"
            data-delay="80"
          >
            <div className="px-4 py-2.5 border-b border-white/[0.06] text-[12.5px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">
              Alertas estructurales
            </div>
            <ul className="divide-y divide-white/[0.06]">
              {heuristics.map((item, idx) => (
                <li key={idx} className="px-4 py-3 text-[13px] text-[#D1D1D6] break-words">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        {traceError && (
          <div className="animate-fade-in rounded-[12px] border border-[#FF453A]/35 bg-[#FF453A]/10 px-4 py-2.5 text-[12.5px] text-[#FF6961]">
            {traceError}
          </div>
        )}

        {/* Trazado Sandboxed en RAM (Electron sin JS ni imágenes) */}
        {traceResult && (
          <section
            className="animate-on-scroll apple-group rounded-[13px] overflow-hidden"
            data-delay="120"
          >
            <div className="px-4 py-2.5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">
                Trazado efímero en RAM (Sandbox sin JS)
              </span>
              <span className="font-tech rounded-full border border-[#2F6FED]/35 bg-[#2F6FED]/15 px-2.5 py-0.5 text-[10.5px] text-[#8AB4FF]">
                0 JS · 0 Imágenes{traceResult.status_code ? ` · HTTP ${traceResult.status_code}` : ''}
              </span>
            </div>

            <div className="p-4 space-y-3">
              {traceResult.blocked_attempt && (
                <div className="rounded-[9px] border border-[#FF453A]/40 bg-[#FF453A]/12 px-3 py-2 flex items-center gap-2 text-[12px] text-[#FF6961]">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>Redirección peligrosa interceptada en sandbox: {traceResult.blocked_attempt}</span>
                </div>
              )}

              {traceResult.redirects?.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-[#8E8E93]">
                    Cadena de redirecciones ({traceResult.redirects.length})
                  </div>
                  <div className="space-y-1.5">
                    {traceResult.redirects.map((hop, idx) => (
                      <div
                        key={`${hop.from}-${hop.to}-${idx}`}
                        className="rounded-[8px] border border-white/[0.06] bg-black/30 px-3 py-2 flex flex-wrap items-center gap-2 font-tech text-[11.5px]"
                      >
                        <span className="rounded-[5px] bg-white/[0.06] px-1.5 py-0.5 text-[10.5px] text-[#FFD60A]">
                          {hop.statusCode || 302}
                        </span>
                        <span className="text-[#8E8E93] break-all">{hop.from}</span>
                        <ArrowRight className="h-3 w-3 text-[#5E9BFF] shrink-0" />
                        <span className="text-[#F5F5F7] break-all">{hop.to}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[12.5px] text-[#8E8E93]">
                  Sin saltos HTTP intermedios; respondió directamente en la URL consultada.
                </p>
              )}

              <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-[11px] font-medium text-[#8E8E93]">Destino final observado</div>
                  <div className="font-tech text-[12px] text-[#F5F5F7] break-all">
                    {traceResult.final_url}
                  </div>
                  {traceResult.title && (
                    <div className="text-[11.5px] text-[#8E8E93]">
                      Título: {traceResult.title}
                    </div>
                  )}
                </div>

                {finalCheckResult && (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shrink-0 ${
                      finalCheckResult.risk_level === 'HIGH'
                        ? 'border-[#FF453A]/40 bg-[#FF453A]/12 text-[#FF6961]'
                        : finalCheckResult.risk_level === 'MEDIUM'
                          ? 'border-[#FF9F0A]/40 bg-[#FF9F0A]/12 text-[#FFD60A]'
                          : 'border-[#30D158]/35 bg-[#30D158]/10 text-[#30D158]'
                    }`}
                  >
                    {finalCheckResult.risk_level === 'SAFE' ? (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    )}
                    <span>Destino: {finalCheckResult.risk_level}</span>
                  </span>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Coincidencias CTI si aplica */}
        {ctiMatches.length > 0 && (
          <section className="apple-group rounded-[13px] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/[0.06] text-[12.5px] font-semibold text-[#FF6961] bg-[#FF453A]/8">
              Coincidencias en reportes de spyware ({ctiMatches.length})
            </div>
            <div className="divide-y divide-white/[0.06]">
              {ctiMatches.map((m, idx) => (
                <div
                  key={`${m.ioc_value}-${idx}`}
                  className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-tech text-[13px] text-[#F5F5F7]">
                        {m.ioc_value}
                      </span>
                      <span className="rounded-full border border-[#FF453A]/35 bg-[#FF453A]/12 px-2 py-0.5 text-[11px] font-medium text-[#FF6961]">
                        {m.spyware_family}
                      </span>
                    </div>
                    <div className="text-[12px] text-[#8E8E93]">
                      {m.campaign} · {m.source_report} ({m.organization})
                    </div>
                  </div>

                  {m.source_url?.startsWith('http') && (
                    <a
                      href={m.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-[8px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-[#8AB4FF] hover:bg-white/[0.08] transition-colors shrink-0"
                    >
                      <span>Fuente</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  // --- ESTADO 1: INICIAL (Centrado vertical y horizontalmente, max-w-[620px]) ---
  return (
    <div className="animate-fade-up flex-1 flex flex-col items-center justify-center py-6">
      <div className="w-full max-w-[620px]">
        <header className="text-center mb-6 sm:mb-7">
          <h1 className="text-[24px] sm:text-[31px] font-semibold tracking-[-0.028em] leading-[1.15] text-[#F5F5F7]">
            Verifica un enlace antes de abrirlo
          </h1>
          <p className="mt-2.5 text-[13.5px] sm:text-[14px] text-[#8E8E93] leading-[1.55] max-w-[500px] mx-auto">
            Detecta dominios vinculados a campañas 1-click o URLs ofuscadas sin realizar peticiones HTTP al servidor destino.
          </p>
        </header>

        <form
          onSubmit={handleCheck}
          style={{ animationDelay: '60ms' }}
          className="animate-scale-in omega-capsule rounded-[15px] p-2 sm:p-2.5 flex items-center gap-2 sm:gap-2.5"
        >
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://enlace-sospechoso.ejemplo/ruta"
            className="font-tech flex-1 min-w-0 h-9 bg-transparent px-2 sm:px-2.5 text-[13.5px] text-[#F5F5F7] placeholder-[#9097A5] focus:outline-none"
          />

          <button
            type="submit"
            disabled={loading || !urlInput.trim()}
            className="h-9 rounded-[10px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.35),inset_0_1px_0_rgba(255,255,255,0.24)] hover:bg-[#3B7BF2] disabled:bg-white/[0.07] disabled:text-[#9097A5] disabled:shadow-none px-3.5 sm:px-4 text-[13px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer shrink-0 disabled:cursor-not-allowed"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Verificar</span>
          </button>
        </form>

        {error && (
          <p className="mt-3 text-[12.5px] text-[#FF453A] text-center">{error}</p>
        )}
      </div>
    </div>
  );
}
