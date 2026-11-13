import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  Database,
  Laptop,
  Link2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { analyzePcLiveSnapshot, syncStixFeeds, verifySuspiciousLink } from '../lib/api';

const QUICK_ASK_SUGGESTIONS = [
  '¿Qué señales visibles deja Pegasus o Predator en un iPhone?',
  'Cómo comprobar si un enlace bancario por SMS es phishing',
];

function extractPcVerdictInfo(pcAudit) {
  if (!pcAudit) return { verdict: '', findingsCount: 0, yaraHits: 0, sockets: 0 };
  const rawCode = String(
    pcAudit?.triage?.diagnosis?.verdict_code || pcAudit?.verdict || '',
  ).toLowerCase();
  const yaraHits = Number(pcAudit?.yara_hits?.length ?? pcAudit?.triage?.yara_hits?.length ?? 0);
  const anomalies = Number(
    pcAudit?.triage?.behavioral_anomalies?.length ?? pcAudit?.behavioral_anomalies?.length ?? 0,
  );
  const matches = Number(pcAudit?.triage?.total_matches ?? pcAudit?.high_findings ?? 0);
  const sockets = Number(pcAudit?.live_sockets_total ?? pcAudit?.network_count ?? 0);
  return {
    verdict: rawCode,
    findingsCount: matches + yaraHits + anomalies,
    yaraHits,
    sockets,
  };
}

function computePostureModel({ apiOnline, pcAudit, usbStatus, govStats, lastLinkResult }) {
  const pcInfo = extractPcVerdictInfo(pcAudit);
  const verdict = pcInfo.verdict;
  const findingsCount = pcInfo.findingsCount;
  const linkRisk = String(lastLinkResult?.risk_level || lastLinkResult?.verdict || '').toLowerCase();

  if (
    verdict === 'suspicious' ||
    verdict === 'alert' ||
    verdict === 'high' ||
    verdict === 'critical' ||
    linkRisk === 'malicious' ||
    linkRisk === 'high'
  ) {
    return {
      key: 'alert',
      litSegments: 22,
      ringColor: '#FF453A',
      badgeText: 'Atención requerida',
      badgeTone: 'text-[#FF7A73] border-[#FF453A]/35 bg-[#FF453A]/14',
      headline: 'Se detectaron indicadores que requieren revisión',
      summaryPlain:
        findingsCount > 0
          ? `Tu último chequeo reportó ${findingsCount} hallazgo(s) relevantes. Abre el detalle de Equipos para inspeccionar sin riesgo.`
          : 'El último análisis marcó una señal de riesgo elevada. Revisa la evidencia local o consulta al copiloto.',
      summaryTech: `verdict=${pcInfo.verdict || linkRisk} | findings=${findingsCount} | yara=${pcInfo.yaraHits}`,
    };
  }

  if (!apiOnline || verdict === 'warning' || verdict === 'watch' || linkRisk === 'suspicious' || linkRisk === 'medium') {
    return {
      key: 'warning',
      litSegments: 16,
      ringColor: '#FF9F0A',
      badgeText: !apiOnline ? 'Motor en espera' : 'Revisión sugerida',
      badgeTone: 'text-[#FFD60A] border-[#FF9F0A]/35 bg-[#FF9F0A]/14',
      headline: !apiOnline
        ? 'Esperando conexión con el motor local'
        : 'Hay observaciones menores por confirmar',
      summaryPlain: !apiOnline
        ? 'La interfaz está activa, pero el motor de análisis local aún no responde en esta sesión.'
        : 'Encontramos elementos atípicos que conviene validar en detalle desde el inspector.',
      summaryTech: !apiOnline
        ? 'api_health=unreachable | local_bridge=ready'
        : `verdict=${pcInfo.verdict || linkRisk} | review_recommended=true`,
    };
  }

  if (pcAudit) {
    return {
      key: 'clean',
      litSegments: 24,
      ringColor: '#30D158',
      badgeText: 'Equipo verificado',
      badgeTone: 'text-[#5EE07E] border-[#30D158]/35 bg-[#30D158]/14',
      headline: 'Tu equipo se ve estable y sin alertas activas',
      summaryPlain:
        'Procesos, conexiones de red y reglas YARA examinadas en memoria sin señales activas de spyware.',
      summaryTech: `yara_matches=${pcInfo.yaraHits} | sockets=${pcInfo.sockets} | matches=${findingsCount}`,
    };
  }

  const usbReady = Boolean(usbStatus?.android?.connected || usbStatus?.ios?.connected);
  const iocCount = Number(govStats?.corpus_stats?.iocs || 0);
  return {
    key: 'ready',
    litSegments: usbReady ? 20 : 18,
    ringColor: '#5E9BFF',
    badgeText: usbReady ? 'USB conectado' : 'Listo para analizar',
    badgeTone: 'text-[#9EC1FF] border-[#2F6FED]/40 bg-[#2F6FED]/16',
    headline: 'Centro de protección local operativo',
    summaryPlain: usbReady
      ? 'Detectamos un teléfono conectado por cable USB y la base de amenazas está lista para auditar en modo local.'
      : 'Todo corre en tu PC sin subir archivos a la nube. Inicia un chequeo de esta PC o conecta un celular por USB.',
    summaryTech: `corpus_iocs=${iocCount} | usb_android=${Boolean(usbStatus?.android?.connected)} | usb_ios=${Boolean(usbStatus?.ios?.connected)}`,
  };
}

