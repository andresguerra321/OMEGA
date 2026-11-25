import { lazy, Suspense, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  Copy,
  FolderOpen,
  Laptop,
  Loader2,
  Play,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Terminal,
} from 'lucide-react';
import { auditDevWorkstationPosture, auditHostPersistence } from '../lib/api';
import { collectNativeHostSnapshot, isDesktopApp } from '../lib/desktopBridge';
import {
  analyzeWorkstationEntries,
  buildSimulatedStealerEntries,
  collectEntriesFromDirectoryHandle,
  collectEntriesFromFileList,
} from '../lib/workstationInspector';

const MvtVerifierPanel = lazy(() =>
  import('./MvtVerifierPanel').then((m) => ({ default: m.MvtVerifierPanel })),
);

const LOCAL_AUDIT_COMMANDS = Object.freeze({
  windows: {
    label: 'PowerShell (Windows)',
    command:
      'git config --global credential.helper; @(".ssh",".npmrc",".pypirc",".git-credentials",".aws\\credentials") | ForEach-Object { $p = Join-Path $HOME $_; "{0}: {1}" -f $_, (Test-Path $p) }; Get-ChildItem Env: | Where-Object Name -match "TOKEN|SECRET|API_KEY" | Select-Object -ExpandProperty Name',
  },
  unix: {
    label: 'Bash / Zsh (macOS · Linux)',
    command:
      'echo "git.helper=$(git config --global credential.helper)"; for f in ~/.ssh ~/.npmrc ~/.pypirc ~/.git-credentials ~/.aws/credentials; do [ -e "$f" ] && echo "PRESENT: $f"; done; env | cut -d= -f1 | grep -E "TOKEN|SECRET|API_KEY" || true',
  },
});

const PROJECT_CHECK_LABELS = Object.freeze({
  'DEV-WS-05': 'Auto-ejecución en IDE (.vscode/tasks.json)',
  'DEV-WS-06': 'Scripts de instalación (package.json)',
  'DEV-WS-03': 'Configuración y hooks de Git del proyecto',
  'DEV-WS-04': 'Variables .env y exclusión en .gitignore',
  'DEV-WS-01': 'Llaves privadas olvidadas en el repositorio',
  'DEV-WS-02': 'Credenciales locales (.npmrc / .pypirc / nube)',
});

