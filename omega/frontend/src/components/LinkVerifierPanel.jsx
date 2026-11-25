import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Loader2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import { lookupExternalReputation, verifySuspiciousLink } from '../lib/api';
import { InfrastructureBadges, EmergencyGuidance } from './ContainmentPanel';
import { stripUnsafeChars, validateUrlInput } from '../lib/validators';
import { useSingleFlight } from '../lib/useSingleFlight';
import { useScrollReveal } from '../lib/useScrollReveal';
import {
  ActionConfirmationBanner,
  PanelErrorBanner,
} from './PanelStatePrimitives';

function getVerdictPresentation(result) {
  if (['HIGH', 'CRITICAL'].includes(result.risk_level)) {
    return {
      dotColor: 'bg-[#FF453A] shadow-[0_0_10px_rgba(255,69,58,0.55)]',
      titleColor: 'text-[#FF6961]',
      headline: 'Enlace peligroso — No lo abras',
    };
  }
  if (result.risk_level === 'MEDIUM') {
    return {
      dotColor: 'bg-[#FF9F0A] shadow-[0_0_10px_rgba(255,159,10,0.45)]',
      titleColor: 'text-[#FFD60A]',
      headline: 'Precaución — Este enlace tiene señales sospechosas',
    };
  }
  return {
    dotColor: 'bg-[#30D158] shadow-[0_0_10px_rgba(48,209,88,0.45)]',
    titleColor: 'text-[#F2F2F4]',
    headline: 'Sin señales de peligro conocidas',
  };
}

function getNaturalBannerMessage(result, traceResult, finalCheckResult) {
  if (traceResult) {
    const destRisk = finalCheckResult?.risk_level || result.risk_level;
    return ['HIGH', 'CRITICAL'].includes(destRisk)
      ? 'Seguimos el enlace de forma segura y lleva a un destino riesgoso.'
      : 'Seguimos el enlace de forma segura sin abrirlo en tu equipo.';
  }
  if (['HIGH', 'CRITICAL'].includes(result.risk_level)) {
    return 'Revisión completada · Detectamos señales de riesgo alto, evita abrir este enlace.';
  }
  if (result.risk_level === 'MEDIUM') {
    return 'Revisión completada · Hay señales que requieren precaución antes de abrirlo.';
  }
  return 'Revisión completada · No encontramos reportes negativos conocidos.';
}

function getNaturalReputationSummary(rep) {
  if (!rep) return null;
  const vt = rep.virustotal;
  const abuse = rep.abuseipdb;
  const vtMal = Number(vt?.malicious || 0);
  const vtSusp = Number(vt?.suspicious || 0);
  const abuseScore = Number(abuse?.abuse_confidence_score || 0);

  if (vt?.status === 'ok' && vtMal > 0) {
    return {
      tone: 'danger',
      text: 'Varios análisis externos coinciden en que este enlace es peligroso.',
    };
  }
  if ((vt?.status === 'ok' && vtSusp > 0) || (abuse?.status === 'ok' && abuseScore >= 25)) {
    return {
      tone: 'warn',
      text: 'Algunas fuentes externas reportan actividad sospechosa en este destino.',
    };
  }
  if (vt?.status === 'ok' || abuse?.status === 'ok') {
    return {
      tone: 'clean',
      text: 'Sin reportes negativos en las fuentes externas consultadas.',
    };
  }
  return null;
}

function getNaturalCertSummary(result) {
  if (result.scheme === 'http') {
    return {
      label: 'Sin cifrado (HTTP)',
      detail: 'No usa certificado seguro',
    };
  }
  const count = result.passive_ct_certificates;
  if (count === null || count === undefined) {
    return {
      label: 'No disponible',
      detail: 'No se pudo consultar el registro',
    };
  }
  if (count > 0) {
    return {
      label: 'Certificado registrado',
      detail: `${count} registro(s) públicos`,
    };
  }
  return {
    label: 'Sin certificado público',
    detail: 'No aparece emitido para este dominio',
  };
}

