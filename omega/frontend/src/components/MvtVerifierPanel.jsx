import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Loader2, Smartphone, Upload } from 'lucide-react';
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

    let verdictAccent = 'border-l-[#2F6FED]';
    if (hasMatches || hasCriticalBehavioral) {
      verdictAccent = 'border-l-[#F87171]';
    } else if (hasBehavioral) {
      verdictAccent = 'border-l-[#FBBF24]';
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
      <div className="w-full max-w-[700px] mx-auto pt-2 pb-10">
        {/* Barra superior minimalista */}
        <div className="flex items-center justify-between mb-6">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-3 py-1.5 text-[12.5px] font-medium text-[#F2F2F4] hover:border-[#2F6FED] transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#8E8E96]" />
            <span>Nuevo análisis</span>
          </button>

          <button
            type="button"
            onClick={handleExportMarkdown}
            className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-3 py-1.5 text-[12.5px] font-medium text-[#F2F2F4] hover:border-[#2F6FED] transition-colors cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-[#8E8E96]" />
            <span>Exportar (.md)</span>
          </button>
        </div>

        {/* Veredicto Claro (1 solo bloque) */}
        <section
          className={`rounded-[6px] bg-[#141418] border border-[#232329] border-l-2 p-5 ${verdictAccent}`}
        >
          <h2 className="text-[16px] font-semibold text-[#F2F2F4]">
            {verdictTitle}
          </h2>

          <p className="mt-1.5 text-[13px] text-[#8E8E96] leading-relaxed">
            {verdictBody}
          </p>

          <div className="font-tech mt-4 text-[11px] text-[#8E8E96]">
            Archivo: {result.sourceLabel}
            {result.filesAnalyzed ? ` · ${result.filesAnalyzed} artefacto(s) en RAM` : ''}
            {` · ${result.analyzedCount} indicadores evaluados · 0 bytes guardados`}
          </div>
        </section>

        {/* Postura de Endurecimiento (cuando proviene de captura viva ADB USB) */}
        {hardeningReport?.hardening_checks?.length > 0 && (
          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="font-tech text-[11px] uppercase tracking-wider text-[#8E8E96]">
                Postura de Endurecimiento (ADB USB)
              </span>
              {hardeningReport.device_summary && (
                <span className="font-tech text-[11px] text-[#8E8E96]">
                  Android {hardeningReport.device_summary.android_version || 'N/D'} · Parche{' '}
                  {hardeningReport.device_summary.security_patch || 'N/D'}
                </span>
              )}
            </div>
            <div className="rounded-[6px] border border-[#232329] bg-[#141418] divide-y divide-[#232329]">
              {hardeningReport.hardening_checks.map((chk) => {
                let badgeCls = 'border-[#232329] bg-[#0A0A0C] text-[#8E8E96]';
                if (chk.status === 'OK') {
                  badgeCls = 'border-[#2F6FED]/40 bg-[#15223D] text-[#7AA7FF]';
                } else if (chk.status === 'WARN') {
                  badgeCls = 'border-[#52401E] bg-[#1C1810] text-[#FBBF24]';
                }

                return (
                  <div key={chk.control} className="px-4 py-3 flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-tech rounded-[4px] border px-1.5 py-0.5 text-[10.5px] font-medium ${badgeCls}`}>
                          {chk.status}
                        </span>
                        <span className="text-[13px] font-medium text-[#F2F2F4]">
                          {chk.control}
                        </span>
                      </div>
                      <p className="text-[12.5px] text-[#8E8E96] leading-relaxed">
                        {chk.detail}
                      </p>
                    </div>
                    <span className="font-tech shrink-0 rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-0.5 text-[11px] text-[#F2F2F4]">
                      {chk.value}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Lista Limpia de Hallazgos CTI (si hay coincidencias) */}
        {hasMatches && (
          <section className="mt-6 border-t border-b border-[#232329] divide-y divide-[#232329]">
            {result.findings.map((finding) => (
              <div
                key={finding.id}
                className="py-3.5 flex items-center justify-between gap-4"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-tech text-[13px] text-[#F2F2F4] break-all">
                      {finding.ioc_value}
                    </span>
                    <span className="rounded-[4px] border border-[#232329] bg-[#141418] px-2 py-0.5 text-[11px] font-medium text-[#F2F2F4]">
                      {finding.spyware_family}
                    </span>
                  </div>
                  <div className="font-tech text-[11.5px] text-[#8E8E96] truncate">
                    {finding.artifact_origin}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!onAskInChat}
                  onClick={() => handleInvestigateFinding(finding)}
                  className="shrink-0 rounded-[4px] border border-[#232329] bg-[#141418] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED] hover:text-[#7AA7FF] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  Investigar en Preguntar
                </button>
              </div>
            ))}
          </section>
        )}

        {/* Lista Limpia de Anomalías Conductuales (Zero-Day / RAM) */}
        {hasBehavioral && (
          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-tech text-[11px] uppercase tracking-wider text-[#8E8E96]">
                Heurística Conductual en RAM (Sin dependencia de IOCs)
              </span>
            </div>
            <div className="border-t border-b border-[#232329] divide-y divide-[#232329]">
              {behavioralAnomalies.map((anom, idx) => {
                const isCrit = anom.severity === 'CRITICAL';
                return (
                  <div
                    key={`${anom.category}-${anom.artifact}-${anom.indicator}-${idx}`}
                    className="py-3.5 flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`font-tech rounded-[4px] border px-1.5 py-0.5 text-[10.5px] font-medium ${
                            isCrit
                              ? 'border-[#5A2429] bg-[#1F1215] text-[#F87171]'
                              : 'border-[#52401E] bg-[#1C1810] text-[#FBBF24]'
                          }`}
                        >
                          {anom.severity}
                        </span>
                        <span className="font-tech text-[13px] text-[#F2F2F4] break-all">
                          {anom.indicator}
                        </span>
                        <span className="font-tech rounded-[4px] border border-[#232329] bg-[#141418] px-2 py-0.5 text-[10.5px] text-[#8E8E96]">
                          {anom.category}
                        </span>
                      </div>
                      <p className="text-[12.5px] text-[#8E8E96] leading-relaxed">
                        {anom.detail}
                      </p>
                      <div className="font-tech text-[11px] text-[#8E8E96]/90 truncate">
                        {anom.artifact}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={!onAskInChat}
                      onClick={() => handleInvestigateAnomaly(anom)}
                      className="shrink-0 rounded-[4px] border border-[#232329] bg-[#141418] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED] hover:text-[#7AA7FF] disabled:opacity-50 transition-colors cursor-pointer"
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
    <div className="flex-1 flex flex-col items-center justify-center py-6">
      <div className="w-full max-w-[620px]">
        {/* Encabezado centrado */}
        <header className="text-center mb-6">
          <span className="font-tech inline-block rounded-[4px] border border-[#232329] bg-[#141418] px-2.5 py-1 text-[11px] text-[#8E8E96]">
            ANÁLISIS EN RAM · SIN PERSISTENCIA
          </span>
          <h1 className="mt-3 text-[24px] font-semibold tracking-tight text-[#F2F2F4]">
            Verificar integridad del dispositivo
          </h1>
          <p className="mt-2 text-[13px] text-[#8E8E96] leading-relaxed">
            Analiza salidas JSON de MVT o pega indicadores sospechosos para cruzarlos contra campañas conocidas.
          </p>
        </header>

        {/* Barra Discreta USB Nativa (solo visible dentro de Electron Desktop) */}
        {hasDesktopBridge && (
          <div className="mb-3 rounded-[6px] border border-[#232329] bg-[#141418] px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2.5">
              <Smartphone
                className={`h-4 w-4 shrink-0 ${
                  usbDevice?.connected ? 'text-[#2F6FED]' : 'text-[#8E8E96]'
                }`}
              />
              <div className="min-w-0">
                {usbDevice?.connected ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-medium text-[#F2F2F4] truncate">
                      {usbDevice.model}
                    </span>
                    <span className="font-tech text-[11px] text-[#8E8E96]">
                      {usbDevice.serial} · ADB solo lectura
                    </span>
                  </div>
                ) : (
                  <p className="text-[12px] text-[#8E8E96] truncate">
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
                className="shrink-0 rounded-[4px] bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-50 px-3 py-1.5 text-[12px] font-medium text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {scanningUsb && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{scanningUsb ? 'Extrayendo RAM...' : 'Auditar dispositivo'}</span>
              </button>
            ) : (
              <span className="font-tech shrink-0 rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-0.5 text-[10.5px] text-[#8E8E96]">
                USB ADB
              </span>
            )}
          </div>
        )}

        {/* Contenedor Único de Entrada */}
        <div className="rounded-[6px] bg-[#141418] border border-[#232329] p-4">
          {/* Selector superior tipo tab minimalista */}
          <div className="flex items-center gap-1 border-b border-[#232329] pb-3 mb-4">
            <button
              type="button"
              onClick={() => {
                setInputMode('upload');
                setErrorMsg('');
              }}
              className={`rounded-[4px] px-3 py-1.5 text-[12.5px] font-medium transition-colors cursor-pointer ${
                inputMode === 'upload'
                  ? 'bg-[#15223D] text-[#F2F2F4]'
                  : 'text-[#8E8E96] hover:text-[#F2F2F4]'
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
              className={`rounded-[4px] px-3 py-1.5 text-[12.5px] font-medium transition-colors cursor-pointer ${
                inputMode === 'paste'
                  ? 'bg-[#15223D] text-[#F2F2F4]'
                  : 'text-[#8E8E96] hover:text-[#F2F2F4]'
              }`}
            >
              Pegar indicadores
            </button>
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
              className={`rounded-[4px] border border-dashed py-10 px-6 flex flex-col items-center justify-center text-center transition-colors cursor-pointer ${
                isDragging
                  ? 'border-[#2F6FED] bg-[#15223D]/30'
                  : 'border-[#232329] hover:border-[#2F6FED]/60'
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

              {isAnalyzing ? (
                <Loader2 className="h-5 w-5 text-[#2F6FED] animate-spin mb-2.5" />
              ) : (
                <Upload className="h-5 w-5 text-[#8E8E96] mb-2.5" />
              )}

              <p className="text-[13px] text-[#F2F2F4]">
                {isAnalyzing ? (
                  'Analizando en memoria RAM...'
                ) : (
                  <>
                    Arrastra tu volcado MVT o <span className="font-tech">sysdiagnose</span> (
                    <span className="font-tech">.json</span>,{' '}
                    <span className="font-tech">.db</span>,{' '}
                    <span className="font-tech">.tar.gz</span>,{' '}
                    <span className="font-tech">.zip</span>) aquí
                  </>
                )}
              </p>

              <button
                type="button"
                disabled={isAnalyzing}
                onClick={handleRunSample}
                className="mt-2.5 text-[12px] text-[#2F6FED] hover:text-[#7AA7FF] hover:underline disabled:opacity-50 cursor-pointer"
              >
                Probar con muestra de ejemplo
              </button>
            </div>
          ) : (
            <form onSubmit={handleAnalyzeText}>
              <textarea
                rows={4}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder={'free247downloads.com\n185.220.101.44\n4a7f... (SHA-256) o proceso anómalo'}
                className="font-tech w-full resize-none bg-transparent border-0 p-0 text-[12px] leading-relaxed text-[#F2F2F4] placeholder-[#8E8E96]/70 focus:outline-none"
              />

              <div className="mt-3 pt-3 border-t border-[#232329] flex items-center justify-between gap-3">
                <span className="text-[12px] text-[#8E8E96]">
                  Uno por línea · Dominios, IPs, URLs o hashes
                </span>
                <button
                  type="submit"
                  disabled={isAnalyzing || !manualText.trim()}
                  className="rounded-[4px] bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-45 px-4 py-1.5 text-[12.5px] font-medium text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {isAnalyzing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Analizar</span>
                </button>
              </div>
            </form>
          )}

          {errorMsg && (
            <p className="mt-3 text-[12px] text-[#F87171]">
              {errorMsg}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
