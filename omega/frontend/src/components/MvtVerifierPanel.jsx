import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Cable,
  ChevronDown,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
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
import { AndroidStepVisual, IosStepVisual } from './DeviceSetupVisuals';
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
  PanelErrorBanner,
  PanelSkeleton,
} from './PanelStatePrimitives';

import { DEFAULT_OS_SCOPE_NOTICE, buildForensicMarkdownReport, isInspectableNetworkIndicator, normalizeManualResult, normalizeParallelResult } from '../lib/mvtNormalizers';

const PRIMARY_DEVICE_ACTION = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#2F6FED] px-4 py-2 text-sm font-semibold text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-50';

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
  const usbChecks = useRef({ android: 0, ios: 0 });
  const manualUsbCheck = useRef(false);

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
  const [androidUsbSearch, setAndroidUsbSearch] = useState(null);
  const [iosStatus, setIosStatus] = useState(null);
  const [refreshingUsb, setRefreshingUsb] = useState(false);
  const [scanningUsb, setScanningUsb] = useState(false);
  const [scanningIos, setScanningIos] = useState(false);
  const [installingAdb, setInstallingAdb] = useState(false);
  const [installingIos, setInstallingIos] = useState(false);
  const [iosNeedsPython, setIosNeedsPython] = useState(false);
  const [scanningPc, setScanningPc] = useState(false);
  const [encryptedBackupPrompt, setEncryptedBackupPrompt] = useState(null);
  const [backupPassword, setBackupPassword] = useState('');
  const [unlockingBackup, setUnlockingBackup] = useState(false);
  const [backupUnlockError, setBackupUnlockError] = useState('');
  const [showConnectionGuide, setShowConnectionGuide] = useState(false);
  const [expandedGuideStep, setExpandedGuideStep] = useState(null);
  const [androidBrand, setAndroidBrand] = useState('generic');
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
    if (!desktopBridge || manualUsbCheck.current) return;
    const platform = ios ? 'ios' : 'android';
    const revision = ++usbChecks.current[platform];
    if (showLoading) {
      manualUsbCheck.current = true;
      setRefreshingUsb(true);
      setErrorMsg('');
      if (!ios) setAndroidUsbSearch(null);
    }
    try {
      if (ios) {
        const status = await desktopBridge.checkIosStatus();
        if (usbChecks.current[platform] === revision) setIosStatus(status);
      } else {
        const status = await desktopBridge.checkAdbStatus(adbPath, showLoading);
        if (usbChecks.current[platform] !== revision) return;
        setUsbDevice(status);
        if (showLoading) setAndroidUsbSearch(status);
        else if (status.status_code !== 'NO_DEVICE') setAndroidUsbSearch(null);
        setSelectedSerial((previous) => status.devices?.some((d) => d.serial === previous && d.state === 'device')
          ? previous : status.serial || '');
      }
    } catch (err) {
      if (usbChecks.current[platform] !== revision) return;
      if (ios) setIosStatus(null);
      else setUsbDevice(null);
      if (showLoading) setErrorMsg(err?.message || String(err));
    } finally {
      if (showLoading) {
        manualUsbCheck.current = false;
        setRefreshingUsb(false);
      }
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
    if (!hasDesktopBridge || deviceTab === 'pc' || (deviceTab === 'ios' && installingIos)) return undefined;
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
  }, [customAdbPath, deviceTab, fetchUsbStatuses, hasDesktopBridge, installingIos]);

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
    const serial = selectedSerial || usbDevice?.serial;
    if (!desktopBridge || !usbDevice?.connected || !serial || scanningUsb || isAnalyzing) return;
    await guard(async () => {
      setScanningUsb(true);
      setErrorMsg('');
      try {
        const snapshot = await desktopBridge.collectDeviceSnapshot(customAdbPath, serial);
        applyLiveDeviceResult(await analyzeLiveDeviceSnapshot(snapshot), 'Android');
      } catch (err) {
        setErrorMsg(err?.message || String(err));
      } finally {
        setScanningUsb(false);
      }
    });
  }

  async function handleLiveIosScan() {
    if (!desktopBridge || !iosStatus?.connected || scanningIos || isAnalyzing) return;
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

  async function handleInstallIosConnector() {
    if (!desktopBridge || installingIos) return;
    await guard(async () => {
      setInstallingIos(true);
      setIosNeedsPython(false);
      setErrorMsg('');
      try {
        const installation = await desktopBridge.installIosConnector();
        if (!installation?.ok) {
          setIosNeedsPython(installation?.code === 'PYTHON_REQUIRED');
          throw new Error(installation?.error || 'No se pudo instalar el conector para iPhone.');
        }
        await fetchUsbStatuses('', true, true);
      } catch (err) {
        setErrorMsg(err?.message || String(err));
      } finally {
        setInstallingIos(false);
      }
    });
  }

  async function openIosDownload(prerequisite) {
    try { await desktopBridge?.openIosPrerequisite(prerequisite); }
    catch (err) { setErrorMsg(err?.message || String(err)); }
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
        className="animate-fade-up w-full max-w-[1280px] 2xl:max-w-[1440px] mx-auto pt-2 pb-12 space-y-6"
      >
        {/* Barra superior */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#141923]/75 px-3 py-1.5 text-[12.5px] font-medium text-[#F2F2F4] hover:border-white/[0.14] hover:bg-[#141923] transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#9A9AA2]" strokeWidth={1.75} />
            <span>Nuevo análisis</span>
          </button>

          <button
            type="button"
            onClick={handleExportMarkdown}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#141923]/75 px-3 py-1.5 text-[12.5px] font-medium text-[#F2F2F4] hover:border-white/[0.14] hover:bg-[#141923] transition-colors cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-[#9A9AA2]" strokeWidth={1.75} />
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
              message={incomplete ? `Revisión incompleta: faltan datos de ${result.coverageGaps?.join(', ') || 'la captura del equipo'}. Los resultados disponibles no permiten completar el análisis.` : `Revisión completada (${result.analyzedCount} indicadores · ${result.matchesCount} coincidencia(s) CTI · ${yaraHits.length} YARA · ${behavioralAnomalies.length} anomalía(s)). Se conservan observaciones saneadas para el historial, no los archivos originales.`}
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
          <div className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {!hasAnyThreatSignal && !incomplete ? (
                  <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" strokeWidth={1.75} />
                ) : (
                  <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${verdictDot}`} />
                )}
                <h2 className={`text-[17px] font-semibold tracking-[-0.015em] ${isCriticalOverall ? 'text-rose-400' : verdictHeadingTone}`}>
                  {verdictTitle}
                </h2>
              </div>
              {result.verdictCode && (
                <span
                  className={`font-tech shrink-0 rounded-full border px-2.5 py-0.5 text-[10.5px] font-medium ${
                    isCriticalOverall
                      ? 'border-rose-500/35 bg-rose-500/12 text-rose-400'
                      : hasAnyThreatSignal || incomplete
                        ? 'border-amber-400/35 bg-amber-400/12 text-amber-400'
                        : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
                  }`}
                >
                  {result.verdictCode}
                </span>
              )}
            </div>

            <p className="text-[13.5px] text-[#F2F2F4]/85 leading-relaxed">
              {verdictBody}
            </p>

            <div className="rounded-xl border border-white/[0.05] bg-[#141923]/75 px-3.5 py-2.5 text-[12px] text-[#D7DEEE] space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 font-tech text-[10.5px] uppercase tracking-[0.05em] text-[#9A9AA2]">
                <span>Alcance del análisis</span>
                <span>Corte de catálogo: {cutoffDate}</span>
              </div>
              <p className="leading-snug text-[#F2F2F4]/85">{scopeNotice}</p>
            </div>

            {result.recommendedActions?.length > 0 && (
              <div className="rounded-xl border border-white/[0.05] bg-[#141923]/75 px-4 py-3 space-y-2">
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
              {' · Observaciones saneadas guardadas'}
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

          <div className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] divide-y divide-white/[0.06] overflow-hidden">
            {hardeningReport?.hardening_checks?.map((chk) => {
              let badgeCls = 'border-white/[0.08] bg-[#141923]/75 text-[#9A9AA2]';
              if (chk.status === 'OK') {
                badgeCls = 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400';
              } else if (chk.status === 'CRITICAL') {
                badgeCls = 'border-rose-500/35 bg-rose-500/12 text-rose-400';
              } else if (chk.status === 'WARN') {
                badgeCls = 'border-amber-400/30 bg-amber-400/10 text-amber-400';
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
                    <span className="font-tech self-start shrink-0 rounded-lg border border-white/[0.05] bg-[#141923]/75 px-2.5 py-1 text-[11px] text-[#F2F2F4]/90">
                      {chk.value}
                    </span>
                  </div>

                  {showDnsAction && (
                    <div className="pt-1 flex flex-wrap items-center gap-2">
                      {!confirmingDns ? (
                        <button
                          type="button"
                          onClick={() => setConfirmingDns(true)}
                          className="rounded-lg border border-white/[0.07] bg-[#141923]/75 px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/50 transition-colors cursor-pointer"
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
                            className="rounded-lg bg-[#2F6FED] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#2F6FED]/90 disabled:opacity-50 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            {hardeningDns && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />}
                            <span>Confirmar</span>
                          </button>
                          <button
                            type="button"
                            disabled={hardeningDns}
                            onClick={() => setConfirmingDns(false)}
                            className="rounded-lg border border-white/[0.07] px-2.5 py-1 text-[12px] text-[#9A9AA2] hover:text-[#F2F2F4] transition-colors cursor-pointer"
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
                          ? 'border-rose-500/35 bg-rose-500/12 text-rose-400'
                          : 'border-amber-400/30 bg-amber-400/10 text-amber-400'
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
                  className="self-start sm:self-auto shrink-0 rounded-lg border border-white/[0.07] bg-[#141923]/75 px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/50 disabled:opacity-50 transition-colors cursor-pointer"
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
                            ? 'border-rose-500/35 bg-rose-500/12 text-rose-400'
                            : 'border-amber-400/30 bg-amber-400/10 text-amber-400'
                        }`}
                      >
                        {anom.severity}
                      </span>
                      <span className="font-tech text-[13px] text-[#F2F2F4] break-all">
                        {anom.indicator}
                      </span>
                      <span className="font-tech rounded-full border border-white/[0.05] bg-[#141923]/75 px-2 py-0.5 text-[10.5px] text-[#9A9AA2]">
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
                    className="self-start sm:self-auto shrink-0 rounded-lg border border-white/[0.07] bg-[#141923]/75 px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/50 disabled:opacity-50 transition-colors cursor-pointer"
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
            <div className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#F2F2F4]">
                  <Clock className="h-3.5 w-3.5 text-[#2F6FED] shrink-0" strokeWidth={1.75} />
                  <span>
                    Línea temporal correlacionada en RAM ({result.timelineSummary?.events_total || result.timeline.length} eventos)
                  </span>
                </span>
                {result.timelineSummary?.chains_detected > 0 && (
                  <span className="rounded-full border border-rose-500/35 bg-rose-500/12 px-2 py-0.5 text-[10.5px] font-medium text-rose-400">
                    {result.timelineSummary.chains_detected} cadena(s) 0-day sospechosa(s)
                  </span>
                )}
              </div>
              <div className="divide-y divide-white/[0.06] max-h-48 overflow-y-auto">
                {result.timeline.slice(-8).reverse().map((ev, idx) => (
                  <div key={`${ev.timestamp}-${ev.kind}-${idx}`} className="px-4 py-2 flex flex-col sm:flex-row sm:items-start justify-between gap-1 sm:gap-3 text-[11.5px]">
                    <div className="min-w-0 break-words">
                      <span className={`font-medium ${ev.suspicious ? 'text-rose-400' : 'text-[#F2F2F4]/90'}`}>
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
          <div className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] divide-y divide-white/[0.06] overflow-hidden">
            {yaraHits.map((hit, idx) => (
              <div key={`${hit.rule_name}-${hit.artifact}-${idx}`} className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2.5 sm:gap-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-tech text-[13px] font-medium text-[#F2F2F4] break-all">
                      {hit.rule_name}
                    </span>
                    <span className="rounded-full border border-rose-500/35 bg-rose-500/12 px-2.5 py-0.5 text-[11px] font-medium text-rose-400">
                      YARA · {hit.spyware_family}
                    </span>
                    {hit.cve && (
                      <span className="font-tech rounded-full border border-white/[0.05] bg-[#141923]/75 px-2 py-0.5 text-[10.5px] text-[#9A9AA2]">
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
                        className="font-tech rounded-lg border border-white/[0.05] bg-[#141923]/75 px-2 py-0.5 text-[11px] text-[#F2F2F4]"
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
                  className="self-start sm:self-auto shrink-0 rounded-lg border border-white/[0.07] bg-[#141923]/75 px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/50 disabled:opacity-50 transition-colors cursor-pointer"
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
                    <span className="rounded-full border border-rose-500/35 bg-rose-500/12 px-2.5 py-0.5 text-[11px] font-medium text-rose-400">
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
                      className="inline-flex items-center gap-1 rounded-lg border border-white/[0.07] bg-[#141923]/75 px-2.5 py-1.5 text-[11.5px] font-medium text-[#F2F2F4]/90 hover:border-white/[0.14] transition-colors cursor-pointer"
                    >
                      <Link2 className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                      <span>Ver enlace</span>
                    </button>
                  )}

                  {onOpenThreat && finding.spyware_family && finding.spyware_family !== 'Sin clasificar' && (
                    <button
                      type="button"
                      onClick={() => onOpenThreat(finding.spyware_family)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/[0.07] bg-[#141923]/75 px-2.5 py-1.5 text-[11.5px] font-medium text-[#F2F2F4]/90 hover:border-white/[0.14] transition-colors cursor-pointer"
                    >
                      <Shield className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                      <span>Campaña</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={!onAskInChat}
                    onClick={() => handleInvestigateFinding(finding)}
                    className="rounded-lg border border-white/[0.07] bg-[#141923]/75 px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/50 disabled:opacity-50 transition-colors cursor-pointer"
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

  // --- ESTADO 1: CONSOLA FORENSE MINIMALISTA (Linear / Raycast) ---
  const isMac = desktopPlatform === 'darwin';
  const installAdbCmd = isMac
    ? 'brew install android-platform-tools'
    : 'winget install Google.PlatformTools';

  const isAndroidMissingConnector =
    hasDesktopBridge && deviceTab === 'android' && usbDevice?.status_code === 'ADB_NOT_FOUND';
  const isIosMissingConnector =
    hasDesktopBridge && deviceTab === 'ios' && iosStatus?.status_code === 'TOOLS_MISSING';

  const isReady =
    (deviceTab === 'android' && hasDesktopBridge && Boolean(usbDevice?.connected)) ||
    (deviceTab === 'ios' && hasDesktopBridge && Boolean(iosStatus?.connected)) ||
    (deviceTab === 'pc' && hasPcTelemetryBridge);

  const statusText = (() => {
    if (deviceTab === 'pc') {
      return hasPcTelemetryBridge ? 'Auditoría de solo lectura lista' : 'Disponible en OMEGA Desktop';
    }
    if (!hasDesktopBridge) return 'Modo navegador';
    if (refreshingUsb) return 'Buscando por USB…';
    if (deviceTab === 'android') {
      if (usbDevice?.connected) return `Conectado · ${usbDevice.model || 'Android'}`;
      if (usbDevice?.status_code === 'UNAUTHORIZED') return 'Toca «Permitir» en tu teléfono';
      if (usbDevice?.status_code === 'ADB_NOT_FOUND') return 'Falta conector USB en PC';
      if (usbDevice?.status_code === 'OFFLINE') return 'Conexión interrumpida';
      if (usbDevice?.status_code === 'ADB_ERROR') return 'El conector USB no respondió';
      if (androidUsbSearch?.windows_file_transfer) return 'Windows detectó el equipo. Depuración pendiente.';
      return usbDevice ? 'ADB no detecta un Android' : 'Comprobando conexión USB';
    }
    if (iosStatus?.connected) return `Conectado · ${iosStatus.device?.name || 'iPhone'}`;
    if (iosStatus?.status_code === 'UNPAIRED') return 'Toca «Confiar» en tu iPhone';
    if (isIosMissingConnector) return 'Falta el conector para iPhone';
    return iosStatus ? 'Sin iPhone detectado' : 'Comprobando conexión USB';
  })();

  const ANDROID_BRAND_HINTS = {
    generic: 'Ajustes → Acerca del teléfono → toca 7 veces «Número de compilación» → Sistema → Opciones de desarrollador → Depuración USB.',
    samsung: 'Ajustes → Acerca del teléfono → Información de software → toca 7 veces «Número de compilación» → Ajustes → Opciones de desarrollador → Depuración USB.',
    xiaomi: 'Ajustes → Sobre el teléfono → toca 7 veces «Versión de MIUI / HyperOS» → Ajustes adicionales → Opciones de desarrollador → Depuración USB.',
  };

  const stepperItems =
    deviceTab === 'android'
      ? [
          {
            num: 1,
            title: 'Paso 1 — Prepara el teléfono',
            text: "Abre Ajustes > Acerca del teléfono, toca 7 veces en 'Número de compilación' y activa 'Depuración USB' en Opciones de desarrollador.",
            icon: Smartphone,
          },
          {
            num: 2,
            title: 'Paso 2 — Conecta el cable a la PC',
            text: 'Conecta un cable que admita transferencia de datos directamente a la computadora.',
            icon: Cable,
          },
          {
            num: 3,
            title: 'Paso 3 — Autoriza en tu pantalla',
            text: 'Desbloquea el teléfono y pulsa Permitir en el aviso de depuración USB.',
            icon: ShieldCheck,
          },
        ]
      : [
          {
            num: 1,
            title: 'Paso 1 — Desbloquea tu iPhone',
            text: 'Mantén el teléfono encendido y en la pantalla de inicio antes de conectarlo.',
            icon: Smartphone,
          },
          {
            num: 2,
            title: 'Paso 2 — Conecta el cable',
            text: 'Usa un cable Lightning o USB-C directo al puerto de la computadora.',
            icon: Cable,
          },
          {
            num: 3,
            title: 'Paso 3 — Toca "Confiar"',
            text: "Cuando aparezca el mensaje '¿Confiar en esta computadora?', pulsa Confiar e ingresa tu código.",
            icon: ShieldCheck,
          },
        ];

  return (
    <div className="animate-fade-up flex-1 flex flex-col">
      <div className="w-full max-w-[1280px] 2xl:max-w-[1440px] mx-auto space-y-6">
        {/* A. Header Compacto + Barra de Estado del Motor */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-[-0.025em] text-[#F2F2F4]">
              Analiza tus equipos
            </h1>
            <p className="mt-1 text-[13.5px] text-[#9A9AA2]">
              Elige un equipo para revisarlo en vivo o analiza un archivo que ya tengas.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={syncingStix}
              onClick={handleSyncStix}
              title="Actualizar base de amenazas conocidas en memoria"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] px-3 py-1 text-[11.5px] font-medium text-[#D2D6E2] hover:text-white disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 ${syncingStix ? 'animate-spin text-[#10B981]' : 'text-[#9A9AA2]'}`} />
              <span>{stixSyncNote || (syncingStix ? 'Actualizando…' : 'Actualizar indicadores')}</span>
            </button>
          </div>
        </header>

        {/* B. Módulo Central Único: Auditoría en Vivo */}
        <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] shadow-[0_8px_32px_rgba(0,0,0,0.45)] p-6 space-y-5">
          {/* 1. Selector de Objetivo + Estado activo */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Equipo que quieres analizar" className="flex flex-wrap rounded-lg bg-[#141923]/75 border border-white/[0.06] p-1">
              {[
                { id: 'android', label: 'Android' },
                { id: 'ios', label: 'iPhone / iPad' },
                { id: 'pc', label: 'Esta PC' },
              ].map((tab) => {
                const active = deviceTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={active}
                    disabled={refreshingUsb || scanningUsb || scanningIos || scanningPc || installingAdb || installingIos}
                    onClick={() => {
                      if (active) return;
                      setDeviceTab(tab.id);
                      setErrorMsg('');
                      setExpandedGuideStep(null);
                      setShowConnectionGuide(false);
                    }}
                    className={`min-h-10 rounded-lg border-b-2 px-3.5 text-sm font-medium transition-colors cursor-pointer disabled:opacity-60 ${
                      active
                        ? 'border-[#2F6FED] bg-white/[0.06] text-white'
                        : 'border-transparent text-zinc-400 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2.5">
              <div role="status" className="inline-flex items-center gap-2 text-sm text-zinc-200">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isReady ? 'bg-emerald-400' : 'bg-zinc-500'
                  }`}
                />
                <span>{statusText}</span>
              </div>

            </div>
          </div>

          {/* 2. Banner de Conector (solo visible si falta conector USB en Android/iPhone) */}
          {(isAndroidMissingConnector || isIosMissingConnector) && (
            <div className="rounded-xl bg-[#171B23] border border-white/[0.06] px-4 py-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[12.5px] text-[#E5E7EB]">
                  {isAndroidMissingConnector
                    ? 'Falta conector USB en PC para analizar Android por cable.'
                    : 'Instala el conector de iPhone para analizarlo por cable.'}
                </span>

                <div className="flex flex-wrap items-center gap-2">
                  {isAndroidMissingConnector ? (
                    <button
                      type="button"
                      disabled={installingAdb || scanningUsb || isAnalyzing}
                      onClick={handleInstallPortableAdb}
                      className={PRIMARY_DEVICE_ACTION}
                    >
                      {installingAdb ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      <span>{installingAdb ? 'Instalando conector...' : 'Instalar conector USB'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={installingIos || scanningIos || isAnalyzing || refreshingUsb}
                      onClick={handleInstallIosConnector}
                      className={PRIMARY_DEVICE_ACTION}
                    >
                      {installingIos ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} strokeWidth={1.75} aria-hidden="true" />}
                      <span>{installingIos ? 'Instalando conector…' : 'Instalar conector para iPhone'}</span>
                    </button>
                  )}

                  {isAndroidMissingConnector && <button
                    type="button"
                    onClick={() => setShowAdvancedCmds((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] px-2.5 py-1.5 text-[11.5px] text-[#9A9AA2] hover:text-white cursor-pointer"
                  >
                    <span>Configuración avanzada</span>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvancedCmds ? 'rotate-180' : ''}`} />
                  </button>}
                </div>
              </div>

              {isAndroidMissingConnector && showAdvancedCmds && (
                <div className="pt-2.5 border-t border-white/[0.06] flex flex-wrap items-center gap-2 text-[11.5px]">
                  {deviceTab === 'android' && (
                    <>
                      <button
                        type="button"
                        onClick={handlePickAdbBinary}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#090B0E] hover:bg-white/[0.06] px-2.5 py-1 text-[#D2D6E2] cursor-pointer"
                      >
                        <FolderOpen className="h-3.5 w-3.5 text-[#9A9AA2]" />
                        <span>{usbDevice?.adb_path ? 'Cambiar adb.exe' : 'Elegir adb.exe en mi PC'}</span>
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
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#090B0E] hover:bg-white/[0.06] px-2.5 py-1 text-[#D2D6E2] cursor-pointer"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-[#9A9AA2]" />
                        <span>Descargar conector oficial (Google)</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopyCommand('android', installAdbCmd)}
                    className="font-tech inline-flex items-center gap-1.5 rounded-lg bg-[#090B0E] hover:bg-white/[0.06] px-2.5 py-1 text-[#9A9AA2] hover:text-white cursor-pointer"
                  >
                    <Copy className="h-3 w-3" />
                    <span>{copiedHintKey === 'android' ? 'Comando copiado' : installAdbCmd}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {hasDesktopBridge && deviceTab === 'ios' && (
            <>
              {installingIos && <p role="status" className="text-sm text-zinc-300">Descargando y preparando el conector. Esto puede tardar unos minutos.</p>}
              {iosNeedsPython && <button type="button" onClick={() => openIosDownload('python')} className="text-sm text-white underline underline-offset-4">Obtener Python</button>}
              {iosStatus?.apple_driver_present === false && !iosStatus.connected && (
                <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
                  Para conectar el iPhone por USB, Windows también necesita el controlador de Apple.
                  <button type="button" onClick={() => openIosDownload('apple')} className="text-white underline underline-offset-4">Descargar desde Apple</button>
                </p>
              )}
            </>
          )}

          <div className="border-t border-white/[0.06] py-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 grow space-y-2">
                <h2 className="text-lg font-semibold text-white">
                  {deviceTab === 'pc' ? 'Analiza esta computadora' : deviceTab === 'android' ? 'Analiza tu Android' : 'Analiza tu iPhone o iPad'}
                </h2>
                {deviceTab === 'pc' ? (
                  <p className="text-sm text-zinc-300">
                    {hasPcTelemetryBridge
                      ? 'Revisa procesos, elementos de arranque y conexiones activas.'
                      : 'La revisión en vivo requiere OMEGA Desktop. Puedes analizar un archivo desde el navegador.'}
                  </p>
                ) : !hasDesktopBridge ? (
                  <p className="text-sm text-zinc-300">
                    El análisis por USB requiere OMEGA Desktop. Aquí puedes analizar archivos o respaldos compatibles.
                  </p>
                ) : deviceTab === 'android' && usbDevice?.connected ? (
                  <div className="text-sm text-zinc-300">
                    {usbDevice.devices?.filter(device => device.state === 'device').length > 1 ? (
                      <label className="flex flex-wrap items-center gap-2">
                        Teléfono para analizar
                        <select value={selectedSerial} onChange={event => setSelectedSerial(event.target.value)}
                          className="min-h-10 rounded-lg border border-white/[0.07] bg-[#141923] px-3 text-white">
                          {usbDevice.devices.filter(device => device.state === 'device').map(device => (
                            <option key={device.serial} value={device.serial}>{device.model || 'Android'} ({device.serial})</option>
                          ))}
                        </select>
                      </label>
                    ) : <p>El teléfono está autorizado. Ya puedes iniciar el análisis.</p>}
                  </div>
                ) : deviceTab === 'ios' && iosStatus?.connected ? (
                  <p className="text-sm text-zinc-300">Tu {iosStatus.device?.name || 'iPhone o iPad'} está listo para analizar.</p>
                ) : (
                  <p className="max-w-prose text-sm text-zinc-300">
                    {deviceTab === 'android'
                      ? usbDevice?.status_code === 'UNAUTHORIZED'
                        ? 'Desbloquea el teléfono y pulsa Permitir en el aviso de depuración USB.'
                        : usbDevice?.status_code === 'OFFLINE'
                          ? 'Desconecta y vuelve a conectar el cable con el teléfono desbloqueado.'
                          : androidUsbSearch?.windows_file_transfer
                            ? `En la última búsqueda, Windows reconoció ${androidUsbSearch.windows_device_name || 'un equipo'} para transferir archivos. Con el teléfono desbloqueado, apaga y vuelve a encender Depuración USB y conecta el cable de nuevo. Si aparece el aviso, pulsa Permitir.`
                            : usbDevice?.status_code === 'ADB_ERROR'
                            ? 'Vuelve a buscar el teléfono. Si persiste, reconecta el cable y reinicia OMEGA Desktop.'
                            : 'Activa la depuración USB, conecta el teléfono con un cable de datos y autoriza la computadora.'
                      : iosStatus?.status_code === 'UNPAIRED'
                        ? 'Desbloquea el iPhone y pulsa Confiar en el aviso.'
                        : 'Conecta el iPhone con un cable de datos. Si aparece un aviso, pulsa Confiar.'}
                  </p>
                )}
              </div>

              <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
                {!hasDesktopBridge && (
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isAnalyzing} className={PRIMARY_DEVICE_ACTION}>
                    <Upload size={16} strokeWidth={1.75} aria-hidden="true" /> Elegir archivo o respaldo
                  </button>
                )}
                {deviceTab === 'android' && hasDesktopBridge && !isAndroidMissingConnector && (
                  <button type="button" disabled={refreshingUsb || scanningUsb || isAnalyzing}
                    onClick={usbDevice?.connected ? handleLiveUsbScan : () => fetchUsbStatuses(customAdbPath, false, true)}
                    className={PRIMARY_DEVICE_ACTION}>
                    {scanningUsb || refreshingUsb
                      ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                      : <Smartphone size={16} strokeWidth={1.75} aria-hidden="true" />}
                    {scanningUsb ? 'Analizando teléfono…' : refreshingUsb ? 'Buscando teléfono…' : usbDevice?.connected ? 'Analizar teléfono' : 'Buscar teléfono por USB'}
                  </button>
                )}
                {deviceTab === 'ios' && hasDesktopBridge && (
                  <>
                    {!isIosMissingConnector && <button type="button" disabled={refreshingUsb || scanningIos || isAnalyzing || installingIos}
                      onClick={iosStatus?.connected ? handleLiveIosScan : () => fetchUsbStatuses('', true, true)}
                      className={PRIMARY_DEVICE_ACTION}>
                      {scanningIos || refreshingUsb
                        ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                        : <Smartphone size={16} strokeWidth={1.75} aria-hidden="true" />}
                      {scanningIos ? 'Analizando iPhone…' : refreshingUsb ? 'Buscando iPhone…' : iosStatus?.connected ? 'Analizar iPhone' : 'Buscar iPhone por USB'}
                    </button>}
                      <button type="button" disabled={scanningIos || isAnalyzing || installingIos} onClick={handlePickIosBackupDir}
                        className="min-h-11 rounded-lg px-2 text-sm text-zinc-300 underline decoration-white/30 underline-offset-4 hover:text-white disabled:opacity-50">
                        Elegir carpeta de respaldo
                      </button>
                  </>
                )}
                {deviceTab === 'pc' && hasPcTelemetryBridge && (
                  <button type="button" disabled={scanningPc || isAnalyzing} onClick={handlePcLiveAudit} className={PRIMARY_DEVICE_ACTION}>
                    {scanningPc
                      ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                      : <Laptop size={16} strokeWidth={1.75} aria-hidden="true" />}
                    {scanningPc ? 'Analizando computadora…' : 'Analizar esta PC'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {errorMsg && <PanelErrorBanner message={errorMsg} onDismiss={() => setErrorMsg('')} />}
          {(scanningPc || scanningUsb || scanningIos) && (
            <PanelSkeleton label={scanningPc ? 'Revisando esta computadora…' : 'Leyendo datos del dispositivo…'} lines={2} />
          )}



          {/* Stepper horizontal minimalista para Android / iPhone */}
          {hasDesktopBridge && deviceTab !== 'pc' && !isReady && (
            <div className="space-y-2.5">
              <div className="border-t border-white/[0.06] pt-3">
                <button
                  type="button"
                  aria-expanded={showConnectionGuide}
                  onClick={() => setShowConnectionGuide((v) => !v)}
                  className="inline-flex min-h-10 items-center gap-2 text-sm text-zinc-300 hover:text-white"
                >
                  Ayuda para conectar por USB <ChevronDown size={15} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>

              {showConnectionGuide && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {stepperItems.map((item) => {
                      const StepIcon = item.icon;
                      const isExpanded = expandedGuideStep === item.num;
                      return (
                        <div
                          key={item.num}
                          className="flex flex-col justify-between gap-2 border-l border-white/[0.07] pl-3"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-[12.5px] font-medium text-[#F2F2F4]">
                              <StepIcon className="h-3.5 w-3.5 text-[#8E95A5] shrink-0" />
                              <span>{item.title}</span>
                            </div>
                            <p className="text-xs text-slate-400 leading-relaxed">
                              {item.text}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => setExpandedGuideStep(isExpanded ? null : item.num)}
                            className="self-start text-[11px] font-medium text-[#6EA0FF] hover:text-white transition-colors cursor-pointer"
                          >
                            {isExpanded ? 'Ocultar ejemplo' : 'Ver ejemplo'}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {expandedGuideStep && (
                    <div className="rounded-xl bg-[#141923]/75 border border-white/[0.05] p-4 sm:p-5">
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] items-center gap-6">
                        <div className="space-y-3 min-w-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-medium text-white">
                              Vista de ejemplo · {stepperItems[expandedGuideStep - 1]?.title}
                            </span>

                            {deviceTab === 'android' && expandedGuideStep === 1 && (
                              <div className="inline-flex rounded-lg bg-[#0F131B]/80 border border-white/[0.06] p-0.5">
                                {[
                                  { id: 'generic', label: 'Genérico' },
                                  { id: 'samsung', label: 'Samsung' },
                                  { id: 'xiaomi', label: 'Xiaomi' },
                                ].map((b) => (
                                  <button
                                    key={b.id}
                                    type="button"
                                    onClick={() => setAndroidBrand(b.id)}
                                    className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                                      androidBrand === b.id
                                        ? 'bg-[#2F6FED] text-white'
                                        : 'text-[#8E95A5] hover:text-white'
                                    }`}
                                  >
                                    {b.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <p className="text-[13px] text-[#D2D6E2] leading-relaxed">
                            {deviceTab === 'android' && expandedGuideStep === 1
                              ? ANDROID_BRAND_HINTS[androidBrand]
                              : stepperItems[expandedGuideStep - 1]?.text}
                          </p>
                        </div>

                        <div className="w-full max-w-[340px] shrink-0 mx-auto md:mx-0">
                          {deviceTab === 'android' ? (
                            <AndroidStepVisual
                              step={expandedGuideStep}
                              brand={androidBrand}
                            />
                          ) : (
                            <IosStepVisual step={expandedGuideStep} />
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Respaldos locales detectados de iOS + desbloqueo cifrado */}
          {deviceTab === 'ios' && hasDesktopBridge && iosStatus?.local_backups?.length > 0 && (
            <div className="rounded-xl bg-[#171B23] divide-y divide-white/[0.06] overflow-hidden">
              <div className="px-4 py-2 text-[11px] font-medium text-[#8E95A5]">
                Copias locales detectadas ({iosStatus.local_backups.length})
              </div>
              {iosStatus.local_backups.slice(0, 3).map((bk) => (
                <div key={bk.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-[12.5px] font-medium text-white truncate">{bk.deviceName}</span>
                    {bk.iosVersion && (
                      <span className="font-tech text-[11px] text-[#8E95A5]">iOS {bk.iosVersion}</span>
                    )}
                    {bk.encrypted && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10.5px] text-[#D2D6E2]">
                        <Lock className="h-2.5 w-2.5" /> Cifrada
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={scanningIos || isAnalyzing || unlockingBackup}
                    onClick={() => analyzeIosBackupDirectory(bk.path, bk)}
                    className="shrink-0 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] px-3 py-1 text-[11.5px] font-medium text-white disabled:opacity-50 cursor-pointer"
                  >
                    {bk.encrypted ? 'Desbloquear en RAM' : 'Revisar copia'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {deviceTab === 'ios' && encryptedBackupPrompt && (
            <form
              onSubmit={handleUnlockEncryptedBackup}
              className="rounded-xl bg-[#171B23] p-4 space-y-2.5"
            >
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-white">
                <KeyRound className="h-3.5 w-3.5 text-[#10B981]" />
                <span>Contraseña de la copia «{encryptedBackupPrompt.meta?.deviceName || 'iPhone'}»</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  autoFocus
                  maxLength={128}
                  value={backupPassword}
                  onChange={(e) => setBackupPassword(stripUnsafeChars(e.target.value, 128))}
                  placeholder="Contraseña de respaldo iTunes / Finder (solo en RAM)"
                  className="flex-1 min-w-[200px] rounded-lg border border-white/[0.1] bg-[#090B0E] px-3 py-1.5 text-[12.5px] text-white placeholder-[#8E95A5] focus:border-[#10B981] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!backupPassword || unlockingBackup}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] px-3 py-1.5 text-[12px] font-semibold text-[#06130E] disabled:opacity-50 cursor-pointer"
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
                  className="rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-[11.5px] text-[#9A9AA2] hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
              {backupUnlockError && (
                <p className="text-[11.5px] text-[#FF6961]">{backupUnlockError}</p>
              )}
            </form>
          )}
        </section>

        {/* C. Módulo Inferior: Análisis Offline (Dropzone Unificada + Input Inline) */}
        <section
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
          className={`rounded-2xl border border-dashed p-6 transition-colors ${
            isDragging
              ? 'border-emerald-400/60 bg-[#141923]/85 backdrop-blur-md'
              : 'border-white/[0.07] bg-[#0F131B]/85 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.45)]'
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

          {/* Área central de carga */}
          <button
            type="button"
            disabled={isAnalyzing}
            onClick={() => {
              if (!isAnalyzing) fileInputRef.current?.click();
            }}
            className="w-full flex flex-col items-center justify-center text-center py-2 cursor-pointer group"
          >
            <div className="mb-2.5 h-10 w-10 rounded-xl bg-[#171B23] flex items-center justify-center text-[#9A9AA2] group-hover:text-white transition-colors">
              {isAnalyzing ? (
                <Loader2 className="h-5 w-5 text-[#10B981] animate-spin" />
              ) : (
                <Upload className="h-4.5 w-4.5" />
              )}
            </div>
            <p className="text-[13.5px] font-medium text-[#F2F2F4]">
              {isAnalyzing ? 'Analizando en memoria temporal...' : 'Subir archivo o respaldo'}
            </p>
            <p className="mt-1 text-[11.5px] text-[#8E95A5]">
              Arrastra o haz clic aquí · .tar.gz, .ips, .db, .zip y .json
            </p>
          </button>

          {/* Entrada rápida inline dentro de la misma dropzone */}
          <form
            onSubmit={handleAnalyzeText}
            className="mt-5 pt-4 border-t border-white/[0.06] flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
          >
            <input
              type="text"
              maxLength={50000}
              value={manualText}
              onChange={(e) => {
                setManualText(stripUnsafeChars(e.target.value, 50000));
                if (errorMsg) setErrorMsg('');
              }}
              placeholder="Pegar enlaces, hashes o datos sospechosos"
              className="font-tech flex-1 min-w-0 h-10 rounded-xl bg-[#090B0E] border border-white/[0.06] px-3.5 text-[12.5px] text-white placeholder-[#8E95A5] focus:border-[#10B981] focus:outline-none"
            />
            <button
              type="submit"
              disabled={isAnalyzing || !manualText.trim()}
              className="h-10 rounded-xl bg-[#171B23] hover:bg-white/[0.1] border border-white/[0.08] disabled:opacity-45 px-4 text-[12.5px] font-medium text-white inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:cursor-not-allowed"
            >
              {isAnalyzing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Analizar</span>
            </button>
          </form>

          {isAnalyzing && (
            <PanelSkeleton
              label="Analizando archivos o indicadores…"
              lines={2}
              className="mt-4"
            />
          )}
        </section>
      </div>
    </div>
  );
}