function StatusPill({ status, severity }) {
  if (status === 'UNVERIFIED') {
    return <span className="font-mono text-[11px] text-zinc-500">Sin archivos</span>;
  }
  if (status === 'WARN') {
    const isCritical = severity === 'CRITICAL' || severity === 'HIGH';
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em] font-medium ${
          isCritical ? 'text-[#E5484D]' : 'text-[#E5A93C]'
        }`}
      >
        <span
          className={`h-[5px] w-[5px] rounded-full ${
            isCritical ? 'bg-[#E5484D]' : 'bg-[#E5A93C]'
          }`}
        />
        <span>{severity === 'CRITICAL' ? 'CRITICAL' : severity === 'HIGH' ? 'HIGH' : 'MEDIUM'}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em] font-medium text-emerald-400">
      <span className="h-[5px] w-[5px] rounded-full bg-emerald-500" />
      <span>OK</span>
    </span>
  );
}

export function DevWorkstationTab({
  onAskInChat,
  onVerifyLink,
  onOpenThreat,
  initialDeviceTab = 'android',
  preloadedAudit = null,
  onAuditUpdate,
  deviceNavKey = 0,
}) {
  const folderInputRef = useRef(null);

  const [stationTab, setStationTab] = useState('posture');
  const [osPlatform, setOsPlatform] = useState(() =>
    typeof navigator !== 'undefined' && /mac|linux/i.test(navigator.platform || '') ? 'unix' : 'windows',
  );
  const [copiedCmd, setCopiedCmd] = useState(false);

  const [runningHost, setRunningHost] = useState(false);
  const [hostError, setHostError] = useState('');
  const [nativeReport, setNativeReport] = useState(null);

  const [runningFolder, setRunningFolder] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [folderError, setFolderError] = useState('');
  const [projectReport, setProjectReport] = useState(null);
  const [auditSynced, setAuditSynced] = useState(false);

  const desktopRuntime = isDesktopApp();

  async function handleCopyLocalCommand() {
    try {
      await navigator.clipboard.writeText(LOCAL_AUDIT_COMMANDS[osPlatform].command);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 1500);
    } catch {
      // Clipboard API unavailable
    }
  }

  async function handleRunNativeHostAudit() {
    if (!desktopRuntime || runningHost) return;
    setRunningHost(true);
    setHostError('');
    try {
      const [hostSnap, persistence, posture] = await Promise.allSettled([
        collectNativeHostSnapshot(),
        auditHostPersistence(),
        auditDevWorkstationPosture({
          consentConfirmed: true,
          inspectLocalHostMetadata: true,
        }),
      ]);
      setNativeReport({
        snapshot: hostSnap.status === 'fulfilled' && hostSnap.value?.ok ? hostSnap.value.snapshot : null,
        persistence: persistence.status === 'fulfilled' ? persistence.value : null,
        posture: posture.status === 'fulfilled' ? posture.value : null,
      });
    } catch (err) {
      setHostError(err?.message || 'No se pudo completar la auditoría nativa de la computadora.');
    } finally {
      setRunningHost(false);
    }
  }

  async function finalizeFolderScan(entries, scopeLabel) {
    const analyzed = analyzeWorkstationEntries(entries, { scopeLabel });
    setProjectReport(analyzed);
    setAuditSynced(false);
    try {
      await auditDevWorkstationPosture(analyzed.backendSyncPayload);
      setAuditSynced(true);
    } catch {
      // Non-blocking audit log sync
    }
  }

  async function handlePickProjectFolder() {
    if (runningFolder) return;
    setFolderError('');
    if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        setRunningFolder(true);
        const entries = await collectEntriesFromDirectoryHandle(dirHandle);
        if (entries.length === 0) {
          setFolderError(
            `No se encontraron archivos de proyecto inspeccionables en "${dirHandle.name}".`,
          );
          return;
        }
        await finalizeFolderScan(entries, dirHandle.name);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setFolderError(err?.message || 'No se pudo leer la carpeta seleccionada en memoria.');
      } finally {
        setRunningFolder(false);
      }
      return;
    }
    folderInputRef.current?.click();
  }

  async function handleFolderInputChange(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setRunningFolder(true);
    setFolderError('');
    try {
      const entries = await collectEntriesFromFileList(files);
      if (entries.length === 0) {
        setFolderError('No se encontraron archivos de configuración o manifiestos en la carpeta.');
        return;
      }
      const firstRel = files[0]?.webkitRelativePath || '';
      const rootFolder = firstRel.includes('/') ? firstRel.split('/')[0] : `${entries.length} archivos`;
      await finalizeFolderScan(entries, rootFolder);
    } catch (err) {
      setFolderError(err?.message || 'Error al analizar la carpeta en memoria.');
    } finally {
      e.target.value = '';
      setRunningFolder(false);
    }
  }

  async function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    if (runningFolder) return;
    const dropped = e.dataTransfer?.files;
    if (!dropped || dropped.length === 0) return;
    setRunningFolder(true);
    setFolderError('');
    try {
      const entries = await collectEntriesFromFileList(dropped);
      if (entries.length === 0) {
        setFolderError('Suelta una carpeta de proyecto o archivos de configuración de texto.');
        return;
      }
      await finalizeFolderScan(entries, `Selección local (${entries.length} archivos)`);
    } catch (err) {
      setFolderError(err?.message || 'No se pudieron inspeccionar los archivos soltados.');
    } finally {
      setRunningFolder(false);
    }
  }

  async function handleRunSimulation() {
    if (runningFolder) return;
    setRunningFolder(true);
    setFolderError('');
    try {
      await finalizeFolderScan(buildSimulatedStealerEntries(), 'Simulación (repo malicioso)');
    } catch (err) {
      setFolderError(err?.message || 'No se pudo ejecutar la simulación.');
    } finally {
      setRunningFolder(false);
    }
  }

  const orderedControls = projectReport
    ? ['DEV-WS-05', 'DEV-WS-06', 'DEV-WS-03', 'DEV-WS-04', 'DEV-WS-01', 'DEV-WS-02']
        .map((id) => projectReport.controls.find((c) => c.controlId === id))
        .filter(Boolean)
    : [];

  return (
    <div className="space-y-5">
      {/* Sub-navegación horizontal */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06]">
        <nav aria-label="Modos de Mi estación" className="flex items-center gap-6">
          {[
            { id: 'posture', label: 'Entorno y Proyectos Locales', icon: Laptop },
            { id: 'devices', label: 'Dispositivos, Móviles e IOCs', icon: Smartphone },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = stationTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStationTab(tab.id)}
                className={`inline-flex items-center gap-2 pb-3 -mb-px border-b-[1.5px] text-xs font-medium transition-colors duration-150 cursor-pointer ${
                  active
                    ? 'border-[#EDEDEF] text-[#EDEDEF]'
                    : 'border-transparent text-[#7E8691] hover:text-zinc-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <span className="inline-flex items-center gap-1.5 pb-2.5 font-mono text-[11px] text-[#7E8691]">
          <span className="h-[6px] w-[6px] rounded-full bg-emerald-500 motion-safe:animate-pulse" />
          <span>{desktopRuntime ? 'OMEGA Desktop · Sensor nativo' : 'Modo Web · Zero-Retention en RAM'}</span>
        </span>
      </div>

      {stationTab === 'devices' ? (
        <Suspense
          fallback={
            <div className="rounded-xl bg-[#09090B] border border-white/[0.06] p-8 flex items-center justify-center gap-2 text-xs text-[#7E8691]">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
              <span>Cargando módulo de dispositivos y triaje MVT...</span>
            </div>
          }
        >
          <MvtVerifierPanel
            key={`dev-mvt-${deviceNavKey}`}
            onAskInChat={onAskInChat}
            onVerifyLink={onVerifyLink}
            onOpenThreat={onOpenThreat}
            initialTab={initialDeviceTab}
            preloadedAudit={preloadedAudit}
            onAuditUpdate={onAuditUpdate}
          />
        </Suspense>
      ) : (
        <div className="bg-[#09090B] pt-2">
          {/* SECCIÓN 1: Auditoría local del sistema */}
          <section>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Terminal className="h-3.5 w-3.5 text-[#7E8691] shrink-0" strokeWidth={1.75} />
                  <h1 className="text-[14px] font-medium tracking-[-0.015em] text-[#EDEDEF]">
                    Auditoría local del sistema
                  </h1>
                </div>
                <p className="text-[13px] text-[#7E8691]">
                  {desktopRuntime
                    ? 'Inspección automática de solo lectura desde el sensor nativo de OMEGA Desktop.'
                    : 'Chequeo de solo lectura en terminal (no expone secretos). Alternativa web a OMEGA Desktop.'}
                </p>
              </div>

              {desktopRuntime && (
                <button
                  type="button"
                  disabled={runningHost}
                  onClick={() => void handleRunNativeHostAudit()}
                  className="h-8 inline-flex items-center gap-1.5 rounded-md bg-[#EDEDEF] hover:bg-white disabled:opacity-45 px-3.5 text-xs font-medium text-[#09090B] transition-colors cursor-pointer shrink-0"
                >
                  {runningHost ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <Play className="h-3 w-3 fill-current" strokeWidth={1.75} />
                  )}
                  <span>{runningHost ? 'Auditando equipo...' : 'Auditar esta computadora'}</span>
                </button>
              )}
            </div>

            {!desktopRuntime && (
              <>
                <div className="rounded-lg border border-white/[0.08] bg-[#0C0C0F] overflow-hidden mt-4">
                  <div className="h-9 px-3 border-b border-white/[0.06] flex items-center justify-between gap-3 bg-white/[0.02]">
                    <div className="inline-flex items-center gap-4">
                      {Object.entries(LOCAL_AUDIT_COMMANDS).map(([id, cfg]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setOsPlatform(id)}
                          className={`text-xs transition-colors cursor-pointer ${
                            osPlatform === id
                              ? 'text-[#EDEDEF] font-medium'
                              : 'text-[#7E8691] hover:text-zinc-300'
                          }`}
                        >
                          {cfg.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleCopyLocalCommand()}
                      className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer shrink-0"
                    >
                      {copiedCmd ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.75} />
                          <span className="text-emerald-400">Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>
                  </div>

                  <pre className="font-mono text-[12.5px] leading-relaxed text-zinc-200 p-4 overflow-x-auto select-all whitespace-pre-wrap break-all">
                    {LOCAL_AUDIT_COMMANDS[osPlatform].command}
                  </pre>
                </div>

                <p className="mt-2.5 text-xs text-zinc-500">
                  Qué revisar: si devuelve <code className="font-mono text-zinc-400">helper=store</code> o tokens globales, migra a un gestor cifrado.
                </p>
              </>
            )}

            {hostError && (
              <div role="alert" className="mt-3 text-xs text-[#E5484D] flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span>{hostError}</span>
              </div>
            )}

            {desktopRuntime && nativeReport && (
              <div className="mt-4 border-t border-white/[0.06] pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-[#EDEDEF] font-medium">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.75} />
                    <span>{nativeReport.persistence?.hostname || 'Host local'}</span>
                  </span>
                  <span className="font-mono text-[11px] text-[#7E8691] tabular-nums">
                    {(nativeReport.persistence?.processes || []).length} procesos ·{' '}
                    {(nativeReport.persistence?.findings || []).length} hallazgos de persistencia ·{' '}
                    {nativeReport.posture?.warningsCount ?? 0} alertas de credenciales
                  </span>
                </div>
              </div>
            )}
          </section>

          <hr className="border-0 border-t border-white/[0.06] my-8" />

          {/* SECCIÓN 2: Pre-chequeo de proyecto */}
          <section>
            <input
              ref={folderInputRef}
              type="file"
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={(e) => void handleFolderInputChange(e)}
            />

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <h2 className="text-[14px] font-medium tracking-[-0.015em] text-[#EDEDEF]">
                  Pre-chequeo de proyecto
                </h2>
                <p className="text-[13px] text-[#7E8691]">
                  Audita un repositorio localmente antes de abrirlo en tu IDE o ejecutar{' '}
                  <code className="font-mono text-[12px] text-zinc-400">npm install</code>.
                </p>
              </div>

              <button
                type="button"
                disabled={runningFolder}
                onClick={() => void handleRunSimulation()}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 border border-white/[0.08] hover:border-white/[0.15] disabled:opacity-45 rounded-md transition-colors cursor-pointer shrink-0"
              >
                <Play className="h-3 w-3" strokeWidth={1.75} />
                <span>Simular ataque</span>
              </button>
            </div>

            <div
              role="button"
              tabIndex={0}
              aria-label="Seleccionar o arrastrar carpeta de proyecto"
              onClick={() => void handlePickProjectFolder()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void handlePickProjectFolder();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!isDragging) setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => void handleDrop(e)}
              className={`mt-4 rounded-lg border border-dashed transition-colors py-8 px-6 flex flex-col items-center justify-center text-center cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                isDragging
                  ? 'border-white/40 bg-white/[0.04]'
                  : 'border-white/[0.12] bg-white/[0.015] hover:bg-white/[0.03] hover:border-white/[0.22]'
              }`}
            >
              {runningFolder ? (
                <Loader2 className="h-[18px] w-[18px] text-zinc-400 animate-spin" strokeWidth={1.75} />
              ) : (
                <FolderOpen className="h-[18px] w-[18px] text-zinc-400" strokeWidth={1.75} />
              )}

              <p className="text-sm font-medium text-[#EDEDEF] mt-2.5">
                {runningFolder
                  ? 'Analizando proyecto en RAM...'
                  : 'Arrastra la raíz de tu proyecto o haz clic para seleccionar'}
              </p>

              <p className="text-xs font-mono text-zinc-500 mt-1.5">
                Escaneo local en RAM · .vscode/tasks.json · package.json · .git/hooks · .env
              </p>

              <button
                type="button"
                disabled={runningFolder}
                onClick={(e) => {
                  e.stopPropagation();
                  void handlePickProjectFolder();
                }}
                className="mt-4 h-8 px-3.5 rounded-md bg-[#EDEDEF] text-[#09090B] text-xs font-medium hover:bg-white disabled:opacity-45 transition-colors cursor-pointer"
              >
                {runningFolder ? 'Analizando...' : 'Seleccionar carpeta'}
              </button>
            </div>

            {folderError && (
              <div role="alert" className="mt-3 text-xs text-[#E5484D] flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span>{folderError}</span>
              </div>
            )}

            <AnimatePresence initial={false}>
              {projectReport && (
                <motion.div
                  key={projectReport.auditedAt}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  className="mt-5 rounded-lg border border-white/[0.06] bg-[#0C0C0F] overflow-hidden"
                >
                  {/* Resumen tabular compacto */}
                  <div className="px-4 py-2.5 bg-white/[0.02] border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#7E8691] tabular-nums">
                    <span>
                      <strong className="text-[#EDEDEF] font-medium">{projectReport.scopeLabel}</strong> ·{' '}
                      {projectReport.filesInspected} archivos en RAM ·{' '}
                      {projectReport.warningsCount} alertas · {projectReport.criticalCount} críticos
                      {auditSynced ? ' · SHA-256 registrado' : ''}
                    </span>
                    {onAskInChat && projectReport.warningsCount > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          onAskInChat(
                            `El pre-chequeo local sobre "${projectReport.scopeLabel}" detectó alertas en: ${projectReport.controls
                              .filter((c) => c.status === 'WARN')
                              .map((c) => PROJECT_CHECK_LABELS[c.controlId] || c.title)
                              .join(', ')}. Dame pasos concretos de remediación.`,
                          )
                        }
                        className="font-sans text-xs text-zinc-300 hover:text-[#EDEDEF] underline decoration-white/[0.14] underline-offset-4 cursor-pointer"
                      >
                        Consultar remediación
                      </button>
                    )}
                  </div>

                  {/* Resultados planos separados por hairline */}
                  <div className="divide-y divide-white/[0.06]">
                    {orderedControls.map((ctrl, idx) => {
                      const findings = Array.isArray(ctrl.findings) ? ctrl.findings : [];
                      return (
                        <motion.div
                          key={ctrl.controlId}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.16, delay: idx * 0.03, ease: [0.23, 1, 0.32, 1] }}
                          className="px-4 py-3 space-y-1.5 transition-colors duration-150 hover:bg-white/[0.02]"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[13px] font-medium text-[#EDEDEF]">
                              {PROJECT_CHECK_LABELS[ctrl.controlId] || ctrl.title}
                            </span>
                            <StatusPill status={ctrl.status} severity={ctrl.severity} />
                          </div>

                          {findings.length > 0 ? (
                            <div className="border-l border-white/[0.12] pl-3.5 space-y-1.5 mt-1">
                              {findings.map((f, fIdx) => (
                                <div key={`${ctrl.controlId}-${fIdx}`} className="text-xs text-zinc-300">
                                  <code className="font-mono text-[11px] text-[#EDEDEF]">{f.path}</code>
                                  <span className="text-[#7E8691]"> — {f.detail}</span>
                                </div>
                              ))}
                              <p className="text-[11.5px] text-[#7E8691]">{ctrl.remediation}</p>
                            </div>
                          ) : (
                            <p className="text-xs text-[#7E8691]">{ctrl.summary}</p>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </div>
      )}
    </div>
  );
}
