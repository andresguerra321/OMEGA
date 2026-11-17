import { useCallback, useEffect, useState } from 'react';
import { ContainmentButton, EmergencyGuidance } from './ContainmentPanel';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react';
import {
  fetchMobileUsbAuditJob,
  fetchMobileUsbDevices,
  startMobileUsbAudit,
} from '../lib/api';

const PROGRESS_STAGES = [
  { key: 'extracting_logs', label: 'Extrayendo registros de sistema...' },
  { key: 'scanning_spyware', label: 'Buscando rastros de spyware...' },
  { key: 'wiping_temp', label: 'Destruyendo copia temporal...' },
];

export function MobileUsbAuditCard() {
  const [tooling, setTooling] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [scanningDevices, setScanningDevices] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [auditing, setAuditing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [auditResult, setAuditResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [showTechnical, setShowTechnical] = useState(false);

  const refreshDevices = useCallback(async () => {
    setScanningDevices(true);
    setErrorMsg('');
    try {
      const res = await fetchMobileUsbDevices();
      const list = Array.isArray(res?.devices) ? res.devices : [];
      setTooling(res?.tooling || null);
      setSelectedDevice((prev) => {
        if (prev && list.some((d) => d.id === prev.id)) {
          return list.find((d) => d.id === prev.id);
        }
        return list[0] || null;
      });
    } catch {
      // Silencioso si el usuario aún no inicia sesión
    } finally {
      setScanningDevices(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void refreshDevices(); }, 0);
    return () => clearTimeout(timer);
  }, [refreshDevices]);

  async function handleRunAudit() {
    if (!selectedDevice || auditing) return;
    setAuditing(true);
    setErrorMsg('');
    setAuditResult(null);
    setProgress(20);
    setProgressMsg('Extrayendo registros de sistema...');

    const stageTimer1 = setTimeout(() => {
      setProgress(60);
      setProgressMsg('Buscando rastros de spyware...');
    }, 650);
    const stageTimer2 = setTimeout(() => {
      setProgress(90);
      setProgressMsg('Destruyendo copia temporal...');
    }, 1350);

    try {
      const job = await startMobileUsbAudit({
        platform: selectedDevice.platform,
        deviceId: selectedDevice.id,
        backupPassword: backupPassword.trim() || undefined,
        asyncMode: false,
      });

      if (job?.status === 'RUNNING' && job?.jobId) {
        let attempts = 0;
        while (attempts < 40) {
          attempts += 1;
          await new Promise((r) => setTimeout(r, 1200));
          const polled = await fetchMobileUsbAuditJob(job.jobId);
          if (polled?.message) setProgressMsg(polled.message);
          if (typeof polled?.progress === 'number') setProgress(polled.progress);
          if (polled?.status === 'COMPLETED') {
            setAuditResult(polled.result);
            break;
          }
          if (polled?.status === 'FAILED') {
            throw new Error(polled.error || 'No se pudo completar el análisis USB.');
          }
        }
      } else if (job?.result) {
        setProgress(100);
        setProgressMsg('Análisis completado y copia temporal destruida.');
        setAuditResult(job.result);
      } else if (job?.error) {
        throw new Error(job.error);
      }
    } catch (err) {
      setErrorMsg(err?.message || 'Error al analizar el teléfono conectado.');
    } finally {
      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);
      setAuditing(false);
      setBackupPassword('');
    }
  }

  const currentStep = !selectedDevice ? 1 : !selectedDevice.authorized ? 2 : 3;

  return (
    <section className="mb-3.5 rounded-[14px] border border-[#2F6FED]/35 bg-gradient-to-b from-[#151926]/90 to-[#0C0E14]/95 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.55)] space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-[10px] bg-[#2F6FED]/20 border border-[#2F6FED]/45 flex items-center justify-center">
            <Smartphone className="h-4.5 w-4.5 text-[#8BB2FF]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-semibold text-[#F2F2F4]">
                Analizar mi teléfono conectado
              </h2>
              <span className="rounded-full border border-[#30D158]/35 bg-[#30D158]/12 px-2 py-0.5 text-[10px] font-semibold text-[#86EFAC]">
                Zero-Retention · 1 Clic
              </span>
            </div>
            <p className="text-[11.5px] text-[#9A9AA2]">
              Flujo guiado en 3 pasos para iPhone y Android con destrucción automática de copias temporales.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={scanningDevices || auditing}
          onClick={() => void refreshDevices()}
          className="inline-flex items-center gap-1.5 rounded-[8px] border border-white/[0.10] bg-white/[0.04] hover:bg-white/[0.09] px-2.5 py-1.5 text-[11.5px] text-[#DCE6FF] cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${scanningDevices ? 'animate-spin' : ''}`} />
          <span>Detectar por USB</span>
        </button>
      </div>

      {/* Indicador de los 3 pasos en lenguaje natural */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {[
          { step: 1, title: '1. Conectar', desc: selectedDevice ? `${selectedDevice.deviceName} (${selectedDevice.platform})` : 'Enchufa tu iPhone o Android por cable USB' },
          {
            step: 2,
            title: '2. Autorizar en pantalla',
            desc: selectedDevice
              ? selectedDevice.userInstruction
              : 'Acepta Confiar / Depuración USB en tu teléfono',
          },
          {
            step: 3,
            title: '3. Analizar y borrar rastros',
            desc: 'Escaneo MVT + borrado inmediato de archivos temporales',
          },
        ].map((item) => {
          const active = currentStep === item.step;
          const done = currentStep > item.step || Boolean(auditResult);
          return (
            <div
              key={item.step}
              className={`rounded-[10px] border p-2.5 transition-all ${
                done
                  ? 'border-[#30D158]/35 bg-[#30D158]/08'
                  : active
                    ? 'border-[#2F6FED]/55 bg-[#2F6FED]/12'
                    : 'border-white/[0.07] bg-black/25'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11.5px] font-semibold text-[#F2F2F4]">{item.title}</span>
                {done && <CheckCircle2 className="h-3.5 w-3.5 text-[#30D158] shrink-0" />}
              </div>
              <p className="mt-1 text-[11px] text-[#9A9AA2] leading-snug">{item.desc}</p>
            </div>
          );
        })}
      </div>

      {selectedDevice && (
        <div className="rounded-[10px] border border-white/[0.08] bg-black/30 p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-[#F2F2F4]">
              <span
                className={`h-2 w-2 rounded-full ${
                  selectedDevice.authorized ? 'bg-[#30D158]' : 'bg-[#FF9F0A]'
                }`}
              />
              <span>
                {selectedDevice.deviceName} · {selectedDevice.osVersion}
              </span>
              <span className="font-mono text-[10.5px] text-[#9A9AA2]">
                ({selectedDevice.state})
              </span>
            </div>
            <p className="text-[11.5px] text-[#C2C7D6]">{selectedDevice.userInstruction}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedDevice.platform === 'IOS' && selectedDevice.authorized && (
              <div className="relative flex items-center">
                <Lock className="h-3 w-3 text-[#9A9AA2] absolute left-2.5 pointer-events-none" />
                <input
                  type="password"
                  value={backupPassword}
                  onChange={(e) => setBackupPassword(e.target.value)}
                  placeholder="Clave backup iOS (opcional)"
                  className="h-8.5 pl-7 pr-2.5 rounded-[8px] bg-[#141418] border border-white/[0.10] text-[11.5px] text-[#F2F2F4] focus:outline-none focus:border-[#2F6FED]"
                />
              </div>
            )}

            <button
              type="button"
              disabled={!selectedDevice.authorized || auditing}
              onClick={() => void handleRunAudit()}
              className="h-8.5 px-3.5 rounded-[8px] bg-[#2F6FED] hover:brightness-110 disabled:opacity-45 text-[12px] font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              {auditing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Analizando...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>Iniciar análisis en 1 clic</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {!selectedDevice && tooling && (
        <div className="text-[11.5px] text-[#9A9AA2] flex flex-wrap items-center justify-between gap-2 px-1">
          <span>
            Conecta tu iPhone o Android con cable USB y pulsa <strong>Detectar por USB</strong>.
          </span>
        </div>
      )}

      {auditing && (
        <div className="rounded-[10px] border border-[#2F6FED]/40 bg-[#0A0A0C]/85 p-3 space-y-2">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-medium text-[#DCE6FF]">{progressMsg}</span>
            <span className="font-mono text-[11px] text-[#8BB2FF]">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#2F6FED] to-[#30D158] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-[#9A9AA2]">
            {PROGRESS_STAGES.map((st) => (
              <span key={st.key} className={progressMsg === st.label ? 'text-[#F2F2F4] font-medium' : ''}>
                • {st.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-[9px] border border-[#FF453A]/35 bg-[#FF453A]/12 px-3 py-2 text-[12px] text-[#FFDAD6]">
          {errorMsg}
        </div>
      )}

      {auditResult && (
        <div className="rounded-[12px] border border-white/[0.10] bg-[#0A0A0C]/85 p-3.5 space-y-3">
          {['HIGH', 'CRITICAL'].includes(auditResult.riskLevel) && <>
            <EmergencyGuidance mobile />
            <p className="text-xs text-[#B7B7C0]">La contención disponible protege la computadora; no instala reglas en el teléfono.</p>
            {(auditResult.ctiMatches || []).slice(0, 3).map((finding, index) => <ContainmentButton key={index} finding={finding} />)}
          </>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {auditResult.riskLevel === 'HIGH' ? (
                <ShieldAlert className="h-4.5 w-4.5 text-[#FF453A]" />
              ) : (
                <ShieldCheck className="h-4.5 w-4.5 text-[#30D158]" />
              )}
              <span className="text-[13px] font-semibold text-[#F2F2F4]">
                {auditResult.verdictLabel}
              </span>
            </div>
            {auditResult.zeroRetentionWiped && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#30D158]/35 bg-[#30D158]/10 px-2.5 py-0.5 text-[10.5px] text-[#86EFAC]">
                <Trash2 className="h-3 w-3" />
                <span>Copia temporal destruida</span>
              </span>
            )}
          </div>

          {Array.isArray(auditResult.recommendedActions) && auditResult.recommendedActions.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11.5px] font-medium text-[#C2C7D6]">
                Acciones recomendadas:
              </div>
              <ul className="space-y-1 text-[11.5px] text-[#9A9AA2] list-disc pl-4">
                {auditResult.recommendedActions.map((act, i) => (
                  <li key={i}>{act}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-1 border-t border-white/[0.06] flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowTechnical((v) => !v)}
              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#8BB2FF] hover:text-white cursor-pointer"
            >
              {showTechnical ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <span>
                {showTechnical ? 'Ocultar evidencia técnica forense' : 'Ver evidencia técnica forense'}
              </span>
            </button>
            <span className="font-mono text-[10.5px] text-[#7C7D87]">
              SHA-256: {String(auditResult.artifactSha256 || '').slice(0, 16)}…
            </span>
          </div>

          {showTechnical && (
            <div className="rounded-[9px] border border-white/[0.07] bg-black/40 p-2.5 font-mono text-[11px] text-[#C2C7D6] space-y-1">
              <div>Plataforma: {auditResult.platform} · Modelo Hash: {auditResult.deviceModelHash}</div>
              <div>Registros en streaming SQLite/WAL: {auditResult.rowsStreamed} · Indicadores: {auditResult.indicatorsAnalyzed}</div>
              <div>Coincidencias CTI: {(auditResult.ctiMatches || []).length} · Anomalías: {(auditResult.behavioralAnomalies || []).length}</div>
              <div className="text-[#86EFAC]">{auditResult.ephemeralNotice}</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