function RadialIntegrityDial({ litSegments, ringColor, postureKey, indexValue }) {
  const totalSegments = 24;
  const cx = 56;
  const cy = 56;
  const outerR = 47;
  const innerR = 39;

  return (
    <div className="relative h-[112px] w-[112px] shrink-0 select-none flex items-center justify-center rounded-full bg-[#090B0E] border border-white/[0.08] shadow-[inset_0_4px_12px_rgba(0,0,0,0.9),0_1px_0_rgba(255,255,255,0.06)]">
      <svg
        width="112"
        height="112"
        viewBox="0 0 112 112"
        aria-hidden="true"
        className="block"
      >
        {Array.from({ length: totalSegments }).map((_, idx) => {
          const angle = ((idx * 360) / totalSegments - 90) * (Math.PI / 180);
          const x1 = cx + innerR * Math.cos(angle);
          const y1 = cy + innerR * Math.sin(angle);
          const x2 = cx + outerR * Math.cos(angle);
          const y2 = cy + outerR * Math.sin(angle);
          const isLit = idx < litSegments;
          return (
            <line
              key={idx}
              x1={x1.toFixed(2)}
              y1={y1.toFixed(2)}
              x2={x2.toFixed(2)}
              y2={y2.toFixed(2)}
              stroke={isLit ? ringColor : 'rgba(255,255,255,0.12)'}
              strokeWidth="2.6"
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {postureKey === 'clean' ? (
          <ShieldCheck className="h-5 w-5 text-[#5EE07E]" />
        ) : postureKey === 'alert' ? (
          <ShieldAlert className="h-5 w-5 text-[#FF7A73]" />
        ) : (
          <Activity className="h-5 w-5 text-[#8AB4FF]" />
        )}
        <span className="font-tech mt-1 text-[11px] font-medium text-[#D6DAE2]">
          {indexValue}
        </span>
      </div>
    </div>
  );
}

export function CommandCenterPanel({
  isDesktop = false,
  technicalMode = false,
  apiOnline = true,
  govStats,
  usbStatus,
  pcAudit,
  pcScannedAt,
  lastLinkResult,
  sessionActivity = [],
  onPcAuditComplete,
  onNavigate,
  onOpenCopilot,
  onSyncComplete,
  onVerifyLinkJump,
  onLinkVerified,
  onLogActivity,
}) {
  const [pcScanning, setPcScanning] = useState(false);
  const [pcScanError, setPcScanError] = useState('');
  const [syncingStix, setSyncingStix] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const [quickUrl, setQuickUrl] = useState('');
  const [linkChecking, setLinkChecking] = useState(false);
  const [inlineLinkStatus, setInlineLinkStatus] = useState(null);

  const [copilotDraft, setCopilotDraft] = useState('');

  const posture = useMemo(
    () =>
      computePostureModel({
        apiOnline,
        pcAudit,
        usbStatus,
        govStats,
        lastLinkResult,
      }),
    [apiOnline, pcAudit, usbStatus, govStats, lastLinkResult]
  );

  const reportsCount = Number(govStats?.corpus_stats?.reports ?? 0);
  const iocsCount = Number(govStats?.corpus_stats?.iocs ?? 0);
  const androidConnected = Boolean(usbStatus?.android?.connected);
  const iosConnected = Boolean(usbStatus?.ios?.connected);
  const usbSummaryLabel = androidConnected
    ? usbStatus?.android?.model || 'Android USB'
    : iosConnected
      ? usbStatus?.ios?.deviceName || 'iPhone / iPad USB'
      : 'Sin cable USB';

  const pcInfo = useMemo(() => extractPcVerdictInfo(pcAudit), [pcAudit]);

  async function handleRunPcScan() {
    if (pcScanning) return;
    setPcScanError('');

    if (!isDesktop || !window.omegaDesktop?.collectPcAuditSnapshot) {
      onLogActivity?.('Modo web: abriendo muestra forense en Equipos');
      onNavigate?.('equipo', { tab: 'pc' });
      return;
    }

    setPcScanning(true);
    try {
      const snapshot = await window.omegaDesktop.collectPcAuditSnapshot();
      if (!snapshot?.ok) {
        throw new Error(snapshot?.error || 'No se pudo recolectar la telemetría de Windows.');
      }
      const analysis = await analyzePcLiveSnapshot(snapshot);
      onPcAuditComplete?.(analysis);
      const vLabel = analysis?.triage?.diagnosis?.verdict_label || analysis?.triage?.diagnosis?.verdict_code || 'listo';
      onLogActivity?.(`Escaneo de esta PC finalizado (${vLabel})`);
    } catch (err) {
      setPcScanError(err?.message || 'Error al analizar esta PC');
      onLogActivity?.('Falló el escaneo rápido de PC');
    } finally {
      setPcScanning(false);
    }
  }

  async function handleSyncStix() {
    if (syncingStix) return;
    setSyncingStix(true);
    setSyncMessage('');
    try {
      const res = await syncStixFeeds();
      const loaded = Number(res?.indicators_loaded ?? res?.total_iocs ?? 0);
      setSyncMessage(
        loaded > 0 ? `${loaded.toLocaleString('en-US')} firmas sincronizadas` : 'Base al día'
      );
      onSyncComplete?.();
      onLogActivity?.('Firmas STIX/YARA actualizadas');
    } catch {
      setSyncMessage('No se pudo conectar con los feeds ahora');
    } finally {
      setSyncingStix(false);
    }
  }

  async function handleQuickLinkVerify(e) {
    e.preventDefault();
    const cleaned = quickUrl.trim();
    if (!cleaned || linkChecking) return;

    setLinkChecking(true);
    setInlineLinkStatus(null);
    try {
      const res = await verifySuspiciousLink(cleaned);
      setInlineLinkStatus({ url: cleaned, ...res });
      onLinkVerified?.(res);
      onLogActivity?.(`Enlace analizado: ${res?.verdict || 'revisado'}`);
    } catch (err) {
      setInlineLinkStatus({
        url: cleaned,
        verdict: 'error',
        error: err?.message || 'No se pudo verificar este enlace.',
      });
    } finally {
      setLinkChecking(false);
    }
  }

  function handleCopilotSubmit(e) {
    e.preventDefault();
    const prompt = copilotDraft.trim();
    if (!prompt) {
      onOpenCopilot?.({});
      return;
    }
    setCopilotDraft('');
    onOpenCopilot?.({ prompt });
  }

  const dialIndex =
    posture.key === 'clean'
      ? '100%'
      : posture.key === 'alert'
        ? 'ALERTA'
        : `${reportsCount || 26} REP`;

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-7 py-5 sm:py-6">
      <div className="mx-auto max-w-[1160px] space-y-5 pb-24">
        {/* INSTRUMENTO PRINCIPAL — Estado de Protección en Vivo */}
        <section
          aria-label="Estado de protección en vivo"
          className="apple-group rounded-[18px] p-5 sm:p-6"
        >
          <div className="grid gap-6 lg:grid-cols-12 lg:items-center">
            {/* Dial radial + Diagnóstico humano */}
            <div className="lg:col-span-7 flex flex-col sm:flex-row sm:items-center gap-5">
              <RadialIntegrityDial
                litSegments={posture.litSegments}
                ringColor={posture.ringColor}
                postureKey={posture.key}
                indexValue={dialIndex}
              />

              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${posture.badgeTone}`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full bg-current"
                    />
                    {posture.badgeText}
                  </span>
                  {isDesktop && (
                    <span className="font-tech rounded-full border border-white/[0.09] bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-[#B4BAC6]">
                      App de escritorio · Windows
                    </span>
                  )}
                </div>

                <h1 className="text-[21px] sm:text-[24px] font-semibold tracking-[-0.025em] text-[#F4F6FA] leading-[1.2]">
                  {posture.headline}
                </h1>

                <p className="text-[13.5px] leading-[1.55] text-[#C4CAD4] max-w-[60ch]">
                  {technicalMode ? posture.summaryTech : posture.summaryPlain}
                </p>

                {pcScanError && (
                  <p className="text-[12.5px] text-[#FF8982]">{pcScanError}</p>
                )}
              </div>
            </div>

            {/* Acciones físicas de hardware */}
            <div className="lg:col-span-5 flex flex-col gap-2.5 lg:items-end">
              <div className="w-full max-w-[360px] flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleRunPcScan}
                  disabled={pcScanning}
                  className="tactile-key-primary h-11 px-4 rounded-[12px] text-[13.5px] font-medium inline-flex items-center justify-between gap-3 cursor-pointer disabled:opacity-65"
                >
                  <span className="inline-flex items-center gap-2.5">
                    {pcScanning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Laptop className="h-4 w-4" />
                    )}
                    <span>
                      {pcScanning
                        ? 'Recopilando procesos y YARA...'
                        : isDesktop
                          ? 'Analizar esta PC ahora'
                          : 'Abrir inspector de PC'}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 opacity-80" />
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onNavigate?.('equipo', { tab: iosConnected ? 'ios' : 'android' })
                    }
                    className="tactile-key h-10 px-3 rounded-[11px] text-[12.5px] font-medium inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Smartphone className="h-3.5 w-3.5 text-[#8AB4FF]" />
                    <span className="truncate">Revisar USB</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenCopilot?.({})}
                    className="tactile-key h-10 px-3 rounded-[11px] text-[12.5px] font-medium inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-[#8AB4FF]" />
                    <span className="truncate">Abrir copiloto</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Tira única inferior de lectura en tiempo real (sin tarjetas repetidas) */}
          <div className="mt-5 pt-4 border-t border-white/[0.07] grid gap-3 sm:grid-cols-3 text-[12.5px]">
            <div className="flex items-center justify-between sm:justify-start gap-2.5">
              <span className="text-[#9BA2B0]">Último chequeo PC:</span>
              <span className="font-tech text-[#F4F6FA]">
                {pcScannedAt || (pcAudit ? 'En esta sesión' : 'Pendiente')}
              </span>
            </div>

            <div className="flex items-center justify-between sm:justify-center gap-2.5">
              <span className="text-[#9BA2B0]">Puertos USB:</span>
              <span className="font-tech text-[#F4F6FA] inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    androidConnected || iosConnected ? 'bg-[#30D158]' : 'bg-[#8E939E]'
                  }`}
                />
                {usbSummaryLabel}
              </span>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-2.5">
              <span className="text-[#9BA2B0]">Base local:</span>
              <span className="font-tech text-[#9EC1FF]">
                {reportsCount || 0} reportes · {iocsCount.toLocaleString('en-US')} IOCs
              </span>
            </div>
          </div>
        </section>

        {/* BANCO DE TRABAJO ASIMÉTRICO (7 / 5) */}
        <div className="grid gap-5 lg:grid-cols-12 items-start">
          {/* Izquierda (7 cols): Matriz de sensores del equipo */}
          <section
            aria-label="Sensores activos e instrumentos rápidos"
            className="lg:col-span-7 apple-group rounded-[16px] overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-white/[0.07] flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[14.5px] font-semibold tracking-[-0.015em] text-[#F4F6FA]">
                  Sensores y escudos locales
                </h2>
                <p className="text-[12px] text-[#9BA2B0]">
                  Cada módulo analiza directo en memoria o lee indicadores ya indexados en tu equipo.
                </p>
              </div>

              {pcAudit && (
                <button
                  type="button"
                  onClick={() => onNavigate?.('equipo', { tab: 'pc' })}
                  className="tactile-key px-3 py-1.5 rounded-[9px] text-[12px] font-medium inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <span>Ver último informe</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="divide-y divide-white/[0.06]">
              {/* Ranura 1: Esta PC */}
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Laptop className="h-4 w-4 text-[#8AB4FF] shrink-0" />
                    <span className="text-[13.5px] font-medium text-[#F4F6FA]">
                      Auditoría en vivo de Windows (procesos, tareas, sockets y YARA)
                    </span>
                  </div>
                  <p className="text-[12.5px] text-[#A9B0BE]">
                    {pcAudit
                      ? technicalMode
                        ? `verdict=${pcInfo.verdict || 'clean'} | yara=${pcInfo.yaraHits} | sockets=${pcInfo.sockets}`
                        : `Último resultado: ${
                            pcInfo.verdict === 'clean' || pcInfo.verdict === 'low' || pcInfo.findingsCount === 0
                              ? 'sin procesos o dominios sospechosos'
                              : `revisar (${pcInfo.findingsCount} hallazgo(s))`
                          }`
                      : isDesktop
                        ? 'Inspecciona tareas programadas, firmas YARA locales y conexiones activas sin instalar agentes.'
                        : 'En vista navegador puedes abrir muestras forenses o cambiar a la app de escritorio.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate?.('equipo', { tab: 'pc' })}
                  className="tactile-key h-9 px-3.5 rounded-[10px] text-[12.5px] font-medium shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <span>{pcAudit ? 'Abrir informe' : 'Inspeccionar'}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Ranura 2: Móviles USB */}
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-[#8AB4FF] shrink-0" />
                    <span className="text-[13.5px] font-medium text-[#F4F6FA]">
                      Celulares por USB (Android ADB y respaldos iPhone)
                    </span>
                  </div>
                  <p className="text-[12.5px] text-[#A9B0BE]">
                    {androidConnected || iosConnected
                      ? `Detectado: ${usbSummaryLabel}. Listo para cotejar paquetes, DNS y registros MVT.`
                      : 'Conecta tu Android o apunta a un respaldo iOS (incluso cifrado) sin subir datos.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onNavigate?.('equipo', { tab: iosConnected ? 'ios' : 'android' })
                  }
                  className="tactile-key h-9 px-3.5 rounded-[10px] text-[12.5px] font-medium shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Abrir guía USB</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Ranura 3: Escudo rápido de enlaces */}
              <div className="px-5 py-4 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-[#8AB4FF] shrink-0" />
                    <span className="text-[13.5px] font-medium text-[#F4F6FA]">
                      Verificador de enlaces sospechosos (antes de abrirlos)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate?.('enlace')}
                    className="text-[12px] text-[#9EC1FF] hover:text-white transition-colors cursor-pointer"
                  >
                    Trazado profundo →
                  </button>
                </div>

                <form onSubmit={handleQuickLinkVerify} className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="url"
                    value={quickUrl}
                    onChange={(e) => setQuickUrl(e.target.value)}
                    placeholder="Pega aquí un enlace recibido por SMS, correo o WhatsApp..."
                    aria-label="Enlace sospechoso para verificar"
                    className="apple-well flex-1 h-9 px-3 rounded-[10px] text-[13px] text-[#F4F6FA] placeholder:text-[#9097A5] focus:outline-none focus:border-[#5E9BFF]/70"
                  />
                  <button
                    type="submit"
                    disabled={linkChecking || !quickUrl.trim()}
                    className="tactile-key-ivory h-9 px-4 rounded-[10px] text-[12.5px] inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer disabled:bg-[#1E222B] disabled:text-[#9097A5] disabled:border disabled:border-white/[0.08] disabled:shadow-none disabled:cursor-not-allowed"
                  >
                    {linkChecking ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Revisando...</span>
                      </>
                    ) : (
                      <span>Verificar</span>
                    )}
                  </button>
                </form>

                {inlineLinkStatus && (
                  <div className="apple-well rounded-[10px] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
                    <div className="min-w-0 flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 rounded-full shrink-0 ${
                          inlineLinkStatus.verdict === 'clean' || inlineLinkStatus.verdict === 'safe'
                            ? 'bg-[#30D158]'
                            : inlineLinkStatus.verdict === 'error'
                              ? 'bg-[#FF9F0A]'
                              : 'bg-[#FF453A]'
                        }`}
                      />
                      <span className="text-[#F4F6FA] truncate">
                        {inlineLinkStatus.error
                          ? inlineLinkStatus.error
                          : `${inlineLinkStatus.verdict || 'Revisado'}: ${inlineLinkStatus.summary || inlineLinkStatus.url}`}
                      </span>
                    </div>

                    {!inlineLinkStatus.error && (
                      <button
                        type="button"
                        onClick={() => onVerifyLinkJump?.(inlineLinkStatus.url)}
                        className="text-[12px] font-medium text-[#9EC1FF] hover:text-white cursor-pointer"
                      >
                        Abrir detalle completo →
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Ranura 4: Base STIX / YARA */}
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-[#8AB4FF] shrink-0" />
                    <span className="text-[13.5px] font-medium text-[#F4F6FA]">
                      Inteligencia de amenazas e indicadores (STIX2 + YARA)
                    </span>
                  </div>
                  <p className="text-[12.5px] text-[#A9B0BE]">
                    {syncMessage ||
                      `${reportsCount} reportes forenses · ${iocsCount.toLocaleString('en-US')} indicadores cargados para consulta sin conexión.`}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleSyncStix}
                  disabled={syncingStix}
                  className="tactile-key h-9 px-3.5 rounded-[10px] text-[12.5px] font-medium shrink-0 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingStix ? 'animate-spin' : ''}`} />
                  <span>{syncingStix ? 'Sincronizando...' : 'Actualizar firmas'}</span>
                </button>
              </div>
            </div>
          </section>

          {/* Derecha (5 cols): Registro RAM volátil + Copiloto rápido */}
          <aside className="lg:col-span-5 space-y-5">
            {/* Copiloto rápido */}
            <div className="apple-group rounded-[16px] p-4 sm:p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#8AB4FF]" />
                  <h2 className="text-[14px] font-semibold tracking-[-0.015em] text-[#F4F6FA]">
                    Pregunta rápida al copiloto
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenCopilot?.({})}
                  className="text-[12px] text-[#9EC1FF] hover:text-white transition-colors cursor-pointer"
                >
                  Abrir panel lateral →
                </button>
              </div>

              <form onSubmit={handleCopilotSubmit} className="space-y-2.5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={copilotDraft}
                    onChange={(e) => setCopilotDraft(e.target.value)}
                    placeholder="Pregunta sobre una alerta, dominio o síntoma..."
                    aria-label="Pregunta rápida para el copiloto"
                    className="apple-well flex-1 h-9 px-3 rounded-[10px] text-[13px] text-[#F4F6FA] placeholder:text-[#9097A5] focus:outline-none focus:border-[#5E9BFF]/70"
                  />
                  <button
                    type="submit"
                    className="tactile-key-primary h-9 px-3.5 rounded-[10px] text-[12.5px] font-medium shrink-0 cursor-pointer"
                  >
                    Consultar
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {QUICK_ASK_SUGGESTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => onOpenCopilot?.({ prompt: item })}
                      className="rounded-[8px] border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] px-2.5 py-1 text-left text-[11.5px] text-[#C4CAD4] hover:text-[#F4F6FA] transition-colors cursor-pointer"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </form>
            </div>

            {/* Registro de sesión en RAM */}
            <div className="apple-group rounded-[16px] p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-[#9BA2B0]" />
                  <h2 className="text-[14px] font-semibold tracking-[-0.015em] text-[#F4F6FA]">
                    Actividad en esta sesión
                  </h2>
                </div>
                <span className="font-tech text-[11px] text-[#9BA2B0]">
                  Solo RAM local
                </span>
              </div>

              <div className="apple-well rounded-[11px] divide-y divide-white/[0.05] max-h-[210px] overflow-y-auto">
                {sessionActivity.length === 0 ? (
                  <div className="px-3.5 py-3 text-[12.5px] text-[#9BA2B0] flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-[#5EE07E] shrink-0" />
                    <span>Instrumentos listos. Nada se almacena fuera de tu equipo.</span>
                  </div>
                ) : (
                  sessionActivity.slice(0, 8).map((entry) => (
                    <div
                      key={entry.id}
                      className="px-3.5 py-2.5 flex items-baseline justify-between gap-3 text-[12px]"
                    >
                      <span className="text-[#D6DAE2] leading-snug">{entry.label}</span>
                      <span className="font-tech text-[11px] text-[#9BA2B0] shrink-0">
                        {entry.time}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
