import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  HelpCircle,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Upload,
} from 'lucide-react';
import {
  analyzeLiveDeviceSnapshot,
  analyzePcLiveSnapshot,
  resolveEncryptedIosManifestTargets,
  resolveIosManifestTargets,
  runParallelTriage,
  syncStixFeeds,
  verifyMvtText,
} from '../lib/api';
import { AndroidStepVisual, IosStepVisual, PcStepVisual } from './DeviceSetupVisuals';
import { OmegaWebIntelCard } from './OmegaWebIntelCard';

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
    yaraHits: res.yara_hits || [],
    timeline: res.timeline || [],
    timelineSummary: res.timeline_summary || null,
    verdictCode: res.diagnosis?.verdict_code || (findings.length > 0 ? 'DETECTED' : 'CLEAN'),
    rationale: res.diagnosis?.rationale || '',
    recommendedActions: res.diagnosis?.recommended_actions || [],
    findings,
  };
}

function normalizeManualResult(res) {
  const findings = dedupeMatches(res.matches || []);
  return {
    sourceLabel: 'indicadores_manuales.txt',
    analyzedCount: res.analyzed_indicators ?? 0,
    matchesCount: findings.length,
    behavioralAnomalies: [],
    yaraHits: [],
    verdictCode: findings.length > 0 ? 'DETECTED' : 'CLEAN',
    rationale: '',
    recommendedActions:
      findings.length > 0
        ? [
            'Preservar el respaldo completo y evitar restaurar el equipo antes de la revisión forense.',
            'Correlacionar el indicador detectado con los reportes técnicos desde Preguntar.',
          ]
        : [],
    findings,
  };
}

