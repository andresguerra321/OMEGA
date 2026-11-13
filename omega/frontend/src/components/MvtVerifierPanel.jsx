import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Loader2, ShieldCheck, Smartphone, Upload } from 'lucide-react';
import { analyzeLiveDeviceSnapshot, runParallelTriage, verifyMvtText } from '../lib/api';

const SAMPLE_SAFARI_JSON = JSON.stringify(
  [
    {
      timestamp: '2024-06-14T09:12:04Z',
      url: 'https://www.reuters.com/world/',
      domain: 'reuters.com',
    },
    {
      timestamp: '2024-06-14T11:42:19Z',
      url: 'https://free247downloads.com/cdn/v2/stage?t=98f1a',
      domain: 'free247downloads.com',
    },
    {
      timestamp: '2024-06-14T11:44:05Z',
      url: 'https://updates-icloud-cdn.org/pkpass',
      domain: 'updates-icloud-cdn.org',
    },
    {
      timestamp: '2024-06-14T15:08:51Z',
      url: 'https://citizenlab.ca/',
      domain: 'citizenlab.ca',
    },
  ],
  null,
  2,
);

function dedupeMatches(rawMatches) {
  const seen = new Set();
  const list = [];
  for (const m of rawMatches) {
    const val = (m.ioc_value || '').trim();
    if (!val) continue;
    const key = `${val.toLowerCase()}::${(m.spyware_family || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      id: `${list.length}-${val}`,
      ioc_value: val,
      spyware_family: m.spyware_family || 'Sin clasificar',
      artifact_origin: m.artifact_origin || 'Volcado MVT',
      campaign: m.campaign || '',
      source_report: m.source_report || '',
      context: m.context || '',
    });
  }
  return list;
}

function normalizeParallelResult(res, files = [], customSourceLabel = '') {
  const allMatches = [];
  for (const sub of res.subagents || []) {
    for (const m of sub.matches || []) {
      allMatches.push(m);
    }
  }
  const findings = dedupeMatches(allMatches);
  const fileNames = files.map((f) => f.name).join(', ');

  return {
    sourceLabel: customSourceLabel || fileNames || 'volcado_mvt',
    analyzedCount: res.total_indicators_analyzed ?? 0,
    filesAnalyzed: res.total_files ?? files.length,
    matchesCount: findings.length,
    behavioralAnomalies: res.behavioral_anomalies || [],
    verdictCode: res.diagnosis?.verdict_code || (findings.length > 0 ? 'DETECTED' : 'CLEAN'),
    rationale: res.diagnosis?.rationale || '',
    findings,
  };
}

function normalizeManualResult(res) {
  const findings = dedupeMatches(res.matches || []);
  return {
    sourceLabel: 'indicadores_manuales.txt',
    analyzedCount: res.analyzed_indicators ?? 0,
    matchesCount: findings.length,
    verdictCode: findings.length > 0 ? 'DETECTED' : 'CLEAN',
    rationale: '',
    findings,
  };
}

export function MvtVerifierPanel({ onAskInChat }) {
  const fileInputRef = useRef(null);

  const [inputMode, setInputMode] = useState('upload');
  const [manualText, setManualText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState(null);
  const [usbDevice, setUsbDevice] = useState(null);
  const [scanningUsb, setScanningUsb] = useState(false);
  const [hardeningReport, setHardeningReport] = useState(null);

  const hasDesktopBridge =
    typeof window !== 'undefined' && Boolean(window.omegaDesktop?.checkAdbStatus);

  useEffect(() => {
    if (!window.omegaDesktop?.checkAdbStatus) return undefined;
    let cancelled = false;

    const refreshStatus = () => {
      window.omegaDesktop
        .checkAdbStatus()
        .then((status) => {
          if (!cancelled) setUsbDevice(status);
        })
        .catch(() => {
          if (!cancelled) {
            setUsbDevice({
              available: false,
              connected: false,
              reason: 'No se pudo consultar el estado del puente ADB.',
            });
          }
        });
    };

    refreshStatus();
    const timer = setInterval(refreshStatus, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function handleLiveUsbScan() {
    if (!window.omegaDesktop?.collectDeviceSnapshot || scanningUsb || isAnalyzing) return;
    setScanningUsb(true);
    setErrorMsg('');
    try {
      const snapshot = await window.omegaDesktop.collectDeviceSnapshot();
      const liveRes = await analyzeLiveDeviceSnapshot(snapshot);
      const dev = liveRes.device_summary || snapshot.device || {};
      const label = [dev.manufacturer, dev.model].filter(Boolean).join(' ').trim() || 'Dispositivo Android';
      setHardeningReport(liveRes);
      setResult(normalizeParallelResult(liveRes.triage, [], `${label} (ADB USB)`));
    } catch (err) {
      setErrorMsg(err?.message || 'Error auditando el dispositivo Android por USB.');
    } finally {
      setScanningUsb(false);
    }
  }

  async function analyzeFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setIsAnalyzing(true);
    setErrorMsg('');
    setHardeningReport(null);
    try {
      const apiRes = await runParallelTriage(files);
      setResult(normalizeParallelResult(apiRes, files));
    } catch (err) {
      setErrorMsg(err?.message || 'No se pudo analizar el archivo en memoria.');
    } finally {
      setIsAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleRunSample(e) {
    e.stopPropagation();
    const sampleFile = new File([SAMPLE_SAFARI_JSON], 'safari_history.json', {
      type: 'application/json',
    });
    await analyzeFiles([sampleFile]);
  }

  async function handleAnalyzeText(e) {
    e.preventDefault();
    const trimmed = manualText.trim();
    if (!trimmed) return;
    setIsAnalyzing(true);
    setErrorMsg('');
    setHardeningReport(null);
    try {
      const apiRes = await verifyMvtText(trimmed);
      setResult(normalizeManualResult(apiRes));
    } catch (err) {
      setErrorMsg(err?.message || 'No se pudieron evaluar los indicadores en memoria.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleReset() {
    setResult(null);
    setHardeningReport(null);
    setErrorMsg('');
  }

  function handleExportMarkdown() {
    if (!result) return;
    const anomalies = result.behavioralAnomalies || [];
    const checks = hardeningReport?.hardening_checks || [];
    const lines = [
      '# OMEGA · Verificación de Integridad del Dispositivo',
      `- **Origen:** \`${result.sourceLabel}\``,
      `- **Artefactos evaluados:** ${result.filesAnalyzed || 1}`,
      `- **Indicadores evaluados:** ${result.analyzedCount}`,
      `- **Coincidencias CTI:** ${result.matchesCount}`,
      `- **Anomalías conductuales:** ${anomalies.length}`,
      `- **Almacenamiento:** 0 bytes guardados en disco`,
      '',
    ];

    if (checks.length > 0) {
      lines.push('## Postura de Endurecimiento del Dispositivo (ADB USB)');
      checks.forEach((chk) => {
        lines.push(`- [${chk.status}] **${chk.control}** (\`${chk.value}\`): ${chk.detail}`);
      });
      lines.push('');
    }

    if (result.findings.length === 0 && anomalies.length === 0) {
      lines.push('## Resultado\nSin indicadores de compromiso detectados frente al corpus CTI público ni anomalías conductuales.');
    } else {
      if (result.findings.length > 0) {
        lines.push('## Coincidencias CTI Detectadas');
        result.findings.forEach((f, idx) => {
          lines.push(
            `${idx + 1}. \`${f.ioc_value}\` — **${f.spyware_family}** (${f.artifact_origin})`,
          );
        });
        lines.push('');
      }
      if (anomalies.length > 0) {
        lines.push('## Anomalías Conductuales Detectadas (RAM)');
        anomalies.forEach((a, idx) => {
          lines.push(
            `${idx + 1}. [${a.severity}] \`${a.indicator}\` — **${a.category}** (\`${a.artifact}\`): ${a.detail}`,
          );
        });
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omega_verificacion_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleInvestigateFinding(finding) {
    if (!onAskInChat) return;
    const prompt = [
      `Investiga este indicador detectado al revisar el dispositivo:`,
      `- Indicador: ${finding.ioc_value}`,
      `- Familia / Campaña: ${finding.spyware_family}${finding.campaign ? ` (${finding.campaign})` : ''}`,
      `- Origen: ${finding.artifact_origin}`,
      `¿Qué se conoce sobre este indicador en los reportes públicos de Citizen Lab, Amnesty Tech o Google TAG y cómo debería verificarse si hubo compromiso real?`,
    ].join('\n');
    onAskInChat(prompt);
  }

  function handleInvestigateAnomaly(anom) {
    if (!onAskInChat) return;
    const prompt = [
      `Investiga esta anomalía conductual detectada en memoria RAM sin IOCs públicos conocidos:`,
      `- Categoría: ${anom.category} (${anom.severity})`,
      `- Indicador: ${anom.indicator}`,
      `- Artefacto: ${anom.artifact}`,
      `- Detalle: ${anom.detail}`,
      `¿Cómo se asocia este patrón con implantes como Pegasus o Predator en Citizen Lab / Amnesty Tech y qué pasos forenses recomiendas para validarlo?`,
    ].join('\n');
    onAskInChat(prompt);
  }

  // --- ESTADO 2: RESULTADO ---
  if (result) {
    const hasMatches = result.matchesCount > 0;
    const behavioralAnomalies = result.behavioralAnomalies || [];
    const hasBehavioral = behavioralAnomalies.length > 0;
    const hasCriticalBehavioral =
      behavioralAnomalies.some((a) => a.severity === 'CRITICAL') ||
      result.verdictCode === 'BEHAVIORAL_ZERO_DAY_SUSPICION';

    let verdictDot = 'bg-[#30D158] shadow-[0_0_10px_rgba(48,209,88,0.5)]';
    let verdictHeadingTone = 'text-[#F5F5F7]';
    if (hasMatches || hasCriticalBehavioral) {
      verdictDot = 'bg-[#FF453A] shadow-[0_0_10px_rgba(255,69,58,0.55)]';
      verdictHeadingTone = 'text-[#FF6961]';
    } else if (hasBehavioral) {
      verdictDot = 'bg-[#FF9F0A] shadow-[0_0_10px_rgba(255,159,10,0.45)]';
      verdictHeadingTone = 'text-[#FFD60A]';
    }

    let verdictTitle = 'Sin indicadores de spyware detectados';
    if (hasMatches && hasBehavioral) {
      verdictTitle = `Se detectaron ${result.matchesCount} coincidencia${result.matchesCount === 1 ? '' : 's'} CTI y ${behavioralAnomalies.length} anomalía${behavioralAnomalies.length === 1 ? '' : 's'} conductual${behavioralAnomalies.length === 1 ? '' : 'es'}`;
    } else if (hasMatches) {
      verdictTitle = `Se detectaron ${result.matchesCount} coincidencia${result.matchesCount === 1 ? '' : 's'} con campañas de spyware`;
    } else if (hasBehavioral) {
      verdictTitle = `${behavioralAnomalies.length} anomalía${behavioralAnomalies.length === 1 ? '' : 's'} conductual${behavioralAnomalies.length === 1 ? '' : 'es'} sin IOCs públicos conocidos`;
    }

    let verdictBody =
      'Ninguno de los artefactos analizados coincide con dominios, procesos ni hashes públicos asociados a spyware comercial conocidos por OMEGA.';
    if (hasBehavioral && result.rationale) {
      verdictBody = result.rationale;
    } else if (hasMatches) {
      verdictBody =
        'Los indicadores listados abajo coinciden con infraestructura o artefactos documentados en investigaciones públicas. Revisa el origen exacto para descartar navegación incidental antes de tomar medidas de contención.';
    }

    return (
      <div className="omega-fade-up w-full max-w-[700px] mx-auto pt-2 pb-12 space-y-6">
        {/* Barra superior */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12.5px] font-medium text-[#F5F5F7] hover:bg-white/[0.08] active:scale-[0.97] transition-all cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#8E8E93]" />
            <span>Nuevo análisis</span>
          </button>

          <button
            type="button"
            onClick={handleExportMarkdown}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12.5px] font-medium text-[#F5F5F7] hover:bg-white/[0.08] active:scale-[0.97] transition-all cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-[#8E8E93]" />
            <span>Exportar (.md)</span>
          </button>
        </div>

        {/* Bloque de Veredicto Apple Glass (sin borde lateral grueso) */}
        <section className="apple-group rounded-[15px] p-5">
          <div className="flex items-center gap-2.5">
            {!hasMatches && !hasBehavioral ? (
              <ShieldCheck className="h-5 w-5 text-[#30D158] shrink-0" />
            ) : (
              <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${verdictDot}`} />
            )}
            <h2 className={`text-[17px] font-semibold tracking-[-0.015em] ${verdictHeadingTone}`}>
              {verdictTitle}
            </h2>
          </div>

          <p className="mt-2.5 text-[13.5px] text-[#D1D1D6] leading-relaxed">
            {verdictBody}
          </p>

          <div className="font-tech mt-4 pt-3 border-t border-white/[0.06] text-[11.5px] text-[#8E8E93]">
            {result.sourceLabel}
            {result.filesAnalyzed ? ` · ${result.filesAnalyzed} artefacto(s) en RAM` : ''}
            {` · ${result.analyzedCount} indicadores evaluados · 0 bytes guardados`}
          </div>
        </section>

        {/* Postura de Endurecimiento (ADB USB) */}
        {hardeningReport?.hardening_checks?.length > 0 && (
          <section className="space-y-2">
            <div className="px-1 flex items-center justify-between gap-3">
              <span className="text-[12.5px] font-semibold tracking-[-0.01em] text-[#8E8E93]">
                Postura de endurecimiento (ADB USB)
              </span>
              {hardeningReport.device_summary && (
                <span className="font-tech text-[11.5px] text-[#8E8E93]">
                  Android {hardeningReport.device_summary.android_version || 'N/D'} · Parche{' '}
                  {hardeningReport.device_summary.security_patch || 'N/D'}
                </span>
              )}
            </div>
            <div className="apple-group rounded-[13px] divide-y divide-white/[0.06] overflow-hidden">
              {hardeningReport.hardening_checks.map((chk) => {
                let badgeCls = 'border-white/[0.1] bg-white/[0.04] text-[#8E8E93]';
                if (chk.status === 'OK') {
                  badgeCls = 'border-[#30D158]/35 bg-[#30D158]/12 text-[#30D158]';
                } else if (chk.status === 'WARN') {
                  badgeCls = 'border-[#FF9F0A]/35 bg-[#FF9F0A]/12 text-[#FFD60A]';
                }

                return (
                  <div key={chk.control} className="px-4 py-3.5 flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-tech rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${badgeCls}`}>
                          {chk.status}
                        </span>
                        <span className="text-[13.5px] font-medium tracking-[-0.01em] text-[#F5F5F7]">
                          {chk.control}
                        </span>
                      </div>
                      <p className="text-[12.5px] text-[#8E8E93] leading-relaxed">
                        {chk.detail}
                      </p>
                    </div>
                    <span className="font-tech shrink-0 rounded-[7px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-[#E5E5EA]">
                      {chk.value}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Hallazgos CTI */}
        {hasMatches && (
          <section className="space-y-2">
            <span className="px-1 block text-[12.5px] font-semibold tracking-[-0.01em] text-[#8E8E93]">
              Coincidencias con inteligencia pública ({result.findings.length})
            </span>
            <div className="apple-group rounded-[13px] divide-y divide-white/[0.06] overflow-hidden">
              {result.findings.map((finding) => (
                <div
                  key={finding.id}
                  className="px-4 py-3.5 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-tech text-[13px] text-[#F5F5F7] break-all">
                        {finding.ioc_value}
                      </span>
                      <span className="rounded-full border border-[#FF453A]/35 bg-[#FF453A]/12 px-2.5 py-0.5 text-[11px] font-medium text-[#FF6961]">
                        {finding.spyware_family}
                      </span>
                    </div>
                    <div className="font-tech text-[11.5px] text-[#8E8E93] truncate">
                      {finding.artifact_origin}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!onAskInChat}
                    onClick={() => handleInvestigateFinding(finding)}
                    className="shrink-0 rounded-[8px] border border-[#2F6FED]/40 bg-[#2F6FED]/15 px-3 py-1.5 text-[12px] font-medium text-[#8AB4FF] hover:bg-[#2F6FED]/24 disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
                  >
                    Investigar en Preguntar
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Anomalías Conductuales */}
        {hasBehavioral && (
          <section className="space-y-2">
            <span className="px-1 block text-[12.5px] font-semibold tracking-[-0.01em] text-[#8E8E93]">
              Heurística conductual en RAM ({behavioralAnomalies.length})
            </span>
            <div className="apple-group rounded-[13px] divide-y divide-white/[0.06] overflow-hidden">
              {behavioralAnomalies.map((anom, idx) => {
                const isCrit = anom.severity === 'CRITICAL';
                return (
                  <div
                    key={`${anom.category}-${anom.artifact}-${anom.indicator}-${idx}`}
                    className="px-4 py-3.5 flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`font-tech rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${
                            isCrit
                              ? 'border-[#FF453A]/40 bg-[#FF453A]/15 text-[#FF6961]'
                              : 'border-[#FF9F0A]/40 bg-[#FF9F0A]/15 text-[#FFD60A]'
                          }`}
                        >
                          {anom.severity}
                        </span>
                        <span className="font-tech text-[13px] text-[#F5F5F7] break-all">
                          {anom.indicator}
                        </span>
                        <span className="font-tech rounded-[6px] border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10.5px] text-[#8E8E93]">
                          {anom.category}
                        </span>
                      </div>
                      <p className="text-[12.5px] text-[#D1D1D6] leading-relaxed">
                        {anom.detail}
                      </p>
                      <div className="font-tech text-[11px] text-[#8E8E93] truncate">
                        {anom.artifact}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={!onAskInChat}
                      onClick={() => handleInvestigateAnomaly(anom)}
                      className="shrink-0 rounded-[8px] border border-[#2F6FED]/40 bg-[#2F6FED]/15 px-3 py-1.5 text-[12px] font-medium text-[#8AB4FF] hover:bg-[#2F6FED]/24 disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
                    >
                      Investigar en Preguntar
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    );
  }

  // --- ESTADO 1: INICIAL (Centrado vertical y horizontalmente) ---
  return (
    <div className="omega-fade-up flex-1 flex flex-col items-center justify-center py-6">
      <div className="w-full max-w-[620px]">
        <header className="text-center mb-7">
          <h1 className="text-[28px] sm:text-[31px] font-semibold tracking-[-0.028em] leading-[1.15] text-[#F5F5F7]">
            Verificar integridad del dispositivo
          </h1>
          <p className="mt-2.5 text-[14px] text-[#8E8E93] leading-[1.55] max-w-[510px] mx-auto">
            Analiza respaldos en memoria RAM o cruza indicadores sospechosos sin escribir datos en disco.
          </p>
        </header>

        {/* Barra USB Nativa (solo Electron Desktop) */}
        {hasDesktopBridge && (
          <div className="apple-group mb-3.5 rounded-[13px] px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-3">
              <div className="h-8 w-8 rounded-[9px] bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0">
                <Smartphone
                  className={`h-4 w-4 ${
                    usbDevice?.connected ? 'text-[#30D158]' : 'text-[#8E8E93]'
                  }`}
                />
              </div>
              <div className="min-w-0">
                {usbDevice?.connected ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#30D158]" />
                    <span className="text-[13px] font-medium text-[#F5F5F7] truncate">
                      {usbDevice.model}
                    </span>
                    <span className="font-tech text-[11px] text-[#8E8E93]">
                      {usbDevice.serial} · solo lectura
                    </span>
                  </div>
                ) : (
                  <p className="text-[12.5px] text-[#8E8E93] truncate">
                    {usbDevice?.reason || 'Detectando dispositivo Android por USB...'}
                  </p>
                )}
              </div>
            </div>

            {usbDevice?.connected ? (
              <button
                type="button"
                disabled={scanningUsb || isAnalyzing}
                onClick={handleLiveUsbScan}
                className="shrink-0 rounded-[9px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.35),inset_0_1px_0_rgba(255,255,255,0.24)] hover:bg-[#3B7BF2] disabled:opacity-50 px-3.5 py-1.5 text-[12px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer"
              >
                {scanningUsb && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{scanningUsb ? 'Extrayendo RAM...' : 'Auditar dispositivo'}</span>
              </button>
            ) : (
              <span className="font-tech shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[10.5px] text-[#8E8E93]">
                USB ADB
              </span>
            )}
          </div>
        )}

        {/* Contenedor Principal Apple Glass */}
        <div className="omega-capsule rounded-[16px] p-4">
          {/* Selector Segmentado macOS */}
          <div className="flex items-center justify-between mb-4">
            <div className="apple-segmented inline-flex rounded-[9px] p-0.5">
              <button
                type="button"
                onClick={() => {
                  setInputMode('upload');
                  setErrorMsg('');
                }}
                className={`rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium transition-all duration-150 cursor-pointer ${
                  inputMode === 'upload'
                    ? 'apple-segmented-active'
                    : 'text-[#8E8E93] hover:text-[#F5F5F7]'
                }`}
              >
                Subir archivo MVT
              </button>
              <button
                type="button"
                onClick={() => {
                  setInputMode('paste');
                  setErrorMsg('');
                }}
                className={`rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium transition-all duration-150 cursor-pointer ${
                  inputMode === 'paste'
                    ? 'apple-segmented-active'
                    : 'text-[#8E8E93] hover:text-[#F5F5F7]'
                }`}
              >
                Pegar indicadores
              </button>
            </div>
          </div>

          {inputMode === 'upload' ? (
            <div
              onClick={() => {
                if (!isAnalyzing) fileInputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (!isAnalyzing && e.dataTransfer?.files?.length) {
                  analyzeFiles(e.dataTransfer.files);
                }
              }}
              className={`rounded-[12px] border border-dashed py-11 px-6 flex flex-col items-center justify-center text-center transition-all duration-200 cursor-pointer ${
                isDragging
                  ? 'border-[#2F6FED] bg-[#2F6FED]/12'
                  : 'border-white/[0.12] bg-black/25 hover:border-[#2F6FED]/55 hover:bg-black/35'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".json,.db,.sqlite,.sqlite3,.txt,.log,.ips,.crash,.tar.gz,.tgz,.tar,.zip"
                onChange={(e) => analyzeFiles(e.target.files)}
                className="hidden"
              />

              <div className="mb-3 h-10 w-10 rounded-[11px] bg-white/[0.045] border border-white/[0.08] flex items-center justify-center">
                {isAnalyzing ? (
                  <Loader2 className="h-5 w-5 text-[#5E9BFF] animate-spin" />
                ) : (
                  <Upload className="h-4.5 w-4.5 text-[#8E8E93]" />
                )}
              </div>

              <p className="text-[13.5px] font-medium text-[#F5F5F7]">
                {isAnalyzing
                  ? 'Analizando artefactos en memoria RAM...'
                  : 'Arrastra tu volcado MVT o sysdiagnose aquí'}
              </p>

              {!isAnalyzing && (
                <p className="font-tech mt-1 text-[11.5px] text-[#8E8E93]">
                  .json · .db · .tar.gz · .zip
                </p>
              )}

              <button
                type="button"
                disabled={isAnalyzing}
                onClick={handleRunSample}
                className="mt-3.5 rounded-full border border-[#2F6FED]/35 bg-[#2F6FED]/12 px-3 py-1 text-[12px] font-medium text-[#8AB4FF] hover:bg-[#2F6FED]/20 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Probar con muestra de ejemplo
              </button>
            </div>
          ) : (
            <form onSubmit={handleAnalyzeText}>
              <div className="apple-well rounded-[11px] p-3">
                <textarea
                  rows={4}
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder={'free247downloads.com\n185.220.101.44\n4a7f... (SHA-256) o proceso anómalo'}
                  className="font-tech w-full resize-none bg-transparent border-0 p-0 text-[12.5px] leading-relaxed text-[#F5F5F7] placeholder-[#6E6E73] focus:outline-none"
                />
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-[12px] text-[#8E8E93]">
                  Uno por línea · Dominios, IPs, URLs o hashes
                </span>
                <button
                  type="submit"
                  disabled={isAnalyzing || !manualText.trim()}
                  className="rounded-[9px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.35),inset_0_1px_0_rgba(255,255,255,0.24)] hover:bg-[#3B7BF2] disabled:bg-white/[0.07] disabled:text-[#6E6E73] disabled:shadow-none px-4 py-1.5 text-[12.5px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  {isAnalyzing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Analizar</span>
                </button>
              </div>
            </form>
          )}

          {errorMsg && (
            <p className="mt-3 text-[12.5px] text-[#FF453A]">
              {errorMsg}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