export function LinkVerifierPanel({
  onAskInChat,
  onAuditDomain,
  onAuditDevice,
  onOpenThreat,
  onSwitchMode,
  initialUrl = '',
  initialCheckKey = 0,
  onLinkVerified,
}) {
  const [scheme, setScheme] = useState(() => {
    const raw = (initialUrl || '').trim();
    return /^http:\/\//i.test(raw) ? 'http://' : 'https://';
  });
  const [urlInput, setUrlInput] = useState(() =>
    (initialUrl || '').trim().replace(/^https?:\/\//i, '')
  );
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeProbe, setActiveProbe] = useState(false);
  const [showConfigPopover, setShowConfigPopover] = useState(false);
  const [recentLinks, setRecentLinks] = useState([]);
  const [error, setError] = useState('');
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceResult, setTraceResult] = useState(null);
  const [traceError, setTraceError] = useState('');
  const [finalCheckResult, setFinalCheckResult] = useState(null);
  const [dismissedConfirmKey, setDismissedConfirmKey] = useState('');
  const guard = useSingleFlight();
  const lastCheckKeyRef = useRef(0);
  const resultContainerRef = useRef(null);

  useScrollReveal(resultContainerRef, [result?.normalized_url, traceResult?.final_url]);

  const canTraceInRam = false;

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
      setScheme(/^http:\/\//i.test(cleaned) ? 'http://' : 'https://');
      setUrlInput(cleaned.replace(/^https?:\/\//i, ''));
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
    if (loading) return;
    const rawTrimmed = urlInput.trim();
    const withScheme = /^(?:https?|hxxps?):\/\//i.test(rawTrimmed)
      ? rawTrimmed
      : `${scheme}${rawTrimmed}`;
    const validation = validateUrlInput(withScheme, { allowBareDomain: true });
    if (!validation.valid) {
      setError(validation.error);
      return;
    }
    await guard(async () => {
      setLoading(true);
      setError('');
      setDismissedConfirmKey('');
      setTraceResult(null);
      setTraceError('');
      setFinalCheckResult(null);
      try {
        const data = await verifySuspiciousLink(validation.value, null, activeProbe);
        let reputation = null;
        const repTarget = data?.normalized_url || data?.host;
        if (repTarget) {
          reputation = await lookupExternalReputation(repTarget).catch(() => null);
        }
        const repMatches = Array.isArray(reputation?.local_cti_matches) ? reputation.local_cti_matches : [];
        const mergedMatches = [
          ...(Array.isArray(data?.cti_matches) ? data.cti_matches : []),
          ...repMatches.filter(
            (rm) => !(data?.cti_matches || []).some((cm) => cm.ioc_value === rm.ioc_value)
          ),
        ];
        const vtMalicious = Number(reputation?.virustotal?.malicious || 0);
        const upgradedRisk = data?.risk_level === 'CRITICAL' ? 'CRITICAL'
          : mergedMatches.length > 0 || vtMalicious > 0 ? 'HIGH' : data?.risk_level;
        const enriched = {
          ...data,
          risk_level: upgradedRisk,
          cti_matches: mergedMatches,
          ...(reputation ? { external_reputation: reputation } : {}),
        };
        setResult(enriched);
        setRecentLinks((prev) => {
          const hostLabel = enriched?.host || rawTrimmed.replace(/^https?:\/\//i, '');
          return [hostLabel, ...prev.filter((item) => item !== hostLabel)].slice(0, 4);
        });
        onLinkVerified?.(enriched);
      } catch (err) {
        setError(err?.message || 'No se pudo inspeccionar el enlace.');
      } finally {
        setLoading(false);
      }
    });
  }

  async function handleTraceEphemeral() {
    if (!canTraceInRam || !result?.normalized_url || traceLoading) return;
    await guard(async () => {
      setTraceLoading(true);
      setTraceError('');
      setFinalCheckResult(null);
      try {
        setTraceError('El trazado efímero aislado solo está disponible con módulo de sandbox remoto.');
      } catch (err) {
        setTraceError(err?.message || 'No se pudo trazar el enlace en la sesión aislada en RAM.');
      } finally {
        setTraceLoading(false);
      }
    });
  }

  // --- ESTADO 2: RESULTADO ---
  if (result) {
    const verdictMeta = getVerdictPresentation(result);
    const heuristics = result.heuristics || [];
    const ctiMatches = result.cti_matches || [];
    const reputationSummary = getNaturalReputationSummary(result.external_reputation);
    const certSummary = getNaturalCertSummary(result);

    return (
      <div
        ref={resultContainerRef}
        className="animate-fade-up w-full max-w-[1280px] 2xl:max-w-[1440px] mx-auto px-2 sm:px-4 pt-2 pb-12 space-y-5"
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
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12.5px] font-medium text-[#F2F2F4] hover:bg-white/[0.08] active:scale-[0.97] transition-all cursor-pointer shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#9A9AA2]" />
            <span>Verificar otro enlace</span>
          </button>

          <span className="font-tech text-[12px] text-[#9A9AA2] truncate max-w-full sm:max-w-[400px]">
            {result.normalized_url}
          </span>
        </header>

        {(() => {
          const confirmKey = `${result.normalized_url}|${traceResult?.final_url || ''}`;
          if (dismissedConfirmKey === confirmKey) return null;
          const bannerTone =
            ['HIGH', 'CRITICAL'].includes(result.risk_level) ? 'alert' : result.risk_level === 'SAFE' ? 'clean' : 'info';
          const bannerMsg = getNaturalBannerMessage(result, traceResult, finalCheckResult);
          return (
            <ActionConfirmationBanner
              tone={bannerTone}
              message={bannerMsg}
              onDismiss={() => setDismissedConfirmKey(confirmKey)}
            />
          );
        })()}

        {/* Bloque de Veredicto Apple Glass (sin bordes laterales de 2px) */}
        <section className="animate-fade-up omega-glass-panel rounded-[15px] p-4 sm:p-5">
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
                  title="Sigue redirecciones HTTP en sesión aislada sin JavaScript, sin imágenes y 100% en RAM"
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-white/[0.1] bg-white/[0.05] px-3 py-1 text-[11.5px] font-medium text-[#F2F2F4] hover:bg-white/[0.09] disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
                >
                  {traceLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                  <span>{traceResult ? 'Retrazar en RAM' : 'Trazar redirecciones (Sin JS)'}</span>
                </button>
              )}

              {onAskInChat && (
                <button
                  type="button"
                  onClick={() => {
                    const owasp = Array.isArray(result.owasp_findings) ? result.owasp_findings : [];
                    const vt = result.external_reputation?.virustotal;
                    const telemetryLines = [
                      `URL analizada: ${result.normalized_url}`,
                      `Host: ${result.host} | Dominio raíz: ${result.root_domain || result.host} | Esquema: ${result.scheme || 'N/D'}`,
                      traceResult?.final_url && traceResult.final_url !== result.normalized_url
                        ? `Destino tras redirecciones (Aislado sin JS): ${traceResult.final_url}`
                        : '',
                      `Nivel de riesgo: ${result.risk_level} — ${result.verdict}`,
                      result.recommendation ? `Recomendación: ${result.recommendation}` : '',
                      `Certificados CT (crt.sh): ${result.passive_ct_certificates ?? 'N/D'}`,
                      vt && vt.status === 'ok'
                        ? `VirusTotal / Reputación: ${vt.malicious || 0} maliciosos, ${vt.suspicious || 0} sospechosos`
                        : '',
                      ctiMatches.length > 0
                        ? `Coincidencias CTI (${ctiMatches.length}): ${ctiMatches.slice(0, 5).map((m) => `${m.ioc_value} [${m.spyware_family || m.campaign || 'CTI'}: ${m.context || ''}]`).join(' ; ')}`
                        : 'Coincidencias CTI: 0',
                      owasp.length > 0
                        ? `Reglas OWASP activadas: ${owasp.map((f) => `[${f.rule_id} ${f.severity}] ${f.title}: ${f.detail}`).join(' ; ')}`
                        : '',
                      heuristics.length > 0
                        ? `Alertas estructurales: ${heuristics.join(' ; ')}`
                        : '',
                    ]
                      .filter(Boolean)
                      .join('\n');
                    const prompt = [
                      `Evalúa este enlace inspeccionado pasivamente en OMEGA:`,
                      `- URL / Host: ${result.normalized_url} (host: ${result.host})`,
                      traceResult?.final_url && traceResult.final_url !== result.normalized_url
                        ? `- Destino tras redirecciones (Aislado sin JS): ${traceResult.final_url}`
                        : '',
                      `- Nivel de riesgo: ${result.risk_level} — ${result.verdict}`,
                      `- Coincidencias CTI: ${ctiMatches.length}`,
                      `¿Qué tiene de maliciosa esta web y existe campaña o infraestructura asociada?`,
                    ]
                      .filter(Boolean)
                      .join('\n');
                    onAskInChat(prompt, {
                      analysisContext: telemetryLines,
                      pinnedContext: `${result.host} (${result.risk_level})`,
                    });
                  }}
                  className="shrink-0 rounded-[8px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-3 py-1 text-[11.5px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/75 hover:shadow-[0_0_24px_rgba(47,111,237,0.25)] active:scale-[0.97] transition-all cursor-pointer"
                >
                  Consultar con Copiloto
                </button>
              )}

              {onAuditDomain && (result.host || result.root_domain) && (
                <button
                  type="button"
                  onClick={() => onAuditDomain(result.host || result.root_domain)}
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-white/[0.1] bg-white/[0.045] px-3 py-1 text-[11.5px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/45 hover:bg-[rgba(28,36,56,0.65)] active:scale-[0.97] transition-all cursor-pointer"
                >
                  <Globe className="h-3 w-3 text-[#2F6FED]" />
                  <span>Auditar en Exposición</span>
                </button>
              )}

              {onAuditDevice && result.risk_level !== 'SAFE' && (
                <button
                  type="button"
                  onClick={() => onAuditDevice('android')}
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#FF453A]/35 bg-[#FF453A]/12 px-3 py-1 text-[11.5px] font-medium text-[#FFD0CE] hover:bg-[#FF453A]/20 active:scale-[0.97] transition-all cursor-pointer"
                >
                  <Smartphone className="h-3 w-3" />
                  <span>Revisar mi equipo</span>
                </button>
              )}
            </div>
          </div>
          <p className="mt-2.5 text-[14px] text-[#F2F2F4]/90 leading-relaxed break-words">
            {result.recommendation}
          </p>
          <p className="mt-3 text-[12px] text-[#9A9AA2] break-words">
            {result.privacy_notice}
          </p>
          <InfrastructureBadges result={result} />
          {['HIGH', 'CRITICAL'].includes(result.risk_level) && <EmergencyGuidance mobile />}
        </section>

        {/* Desglose Agrupado en 3 datos */}
        <section
          className="animate-on-scroll apple-group rounded-[13px] grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06] overflow-hidden"
          data-delay="40"
        >
          <div className="p-4 min-w-0">
            <div className="text-[11.5px] font-medium text-[#9A9AA2]">Host</div>
            <div className="font-tech mt-1.5 text-[12.5px] text-[#F2F2F4] break-all">
              {result.host}
            </div>
          </div>

          <div className="p-4 min-w-0">
            <div className="text-[11.5px] font-medium text-[#9A9AA2]">Dominio raíz</div>
            <div className="font-tech mt-1.5 text-[12.5px] text-[#F2F2F4] break-all">
              {result.root_domain || result.host}
            </div>
          </div>

          <div className="p-4 sm:p-5 min-w-0">
            <div className="text-[12.5px] font-medium text-[#9A9AA2]">Certificado de seguridad</div>
            <div className="mt-1.5 text-[14px] font-medium text-[#F2F2F4]">
              {certSummary.label}
            </div>
            <div className="mt-0.5 text-[12px] text-[#9A9AA2]">
              {certSummary.detail}
            </div>
          </div>
        </section>

        {reputationSummary && (
          <section className="apple-group rounded-[13px] p-4 sm:p-5 space-y-1.5">
            <div className="text-[13.5px] font-semibold text-[#F2F2F4]">
              Resultado
            </div>
            <p className={`text-[14px] leading-relaxed ${
              reputationSummary.tone === 'danger'
                ? 'text-[#FF6961]'
                : reputationSummary.tone === 'warn'
                  ? 'text-[#FFD60A]'
                  : 'text-[#C2C7D6]'
            }`}>
              {reputationSummary.text}
            </p>
          </section>
        )}

        {/* Alertas estructurales */}
        {heuristics.length > 0 && (
          <section
            className="animate-on-scroll apple-group rounded-[13px] overflow-hidden"
            data-delay="80"
          >
            <div className="px-4 py-2.5 border-b border-white/[0.06] text-[12.5px] font-semibold tracking-[-0.01em] text-[#F2F2F4]">
              Alertas estructurales
            </div>
            <ul className="divide-y divide-white/[0.06]">
              {heuristics.map((item, idx) => (
                <li key={idx} className="px-4 py-3 text-[13px] text-[#F2F2F4]/85 break-words">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        {traceError && (
          <PanelErrorBanner
            message={traceError}
            onDismiss={() => setTraceError('')}
          />
        )}

        {/* Trazado Aislado en RAM (Sin JS ni imágenes) */}
        {traceResult && (
          <section
            className="animate-on-scroll apple-group rounded-[13px] overflow-hidden"
            data-delay="120"
          >
            <div className="px-4 py-2.5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold tracking-[-0.01em] text-[#F2F2F4]">
                Trazado efímero en RAM (Sin JavaScript)
              </span>
              <span className="font-tech rounded-full border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-2.5 py-0.5 text-[10.5px] text-[#F2F2F4]">
                0 JS · 0 Imágenes{traceResult.status_code ? ` · HTTP ${traceResult.status_code}` : ''}
              </span>
            </div>

            <div className="p-4 space-y-3">
              {traceResult.blocked_attempt && (
                <div className="rounded-[9px] border border-[#FF453A]/40 bg-[#FF453A]/12 px-3 py-2 flex items-center gap-2 text-[12px] text-[#FF6961]">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>Redirección peligrosa interceptada en sesión aislada: {traceResult.blocked_attempt}</span>
                </div>
              )}

              {traceResult.redirects?.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-[#9A9AA2]">
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
                        <span className="text-[#9A9AA2] break-all">{hop.from}</span>
                        <ArrowRight className="h-3 w-3 text-[#2F6FED] shrink-0" />
                        <span className="text-[#F2F2F4] break-all">{hop.to}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[12.5px] text-[#9A9AA2]">
                  Sin saltos HTTP intermedios; respondió directamente en la URL consultada.
                </p>
              )}

              <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-[11px] font-medium text-[#9A9AA2]">Destino final observado</div>
                  <div className="font-tech text-[12px] text-[#F2F2F4] break-all">
                    {traceResult.final_url}
                  </div>
                  {traceResult.title && (
                    <div className="text-[11.5px] text-[#9A9AA2]">
                      Título: {traceResult.title}
                    </div>
                  )}
                </div>

                {finalCheckResult && (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shrink-0 ${finalCheckResult.risk_level === 'HIGH'
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
                      <span className="font-tech text-[13px] text-[#F2F2F4]">
                        {m.ioc_value}
                      </span>
                      <span className="rounded-full border border-[#FF453A]/35 bg-[#FF453A]/12 px-2 py-0.5 text-[11px] font-medium text-[#FF6961]">
                        {m.spyware_family}
                      </span>
                    </div>
                    <div className="text-[12px] text-[#9A9AA2]">
                      {m.campaign} · {m.source_report} ({m.organization})
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {onOpenThreat && (m.campaign || m.spyware_family) && (
                      <button
                        type="button"
                        onClick={() => onOpenThreat(m.campaign || m.spyware_family)}
                        className="inline-flex items-center gap-1 rounded-[8px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-2.5 py-1 text-[11.5px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/75 hover:shadow-[0_0_24px_rgba(47,111,237,0.25)] transition-all cursor-pointer"
                      >
                        <Shield className="h-3 w-3" />
                        <span>Ver campaña</span>
                      </button>
                    )}

                    {m.source_url?.startsWith('http') && (
                      <a
                        href={m.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-[8px] border border-white/[0.08] bg-white/[0.045] px-2.5 py-1 text-[11.5px] text-[#F2F2F4] hover:border-[#2F6FED]/45 hover:bg-[rgba(28,36,56,0.65)] transition-all shrink-0"
                      >
                        <span>Fuente</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  // --- ESTADO 1: COMMAND BOX MODERNA DE 2 NIVELES ---
  return (
    <div className="relative animate-fade-up flex-1 flex flex-col items-center pt-14 sm:pt-16 pb-12 px-3 sm:px-6 overflow-hidden">
      <div className="relative z-10 w-full max-w-3xl lg:max-w-4xl mt-[4vh]">
        {/* Selector limpio tipo píldora centrado encima del título */}
        <div className="mb-5 flex justify-center">
          <div className="inline-flex rounded-full border border-white/[0.07] bg-[#0F131B]/80 backdrop-blur-xl p-1">
            <button
              type="button"
              className="rounded-full bg-[#2F6FED]/20 border border-[#2F6FED]/45 px-3.5 py-1 text-xs font-medium text-white cursor-pointer"
            >
              Enlace URL
            </button>
            <button
              type="button"
              onClick={() => onSwitchMode?.('institutional_email')}
              className="rounded-full border border-transparent px-3.5 py-1 text-xs font-medium text-[#8E95A5] hover:text-white transition-colors cursor-pointer"
            >
              Correo
            </button>
            <button
              type="button"
              onClick={() => onSwitchMode?.('domain')}
              className="rounded-full border border-transparent px-3.5 py-1 text-xs font-medium text-[#8E95A5] hover:text-white transition-colors cursor-pointer"
            >
              Dominio
            </button>
          </div>
        </div>

        <header className="text-center mb-6">
          <h1 className="text-[26px] sm:text-[32px] font-semibold tracking-[-0.028em] leading-[1.15] text-[#F2F2F4]">
            Verificar enlace
          </h1>
          <p className="mt-2 text-sm text-[#9A9AA2] max-w-md mx-auto">
            Revisa si una URL o dominio es seguro antes de abrirlo.
          </p>
        </header>

        {/* Command Box de 2 Niveles */}
        <form
          noValidate
          onSubmit={handleCheck}
          className="relative rounded-2xl bg-[#0F131B]/80 backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.45)] focus-within:border-blue-500/60 focus-within:shadow-[0_0_32px_rgba(47,111,237,0.16)] transition-all"
        >
          {/* Zona superior: Máximo 4 chips en una sola fila */}
          <div className="px-4 pt-3 pb-1 flex flex-nowrap items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => {
                setScheme('https://');
                setUrlInput('verify-icloud-session.example/auth');
                setError('');
              }}
              className="shrink-0 inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] px-2.5 py-0.5 text-[11px] text-[#9A9AA2] hover:text-white transition-colors cursor-pointer"
            >
              Probar enlace de ejemplo
            </button>

            {recentLinks.slice(0, 3).map((item) => (
              <span
                key={item}
                className="shrink-0 inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 font-tech text-[11px] text-[#D2D6E2]"
              >
                <button
                  type="button"
                  onClick={() => {
                    setUrlInput(item);
                    setError('');
                  }}
                  className="hover:text-white cursor-pointer"
                >
                  {item}
                </button>
                <button
                  type="button"
                  aria-label={`Quitar ${item}`}
                  onClick={() => setRecentLinks((prev) => prev.filter((x) => x !== item))}
                  className="text-[#8E95A5] hover:text-[#FF6961] cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>

          {/* Zona media: Input limpio con prefijo minimalista inline */}
          <div className="px-4 py-3 flex items-center gap-1.5">
            <button
              type="button"
              title="Cambiar entre https:// y http://"
              onClick={() => setScheme((s) => (s === 'https://' ? 'http://' : 'https://'))}
              className="font-tech text-[14.5px] text-[#6EA0FF] hover:text-white transition-colors cursor-pointer shrink-0 select-none"
            >
              {scheme}
            </button>
            <input
              type="text"
              maxLength={2048}
              value={urlInput}
              onChange={(e) => {
                const raw = stripUnsafeChars(e.target.value, 2048);
                if (/^https:\/\//i.test(raw)) {
                  setScheme('https://');
                  setUrlInput(raw.replace(/^https:\/\//i, ''));
                } else if (/^http:\/\//i.test(raw)) {
                  setScheme('http://');
                  setUrlInput(raw.replace(/^http:\/\//i, ''));
                } else {
                  setUrlInput(raw);
                }
                if (error) setError('');
              }}
              aria-invalid={Boolean(error)}
              placeholder="enlace.com/ruta"
              className="font-tech flex-1 min-w-0 bg-transparent border-0 text-[15px] text-white placeholder-[#7E869A] focus:outline-none"
            />
          </div>

          {/* Barra inferior integrada (Toolbar) */}
          <div className="px-4 py-2.5 border-t border-white/[0.06] flex items-center justify-between gap-3">
            <div className="relative">
              <button
                type="button"
                aria-expanded={showConfigPopover}
                onClick={() => setShowConfigPopover((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] px-2.5 py-1.5 text-xs font-medium text-[#D2D6E2] hover:text-white transition-colors cursor-pointer"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${activeProbe ? 'bg-[#30D158]' : 'bg-[#2F6FED]'}`} />
                <Shield className="h-3.5 w-3.5 text-[#8E95A5]" />
                <span>{activeProbe ? 'OWASP + Live' : 'OWASP Pasivo'}</span>
              </button>

              {showConfigPopover && (
                <div className="absolute left-0 bottom-full mb-2 z-30 w-72 rounded-xl bg-[#161B26] border border-white/10 p-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.75)] space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-white">Visita aislada en vivo</div>
                      <div className="text-[11px] text-[#8E95A5]">Comprueba respuesta HTTP sin JS ni cookies.</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={activeProbe}
                      aria-label="Visita aislada en vivo"
                      onClick={() => setActiveProbe((v) => !v)}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                        activeProbe ? 'bg-[#2F6FED]' : 'bg-white/[0.12]'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          activeProbe ? 'translate-x-4.5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="pt-2.5 border-t border-white/[0.07] flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-white">Análisis de cabeceras OWASP</div>
                      <div className="text-[11px] text-[#8E95A5]">Inspección estructural y certificados.</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={true}
                      disabled
                      aria-label="Análisis de cabeceras OWASP"
                      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-[#2F6FED]/70 opacity-80 cursor-not-allowed"
                    >
                      <span className="inline-block h-3.5 w-3.5 translate-x-4.5 rounded-full bg-white" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !urlInput.trim()}
              className="h-9 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-sm disabled:bg-white/[0.07] disabled:text-[#8E95A5] disabled:shadow-none px-4 text-xs font-semibold inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer shrink-0 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              <span>Verificar</span>
              {!loading && <ArrowRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </form>

        <p className="mt-4 text-center text-xs text-slate-500">
          Inspección pasiva sin contacto · Certificados TLS en tiempo real · Reglas OWASP y CTI
        </p>

        {error && (
          <PanelErrorBanner
            message={error}
            onDismiss={() => setError('')}
            className="mt-4"
          />
        )}
      </div>
    </div>
  );
}
