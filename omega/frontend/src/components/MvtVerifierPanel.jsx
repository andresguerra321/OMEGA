import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Link2,
  Loader2,
  Lock,
  RefreshCw,
  Shield,
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
import { collectNativeHostSnapshot, getMobileDesktopBridge, isDesktopApp } from '../lib/desktopBridge';
import { AndroidStepVisual, IosStepVisual, PcStepVisual } from './DeviceSetupVisuals';
import { MobileUsbAuditCard } from './MobileUsbAuditCard';
import { OmegaWebIntelCard } from './OmegaWebIntelCard';
import { useScrollReveal } from '../lib/useScrollReveal';
import {
  stripUnsafeChars,
  validateIocList,
  validateUploadFile,
} from '../lib/validators';
import { useSingleFlight } from '../lib/useSingleFlight';
import { ContainmentButton, EmergencyGuidance } from './ContainmentPanel';
import {
  ActionConfirmationBanner,
  PanelEmptyState,
  PanelErrorBanner,
  PanelSkeleton,
} from './PanelStatePrimitives';

import { DEFAULT_OS_SCOPE_NOTICE, buildForensicMarkdownReport, isInspectableNetworkIndicator, normalizeManualResult, normalizeParallelResult } from '../lib/mvtNormalizers';

export function MvtVerifierPanel({
  onAskInChat,
  onVerifyLink,
  onOpenThreat,
  initialTab = 'android',
  preloadedAudit = null,
  onAuditUpdate,
}) {
  const fileInputRef = useRef(null);
  const lastPreloadedRef = useRef(null);
  const resultContainerRef = useRef(null);

  const [deviceTab, setDeviceTab] = useState(initialTab || 'android');
  const [inputMode, setInputMode] = useState('upload');
  const [manualText, setManualText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState(null);
  const [customAdbPath, setCustomAdbPath] = useState('');
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
  const [exportNote, setExportNote] = useState('');
  const [dismissedResultKey, setDismissedResultKey] = useState('');
  const guard = useSingleFlight();

  const hasPcTelemetryBridge = isDesktopApp();
  const desktopBridge = useMemo(() => getMobileDesktopBridge(), []);
  const hasDesktopBridge = Boolean(desktopBridge);
  const desktopPlatform =
    typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '') ? 'darwin' : 'win32';

  useScrollReveal(resultContainerRef, [result?.sourceLabel, result?.verdictCode]);

  const fetchUsbStatuses = useCallback(async (adbPath = '', ios = false, showLoading = false) => {
    if (!desktopBridge) return;
    if (showLoading) setRefreshingUsb(true);
    try {
      if (ios) {
        setIosStatus(await desktopBridge.checkIosStatus());
      } else {
        const status = await desktopBridge.checkAdbStatus(adbPath);
        setUsbDevice(status);
        setSelectedSerial((previous) => status.devices?.some((d) => d.serial === previous && d.state === 'device')
          ? previous : status.serial || '');
      }
    } catch (err) {
      if (ios) setIosStatus(null);
      else setUsbDevice(null);
      if (showLoading) setErrorMsg(err?.message || String(err));
    } finally {
      if (showLoading) setRefreshingUsb(false);
    }
  }, [desktopBridge]);

  useEffect(() => {
    const handlePanicPurge = () => {
      setManualText('');
      setResult(null);
      setHardeningReport(null);
      setCustomAdbPath('');
      setBackupPassword('');
      setEncryptedBackupPrompt(false);
      setErrorMsg('');
    };
    window.addEventListener('omega:panic-purge', handlePanicPurge);
    return () => window.removeEventListener('omega:panic-purge', handlePanicPurge);
  }, []);

  useEffect(() => {
    if (!hasDesktopBridge || deviceTab === 'pc') return undefined;
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
  }, [customAdbPath, deviceTab, fetchUsbStatuses, hasDesktopBridge]);

  const applyLiveDeviceResult = useCallback(
    (liveRes, fallbackLabel, notifyParent = true) => {
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
      setExportNote('');
      setDismissedResultKey('');
      if (notifyParent) {
        onAuditUpdate?.(liveRes);
      }
    },
    [onAuditUpdate]
  );

  useEffect(() => {
    if (preloadedAudit && preloadedAudit !== lastPreloadedRef.current) {
      lastPreloadedRef.current = preloadedAudit;
      const t = setTimeout(() => {
        applyLiveDeviceResult(preloadedAudit, 'Auditoría Local PC (en RAM)', false);
      }, 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [preloadedAudit, applyLiveDeviceResult]);

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
    if (!desktopBridge) return;
    try {
      const picked = await desktopBridge.pickAdbBinary();
      if (picked.canceled) return;
      if (!picked.valid) throw new Error(picked.error || 'No se pudo validar ADB.');
      setCustomAdbPath(picked.adb_path);
      setErrorMsg('');
      await fetchUsbStatuses(picked.adb_path, false, true);
    } catch (err) {
      setErrorMsg(err?.message || String(err));
    }
  }

  async function handleLiveUsbScan() {
    if (!desktopBridge || scanningUsb || isAnalyzing) return;
    await guard(async () => {
      setScanningUsb(true);
      setErrorMsg('');
      try {
        const snapshot = await desktopBridge.collectDeviceSnapshot(customAdbPath, selectedSerial || usbDevice?.serial);
        applyLiveDeviceResult(await analyzeLiveDeviceSnapshot(snapshot), 'Android');
      } catch (err) {
        setErrorMsg(err?.message || String(err));
      } finally {
        setScanningUsb(false);
      }
    });
  }

  async function handleLiveIosScan() {
    if (!desktopBridge || scanningIos || isAnalyzing) return;
    await guard(async () => {
      setScanningIos(true);
      setErrorMsg('');
      try {
        const snapshot = await desktopBridge.collectIosSnapshot(iosStatus?.device?.udid);
        applyLiveDeviceResult(await analyzeLiveDeviceSnapshot(snapshot), 'iPhone / iPad');
      } catch (err) {
        setErrorMsg(err?.message || String(err));
      } finally {
        setScanningIos(false);
      }
    });
  }

  async function handleInstallPortableAdb() {
    if (!desktopBridge || installingAdb) return;
    await guard(async () => {
      setInstallingAdb(true);
      setErrorMsg('');
      try {
        const installed = await desktopBridge.installPortableAdb();
        if (!installed.ok) throw new Error(installed.error || 'No se pudo instalar ADB.');
        setCustomAdbPath(installed.adbPath);
        await fetchUsbStatuses(installed.adbPath, false, true);
      } catch (err) {
        setErrorMsg(err?.message || String(err));
      } finally {
        setInstallingAdb(false);
      }
    });
  }

  async function handlePcLiveAudit() {
    if (!hasPcTelemetryBridge || scanningPc || isAnalyzing) return;
    await guard(async () => {
      setScanningPc(true);
      setErrorMsg('');
      try {
        const col = await collectNativeHostSnapshot();
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
    });
  }

  async function analyzeIosBackupDirectory(backupPath, meta) {
    if (!desktopBridge || scanningIos || isAnalyzing) return;
    await guard(async () => {
      setScanningIos(true);
      setErrorMsg('');
      setEncryptedBackupPrompt(null);
      setBackupPassword('');
      setBackupUnlockError('');
      try {
        const manifest = await desktopBridge.readIosBackupManifest(backupPath);
        if (manifest.encrypted) {
          setEncryptedBackupPrompt({ backupPath, meta: manifest.backup || meta });
          return;
        }
        const resolved = await resolveIosManifestTargets(manifest.manifest_b64);
        const snapshot = await desktopBridge.readIosBackupArtifacts(backupPath, false, resolved.targets);
        applyLiveDeviceResult(await analyzeLiveDeviceSnapshot(snapshot), 'Respaldo iOS');
      } catch (err) {
        setErrorMsg(err?.message || String(err));
      } finally {
        setScanningIos(false);
      }
    });
  }

  async function handleUnlockEncryptedBackup(e) {
    e?.preventDefault?.();
    if (!encryptedBackupPrompt || !backupPassword || unlockingBackup) return;
    await guard(async () => {
      setUnlockingBackup(true);
      setBackupUnlockError('');
      const password = backupPassword;
      setBackupPassword('');
      try {
        const { backupPath } = encryptedBackupPrompt;
        const manifest = await desktopBridge.readIosBackupManifest(backupPath);
        const resolved = await resolveEncryptedIosManifestTargets(
          manifest.manifest_plist_b64, manifest.manifest_b64, password,
        );
        if (!resolved.unlock_token) throw new Error('No se recibió la sesión de desbloqueo del respaldo.');
        const snapshot = await desktopBridge.readIosBackupArtifacts(backupPath, true, resolved.targets);
        snapshot.ios_unlock_token = resolved.unlock_token;
        applyLiveDeviceResult(await analyzeLiveDeviceSnapshot(snapshot), 'Respaldo iOS');
        setEncryptedBackupPrompt(null);
      } catch (err) {
        setBackupUnlockError(err?.message || String(err));
      } finally {
        setUnlockingBackup(false);
      }
    });
  }

  async function handlePickIosBackupDir() {
    if (!desktopBridge || scanningIos || isAnalyzing) return;
    try {
      const picked = await desktopBridge.pickIosBackupDir();
      if (picked.canceled) return;
      if (!picked.valid || !picked.backup?.path) throw new Error(picked.error || 'El respaldo seleccionado no es válido.');
      await analyzeIosBackupDirectory(picked.backup.path, picked.backup);
    } catch (err) {
      setErrorMsg(err?.message || String(err));
    }
  }

  async function handleConfirmHardenDns() {
    setConfirmingDns(false);
    if (!desktopBridge || hardeningDns) return;
    await guard(async () => {
      setHardeningDns(true);
      setDnsAppliedNote('');
      try {
        const response = await desktopBridge.hardenPrivateDns(customAdbPath, selectedSerial || usbDevice?.serial);
        if (!response.applied) throw new Error('No se pudo verificar la configuración de DNS privado.');
        setDnsAppliedNote('DNS privado dns.quad9.net aplicado y verificado.');
      } catch (err) {
        setErrorMsg(err?.message || String(err));
      } finally {
        setHardeningDns(false);
      }
    });
  }

  async function handleSyncStix() {
    if (syncingStix) return;
    await guard(async () => {
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
    });
  }

  async function analyzeFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || isAnalyzing) return;
    if (files.length > 12) {
      setErrorMsg('Máximo 12 archivos por lote de triaje.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const allowedExts = [
      '.json',
      '.db',
      '.sqlite',
      '.sqlite3',
      '.txt',
      '.log',
      '.ips',
      '.crash',
      '.tar.gz',
      '.tgz',
      '.tar',
      '.zip',
      '.pkpass',
      '.pdf',
      '.gif',
    ];
    for (const file of files) {
      const check = validateUploadFile(file, {
        extensions: allowedExts,
        maxBytes: 64 * 1024 * 1024,
        label: 'archivo forense',
      });
      if (!check.valid) {
        setErrorMsg(`${file.name ? `${file.name}: ` : ''}${check.error}`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    }
    await guard(async () => {
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
    });
  }

  async function handleAnalyzeText(e) {
    e.preventDefault();
    if (isAnalyzing) return;
    const validation = validateIocList(manualText, { maxLines: 200 });
    if (!validation.valid) {
      setErrorMsg(validation.error);
      return;
    }
    await guard(async () => {
      setIsAnalyzing(true);
      setErrorMsg('');
      setHardeningReport(null);
      try {
        const apiRes = await verifyMvtText(validation.accepted.join('\n'));
        setResult(normalizeManualResult(apiRes));
        setExportNote('');
        setDismissedResultKey('');
      } catch (err) {
        setErrorMsg(err?.message || 'No se pudieron evaluar los indicadores en memoria.');
      } finally {
        setIsAnalyzing(false);
      }
    });
  }

  function handleReset() {
    setResult(null);
    setHardeningReport(null);
    setConfirmingDns(false);
    setDnsAppliedNote('');
    setExportNote('');
    setDismissedResultKey('');
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
    setExportNote('Reporte forense descargado (.md).');
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
    const incomplete = result.verdictCode === 'INCOMPLETE' || result.coverageGaps?.length > 0;
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
    let verdictHeadingTone = 'text-[#F2F2F4]';
    if (hasMatches || hasCriticalBehavioral || hasYara || hasCriticalAlert) {
      verdictDot = 'bg-[#FF453A] shadow-[0_0_10px_rgba(255,69,58,0.55)]';
      verdictHeadingTone = 'text-[#FF6961]';
    } else if (hasBehavioral || abuseAlerts.length > 0) {
      verdictDot = 'bg-[#FF9F0A] shadow-[0_0_10px_rgba(255,159,10,0.45)]';
      verdictHeadingTone = 'text-[#FFD60A]';
    }

    const isPcPlatform = hardeningReport?.device_summary?.platform === 'pc';
    const cutoffDate =
      result.catalogFreshness?.catalog_cutoff_date ||
      hardeningReport?.catalog_freshness?.catalog_cutoff_date ||
      '2024-12-16';
    const scopeNotice =
      result.osScopeNotice ||
      hardeningReport?.os_scope_notice ||
      DEFAULT_OS_SCOPE_NOTICE;

    let verdictTitle = result.verdictLabel || `0 coincidencias vs catálogo CTI (corte ${cutoffDate})`;
    const signalParts = [];
    if (hasMatches) signalParts.push(`${result.matchesCount} coincidencia${result.matchesCount === 1 ? '' : 's'} CTI`);
    if (hasYara) signalParts.push(`${yaraHits.length} firma${yaraHits.length === 1 ? '' : 's'} YARA`);
    if (hasBehavioral) signalParts.push(`${behavioralAnomalies.length} anomalía${behavioralAnomalies.length === 1 ? '' : 's'} en RAM`);
    if (abuseAlerts.length > 0) {
      signalParts.push(`${abuseAlerts.length} alerta${abuseAlerts.length === 1 ? '' : 's'} de ${isPcPlatform ? 'equipo' : 'dispositivo'}`);
    }
    if (signalParts.length > 0) {
      if (isPcPlatform && !hasMatches && !hasYara && !hasBehavioral) {
        verdictTitle = `0 coincidencias vs catálogo (${cutoffDate}) · ${signalParts.join(' · ')}`;
      } else {
        verdictTitle = `Detectado: ${signalParts.join(' · ')}`;
      }
    } else if (isPcPlatform && hasCriticalAlert) {
      verdictTitle = `0 coincidencias CTI (${cutoffDate}) · Protecciones apagadas`;
    }

    const hasAnyThreatSignal = hasMatches || hasBehavioral || hasYara || abuseAlerts.length > 0 || hasCriticalAlert;
    const isCriticalOverall = hasMatches || hasCriticalBehavioral || hasYara || hasCriticalAlert;

    let verdictBody =
      `Ninguno de los artefactos analizados coincide con dominios, procesos, firmas YARA ni hashes públicos del catálogo con corte ${cutoffDate}. Esto indica ausencia de rastros en el análisis realizado, NO inmunidad del kernel ni ante exploits zero-click.`;
    if ((isPcPlatform || hasBehavioral || hasYara) && result.rationale) {
      verdictBody = result.rationale;
    } else if (hasMatches) {
      verdictBody =
        'Los indicadores listados abajo coinciden con infraestructura o artefactos documentados en investigaciones públicas. Revisa el origen exacto para descartar navegación incidental antes de tomar medidas de contención.';
    } else if (abuseAlerts.length > 0) {
      verdictBody =
        'Se detectaron privilegios activos de accesibilidad, administración de dispositivo o conexiones kernel anómalas que requieren verificación inmediata.';
    }

    const canHardenDnsInDesktop = false;

    return (
      <div
        ref={resultContainerRef}
        className="animate-fade-up w-full max-w-[700px] mx-auto pt-2 pb-12 space-y-6"
      >
        {/* Barra superior */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12.5px] font-medium text-[#F2F2F4] hover:bg-white/[0.08] active:scale-[0.97] transition-all cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#9A9AA2]" />
            <span>Nuevo análisis</span>
          </button>

          <button
            type="button"
            onClick={handleExportMarkdown}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12.5px] font-medium text-[#F2F2F4] hover:bg-white/[0.08] active:scale-[0.97] transition-all cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-[#9A9AA2]" />
            <span>Exportar (.md)</span>
          </button>
        </div>

        {(() => {
          const resultKey = `${result.sourceLabel}|${result.analyzedCount}|${result.verdictCode}`;
          if (dismissedResultKey === resultKey) return null;
          const bannerTone = isCriticalOverall ? 'alert' : (hasAnyThreatSignal || incomplete) ? 'info' : 'clean';
          return (
            <ActionConfirmationBanner
              tone={bannerTone}
              message={incomplete ? `Revisión incompleta: faltan datos de ${result.coverageGaps?.join(', ') || 'la captura del equipo'}. Los resultados disponibles no permiten completar el análisis.` : `Revisión en RAM completada (${result.analyzedCount} indicadores · ${result.matchesCount} coincidencia(s) CTI · ${yaraHits.length} YARA · ${behavioralAnomalies.length} anomalía(s) · 0 bytes en disco).`}
              onDismiss={() => setDismissedResultKey(resultKey)}
            />
          );
        })()}

        {exportNote && (
          <ActionConfirmationBanner
            tone="clean"
            message={exportNote}
            onDismiss={() => setExportNote('')}
          />
        )}

        {/* 1 · Veredicto y contención */}
        <section className="animate-fade-up space-y-2">
          <span className="px-1 block text-[11px] font-medium tracking-[0.06em] uppercase text-[#9A9AA2]">
            1 · Veredicto y contención
          </span>
          <div className="omega-glass-panel rounded-[15px] p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {!hasAnyThreatSignal && !incomplete ? (
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
                      : hasAnyThreatSignal || incomplete
                        ? 'border-[#FF9F0A]/35 bg-[#FF9F0A]/12 text-[#FFD60A]'
                        : 'border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]'
                  }`}
                >
                  {result.verdictCode}
                </span>
              )}
            </div>

            <p className="text-[13.5px] text-[#F2F2F4]/85 leading-relaxed">
              {verdictBody}
            </p>

            <div className="rounded-[11px] border border-[#2F6FED]/30 bg-[#1C2438]/40 px-3.5 py-2.5 text-[12px] text-[#D7DEEE] space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 font-tech text-[10.5px] uppercase tracking-[0.05em] text-[#9FB8F5]">
                <span>Alcance del análisis</span>
                <span>Corte de catálogo: {cutoffDate}</span>
              </div>
              <p className="leading-snug text-[#F2F2F4]/85">{scopeNotice}</p>
            </div>

            {result.recommendedActions?.length > 0 && (
              <div className="rounded-[11px] border border-white/[0.06] bg-white/[0.025] px-4 py-3 space-y-2">
                <div className="text-[11.5px] font-semibold tracking-[-0.01em] text-[#9A9AA2]">
                  Acciones de contención recomendadas
                </div>
                <ul className="space-y-1.5">
                  {result.recommendedActions.map((act, idx) => (
                    <li key={`${idx}-${act.slice(0, 24)}`} className="flex items-start gap-2 text-[12.5px] text-[#F2F2F4]/90 leading-snug">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#2F6FED] shrink-0" />
                      <span>{act}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="font-tech pt-3 border-t border-white/[0.06] text-[11.5px] text-[#9A9AA2]">
              {result.sourceLabel}
              {result.filesAnalyzed ? ` · ${result.filesAnalyzed} artefacto(s) en RAM` : ''}
              {` · ${result.analyzedCount} indicadores evaluados`}
              {hardeningReport?.cached_dns_count > 0 ? ` · ${hardeningReport.cached_dns_count} DNS en caché` : ''}
              {' · 0 bytes guardados'}
            </div>
          </div>
        </section>

        {errorMsg && (
          <PanelErrorBanner
            message={errorMsg}
            onDismiss={() => setErrorMsg('')}
          />
        )}

        {dnsAppliedNote && (
          <ActionConfirmationBanner
            tone="clean"
            message={dnsAppliedNote}
            onDismiss={() => setDnsAppliedNote('')}
          />
        )}

        {/* 2 · Anomalías conductuales y hardening */}
        <section className="animate-on-scroll space-y-2" data-delay="50">
          <div className="px-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-medium tracking-[0.06em] uppercase text-[#9A9AA2]">
              2 · Anomalías conductuales y hardening
            </span>
            {hardeningReport?.device_summary &&
              Object.keys(hardeningReport.device_summary).length > 0 && (
                <span className="font-tech text-[11px] text-[#9A9AA2]">
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
              let badgeCls = 'border-white/[0.1] bg-white/[0.04] text-[#9A9AA2]';
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
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-tech rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${badgeCls}`}>
                          {chk.status}
                        </span>
                        <span className="text-[13.5px] font-medium tracking-[-0.01em] text-[#F2F2F4]">
                          {chk.control}
                        </span>
                      </div>
                      <p className="text-[12.5px] text-[#9A9AA2] leading-relaxed break-words">
                        {chk.detail}
                      </p>
                    </div>
                    <span className="font-tech self-start shrink-0 rounded-[7px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-[#F2F2F4]/90">
                      {chk.value}
                    </span>
                  </div>

                  {showDnsAction && (
                    <div className="pt-1 flex flex-wrap items-center gap-2">
                      {!confirmingDns ? (
                        <button
                          type="button"
                          onClick={() => setConfirmingDns(true)}
                          className="rounded-[8px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/75 hover:shadow-[0_0_24px_rgba(47,111,237,0.25)] active:scale-[0.97] transition-all cursor-pointer"
                        >
                          Activar DNS Privado (Quad9 DoT)
                        </button>
                      ) : (
                        <>
                          <span className="text-[12px] text-[#F2F2F4]/85">
                            ¿Forzar <span className="font-tech text-[#F2F2F4]">dns.quad9.net</span> por USB?
                          </span>
                          <button
                            type="button"
                            disabled={hardeningDns}
                            onClick={handleConfirmHardenDns}
                            className="rounded-[8px] bg-[#2F6FED] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#2F6FED]/90 hover:shadow-[0_0_20px_rgba(47,111,237,0.3)] disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            {hardeningDns && <Loader2 className="h-3 w-3 animate-spin" />}
                            <span>Confirmar</span>
                          </button>
                          <button
                            type="button"
                            disabled={hardeningDns}
                            onClick={() => setConfirmingDns(false)}
                            className="rounded-[8px] border border-white/[0.1] px-2.5 py-1 text-[12px] text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer"
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
              <div key={`${al.indicator}-${idx}`} className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2.5 sm:gap-4">
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
                    <span className="text-[13px] font-medium text-[#F2F2F4]">
                      {al.category}
                    </span>
                  </div>
                  <div className="font-tech text-[12.5px] text-[#F2F2F4]/90 break-all">
                    {al.indicator}
                  </div>
                  <p className="text-[12.5px] text-[#9A9AA2] leading-relaxed break-words">
                    {al.detail}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={!onAskInChat}
                  onClick={() => handleInvestigateAnomaly({ ...al, artifact: result.sourceLabel })}
                  className="self-start sm:self-auto shrink-0 rounded-[8px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/75 hover:shadow-[0_0_24px_rgba(47,111,237,0.25)] disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
                >
                  Consultar con Copiloto
                </button>
              </div>
            ))}

            {behavioralAnomalies.map((anom, idx) => {
              const isCrit = anom.severity === 'CRITICAL';
              return (
                <div
                  key={`${anom.category}-${anom.artifact}-${anom.indicator}-${idx}`}
                  className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2.5 sm:gap-4"
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
                      <span className="font-tech text-[13px] text-[#F2F2F4] break-all">
                        {anom.indicator}
                      </span>
                      <span className="font-tech rounded-[6px] border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10.5px] text-[#9A9AA2]">
                        {anom.category}
                      </span>
                    </div>
                    <p className="text-[12.5px] text-[#F2F2F4]/85 leading-relaxed break-words">
                      {anom.detail}
                    </p>
                    <div className="font-tech text-[11px] text-[#9A9AA2] truncate">
                      {anom.artifact}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!onAskInChat}
                    onClick={() => handleInvestigateAnomaly(anom)}
                    className="self-start sm:self-auto shrink-0 rounded-[8px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/75 hover:shadow-[0_0_24px_rgba(47,111,237,0.25)] disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
                  >
                    Consultar con Copiloto
                  </button>
                </div>
              );
            })}

            {liveSockets.length > 0 && (
              <div>
                <div className="px-4 py-2.5 bg-white/[0.02] flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-[#F2F2F4]/85">
                    {isPcPlatform ? 'Conexiones TCP activas' : 'Sockets kernel activos /proc/net/tcp'} ({hardeningReport?.live_sockets_total || liveSockets.length})
                  </span>
                  <span className="font-tech text-[11px] text-[#9A9AA2]">
                    {isPcPlatform
                      ? `${liveSockets.filter((s) => s.process_name).length} con proceso`
                      : `${hardeningReport?.cached_dns_count || 0} DNS en caché`}
                  </span>
                </div>
                <div className="divide-y divide-white/[0.05] max-h-[220px] overflow-y-auto">
                  {liveSockets.slice(0, 20).map((sock, idx) => (
                    <div
                      key={`${sock.remote_ip}-${sock.remote_port}-${idx}`}
                      className="px-4 py-2 flex flex-wrap sm:flex-nowrap items-center justify-between gap-1.5 sm:gap-3"
                    >
                      <div className="min-w-0 flex items-center gap-2.5">
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                            sock.cti_match ? 'bg-[#FF453A]' : 'bg-[#9A9AA2]/60'
                          }`}
                        />
                        <span className="font-tech text-[12.5px] text-[#F2F2F4] truncate">
                          {sock.remote_ip}:{sock.remote_port}
                          {sock.process_name ? ` · ${sock.process_name}` : ''}
                        </span>
                        {sock.cti_match && (
                          <span className="rounded-full border border-[#FF453A]/35 bg-[#FF453A]/12 px-2 py-0.5 text-[10.5px] font-medium text-[#FF6961] shrink-0">
                            CTI · {sock.spyware_family}
                          </span>
                        )}
                      </div>
                      <span className="font-tech shrink-0 text-[11px] text-[#9A9AA2]">
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
                <div className="px-4 py-3.5 text-[12.5px] text-[#9A9AA2]">
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
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#F2F2F4]">
                  <Clock className="h-3.5 w-3.5 text-[#2F6FED] shrink-0" />
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
                  <div key={`${ev.timestamp}-${ev.kind}-${idx}`} className="px-4 py-2 flex flex-col sm:flex-row sm:items-start justify-between gap-1 sm:gap-3 text-[11.5px]">
                    <div className="min-w-0 break-words">
                      <span className={`font-medium ${ev.suspicious ? 'text-[#FF6961]' : 'text-[#F2F2F4]/90'}`}>
                        {ev.actor}
                      </span>{' '}
                      <span className="text-[#9A9AA2]">{ev.detail}</span>
                    </div>
                    <span className="font-tech text-[10.5px] text-[#9A9AA2] shrink-0">
                      {ev.timestamp}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 3 · Coincidencias CTI y firmas YARA */}
        <section className="animate-on-scroll space-y-2" data-delay="100">
          <span className="px-1 block text-[11px] font-medium tracking-[0.06em] uppercase text-[#9A9AA2]">
            3 · Coincidencias CTI y firmas YARA ({yaraHits.length + result.findings.length})
          </span>
          <div className="apple-group rounded-[13px] divide-y divide-white/[0.06] overflow-hidden">
            {yaraHits.map((hit, idx) => (
              <div key={`${hit.rule_name}-${hit.artifact}-${idx}`} className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2.5 sm:gap-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-tech text-[13px] font-medium text-[#F2F2F4] break-all">
                      {hit.rule_name}
                    </span>
                    <span className="rounded-full border border-[#FF453A]/35 bg-[#FF453A]/12 px-2.5 py-0.5 text-[11px] font-medium text-[#FF6961]">
                      YARA · {hit.spyware_family}
                    </span>
                    {hit.cve && (
                      <span className="font-tech rounded-[6px] border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10.5px] text-[#9A9AA2]">
                        {hit.cve}
                      </span>
                    )}
                  </div>
                  <p className="text-[12.5px] text-[#F2F2F4]/85 leading-relaxed break-words">
                    {hit.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {(hit.matched_strings || []).map((tok) => (
                      <span
                        key={tok}
                        className="font-tech rounded-[5px] border border-[#2F6FED]/40 bg-[rgba(28,36,56,0.65)] px-2 py-0.5 text-[11px] text-[#F2F2F4]"
                      >
                        {tok}
                      </span>
                    ))}
                    <span className="font-tech text-[11px] text-[#9A9AA2] break-all sm:truncate">
                      · {hit.artifact}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!onAskInChat}
                  onClick={() => handleInvestigateYara(hit)}
                  className="self-start sm:self-auto shrink-0 rounded-[8px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/75 hover:shadow-[0_0_24px_rgba(47,111,237,0.25)] disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
                >
                  Consultar con Copiloto
                </button>
              </div>
            ))}

            {result.findings.map((finding) => (
              <div
                key={finding.id}
                className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-tech text-[13px] text-[#F2F2F4] break-all">
                      {finding.ioc_value}
                    </span>
                    <span className="rounded-full border border-[#FF453A]/35 bg-[#FF453A]/12 px-2.5 py-0.5 text-[11px] font-medium text-[#FF6961]">
                      {finding.spyware_family}
                    </span>
                  </div>
                  <div className="font-tech text-[11.5px] text-[#9A9AA2] truncate">
                    {finding.artifact_origin}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
                  {onVerifyLink && isInspectableNetworkIndicator(finding.ioc_value) && (
                    <button
                      type="button"
                      onClick={() => onVerifyLink(finding.ioc_value)}
                      className="inline-flex items-center gap-1 rounded-[8px] border border-white/[0.1] bg-white/[0.045] px-2.5 py-1.5 text-[11.5px] font-medium text-[#F2F2F4]/90 hover:bg-white/[0.09] active:scale-[0.97] transition-all cursor-pointer"
                    >
                      <Link2 className="h-3 w-3 text-[#2F6FED]" />
                      <span>Ver enlace</span>
                    </button>
                  )}

                  {onOpenThreat && finding.spyware_family && finding.spyware_family !== 'Sin clasificar' && (
                    <button
                      type="button"
                      onClick={() => onOpenThreat(finding.spyware_family)}
                      className="inline-flex items-center gap-1 rounded-[8px] border border-white/[0.1] bg-white/[0.045] px-2.5 py-1.5 text-[11.5px] font-medium text-[#F2F2F4]/90 hover:bg-white/[0.09] active:scale-[0.97] transition-all cursor-pointer"
                    >
                      <Shield className="h-3 w-3 text-[#2F6FED]" />
                      <span>Campaña</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={!onAskInChat}
                    onClick={() => handleInvestigateFinding(finding)}
                    className="rounded-[8px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/75 hover:shadow-[0_0_24px_rgba(47,111,237,0.25)] disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
                  >
                    Consultar con Copiloto
                  </button>
                </div>
              </div>
            ))}

            {!hasYara && !hasMatches && (
              <div className="px-4 py-3.5 text-[12.5px] text-[#9A9AA2]">
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
    <div className="animate-fade-up flex-1 flex flex-col items-center justify-center py-3">
      <div className="w-full max-w-[740px]">
        <header className="text-center mb-3.5">
          <h1 className="text-[23px] sm:text-[29px] font-semibold tracking-[-0.028em] leading-[1.15] text-[#F2F2F4]">
            Verificar integridad del dispositivo
          </h1>
          <p className="mt-1.5 text-[13px] text-[#9A9AA2] max-w-[460px] mx-auto">
            Audita PC, Android o iPhone en RAM sin guardar archivos personales.
          </p>
        </header>

        <MobileUsbAuditCard />
        {result && (result.matchesCount > 0 || result.behavioralAnomalies?.some(item => ['HIGH', 'CRITICAL'].includes(item.severity))) && <div className="my-3">
          <EmergencyGuidance mobile={deviceTab !== 'pc'} />
          {(result.findings || []).slice(0, 3).map(finding => <ContainmentButton key={finding.id} finding={finding} />)}
        </div>}

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
          let statusPillTone = 'border-white/[0.08] bg-white/[0.04] text-[#9A9AA2]';
          if (deviceTab === 'pc') {
            statusPillLabel = hasDesktopBridge ? 'Auditoría de solo lectura' : 'Solo en OMEGA Desktop';
            statusPillTone = hasDesktopBridge
              ? 'border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]'
              : 'border-white/[0.1] bg-white/[0.04] text-[#9A9AA2]';
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
            <div className="omega-glass-panel mb-3.5 rounded-[14px] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-8 w-8 rounded-[9px] bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0">
                    {deviceTab === 'pc' ? (
                      <Laptop className={`h-4 w-4 ${hasDesktopBridge ? 'text-[#30D158]' : 'text-[#9A9AA2]'}`} />
                    ) : (
                      <Smartphone
                        className={`h-4 w-4 ${
                          hasDesktopBridge &&
                          ((deviceTab === 'android' && usbDevice?.connected) ||
                            (deviceTab === 'ios' && iosStatus?.connected))
                            ? 'text-[#30D158]'
                            : 'text-[#9A9AA2]'
                        }`}
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium tracking-[-0.01em] text-[#F2F2F4]">
                        {deviceTab === 'pc' ? 'Revisar esta computadora' : 'Analizar dispositivo USB'}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${statusPillTone}`}>
                        {statusPillLabel}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 max-w-full">
                  <div className="apple-segmented inline-flex max-w-full overflow-x-auto no-scrollbar rounded-[8px] p-0.5">
                    <button
                      type="button"
                      onClick={() => setDeviceTab('android')}
                      className={`whitespace-nowrap shrink-0 rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium active:scale-[0.97] transition-all cursor-pointer ${
                        deviceTab === 'android'
                          ? 'apple-segmented-active'
                          : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                      }`}
                    >
                      Android
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeviceTab('ios')}
                      className={`whitespace-nowrap shrink-0 rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium active:scale-[0.97] transition-all cursor-pointer ${
                        deviceTab === 'ios'
                          ? 'apple-segmented-active'
                          : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
                      }`}
                    >
                      iPhone / iPad
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeviceTab('pc')}
                      className={`whitespace-nowrap shrink-0 rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium active:scale-[0.97] transition-all cursor-pointer ${
                        deviceTab === 'pc'
                          ? 'apple-segmented-active'
                          : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
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
                      className="h-7 w-7 rounded-[8px] border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center text-[#9A9AA2] hover:text-[#F2F2F4] disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${refreshingUsb ? 'animate-spin text-[#2F6FED]' : ''}`} />
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
                          <span className="text-[12.5px] font-medium text-[#F2F2F4]">
                            {usbDevice.model || 'Teléfono Android'}
                          </span>
                          <span className="font-tech text-[11px] text-[#9A9AA2]">
                            {selectedSerial || usbDevice.serial}
                          </span>
                          {usbDevice.devices?.length > 1 && (
                            <select
                              value={selectedSerial}
                              onChange={(e) => setSelectedSerial(e.target.value)}
                              className="font-tech rounded-[6px] border border-white/[0.12] bg-black/50 px-1.5 py-0.5 text-[11px] text-[#F2F2F4]/90"
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
                        <p className="text-[12px] text-[#9A9AA2]">
                          Teléfono listo. Análisis pasivo en RAM sin modificar el equipo.
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={scanningUsb || isAnalyzing}
                        onClick={handleLiveUsbScan}
                        className="shrink-0 rounded-[9px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.28),inset_0_1px_0_rgba(255,255,255,0.22)] hover:bg-[#2F6FED]/90 hover:shadow-[0_0_24px_rgba(47,111,237,0.35)] disabled:opacity-50 px-3.5 py-1.5 text-[12px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer"
                      >
                        {scanningUsb && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        <span>{scanningUsb ? 'Revisando teléfono...' : 'Iniciar revisión segura'}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[11px] border border-white/[0.06] bg-white/[0.025] px-3.5 py-2.5">
                        <p className="text-[12.5px] text-[#F2F2F4]/85 leading-relaxed flex-1 min-w-[220px]">
                          {hasDesktopBridge
                            ? usbDevice?.reason || 'Buscando Android por USB...'
                            : 'El análisis por USB requiere OMEGA Desktop. En web puedes subir una copia abajo.'}
                        </p>

                        <button
                          type="button"
                          onClick={() => setShowAndroidGuide((v) => !v)}
                          className="shrink-0 inline-flex items-center gap-1 rounded-[7px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-[#F2F2F4] hover:border-[#2F6FED]/50 hover:bg-[rgba(28,36,56,0.65)] transition-colors cursor-pointer"
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
                                <div className="text-[12px] font-medium text-[#F2F2F4]">
                                  1. Activa el modo revisión
                                </div>
                                <p className="mt-0.5 text-[11.5px] text-[#9A9AA2] leading-snug">
                                  En tu teléfono ve a <span className="text-[#F2F2F4]/85">Ajustes → Acerca del teléfono</span>, toca 7 veces <span className="text-[#F2F2F4]/85">N.º de compilación</span> y enciende <span className="text-[#F2F2F4]/85">Depuración USB</span>.
                                </p>
                              </div>
                            </div>

                            <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                              <AndroidStepVisual step={2} adbReady={Boolean(usbDevice?.adb_path)} />
                              <div>
                                <div className="text-[12px] font-medium text-[#F2F2F4]">
                                  2. Conecta tu cable USB
                                </div>
                                <p className="mt-0.5 text-[11.5px] text-[#9A9AA2] leading-snug">
                                  {usbDevice?.adb_path
                                    ? 'Tu computadora ya está lista. Conecta el teléfono con cable de datos y elige "Transferir archivos".'
                                    : 'Usa un cable USB de datos (no solo de carga) y descarga o señala el conector gratuito abajo.'}
                                </p>
                              </div>
                            </div>

                            <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                              <AndroidStepVisual step={3} />
                              <div>
                                <div className="text-[12px] font-medium text-[#F2F2F4]">
                                  3. Toca “Permitir”
                                </div>
                                <p className="mt-0.5 text-[11.5px] text-[#9A9AA2] leading-snug">
                                  Desbloquea la pantalla del teléfono. Cuando salga la ventana de permiso, marca confiar y pulsa <span className="text-[#F2F2F4]/85">Permitir</span>.
                                </p>
                              </div>
                            </div>
                          </div>

                          {hasDesktopBridge && (
                            <div className="pt-0.5 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={handlePickAdbBinary}
                                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-2.5 py-1 text-[11.5px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/75 hover:shadow-[0_0_20px_rgba(47,111,237,0.22)] transition-all cursor-pointer"
                                >
                                  <FolderOpen className="h-3.5 w-3.5" />
                                  <span>
                                    {usbDevice?.adb_path ? 'Cambiar conector adb.exe' : 'Elegir adb.exe en mi PC'}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  disabled={installingAdb || scanningUsb || isAnalyzing}
                                  onClick={handleInstallPortableAdb}
                                  className="inline-flex items-center gap-1 rounded-[8px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-[#F2F2F4]/90 disabled:opacity-50 cursor-pointer"
                                >
                                  {installingAdb ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                  <span>{installingAdb ? 'Instalando conector...' : 'Instalar conector USB'}</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    window.open(
                                      'https://developer.android.com/tools/releases/platform-tools',
                                      '_blank',
                                      'noopener,noreferrer',
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded-[8px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-[#F2F2F4]/90 hover:bg-white/[0.08] transition-colors cursor-pointer"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  <span>Descargar conector oficial (Google)</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setShowAdvancedCmds((v) => !v)}
                                  className="inline-flex items-center gap-1 rounded-[8px] border border-white/[0.06] bg-transparent px-2 py-1 text-[11px] text-[#9A9AA2] hover:text-[#F2F2F4]/85 transition-colors cursor-pointer"
                                >
                                  <span>{showAdvancedCmds ? 'Ocultar comandos' : 'Opciones para técnicos'}</span>
                                </button>
                              </div>

                              {showAdvancedCmds && (
                                <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-[11px] text-[#9A9AA2]">
                                  <span>Instalar por terminal:</span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyCommand('adb', installAdbCmd)}
                                    className="font-tech inline-flex items-center gap-1.5 rounded-[7px] border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] text-[#F2F2F4]/90 hover:bg-white/[0.08] transition-colors cursor-pointer"
                                  >
                                    {copiedHintKey === 'adb' ? (
                                      <Check className="h-3 w-3 text-[#30D158]" />
                                    ) : (
                                      <Copy className="h-3 w-3 text-[#9A9AA2]" />
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
                          <span className="text-[12.5px] font-medium text-[#F2F2F4]">
                            {iosStatus.device?.name || 'iPhone / iPad'}
                          </span>
                          <span className="font-tech text-[11px] text-[#9A9AA2]">
                            {iosStatus.device?.model} · iOS {iosStatus.device?.ios_version || 'N/D'}
                          </span>
                        </div>
                        <p className="text-[12px] text-[#9A9AA2]">
                          iPhone listo. Inspección en RAM sin tocar fotos ni mensajes.
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={scanningIos || isAnalyzing}
                        onClick={handleLiveIosScan}
                        className="shrink-0 rounded-[9px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.28),inset_0_1px_0_rgba(255,255,255,0.22)] hover:bg-[#2F6FED]/90 hover:shadow-[0_0_24px_rgba(47,111,237,0.35)] disabled:opacity-50 px-3.5 py-1.5 text-[12px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer"
                      >
                        {scanningIos && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        <span>{scanningIos ? 'Revisando iPhone...' : 'Iniciar revisión de iPhone'}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-[12px] border border-white/[0.06] bg-black/30 p-3 space-y-3">
                      <p className="text-[12.5px] text-[#F2F2F4]/85 leading-relaxed">
                        {hasDesktopBridge
                          ? iosStatus?.reason || 'Sigue estos 3 pasos para analizar tu iPhone sin riesgo:'
                          : 'Sigue estos 3 pasos en tu iPhone y sube el archivo abajo:'}
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                        <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                          <IosStepVisual step={1} />
                          <div>
                            <div className="text-[12px] font-medium text-[#F2F2F4]">
                              1. Genera el archivo en iPhone
                            </div>
                            <p className="mt-0.5 text-[11.5px] text-[#9A9AA2] leading-snug">
                              <span className="text-[#F2F2F4]/85">Ajustes → Privacidad → Análisis y mejoras → Datos</span>, o <span className="text-[#F2F2F4]/85">Vol+ · Vol- + Lateral</span>.
                            </p>
                          </div>
                        </div>

                        <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                          <IosStepVisual step={2} />
                          <div>
                            <div className="text-[12px] font-medium text-[#F2F2F4]">
                              2. O usa una copia en PC
                            </div>
                            <p className="mt-0.5 text-[11.5px] text-[#9A9AA2] leading-snug">
                              Desbloquea el iPhone conectado y toca <span className="text-[#F2F2F4]/85">Confiar</span> con tu PIN.
                            </p>
                          </div>
                        </div>

                        <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                          <IosStepVisual step={3} />
                          <div>
                            <div className="text-[12px] font-medium text-[#F2F2F4]">
                              3. Súbelo en RAM
                            </div>
                            <p className="mt-0.5 text-[11.5px] text-[#9A9AA2] leading-snug">
                              Envía el diagnóstico o abre la carpeta de respaldo. Cero retención.
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
                              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-2.5 py-1 text-[11.5px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/75 hover:shadow-[0_0_20px_rgba(47,111,237,0.22)] disabled:opacity-50 transition-all cursor-pointer"
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
                                className="inline-flex items-center gap-1 rounded-[8px] border border-white/[0.06] bg-transparent px-2 py-1 text-[11px] text-[#9A9AA2] hover:text-[#F2F2F4]/85 transition-colors cursor-pointer"
                              >
                                <span>{showAdvancedCmds ? 'Ocultar comandos' : 'Opciones para técnicos (cable directo)'}</span>
                              </button>
                            )}
                          </div>

                          {showAdvancedCmds && !iosStatus?.tools_available && (
                            <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-[11px] text-[#9A9AA2]">
                              <span>Para conexión USB Lockdown directa (requiere Apple Devices / iTunes):</span>
                              <button
                                type="button"
                                onClick={() => handleCopyCommand('ios', installIosCmd)}
                                className="font-tech inline-flex items-center gap-1.5 rounded-[7px] border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] text-[#F2F2F4]/90 hover:bg-white/[0.08] transition-colors cursor-pointer"
                              >
                                {copiedHintKey === 'ios' ? (
                                  <Check className="h-3 w-3 text-[#30D158]" />
                                ) : (
                                  <Copy className="h-3 w-3 text-[#9A9AA2]" />
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
                      <div className="px-3 py-1.5 text-[11px] font-medium text-[#9A9AA2]">
                        Copias de seguridad encontradas en tu computadora ({iosStatus.local_backups.length})
                      </div>
                      {iosStatus.local_backups.slice(0, 3).map((bk) => (
                        <div key={bk.id} className="px-3 py-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[12px] font-medium text-[#F2F2F4] truncate">
                                {bk.deviceName}
                              </span>
                              {bk.iosVersion && (
                                <span className="font-tech text-[10.5px] text-[#9A9AA2]">
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
                              className="shrink-0 rounded-[7px] bg-[#2F6FED] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#2F6FED]/90 disabled:opacity-50 cursor-pointer"
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
                      className="rounded-[11px] border border-[#FF9F0A]/30 bg-[#141418] p-3.5 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#F2F2F4]">
                            <KeyRound className="h-3.5 w-3.5 text-[#FFD60A]" />
                            <span>
                              Contraseña de la copia «{encryptedBackupPrompt.meta?.deviceName || 'iPhone'}»
                            </span>
                          </div>
                          <p className="text-[11px] text-[#9A9AA2]">
                            Solo en memoria RAM para revisar SMS, Safari, DataUsage y perfiles. Nunca se guarda.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="password"
                          autoFocus
                          maxLength={128}
                          value={backupPassword}
                          onChange={(e) => setBackupPassword(stripUnsafeChars(e.target.value, 128))}
                          placeholder="Contraseña de respaldo iTunes / Finder"
                          className="flex-1 min-w-[200px] rounded-[8px] border border-white/[0.12] bg-black/50 px-3 py-1.5 text-[12.5px] text-[#F2F2F4] placeholder-[#9A9AA2] focus:border-[#2F6FED] focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={!backupPassword || unlockingBackup}
                          className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#2F6FED] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#2F6FED]/90 hover:shadow-[0_0_20px_rgba(47,111,237,0.3)] disabled:opacity-50 cursor-pointer"
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
                          className="rounded-[8px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer"
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
                  <p className="text-[12px] text-[#9A9AA2] leading-relaxed">
                    Audita procesos sin firma, persistencia WMI (<span className="text-[#F2F2F4]/85">Candiru / Predator</span>) y conexiones externas en solo lectura.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="rounded-[10px] border border-white/[0.07] bg-black/35 p-2.5 flex flex-col gap-2">
                      <PcStepVisual step={1} />
                      <div className="text-[11.5px] font-medium text-[#F2F2F4]">
                        1. Conexiones externas
                      </div>
                      <p className="text-[11px] text-[#9A9AA2] leading-snug">
                        Cruza IPs activas contra campañas CTI y reglas YARA.
                      </p>
                    </div>
                    <div className="rounded-[10px] border border-white/[0.07] bg-black/35 p-2.5 flex flex-col gap-2">
                      <PcStepVisual step={2} />
                      <div className="text-[11.5px] font-medium text-[#F2F2F4]">
                        2. Persistencia oculta
                      </div>
                      <p className="text-[11px] text-[#9A9AA2] leading-snug">
                        Revisa tareas programadas, WMI y temporales sin firma.
                      </p>
                    </div>
                    <div className="rounded-[10px] border border-white/[0.07] bg-black/35 p-2.5 flex flex-col gap-2">
                      <PcStepVisual step={3} />
                      <div className="text-[11.5px] font-medium text-[#F2F2F4]">
                        3. Escudos del sistema
                      </div>
                      <p className="text-[11px] text-[#9A9AA2] leading-snug">
                        Comprueba Defender, Firewall, UAC y Gatekeeper.
                      </p>
                    </div>
                  </div>

                  {hasPcTelemetryBridge ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                      <span className="text-[11.5px] text-[#9A9AA2]">
                        Solo lectura en RAM · ~2 segundos · Sin cambios en tu equipo.
                      </span>
                      <button
                        type="button"
                        disabled={scanningPc || isAnalyzing}
                        onClick={handlePcLiveAudit}
                        className="rounded-[9px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.28),inset_0_1px_0_rgba(255,255,255,0.22)] hover:bg-[#2F6FED]/90 hover:shadow-[0_0_24px_rgba(47,111,237,0.35)] disabled:opacity-50 px-3.5 py-1.5 text-[12px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer"
                      >
                        {scanningPc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Laptop className="h-3.5 w-3.5" />}
                        <span>{scanningPc ? 'Revisando equipo...' : 'Analizar esta computadora'}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[11.5px] text-[#9A9AA2]">
                      Auditoría local disponible en <span className="text-[#F2F2F4]/85">OMEGA Desktop</span>.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* Disparador 2: Cargar respaldo / volcado */}
        <div style={{ animationDelay: '60ms' }} className="animate-scale-in omega-capsule rounded-[16px] p-3.5 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span className="text-[13.5px] font-medium tracking-[-0.01em] text-[#F2F2F4]">
              Cargar respaldo / volcado
            </span>

            <button
              type="button"
              disabled={syncingStix}
              onClick={handleSyncStix}
              title="Actualizar base de amenazas conocidas en memoria"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-[#9A9AA2] hover:bg-white/[0.08] hover:text-[#F2F2F4] disabled:opacity-50 active:scale-[0.97] transition-all cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 ${syncingStix ? 'animate-spin text-[#2F6FED]' : ''}`} />
              <span>{stixSyncNote || (syncingStix ? 'Actualizando...' : 'Feeds STIX 2.1')}</span>
            </button>
          </div>

          <div className="mb-3">
            <div className="apple-segmented grid grid-cols-1 sm:inline-flex gap-1 sm:gap-0 w-full sm:w-auto rounded-[9px] p-0.5">
              <button
                type="button"
                onClick={() => {
                  setInputMode('upload');
                  setErrorMsg('');
                }}
                className={`rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium text-center active:scale-[0.98] transition-all duration-150 cursor-pointer ${
                  inputMode === 'upload'
                    ? 'apple-segmented-active'
                    : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
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
                className={`rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium text-center active:scale-[0.98] transition-all duration-150 cursor-pointer ${
                  inputMode === 'paste'
                    ? 'apple-segmented-active'
                    : 'text-[#9A9AA2] hover:text-[#F2F2F4]'
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
              className={`rounded-[12px] border border-dashed py-5 px-4 sm:px-6 flex flex-col items-center justify-center text-center transition-all duration-200 hover:-translate-y-0.5 cursor-pointer ${
                isDragging
                  ? 'border-[#2F6FED] bg-[rgba(28,36,56,0.65)]'
                  : 'border-white/[0.12] bg-black/25 hover:border-[#2F6FED]/55 hover:bg-[rgba(28,36,56,0.35)]'
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
                  <Loader2 className="h-5 w-5 text-[#2F6FED] animate-spin" />
                ) : (
                  <Upload className="h-4.5 w-4.5 text-[#9A9AA2]" />
                )}
              </div>

              <p className="text-[13.5px] font-medium text-[#F2F2F4]">
                {isAnalyzing
                  ? 'Analizando en memoria temporal...'
                  : 'Arrastra aquí el archivo o respaldo de tu celular'}
              </p>

              {!isAnalyzing && (
                <p className="mt-1 text-[11.5px] text-[#9A9AA2]">
                  Soporta .tar.gz, .ips, .db, .zip y .json
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={handleAnalyzeText}>
              <div className="apple-well rounded-[11px] p-3">
                <textarea
                  rows={4}
                  maxLength={50000}
                  value={manualText}
                  onChange={(e) => {
                    setManualText(stripUnsafeChars(e.target.value, 50000));
                    if (errorMsg) setErrorMsg('');
                  }}
                  placeholder={'https://enlace-sospechoso.com\n185.220.101.44\nPega un dominio, dirección IP o texto extraño por línea'}
                  className="font-tech w-full resize-none bg-transparent border-0 p-0 text-[12.5px] leading-relaxed text-[#F2F2F4] placeholder-[#9A9AA2] focus:outline-none"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
                <span className="text-[12px] text-[#9A9AA2]">
                  Uno por línea · Enlaces web, dominios, IPs o códigos
                </span>
                <button
                  type="submit"
                  disabled={isAnalyzing || !manualText.trim()}
                  className="rounded-[9px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.28),inset_0_1px_0_rgba(255,255,255,0.22)] hover:bg-[#2F6FED]/90 hover:shadow-[0_0_24px_rgba(47,111,237,0.35)] disabled:bg-white/[0.07] disabled:text-[#9A9AA2] disabled:shadow-none px-4 py-1.5 text-[12.5px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  {isAnalyzing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Revisar</span>
                </button>
              </div>
            </form>
          )}

          {errorMsg && (
            <PanelErrorBanner
              message={errorMsg}
              onDismiss={() => setErrorMsg('')}
              className="mt-3"
            />
          )}

          {(isAnalyzing || scanningPc || scanningUsb || scanningIos) && (
            <PanelSkeleton
              label={
                scanningPc
                  ? 'Auditando procesos, WMI y sockets en RAM...'
                  : scanningUsb || scanningIos
                    ? 'Leyendo telemetría USB en RAM...'
                    : 'Analizando artefactos forenses en RAM...'
              }
              lines={3}
              className="mt-3"
            />
          )}

          {!isAnalyzing && !scanningPc && !scanningUsb && !scanningIos && !errorMsg && (
            <PanelEmptyState
              icon={ShieldCheck}
              title="Aún no has verificado ningún equipo"
              description={
                deviceTab === 'pc'
                  ? 'Ejecuta la inspección en RAM sobre esta computadora (procesos, WMI y conexiones abiertas) o carga un archivo forense.'
                  : 'Conecta tu celular arriba para inspección directa o carga una copia / lista de indicadores abajo. Todo corre en RAM sin guardar archivos.'
              }
              actionLabel={
                deviceTab === 'pc' && hasPcTelemetryBridge
                  ? 'Analizar esta computadora'
                  : undefined
              }
              onAction={
                deviceTab === 'pc' && hasPcTelemetryBridge
                  ? handlePcLiveAudit
                  : undefined
              }
              className="mt-4"
            />
          )}
        </div>
      </div>
    </div>
  );
}