function buildForensicMarkdownReport(result, hardeningReport) {
  const anomalies = result.behavioralAnomalies || [];
  const yaraHits = result.yaraHits || [];
  const checks = hardeningReport?.hardening_checks || [];
  const alerts = hardeningReport?.abuse_alerts || [];
  const sockets = hardeningReport?.live_sockets || [];

  const lines = [
    '# OMEGA · Verificación de Integridad del Dispositivo',
    `- **Origen:** \`${result.sourceLabel}\``,
    `- **Artefactos evaluados:** ${result.filesAnalyzed || 1}`,
    `- **Indicadores evaluados:** ${result.analyzedCount}`,
    `- **Coincidencias CTI:** ${result.matchesCount}`,
    `- **Firmas YARA detectadas:** ${yaraHits.length}`,
    `- **Anomalías conductuales / Manifest.db:** ${anomalies.length}`,
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

  if (alerts.length > 0) {
    lines.push('## Alertas de Accesibilidad, Privilegios y Red');
    alerts.forEach((al, idx) => {
      lines.push(`${idx + 1}. [${al.severity}] **${al.category}** — \`${al.indicator}\`: ${al.detail}`);
    });
    lines.push('');
  }

  if (yaraHits.length > 0) {
    lines.push('## Caza de Firmas YARA en RAM');
    yaraHits.forEach((yh, idx) => {
      lines.push(
        `${idx + 1}. \`${yh.rule_name}\` — **${yh.spyware_family}** (${yh.cve}) en \`${yh.artifact}\` [${(yh.matched_strings || []).join(', ')}]: ${yh.description}`,
      );
    });
    lines.push('');
  }

  if (sockets.length > 0) {
    lines.push(`## Sockets Públicos de Kernel (${hardeningReport?.live_sockets_total || sockets.length})`);
    sockets.slice(0, 25).forEach((s) => {
      const flag = s.cti_match ? ` [CTI MATCH: ${s.spyware_family}]` : '';
      lines.push(`- \`${s.remote_ip}:${s.remote_port}\` (${s.state})${flag}`);
    });
    lines.push('');
  }

  if (result.findings.length === 0 && anomalies.length === 0 && yaraHits.length === 0) {
    lines.push('## Resultado\nSin indicadores de compromiso detectados frente al corpus CTI público ni anomalías conductuales.');
  } else {
    if (result.findings.length > 0) {
      lines.push('## Coincidencias CTI Detectadas');
      result.findings.forEach((f, idx) => {
        lines.push(`${idx + 1}. \`${f.ioc_value}\` — **${f.spyware_family}** (${f.artifact_origin})`);
      });
      lines.push('');
    }
    if (anomalies.length > 0) {
      lines.push('## Anomalías Conductuales y Manifest.db Detectadas (RAM)');
      anomalies.forEach((a, idx) => {
        lines.push(`${idx + 1}. [${a.severity}] \`${a.indicator}\` — **${a.category}** (\`${a.artifact}\`): ${a.detail}`);
      });
    }
  }

  return lines.join('\n');
}

const ADB_PATH_STORAGE_KEY = 'omega_custom_adb_path';

export function MvtVerifierPanel({ onAskInChat }) {
  const fileInputRef = useRef(null);

  const [deviceTab, setDeviceTab] = useState('android');
  const [inputMode, setInputMode] = useState('upload');
  const [manualText, setManualText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState(null);
  const [customAdbPath, setCustomAdbPath] = useState(() => {
    try {
      return localStorage.getItem(ADB_PATH_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [selectedSerial, setSelectedSerial] = useState('');
  const [usbDevice, setUsbDevice] = useState(null);
  const [iosStatus, setIosStatus] = useState(null);
  const [refreshingUsb, setRefreshingUsb] = useState(false);
  const [scanningUsb, setScanningUsb] = useState(false);
  const [scanningIos, setScanningIos] = useState(false);
  const [installingAdb, setInstallingAdb] = useState(false);
  const [scanningPc, setScanningPc] = useState(false);
  const [encryptedBackupPrompt, setEncryptedBackupPrompt] = useState(null);
  const [backupPassword, setBackupPassword] = useState('');
  const [unlockingBackup, setUnlockingBackup] = useState(false);
  const [backupUnlockError, setBackupUnlockError] = useState('');
  const [showAndroidGuide, setShowAndroidGuide] = useState(true);
  const [showAdvancedCmds, setShowAdvancedCmds] = useState(false);
  const [copiedHintKey, setCopiedHintKey] = useState('');
  const [hardeningReport, setHardeningReport] = useState(null);
  const [confirmingDns, setConfirmingDns] = useState(false);
  const [hardeningDns, setHardeningDns] = useState(false);
  const [dnsAppliedNote, setDnsAppliedNote] = useState('');
  const [syncingStix, setSyncingStix] = useState(false);
  const [stixSyncNote, setStixSyncNote] = useState('');

  const hasDesktopBridge =
    typeof window !== 'undefined' && Boolean(window.omegaDesktop?.checkAdbStatus);
  const desktopPlatform = typeof window !== 'undefined' ? window.omegaDesktop?.platform || 'win32' : 'win32';

  const fetchUsbStatuses = useCallback(
    async (explicitPath = customAdbPath, includeIos = false, isManual = false) => {
      if (!window.omegaDesktop?.checkAdbStatus) return;
      if (isManual) setRefreshingUsb(true);
      try {
        const status = await window.omegaDesktop.checkAdbStatus(explicitPath);
        setUsbDevice(status);
        if (status?.devices?.length) {
          const readyDev = status.devices.find((d) => d.state === 'device') || status.devices[0];
          setSelectedSerial((prev) =>
            prev && status.devices.some((d) => d.serial === prev) ? prev : readyDev.serial,
          );
        }
      } catch {
        setUsbDevice({
          available: false,
          connected: false,
          status_code: 'ADB_NOT_FOUND',
          devices: [],
          reason: 'No se pudo consultar el estado del puente ADB.',
        });
      }

      if (includeIos && window.omegaDesktop?.checkIosStatus) {
        try {
          const ios = await window.omegaDesktop.checkIosStatus();
          setIosStatus(ios);
        } catch {
          setIosStatus({
            tools_available: false,
            connected: false,
            status_code: 'TOOLS_MISSING',
            local_backups: [],
            reason: 'No se pudo consultar el puente USB iOS.',
          });
        }
      }
      if (isManual) setRefreshingUsb(false);
    },
    [customAdbPath],
  );

  useEffect(() => {
    if (!window.omegaDesktop?.checkAdbStatus || deviceTab === 'pc') return undefined;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      void fetchUsbStatuses(customAdbPath, deviceTab === 'ios', false);
    };

    const initTimer = setTimeout(tick, 0);
    const timer = setInterval(tick, deviceTab === 'ios' ? 7500 : 5000);
    return () => {
      cancelled = true;
      clearTimeout(initTimer);
      clearInterval(timer);
    };
  }, [customAdbPath, deviceTab, fetchUsbStatuses]);

  function applyLiveDeviceResult(liveRes, fallbackLabel) {
    const dev = liveRes.device_summary || {};
    const unifiedSource = liveRes.triage
      ? {
          ...liveRes.triage,
          yara_hits: liveRes.yara_hits?.length ? liveRes.yara_hits : liveRes.triage.yara_hits,
          behavioral_anomalies: liveRes.behavioral_anomalies?.length
            ? liveRes.behavioral_anomalies
            : liveRes.triage.behavioral_anomalies,
          timeline: liveRes.timeline?.length ? liveRes.timeline : liveRes.triage.timeline,
          timeline_summary: liveRes.timeline_summary || liveRes.triage.timeline_summary,
        }
      : {};
    let computedLabel = `${[dev.manufacturer, dev.model].filter(Boolean).join(' ').trim() || fallbackLabel} (ADB USB)`;
    if (dev.platform === 'ios') {
      computedLabel = `${[dev.name, dev.ios_version ? `iOS ${dev.ios_version}` : ''].filter(Boolean).join(' · ') || fallbackLabel}`;
    } else if (dev.platform === 'pc') {
      const osTag = dev.host_os === 'win32' ? 'Windows' : dev.host_os === 'darwin' ? 'macOS' : 'PC';
      computedLabel = `${osTag} · ${dev.hostname || 'Esta computadora'}`;
    }
    setHardeningReport(liveRes);
    setResult(normalizeParallelResult(unifiedSource, [], computedLabel));
  }

  async function handleCopyCommand(key, value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedHintKey(key);
      setTimeout(() => setCopiedHintKey(''), 1600);
    } catch {
      // Clipboard unavailable
    }
  }

  async function handlePickAdbBinary() {
    if (!window.omegaDesktop?.pickAdbBinary) return;
    setErrorMsg('');
    try {
      const pick = await window.omegaDesktop.pickAdbBinary();
      if (pick?.canceled) return;
      if (!pick?.valid || !pick.adb_path) {
        setErrorMsg(pick?.error || 'El ejecutable seleccionado no es un binario ADB válido.');
        return;
      }
      setCustomAdbPath(pick.adb_path);
      try {
        localStorage.setItem(ADB_PATH_STORAGE_KEY, pick.adb_path);
      } catch {
        // Ignore storage errors
      }
      await fetchUsbStatuses(pick.adb_path, false);
    } catch (err) {
      setErrorMsg(err?.message || 'No se pudo verificar la ruta de ADB.');
    }
  }

  async function handleLiveUsbScan() {
    if (!window.omegaDesktop?.collectDeviceSnapshot || scanningUsb || isAnalyzing) return;
    setScanningUsb(true);
    setErrorMsg('');
    setConfirmingDns(false);
    setDnsAppliedNote('');
    try {
      const snapshot = await window.omegaDesktop.collectDeviceSnapshot({
        customPath: customAdbPath,
        serial: selectedSerial || usbDevice?.serial || '',
      });
      const liveRes = await analyzeLiveDeviceSnapshot(snapshot);
      applyLiveDeviceResult(liveRes, 'Dispositivo Android');
    } catch (err) {
      setErrorMsg(err?.message || 'Error auditando el dispositivo Android por USB.');
    } finally {
      setScanningUsb(false);
    }
  }

  async function handleLiveIosScan() {
    if (!window.omegaDesktop?.collectIosSnapshot || scanningIos || isAnalyzing) return;
    setScanningIos(true);
    setErrorMsg('');
    setConfirmingDns(false);
    setDnsAppliedNote('');
    try {
      const snapshot = await window.omegaDesktop.collectIosSnapshot({
        udid: iosStatus?.device?.udid || '',
      });
      const liveRes = await analyzeLiveDeviceSnapshot(snapshot);
      applyLiveDeviceResult(liveRes, 'iPhone / iPad (USB Lockdown)');
    } catch (err) {
      setErrorMsg(err?.message || 'Error auditando el dispositivo iOS por USB.');
    } finally {
      setScanningIos(false);
    }
  }

  async function handleInstallPortableAdb() {
    if (!window.omegaDesktop?.installPortableAdb || installingAdb) return;
    setInstallingAdb(true);
    setErrorMsg('');
    try {
      const res = await window.omegaDesktop.installPortableAdb();
      if (!res?.ok || !res.adbPath) {
        setErrorMsg(res?.error || 'No se pudo instalar el conector USB de Google.');
        return;
      }
      setCustomAdbPath(res.adbPath);
      try {
        window.localStorage?.setItem('omega_custom_adb_path', res.adbPath);
      } catch {
        // Ignore storage restrictions
      }
      await fetchUsbStatuses(res.adbPath, false, true);
    } catch (err) {
      setErrorMsg(err?.message || 'Error instalando conector ADB automático.');
    } finally {
      setInstallingAdb(false);
    }
  }

  async function handlePcLiveAudit() {
    if (!window.omegaDesktop?.collectPcAuditSnapshot || scanningPc || isAnalyzing) return;
    setScanningPc(true);
    setErrorMsg('');
    try {
      const col = await window.omegaDesktop.collectPcAuditSnapshot();
      if (!col?.ok || !col.snapshot) {
        setErrorMsg(col?.error || 'No se pudo leer el estado de seguridad de esta computadora.');
        return;
      }
      const pcRes = await analyzePcLiveSnapshot(col.snapshot);
      applyLiveDeviceResult(pcRes, 'Auditoría Local PC (en RAM)');
    } catch (err) {
      setErrorMsg(err?.message || 'No se pudo completar la auditoría de esta computadora.');
    } finally {
      setScanningPc(false);
    }
  }

  async function analyzeIosBackupDirectory(backupPath, fallbackMeta = null) {
    if (!window.omegaDesktop?.readIosBackupManifest || scanningIos || isAnalyzing) return;
    setScanningIos(true);
    setErrorMsg('');
    setBackupUnlockError('');
    try {
      const manifestData = await window.omegaDesktop.readIosBackupManifest(backupPath);
      if (manifestData.encrypted || !manifestData.manifest_b64) {
        if (!manifestData.manifest_plist_b64) {
          setErrorMsg(
            `El respaldo "${manifestData.backup?.deviceName || 'iOS'}" está cifrado pero falta Manifest.plist para desbloquearlo en memoria.`,
          );
          return;
        }
        setBackupPassword('');
        setEncryptedBackupPrompt({
          backupPath,
          meta: manifestData.backup || fallbackMeta,
          manifestB64: manifestData.manifest_b64 || '',
          manifestPlistB64: manifestData.manifest_plist_b64,
        });
        return;
      }
      const targetPlan = await resolveIosManifestTargets(manifestData.manifest_b64);
      if (targetPlan.encrypted) {
        if (!manifestData.manifest_plist_b64) {
          setErrorMsg(targetPlan.detail || 'Manifest.db cifrado; requiere contraseña de respaldo.');
          return;
        }
        setBackupPassword('');
        setEncryptedBackupPrompt({
          backupPath,
          meta: manifestData.backup || fallbackMeta,
          manifestB64: manifestData.manifest_b64 || '',
          manifestPlistB64: manifestData.manifest_plist_b64,
        });
        return;
      }
      const backupPayload = await window.omegaDesktop.readIosBackupArtifacts({
        backupPath,
        targets: targetPlan.targets || [],
      });
      const liveRes = await analyzeLiveDeviceSnapshot(backupPayload);
      applyLiveDeviceResult(liveRes, 'Respaldo iOS (Manifest.db en RAM)');
    } catch (err) {
      setErrorMsg(err?.message || 'No se pudo analizar la carpeta de respaldo iOS en RAM.');
    } finally {
      setScanningIos(false);
    }
  }

  async function handleUnlockEncryptedBackup(e) {
    e?.preventDefault?.();
    if (!encryptedBackupPrompt || !backupPassword || unlockingBackup) return;
    setUnlockingBackup(true);
    setBackupUnlockError('');
    const pwd = backupPassword;
    try {
      const targetPlan = await resolveEncryptedIosManifestTargets(
        encryptedBackupPrompt.manifestPlistB64,
        encryptedBackupPrompt.manifestB64,
        pwd,
      );
      setBackupPassword('');
      const backupPayload = await window.omegaDesktop.readIosBackupArtifacts({
        backupPath: encryptedBackupPrompt.backupPath,
        targets: targetPlan.targets || [],
        encrypted: true,
      });
      const liveRes = await analyzeLiveDeviceSnapshot({
        ...backupPayload,
        ios_unlock_token: targetPlan.unlock_token || '',
      });
      setEncryptedBackupPrompt(null);
      applyLiveDeviceResult(liveRes, 'Respaldo iOS Encriptado (en RAM)');
    } catch (err) {
      setBackupUnlockError(
        err?.message || 'No se pudo abrir la copia encriptada. Revisa tu contraseña de respaldo.',
      );
    } finally {
      setBackupPassword('');
      setUnlockingBackup(false);
    }
  }

  async function handlePickIosBackupDir() {
    if (!window.omegaDesktop?.pickIosBackupDir || scanningIos || isAnalyzing) return;
    setErrorMsg('');
    try {
      const pick = await window.omegaDesktop.pickIosBackupDir();
      if (pick?.canceled) return;
      if (!pick?.valid || !pick.backup?.path) {
        setErrorMsg(pick?.error || 'La carpeta seleccionada no es un respaldo iOS válido.');
        return;
      }
      await analyzeIosBackupDirectory(pick.backup.path);
    } catch (err) {
      setErrorMsg(err?.message || 'No se pudo inspeccionar la carpeta seleccionada.');
    }
  }

  async function handleConfirmHardenDns() {
    if (!window.omegaDesktop?.hardenPrivateDns || hardeningDns) return;
    setHardeningDns(true);
    setErrorMsg('');
    try {
      const res = await window.omegaDesktop.hardenPrivateDns({
        customPath: customAdbPath,
        serial: selectedSerial || usbDevice?.serial || '',
      });
      setConfirmingDns(false);
      if (res?.applied) {
        setDnsAppliedNote('DNS Privado cifrado (dns.quad9.net) aplicado en el dispositivo.');
        setHardeningReport((prev) => {
          if (!prev?.hardening_checks) return prev;
          return {
            ...prev,
            hardening_checks: prev.hardening_checks.map((chk) =>
              chk.control.includes('DNS Privado')
                ? {
                    ...chk,
                    status: 'OK',
                    value: 'dns.quad9.net',
                    detail: 'Resoluciones DNS cifradas mediante dns.quad9.net (DoT aplicado).',
                  }
                : chk,
            ),
          };
        });
      }
    } catch (err) {
      setErrorMsg(err?.message || 'No se pudo configurar el DNS Privado en el dispositivo.');
    } finally {
      setHardeningDns(false);
    }
  }

  async function handleSyncStix() {
    if (syncingStix) return;
    setSyncingStix(true);
    setErrorMsg('');
    try {
      const res = await syncStixFeeds();
      const inserted = res.iocs_inserted ?? 0;
      const total = res.total_db_iocs ?? res.iocs_parsed ?? 0;
      setStixSyncNote(
        inserted > 0
          ? `+${inserted} IOCs nuevos · ${total} activos (${res.files_scanned} feeds STIX2)`
          : `${total} IOCs STIX2 activos`,
      );
    } catch (err) {
      setErrorMsg(err?.message || 'Error sincronizando feeds STIX 2.1.');
    } finally {
      setSyncingStix(false);
    }
  }

  async function analyzeFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setIsAnalyzing(true);
    setErrorMsg('');
    setHardeningReport(null);
    setConfirmingDns(false);
    setDnsAppliedNote('');
    try {
      const apiRes = await runParallelTriage(files);
      setHardeningReport(apiRes);
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
    setConfirmingDns(false);
    setDnsAppliedNote('');
    setErrorMsg('');
  }

  function handleExportMarkdown() {
    if (!result) return;
    const md = buildForensicMarkdownReport(result, hardeningReport);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
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
      `Investiga esta anomalía conductual detectada en memoria RAM:`,
      `- Categoría: ${anom.category} (${anom.severity})`,
      `- Indicador: ${anom.indicator}`,
      `- Artefacto: ${anom.artifact || 'Dispositivo USB ADB'}`,
      `- Detalle: ${anom.detail}`,
      `¿Cómo se asocia este patrón con implantes como Pegasus o Predator en Citizen Lab / Amnesty Tech y qué pasos forenses recomiendas para validarlo?`,
    ].join('\n');
    onAskInChat(prompt);
  }

  function handleInvestigateYara(hit) {
    if (!onAskInChat) return;
    const prompt = [
      `Investiga esta detección de firma YARA en RAM:`,
      `- Regla: ${hit.rule_name}`,
      `- Familia / Vector: ${hit.spyware_family} (${hit.cve})`,
      `- Artefacto: ${hit.artifact}`,
      `- Cadenas coincidentes: ${(hit.matched_strings || []).join(', ')}`,
      `¿Qué técnica de explotación o persistencia representa en reportes de Citizen Lab / Amnesty Tech y qué contención inmediata aplicaría?`,
    ].join('\n');
    onAskInChat(prompt);
  }

  // --- ESTADO 2: RESULTADO ---
  if (result) {
    const hasMatches = result.matchesCount > 0;
    const behavioralAnomalies = result.behavioralAnomalies || [];
    const yaraHits = result.yaraHits || [];
    const abuseAlerts = hardeningReport?.abuse_alerts || [];
    const liveSockets = hardeningReport?.live_sockets || [];

    const hasBehavioral = behavioralAnomalies.length > 0;
    const hasYara = yaraHits.length > 0;
    const hasCriticalAlert =
      abuseAlerts.some((a) => a.severity === 'CRITICAL') ||
      hardeningReport?.hardening_checks?.some((c) => c.status === 'CRITICAL');
    const hasCriticalBehavioral =
      behavioralAnomalies.some((a) => a.severity === 'CRITICAL') ||
      result.verdictCode === 'BEHAVIORAL_ZERO_DAY_SUSPICION';

    let verdictDot = 'bg-[#30D158] shadow-[0_0_10px_rgba(48,209,88,0.5)]';
    let verdictHeadingTone = 'text-[#F5F5F7]';
    if (hasMatches || hasCriticalBehavioral || hasYara || hasCriticalAlert) {
      verdictDot = 'bg-[#FF453A] shadow-[0_0_10px_rgba(255,69,58,0.55)]';
      verdictHeadingTone = 'text-[#FF6961]';
    } else if (hasBehavioral || abuseAlerts.length > 0) {
      verdictDot = 'bg-[#FF9F0A] shadow-[0_0_10px_rgba(255,159,10,0.45)]';
      verdictHeadingTone = 'text-[#FFD60A]';
    }

    const isPcPlatform = hardeningReport?.device_summary?.platform === 'pc';

    let verdictTitle = 'Sin indicadores de spyware detectados';
    const signalParts = [];
    if (hasMatches) signalParts.push(`${result.matchesCount} coincidencia${result.matchesCount === 1 ? '' : 's'} CTI`);
    if (hasYara) signalParts.push(`${yaraHits.length} firma${yaraHits.length === 1 ? '' : 's'} YARA`);
    if (hasBehavioral) signalParts.push(`${behavioralAnomalies.length} anomalía${behavioralAnomalies.length === 1 ? '' : 's'} en RAM`);
    if (abuseAlerts.length > 0) {
      signalParts.push(`${abuseAlerts.length} alerta${abuseAlerts.length === 1 ? '' : 's'} de ${isPcPlatform ? 'equipo' : 'dispositivo'}`);
    }
    if (signalParts.length > 0) {
      if (isPcPlatform && !hasMatches && !hasYara && !hasBehavioral) {
        verdictTitle = `Sin spyware conocido · ${signalParts.join(' · ')}`;
      } else {
        verdictTitle = `Detectado: ${signalParts.join(' · ')}`;
      }
    } else if (isPcPlatform && hasCriticalAlert) {
      verdictTitle = 'Sin spyware conocido · Protecciones apagadas';
    }

    const hasAnyThreatSignal = hasMatches || hasBehavioral || hasYara || abuseAlerts.length > 0 || hasCriticalAlert;
    const isCriticalOverall = hasMatches || hasCriticalBehavioral || hasYara || hasCriticalAlert;

    let verdictBody =
      'Ninguno de los artefactos analizados coincide con dominios, procesos, firmas YARA ni hashes públicos asociados a spyware comercial conocidos por OMEGA.';
    if ((isPcPlatform || hasBehavioral || hasYara) && result.rationale) {
      verdictBody = result.rationale;
    } else if (hasMatches) {
      verdictBody =
        'Los indicadores listados abajo coinciden con infraestructura o artefactos documentados en investigaciones públicas. Revisa el origen exacto para descartar navegación incidental antes de tomar medidas de contención.';
    } else if (abuseAlerts.length > 0) {
      verdictBody =
        'Se detectaron privilegios activos de accesibilidad, administración de dispositivo o conexiones kernel anómalas que requieren verificación inmediata.';
    }

    const canHardenDnsInDesktop =
      typeof window !== 'undefined' && Boolean(window.omegaDesktop?.hardenPrivateDns);

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

        {/* 1 · Veredicto y contención */}
        <section className="space-y-2">
          <span className="px-1 block text-[11px] font-medium tracking-[0.06em] uppercase text-[#8E8E93]">
            1 · Veredicto y contención
          </span>
          <div className="apple-group rounded-[15px] p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {!hasAnyThreatSignal ? (
                  <ShieldCheck className="h-5 w-5 text-[#30D158] shrink-0" />
                ) : (
                  <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${verdictDot}`} />
                )}
                <h2 className={`text-[17px] font-semibold tracking-[-0.015em] ${isCriticalOverall ? 'text-[#FF6961]' : verdictHeadingTone}`}>
                  {verdictTitle}
                </h2>
              </div>
              {result.verdictCode && (
                <span
                  className={`font-tech shrink-0 rounded-full border px-2.5 py-0.5 text-[10.5px] font-medium ${
                    isCriticalOverall
                      ? 'border-[#FF453A]/35 bg-[#FF453A]/12 text-[#FF6961]'
                      : hasAnyThreatSignal
                        ? 'border-[#FF9F0A]/35 bg-[#FF9F0A]/12 text-[#FFD60A]'
                        : 'border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]'
                  }`}
                >
                  {result.verdictCode}
                </span>
              )}
            </div>

            <p className="text-[13.5px] text-[#D1D1D6] leading-relaxed">
              {verdictBody}
            </p>

            {result.recommendedActions?.length > 0 && (
              <div className="rounded-[11px] border border-white/[0.06] bg-white/[0.025] px-4 py-3 space-y-2">
                <div className="text-[11.5px] font-semibold tracking-[-0.01em] text-[#8E8E93]">
                  Acciones de contención recomendadas
                </div>
                <ul className="space-y-1.5">
                  {result.recommendedActions.map((act, idx) => (
                    <li key={`${idx}-${act.slice(0, 24)}`} className="flex items-start gap-2 text-[12.5px] text-[#E5E5EA] leading-snug">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#2F6FED] shrink-0" />
                      <span>{act}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="font-tech pt-3 border-t border-white/[0.06] text-[11.5px] text-[#8E8E93]">
              {result.sourceLabel}
              {result.filesAnalyzed ? ` · ${result.filesAnalyzed} artefacto(s) en RAM` : ''}
              {` · ${result.analyzedCount} indicadores evaluados`}
              {hardeningReport?.cached_dns_count > 0 ? ` · ${hardeningReport.cached_dns_count} DNS en caché` : ''}
              {' · 0 bytes guardados'}
            </div>
          </div>
        </section>

        {(errorMsg || dnsAppliedNote) && (
          <div
            className={`rounded-[12px] border px-4 py-2.5 text-[12.5px] ${
              errorMsg
                ? 'border-[#FF453A]/35 bg-[#FF453A]/10 text-[#FF6961]'
                : 'border-[#30D158]/35 bg-[#30D158]/10 text-[#30D158]'
            }`}
          >
            {errorMsg || dnsAppliedNote}
          </div>
        )}

        {/* 2 · Anomalías conductuales y hardening */}
        <section className="space-y-2">
          <div className="px-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-medium tracking-[0.06em] uppercase text-[#8E8E93]">
              2 · Anomalías conductuales y hardening
            </span>
            {hardeningReport?.device_summary &&
              Object.keys(hardeningReport.device_summary).length > 0 && (
                <span className="font-tech text-[11px] text-[#8E8E93]">
                  {hardeningReport.device_summary.platform === 'ios'
                    ? `iOS ${hardeningReport.device_summary.ios_version || 'N/D'} · ${hardeningReport.device_summary.model || 'iPhone/iPad'}`
                    : hardeningReport.device_summary.platform === 'pc'
                      ? `${hardeningReport.device_summary.host_os === 'win32' ? 'Windows' : hardeningReport.device_summary.host_os || 'PC'} · ${hardeningReport.device_summary.hostname || 'Equipo local'}`
                      : `Android ${hardeningReport.device_summary.android_version || 'N/D'} · Parche ${hardeningReport.device_summary.security_patch || 'N/D'}`}
                </span>
              )}
          </div>

          <div className="apple-group rounded-[13px] divide-y divide-white/[0.06] overflow-hidden">
            {hardeningReport?.hardening_checks?.map((chk) => {
              let badgeCls = 'border-white/[0.1] bg-white/[0.04] text-[#8E8E93]';
              if (chk.status === 'OK') {
                badgeCls = 'border-[#30D158]/35 bg-[#30D158]/12 text-[#30D158]';
              } else if (chk.status === 'CRITICAL') {
                badgeCls = 'border-[#FF453A]/40 bg-[#FF453A]/15 text-[#FF6961]';
              } else if (chk.status === 'WARN') {
                badgeCls = 'border-[#FF9F0A]/35 bg-[#FF9F0A]/12 text-[#FFD60A]';
              }

              const showDnsAction =
                canHardenDnsInDesktop &&
                hardeningReport?.device_summary?.platform !== 'ios' &&
                chk.control.includes('DNS Privado') &&
                chk.status !== 'OK';

              return (
                <div key={chk.control} className="px-4 py-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-4">
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

                  {showDnsAction && (
                    <div className="pt-1 flex flex-wrap items-center gap-2">
                      {!confirmingDns ? (
                        <button
                          type="button"
                          onClick={() => setConfirmingDns(true)}
                          className="rounded-[8px] border border-[#2F6FED]/40 bg-[#2F6FED]/15 px-3 py-1.5 text-[12px] font-medium text-[#8AB4FF] hover:bg-[#2F6FED]/24 active:scale-[0.97] transition-all cursor-pointer"
                        >
                          Activar DNS Privado (Quad9 DoT)
                        </button>
                      ) : (
                        <>
                          <span className="text-[12px] text-[#D1D1D6]">
                            ¿Forzar <span className="font-tech text-[#F5F5F7]">dns.quad9.net</span> por USB?
                          </span>
                          <button
                            type="button"
                            disabled={hardeningDns}
                            onClick={handleConfirmHardenDns}
                            className="rounded-[8px] bg-[#2F6FED] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#3B7BF2] disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            {hardeningDns && <Loader2 className="h-3 w-3 animate-spin" />}
                            <span>Confirmar</span>
                          </button>
                          <button
                            type="button"
                            disabled={hardeningDns}
                            onClick={() => setConfirmingDns(false)}
                            className="rounded-[8px] border border-white/[0.1] px-2.5 py-1 text-[12px] text-[#8E8E93] hover:text-[#F5F5F7] cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {abuseAlerts.map((al, idx) => (
              <div key={`${al.indicator}-${idx}`} className="px-4 py-3.5 flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`font-tech rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${
                        al.severity === 'CRITICAL'
                          ? 'border-[#FF453A]/40 bg-[#FF453A]/15 text-[#FF6961]'
                          : 'border-[#FF9F0A]/40 bg-[#FF9F0A]/15 text-[#FFD60A]'
                      }`}
                    >
                      {al.severity}
                    </span>
                    <span className="text-[13px] font-medium text-[#F5F5F7]">
                      {al.category}
                    </span>
                  </div>
                  <div className="font-tech text-[12.5px] text-[#E5E5EA] break-all">
                    {al.indicator}
                  </div>
                  <p className="text-[12.5px] text-[#8E8E93] leading-relaxed">
                    {al.detail}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={!onAskInChat}
                  onClick={() => handleInvestigateAnomaly({ ...al, artifact: result.sourceLabel })}
                  className="shrink-0 rounded-[8px] border border-[#2F6FED]/40 bg-[#2F6FED]/15 px-3 py-1.5 text-[12px] font-medium text-[#8AB4FF] hover:bg-[#2F6FED]/24 disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
                >
                  Investigar en Preguntar
                </button>
              </div>
            ))}

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

            {liveSockets.length > 0 && (
              <div>
                <div className="px-4 py-2.5 bg-white/[0.02] flex items-center justify-between gap-3">
                  <span className="text-[12px] font-medium text-[#D1D1D6]">
                    {isPcPlatform ? 'Conexiones TCP activas' : 'Sockets kernel activos /proc/net/tcp'} ({hardeningReport?.live_sockets_total || liveSockets.length})
                  </span>
                  <span className="font-tech text-[11px] text-[#8E8E93]">
                    {isPcPlatform
                      ? `${liveSockets.filter((s) => s.process_name).length} con proceso`
                      : `${hardeningReport?.cached_dns_count || 0} DNS en caché`}
                  </span>
                </div>
                <div className="divide-y divide-white/[0.05] max-h-[220px] overflow-y-auto">
                  {liveSockets.slice(0, 20).map((sock, idx) => (
                    <div
                      key={`${sock.remote_ip}-${sock.remote_port}-${idx}`}
                      className="px-4 py-2 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex items-center gap-2.5">
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                            sock.cti_match ? 'bg-[#FF453A]' : 'bg-[#8E8E93]/60'
                          }`}
                        />
                        <span className="font-tech text-[12.5px] text-[#F5F5F7] truncate">
                          {sock.remote_ip}:{sock.remote_port}
                          {sock.process_name ? ` · ${sock.process_name}` : ''}
                        </span>
                        {sock.cti_match && (
                          <span className="rounded-full border border-[#FF453A]/35 bg-[#FF453A]/12 px-2 py-0.5 text-[10.5px] font-medium text-[#FF6961]">
                            CTI · {sock.spyware_family}
                          </span>
                        )}
                      </div>
                      <span className="font-tech shrink-0 text-[11px] text-[#8E8E93]">
                        {sock.state}{sock.local_port ? ` · local:${sock.local_port}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!hardeningReport?.hardening_checks?.length &&
              !abuseAlerts.length &&
              !hasBehavioral &&
              !liveSockets.length && (
                <div className="px-4 py-3.5 text-[12.5px] text-[#8E8E93]">
                  Sin anomalías conductuales, privilegios anómalos ni brechas de endurecimiento detectadas en este análisis.
                </div>
              )}
          </div>

          {liveSockets.length > 0 && (
            <OmegaWebIntelCard
              compact
              activeNet4Ips={liveSockets.map((s) => s.remote_ip).filter(Boolean)}
              onAskInChat={onAskInChat}
              title="Cruzar IPv4 activas contra artículo CTI reciente"
              subtitle={
                isPcPlatform
                  ? 'Carga en RAM un reporte de Citizen Lab, Amnesty Tech o Google TAG y compara sus IPv4 (net4) contra las conexiones salientes de esta computadora.'
                  : 'Carga en RAM un reporte de Citizen Lab, Amnesty Tech o Google TAG y compara sus IPv4 (net4) contra las conexiones abiertas en /proc/net/tcp.'
              }
            />
          )}

          {result.timeline?.length > 0 && (
            <div className="apple-group rounded-[13px] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#F5F5F7]">
                  <Clock className="h-3.5 w-3.5 text-[#8AB4FF]" />
                  <span>
                    Línea temporal correlacionada en RAM ({result.timelineSummary?.events_total || result.timeline.length} eventos)
                  </span>
                </span>
                {result.timelineSummary?.chains_detected > 0 && (
                  <span className="rounded-full border border-[#FF453A]/35 bg-[#FF453A]/12 px-2 py-0.5 text-[10.5px] font-medium text-[#FF6961]">
                    {result.timelineSummary.chains_detected} cadena(s) 0-day sospechosa(s)
                  </span>
                )}
              </div>
              <div className="divide-y divide-white/[0.04] max-h-48 overflow-y-auto">
                {result.timeline.slice(-8).reverse().map((ev, idx) => (
                  <div key={`${ev.timestamp}-${ev.kind}-${idx}`} className="px-4 py-2 flex items-start justify-between gap-3 text-[11.5px]">
                    <div className="min-w-0">
                      <span className={`font-medium ${ev.suspicious ? 'text-[#FF6961]' : 'text-[#E5E5EA]'}`}>
                        {ev.actor}
                      </span>{' '}
                      <span className="text-[#8E8E93]">{ev.detail}</span>
                    </div>
                    <span className="font-tech text-[10.5px] text-[#8E8E93] shrink-0">
                      {ev.timestamp}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 3 · Coincidencias CTI y firmas YARA */}
        <section className="space-y-2">
          <span className="px-1 block text-[11px] font-medium tracking-[0.06em] uppercase text-[#8E8E93]">
            3 · Coincidencias CTI y firmas YARA ({yaraHits.length + result.findings.length})
          </span>
          <div className="apple-group rounded-[13px] divide-y divide-white/[0.06] overflow-hidden">
            {yaraHits.map((hit, idx) => (
              <div key={`${hit.rule_name}-${hit.artifact}-${idx}`} className="px-4 py-3.5 flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-tech text-[13px] font-medium text-[#F5F5F7]">
                      {hit.rule_name}
                    </span>
                    <span className="rounded-full border border-[#FF453A]/35 bg-[#FF453A]/12 px-2.5 py-0.5 text-[11px] font-medium text-[#FF6961]">
                      YARA · {hit.spyware_family}
                    </span>
                    {hit.cve && (
                      <span className="font-tech rounded-[6px] border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10.5px] text-[#8E8E93]">
                        {hit.cve}
                      </span>
                    )}
                  </div>
                  <p className="text-[12.5px] text-[#D1D1D6] leading-relaxed">
                    {hit.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {(hit.matched_strings || []).map((tok) => (
                      <span
                        key={tok}
                        className="font-tech rounded-[5px] border border-white/[0.08] bg-black/35 px-2 py-0.5 text-[11px] text-[#8AB4FF]"
                      >
                        {tok}
                      </span>
                    ))}
                    <span className="font-tech text-[11px] text-[#8E8E93] truncate">
                      · {hit.artifact}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!onAskInChat}
                  onClick={() => handleInvestigateYara(hit)}
                  className="shrink-0 rounded-[8px] border border-[#2F6FED]/40 bg-[#2F6FED]/15 px-3 py-1.5 text-[12px] font-medium text-[#8AB4FF] hover:bg-[#2F6FED]/24 disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
                >
                  Investigar en Preguntar
                </button>
              </div>
            ))}

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

            {!hasYara && !hasMatches && (
              <div className="px-4 py-3.5 text-[12.5px] text-[#8E8E93]">
                0 firmas YARA activadas y 0 coincidencias contra campañas conocidas (STIX 2.1 / Citizen Lab / Amnesty Tech).
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  // --- ESTADO 1: INICIAL (Centrado vertical y horizontalmente) ---
  return (
    <div className="omega-fade-up flex-1 flex flex-col items-center justify-center py-3">
      <div className="w-full max-w-[740px]">
        <header className="text-center mb-3.5">
          <h1 className="text-[26px] sm:text-[29px] font-semibold tracking-[-0.028em] leading-[1.15] text-[#F5F5F7]">
            Verificar integridad del dispositivo
          </h1>
          <p className="mt-1.5 text-[13.5px] text-[#8E8E93] leading-[1.5] max-w-[540px] mx-auto">
            Revisa tu celular por cable USB o con una copia guardada. Todo se analiza de forma temporal, sin guardar tus fotos ni archivos en esta computadora.
          </p>
        </header>

        {/* Disparador 1: Analizar dispositivo USB (Android + iPhone / iPad guiado) */}
        {(() => {
          const isMac = desktopPlatform === 'darwin';
          const installAdbCmd = isMac
            ? 'brew install android-platform-tools'
            : 'winget install Google.PlatformTools';
          const installIosCmd = isMac
            ? 'pip3 install pymobiledevice3'
            : 'pip install pymobiledevice3';

          let statusPillLabel = 'Solo app Desktop';
          let statusPillTone = 'border-white/[0.08] bg-white/[0.04] text-[#8E8E93]';
          if (deviceTab === 'pc') {
            statusPillLabel = hasDesktopBridge ? 'Auditoría de solo lectura' : 'Solo en OMEGA Desktop';
            statusPillTone = hasDesktopBridge
              ? 'border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]'
              : 'border-white/[0.1] bg-white/[0.04] text-[#8E8E93]';
          } else if (hasDesktopBridge) {
            if (deviceTab === 'android') {
              if (usbDevice?.connected) {
                statusPillLabel = `Conectado · ${usbDevice.model || 'Android'}`;
                statusPillTone = 'border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]';
              } else if (usbDevice?.status_code === 'UNAUTHORIZED') {
                statusPillLabel = 'Toca "Permitir" en tu celular';
                statusPillTone = 'border-[#FF9F0A]/35 bg-[#FF9F0A]/12 text-[#FFD60A]';
              } else if (usbDevice?.status_code === 'ADB_NOT_FOUND') {
                statusPillLabel = 'Falta conector USB en PC';
                statusPillTone = 'border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-[#FFD60A]';
              } else {
                statusPillLabel = 'Esperando cable USB';
              }
            } else if (iosStatus?.connected) {
              statusPillLabel = `Conectado · ${iosStatus.device?.name || 'iPhone'}`;
              statusPillTone = 'border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]';
            } else if (iosStatus?.status_code === 'UNPAIRED') {
              statusPillLabel = 'Toca "Confiar" en tu iPhone';
              statusPillTone = 'border-[#FF9F0A]/35 bg-[#FF9F0A]/12 text-[#FFD60A]';
            } else if (iosStatus?.tools_available) {
              statusPillLabel = 'Esperando cable USB';
            } else {
              statusPillLabel = 'Guía por archivo o copia';
            }
          } else if (deviceTab === 'ios') {
            statusPillLabel = 'Sube tu archivo abajo';
          }

          return (
            <div className="apple-group mb-3.5 rounded-[14px] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-8 w-8 rounded-[9px] bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0">
                    {deviceTab === 'pc' ? (
                      <Laptop className={`h-4 w-4 ${hasDesktopBridge ? 'text-[#30D158]' : 'text-[#8E8E93]'}`} />
                    ) : (
                      <Smartphone
                        className={`h-4 w-4 ${
                          hasDesktopBridge &&
                          ((deviceTab === 'android' && usbDevice?.connected) ||
                            (deviceTab === 'ios' && iosStatus?.connected))
                            ? 'text-[#30D158]'
                            : 'text-[#8E8E93]'
                        }`}
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium tracking-[-0.01em] text-[#F5F5F7]">
                        {deviceTab === 'pc' ? 'Revisar esta computadora' : 'Analizar dispositivo USB'}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${statusPillTone}`}>
                        {statusPillLabel}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="apple-segmented inline-flex rounded-[8px] p-0.5">
                    <button
                      type="button"
                      onClick={() => setDeviceTab('android')}
                      className={`rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium transition-all cursor-pointer ${
                        deviceTab === 'android'
                          ? 'apple-segmented-active'
                          : 'text-[#8E8E93] hover:text-[#F5F5F7]'
                      }`}
                    >
                      Android
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeviceTab('ios')}
                      className={`rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium transition-all cursor-pointer ${
                        deviceTab === 'ios'
                          ? 'apple-segmented-active'
                          : 'text-[#8E8E93] hover:text-[#F5F5F7]'
                      }`}
                    >
                      iPhone / iPad
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeviceTab('pc')}
                      className={`rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium transition-all cursor-pointer ${
                        deviceTab === 'pc'
                          ? 'apple-segmented-active'
                          : 'text-[#8E8E93] hover:text-[#F5F5F7]'
                      }`}
                    >
                      Esta PC
                    </button>
                  </div>

                  {hasDesktopBridge && deviceTab !== 'pc' && (
                    <button
                      type="button"
                      disabled={refreshingUsb}
                      onClick={() => fetchUsbStatuses(customAdbPath, deviceTab === 'ios', true)}
                      title="Volver a buscar teléfono conectado"
                      aria-label="Volver a buscar teléfono conectado"
                      className="h-7 w-7 rounded-[8px] border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center text-[#8E8E93] hover:text-[#F5F5F7] disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${refreshingUsb ? 'animate-spin text-[#8AB4FF]' : ''}`} />
                    </button>
                  )}
                </div>
              </div>

              {deviceTab === 'android' ? (
                <div className="space-y-2.5">
                  {hasDesktopBridge && usbDevice?.connected ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[11px] border border-[#30D158]/20 bg-[#30D158]/[0.05] px-3.5 py-2.5">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[12.5px] font-medium text-[#F5F5F7]">
                            {usbDevice.model || 'Teléfono Android'}
                          </span>
                          <span className="font-tech text-[11px] text-[#8E8E93]">
                            {selectedSerial || usbDevice.serial}
                          </span>
                          {usbDevice.devices?.length > 1 && (
                            <select
                              value={selectedSerial}
                              onChange={(e) => setSelectedSerial(e.target.value)}
                              className="font-tech rounded-[6px] border border-white/[0.12] bg-black/50 px-1.5 py-0.5 text-[11px] text-[#E5E5EA]"
                            >
                              {usbDevice.devices
                                .filter((d) => d.state === 'device')
                                .map((d) => (
                                  <option key={d.serial} value={d.serial}>
                                    {d.model} ({d.serial})
                                  </option>
                                ))}
                            </select>
                          )}
                        </div>
                        <p className="text-[12px] text-[#8E8E93]">
                          Teléfono listo. OMEGA revisará conexiones activas, permisos especiales y protección del sistema sin borrar ni cambiar nada.
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={scanningUsb || isAnalyzing}
                        onClick={handleLiveUsbScan}
                        className="shrink-0 rounded-[9px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.35),inset_0_1px_0_rgba(255,255,255,0.24)] hover:bg-[#3B7BF2] disabled:opacity-50 px-3.5 py-1.5 text-[12px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer"
                      >
                        {scanningUsb && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        <span>{scanningUsb ? 'Revisando teléfono...' : 'Iniciar revisión segura'}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[11px] border border-white/[0.06] bg-white/[0.025] px-3.5 py-2.5">
                        <p className="text-[12.5px] text-[#D1D1D6] leading-relaxed flex-1 min-w-[220px]">
                          {hasDesktopBridge
                            ? usbDevice?.reason || 'Buscando conector USB de Android en tu computadora...'
                            : 'Para revisar un Android por cable USB necesitas la app de escritorio OMEGA. En navegador web, puedes subir una copia abajo.'}
                        </p>

                        <button
                          type="button"
                          onClick={() => setShowAndroidGuide((v) => !v)}
                          className="shrink-0 inline-flex items-center gap-1 rounded-[7px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-[#8AB4FF] hover:bg-white/[0.08] transition-colors cursor-pointer"
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                          <span>
                            {showAndroidGuide ||
                            usbDevice?.status_code === 'ADB_NOT_FOUND' ||
                            usbDevice?.status_code === 'UNAUTHORIZED'
                              ? 'Ocultar pasos'
                              : 'Ver guía visual'}
                          </span>
                        </button>
                      </div>

                      {(showAndroidGuide ||
                        usbDevice?.status_code === 'ADB_NOT_FOUND' ||
                        usbDevice?.status_code === 'UNAUTHORIZED') && (
                        <div className="rounded-[12px] border border-white/[0.06] bg-black/30 p-3 space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                            <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                              <AndroidStepVisual step={1} />
                              <div>
                                <div className="text-[12px] font-medium text-[#F5F5F7]">
                                  1. Activa el modo revisión
                                </div>
                                <p className="mt-0.5 text-[11.5px] text-[#8E8E93] leading-snug">
                                  En tu teléfono ve a <span className="text-[#D1D1D6]">Ajustes → Acerca del teléfono</span>, toca 7 veces <span className="text-[#D1D1D6]">N.º de compilación</span> y enciende <span className="text-[#D1D1D6]">Depuración USB</span>.
                                </p>
                              </div>
                            </div>

                            <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                              <AndroidStepVisual step={2} adbReady={Boolean(usbDevice?.adb_path)} />
                              <div>
                                <div className="text-[12px] font-medium text-[#F5F5F7]">
                                  2. Conecta tu cable USB
                                </div>
                                <p className="mt-0.5 text-[11.5px] text-[#8E8E93] leading-snug">
                                  {usbDevice?.adb_path
                                    ? 'Tu computadora ya está lista. Conecta el teléfono con cable de datos y elige "Transferir archivos".'
                                    : 'Usa un cable USB de datos (no solo de carga) y descarga o señala el conector gratuito abajo.'}
                                </p>
                              </div>
                            </div>

                            <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                              <AndroidStepVisual step={3} />
                              <div>
                                <div className="text-[12px] font-medium text-[#F5F5F7]">
                                  3. Toca “Permitir”
                                </div>
                                <p className="mt-0.5 text-[11.5px] text-[#8E8E93] leading-snug">
                                  Desbloquea la pantalla del teléfono. Cuando salga la ventana de permiso, marca confiar y pulsa <span className="text-[#D1D1D6]">Permitir</span>.
                                </p>
                              </div>
                            </div>
                          </div>

                          {hasDesktopBridge && (
                            <div className="pt-0.5 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                {window.omegaDesktop?.installPortableAdb && !usbDevice?.adb_path && (
                                  <button
                                    type="button"
                                    disabled={installingAdb}
                                    onClick={handleInstallPortableAdb}
                                    className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#2F6FED] px-3 py-1 text-[11.5px] font-medium text-white hover:bg-[#3B7BF2] disabled:opacity-50 transition-colors cursor-pointer"
                                  >
                                    {installingAdb ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Download className="h-3.5 w-3.5" />
                                    )}
                                    <span>
                                      {installingAdb ? 'Descargando conector Google...' : 'Instalar conector automático (Google)'}
                                    </span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={handlePickAdbBinary}
                                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#2F6FED]/35 bg-[#2F6FED]/15 px-2.5 py-1 text-[11.5px] font-medium text-[#8AB4FF] hover:bg-[#2F6FED]/24 transition-colors cursor-pointer"
                                >
                                  <FolderOpen className="h-3.5 w-3.5" />
                                  <span>
                                    {usbDevice?.adb_path ? 'Cambiar conector adb.exe' : 'Elegir adb.exe en mi PC'}
                                  </span>
                                </button>

                                {window.omegaDesktop?.openExternalUrl && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      window.omegaDesktop.openExternalUrl(
                                        'https://developer.android.com/tools/releases/platform-tools',
                                      )
                                    }
                                    className="inline-flex items-center gap-1 rounded-[8px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-[#E5E5EA] hover:bg-white/[0.08] transition-colors cursor-pointer"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    <span>Descargar conector oficial (Google)</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => setShowAdvancedCmds((v) => !v)}
                                  className="inline-flex items-center gap-1 rounded-[8px] border border-white/[0.06] bg-transparent px-2 py-1 text-[11px] text-[#8E8E93] hover:text-[#D1D1D6] transition-colors cursor-pointer"
                                >
                                  <span>{showAdvancedCmds ? 'Ocultar comandos' : 'Opciones para técnicos'}</span>
                                </button>
                              </div>

                              {showAdvancedCmds && (
                                <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-[11px] text-[#8E8E93]">
                                  <span>Instalar por terminal:</span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyCommand('adb', installAdbCmd)}
                                    className="font-tech inline-flex items-center gap-1.5 rounded-[7px] border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] text-[#E5E5EA] hover:bg-white/[0.08] transition-colors cursor-pointer"
                                  >
                                    {copiedHintKey === 'adb' ? (
                                      <Check className="h-3 w-3 text-[#30D158]" />
                                    ) : (
                                      <Copy className="h-3 w-3 text-[#8E8E93]" />
                                    )}
                                    <span>{installAdbCmd}</span>
                                  </button>
                                  {usbDevice?.adb_path && (
                                    <span className="font-tech text-[#30D158] truncate max-w-full">
                                      Detectado: {usbDevice.adb_path}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : deviceTab === 'ios' ? (
                <div className="space-y-2.5">
                  {hasDesktopBridge && iosStatus?.connected ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[11px] border border-[#30D158]/20 bg-[#30D158]/[0.05] px-3.5 py-2.5">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[12.5px] font-medium text-[#F5F5F7]">
                            {iosStatus.device?.name || 'iPhone / iPad'}
                          </span>
                          <span className="font-tech text-[11px] text-[#8E8E93]">
                            {iosStatus.device?.model} · iOS {iosStatus.device?.ios_version || 'N/D'}
                          </span>
                        </div>
                        <p className="text-[12px] text-[#8E8E93]">
                          iPhone conectado por cable. Revisaremos reportes internos recientes y registro de fallos en memoria temporal sin tocar tus fotos ni mensajes.
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={scanningIos || isAnalyzing}
                        onClick={handleLiveIosScan}
                        className="shrink-0 rounded-[9px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.35),inset_0_1px_0_rgba(255,255,255,0.24)] hover:bg-[#3B7BF2] disabled:opacity-50 px-3.5 py-1.5 text-[12px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer"
                      >
                        {scanningIos && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        <span>{scanningIos ? 'Revisando iPhone...' : 'Iniciar revisión de iPhone'}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-[12px] border border-white/[0.06] bg-black/30 p-3 space-y-3">
                      <p className="text-[12.5px] text-[#D1D1D6] leading-relaxed">
                        {hasDesktopBridge
                          ? iosStatus?.reason || 'Apple bloquea el análisis directo sin permisos especiales. Sigue estas 3 imágenes para revisar tu iPhone sin riesgo:'
                          : 'Por seguridad de Apple, el navegador web no puede leer un iPhone por cable. Sigue estos 3 pasos fáciles en tu iPhone y sube el archivo abajo:'}
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                        <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                          <IosStepVisual step={1} />
                          <div>
                            <div className="text-[12px] font-medium text-[#F5F5F7]">
                              1. Genera el archivo en iPhone
                            </div>
                            <p className="mt-0.5 text-[11.5px] text-[#8E8E93] leading-snug">
                              Ve a <span className="text-[#D1D1D6]">Ajustes → Privacidad y seguridad → Análisis y mejoras → Datos de análisis</span>, o pulsa <span className="text-[#D1D1D6]">Vol+ · Vol- + Lateral</span> 1 segundo.
                            </p>
                          </div>
                        </div>

                        <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                          <IosStepVisual step={2} />
                          <div>
                            <div className="text-[12px] font-medium text-[#F5F5F7]">
                              2. O usa una copia en PC
                            </div>
                            <p className="mt-0.5 text-[11.5px] text-[#8E8E93] leading-snug">
                              Si conectas tu iPhone por cable para hacer una copia en esta PC, desbloquéalo y toca <span className="text-[#D1D1D6]">Confiar</span> con tu código PIN.
                            </p>
                          </div>
                        </div>

                        <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                          <IosStepVisual step={3} />
                          <div>
                            <div className="text-[12px] font-medium text-[#F5F5F7]">
                              3. Súbelo sin guardar nada
                            </div>
                            <p className="mt-0.5 text-[11.5px] text-[#8E8E93] leading-snug">
                              Envía el archivo de diagnóstico a tu PC o elige la carpeta de respaldo. Se revisa al instante y no se guarda nada privado.
                            </p>
                          </div>
                        </div>
                      </div>

                      {hasDesktopBridge && (
                        <div className="pt-0.5 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={scanningIos || isAnalyzing}
                              onClick={handlePickIosBackupDir}
                              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#2F6FED]/35 bg-[#2F6FED]/15 px-2.5 py-1 text-[11.5px] font-medium text-[#8AB4FF] hover:bg-[#2F6FED]/24 disabled:opacity-50 transition-colors cursor-pointer"
                            >
                              {scanningIos ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <FolderOpen className="h-3.5 w-3.5" />
                              )}
                              <span>Elegir carpeta de respaldo iPhone</span>
                            </button>

                            {!iosStatus?.tools_available && (
                              <button
                                type="button"
                                onClick={() => setShowAdvancedCmds((v) => !v)}
                                className="inline-flex items-center gap-1 rounded-[8px] border border-white/[0.06] bg-transparent px-2 py-1 text-[11px] text-[#8E8E93] hover:text-[#D1D1D6] transition-colors cursor-pointer"
                              >
                                <span>{showAdvancedCmds ? 'Ocultar comandos' : 'Opciones para técnicos (cable directo)'}</span>
                              </button>
                            )}
                          </div>

                          {showAdvancedCmds && !iosStatus?.tools_available && (
                            <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-[11px] text-[#8E8E93]">
                              <span>Para conexión USB Lockdown directa (requiere Apple Devices / iTunes):</span>
                              <button
                                type="button"
                                onClick={() => handleCopyCommand('ios', installIosCmd)}
                                className="font-tech inline-flex items-center gap-1.5 rounded-[7px] border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] text-[#E5E5EA] hover:bg-white/[0.08] transition-colors cursor-pointer"
                              >
                                {copiedHintKey === 'ios' ? (
                                  <Check className="h-3 w-3 text-[#30D158]" />
                                ) : (
                                  <Copy className="h-3 w-3 text-[#8E8E93]" />
                                )}
                                <span>{installIosCmd}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {hasDesktopBridge && iosStatus?.local_backups?.length > 0 && (
                    <div className="rounded-[11px] border border-white/[0.06] bg-black/30 divide-y divide-white/[0.05] overflow-hidden">
                      <div className="px-3 py-1.5 text-[11px] font-medium text-[#8E8E93]">
                        Copias de seguridad encontradas en tu computadora ({iosStatus.local_backups.length})
                      </div>
                      {iosStatus.local_backups.slice(0, 3).map((bk) => (
                        <div key={bk.id} className="px-3 py-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[12px] font-medium text-[#F5F5F7] truncate">
                                {bk.deviceName}
                              </span>
                              {bk.iosVersion && (
                                <span className="font-tech text-[10.5px] text-[#8E8E93]">
                                  iOS {bk.iosVersion}
                                </span>
                              )}
                              {bk.encrypted && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 px-1.5 py-0.5 text-[10px] text-[#FFD60A]">
                                  <Lock className="h-2.5 w-2.5" /> Protegida con clave
                                </span>
                              )}
                            </div>
                          </div>
                          {bk.encrypted ? (
                            <button
                              type="button"
                              disabled={scanningIos || isAnalyzing || unlockingBackup}
                              onClick={() => analyzeIosBackupDirectory(bk.path, bk)}
                              className="shrink-0 inline-flex items-center gap-1 rounded-[7px] border border-[#FF9F0A]/35 bg-[#FF9F0A]/15 px-2.5 py-1 text-[11px] font-medium text-[#FFD60A] hover:bg-[#FF9F0A]/25 disabled:opacity-50 cursor-pointer"
                            >
                              <KeyRound className="h-3 w-3" />
                              <span>Desbloquear en RAM</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={scanningIos || isAnalyzing}
                              onClick={() => analyzeIosBackupDirectory(bk.path, bk)}
                              className="shrink-0 rounded-[7px] bg-[#2F6FED] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#3B7BF2] disabled:opacity-50 cursor-pointer"
                            >
                              Revisar copia ahora
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {encryptedBackupPrompt && (
                    <form
                      onSubmit={handleUnlockEncryptedBackup}
                      className="rounded-[11px] border border-[#FF9F0A]/30 bg-[#121217] p-3.5 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#F5F5F7]">
                            <KeyRound className="h-3.5 w-3.5 text-[#FFD60A]" />
                            <span>
                              Contraseña de la copia «{encryptedBackupPrompt.meta?.deviceName || 'iPhone'}»
                            </span>
                          </div>
                          <p className="text-[11px] text-[#8E8E93]">
                            Solo se usa en memoria temporal (RAM) para revisar SMS, Safari, DataUsage y perfiles. Nunca se guarda ni sale de tu computadora.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="password"
                          autoFocus
                          value={backupPassword}
                          onChange={(e) => setBackupPassword(e.target.value)}
                          placeholder="Contraseña de respaldo iTunes / Finder"
                          className="flex-1 min-w-[200px] rounded-[8px] border border-white/[0.12] bg-black/50 px-3 py-1.5 text-[12.5px] text-[#F5F5F7] placeholder-[#6E6E73] focus:border-[#2F6FED] focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={!backupPassword || unlockingBackup}
                          className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#2F6FED] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#3B7BF2] disabled:opacity-50 cursor-pointer"
                        >
                          {unlockingBackup && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          <span>Desbloquear y revisar en RAM</span>
                        </button>
                        <button
                          type="button"
                          disabled={unlockingBackup}
                          onClick={() => {
                            setEncryptedBackupPrompt(null);
                            setBackupPassword('');
                            setBackupUnlockError('');
                          }}
                          className="rounded-[8px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] text-[#8E8E93] hover:text-[#F5F5F7] cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>

                      {backupUnlockError && (
                        <p className="text-[11.5px] text-[#FF6961]">{backupUnlockError}</p>
                      )}
                    </form>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[12px] text-[#8E8E93] leading-relaxed">
                    Revisa si esta computadora Windows o macOS tiene programas ocultos sin firma digital, persistencia silenciosa en WMI (técnica asociada a <span className="text-[#D1D1D6]">Candiru / Predator</span>) o conexiones externas sospechosas — sin leer tus archivos personales.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="rounded-[10px] border border-white/[0.07] bg-black/35 p-2.5 flex flex-col gap-2">
                      <PcStepVisual step={1} />
                      <div className="text-[11.5px] font-medium text-[#F5F5F7]">
                        1. Conexiones externas
                      </div>
                      <p className="text-[11px] text-[#8E8E93] leading-snug">
                        Cruza direcciones IP abiertas por tus aplicaciones contra campañas conocidas y reglas YARA.
                      </p>
                    </div>
                    <div className="rounded-[10px] border border-white/[0.07] bg-black/35 p-2.5 flex flex-col gap-2">
                      <PcStepVisual step={2} />
                      <div className="text-[11.5px] font-medium text-[#F5F5F7]">
                        2. Persistencia oculta
                      </div>
                      <p className="text-[11px] text-[#8E8E93] leading-snug">
                        Inspecciona eventos WMI, tareas programadas y ejecutables sin firma en carpetas temporales.
                      </p>
                    </div>
                    <div className="rounded-[10px] border border-white/[0.07] bg-black/35 p-2.5 flex flex-col gap-2">
                      <PcStepVisual step={3} />
                      <div className="text-[11.5px] font-medium text-[#F5F5F7]">
                        3. Escudos del sistema
                      </div>
                      <p className="text-[11px] text-[#8E8E93] leading-snug">
                        Verifica que Defender, Firewall, UAC y SmartScreen (o Gatekeeper/SIP) sigan activos.
                      </p>
                    </div>
                  </div>

                  {hasDesktopBridge && window.omegaDesktop?.collectPcAuditSnapshot ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                      <span className="text-[11.5px] text-[#8E8E93]">
                        Análisis instantáneo en RAM · Tarda ~2 segundos · 0 modificaciones en tu equipo.
                      </span>
                      <button
                        type="button"
                        disabled={scanningPc || isAnalyzing}
                        onClick={handlePcLiveAudit}
                        className="rounded-[9px] bg-[#2F6FED] shadow-[0_4px_12px_rgba(47,111,237,0.32)] hover:bg-[#3B7BF2] disabled:opacity-50 px-3.5 py-1.5 text-[12px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer"
                      >
                        {scanningPc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Laptop className="h-3.5 w-3.5" />}
                        <span>{scanningPc ? 'Revisando equipo...' : 'Analizar esta computadora'}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[11.5px] text-[#8E8E93]">
                      La revisión directa de procesos y WMI locales está disponible en la aplicación de escritorio <span className="text-[#D1D1D6]">OMEGA Desktop</span>.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* Disparador 2: Cargar respaldo / volcado */}
        <div className="omega-capsule rounded-[16px] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span className="text-[13.5px] font-medium tracking-[-0.01em] text-[#F5F5F7]">
              Cargar respaldo / volcado
            </span>

            <button
              type="button"
              disabled={syncingStix}
              onClick={handleSyncStix}
              title="Actualizar base de amenazas conocidas en memoria"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-[#8E8E93] hover:bg-white/[0.08] hover:text-[#F5F5F7] disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 ${syncingStix ? 'animate-spin text-[#5E9BFF]' : ''}`} />
              <span>{stixSyncNote || (syncingStix ? 'Actualizando...' : 'Feeds STIX 2.1')}</span>
            </button>
          </div>

          <div className="mb-3">
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
                Subir archivo del teléfono
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
                Pegar enlaces o datos sospechosos
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
              className={`rounded-[12px] border border-dashed py-5 px-6 flex flex-col items-center justify-center text-center transition-all duration-200 cursor-pointer ${
                isDragging
                  ? 'border-[#2F6FED] bg-[#2F6FED]/12'
                  : 'border-white/[0.12] bg-black/25 hover:border-[#2F6FED]/55 hover:bg-black/35'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".json,.db,.sqlite,.sqlite3,.txt,.log,.ips,.crash,.tar.gz,.tgz,.tar,.zip,.pkpass,.pdf,.gif"
                onChange={(e) => analyzeFiles(e.target.files)}
                className="hidden"
              />

              <div className="mb-2.5 h-10 w-10 rounded-[11px] bg-white/[0.045] border border-white/[0.08] flex items-center justify-center">
                {isAnalyzing ? (
                  <Loader2 className="h-5 w-5 text-[#5E9BFF] animate-spin" />
                ) : (
                  <Upload className="h-4.5 w-4.5 text-[#8E8E93]" />
                )}
              </div>

              <p className="text-[13.5px] font-medium text-[#F5F5F7]">
                {isAnalyzing
                  ? 'Revisando archivos en memoria temporal...'
                  : 'Arrastra aquí el archivo de diagnóstico o copia de tu celular'}
              </p>

              {!isAnalyzing && (
                <p className="mt-1 text-[11.5px] text-[#8E8E93]">
                  Acepta reportes de iPhone (.tar.gz, .ips), respaldos (.db, .zip) o archivos de análisis (.json)
                </p>
              )}

              <button
                type="button"
                disabled={isAnalyzing}
                onClick={handleRunSample}
                className="mt-3 rounded-full border border-[#2F6FED]/35 bg-[#2F6FED]/12 px-3 py-1 text-[12px] font-medium text-[#8AB4FF] hover:bg-[#2F6FED]/20 disabled:opacity-50 transition-colors cursor-pointer"
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
                  placeholder={'https://enlace-sospechoso.com\n185.220.101.44\nPega un dominio, dirección IP o texto extraño por línea'}
                  className="font-tech w-full resize-none bg-transparent border-0 p-0 text-[12.5px] leading-relaxed text-[#F5F5F7] placeholder-[#6E6E73] focus:outline-none"
                />
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-[12px] text-[#8E8E93]">
                  Uno por línea · Enlaces web, dominios, IPs o códigos
                </span>
                <button
                  type="submit"
                  disabled={isAnalyzing || !manualText.trim()}
                  className="rounded-[9px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.35),inset_0_1px_0_rgba(255,255,255,0.24)] hover:bg-[#3B7BF2] disabled:bg-white/[0.07] disabled:text-[#6E6E73] disabled:shadow-none px-4 py-1.5 text-[12.5px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  {isAnalyzing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Revisar</span>
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
