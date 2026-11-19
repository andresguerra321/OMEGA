import { containmentCandidate } from '../lib/containment';
import { useEffect, useRef, useState } from 'react';
import { prepareDesktopHostSensor, getHostRealtimeStatus, toggleHostRealtime, auditHostPersistence } from '../lib/api';
import { ContainmentPanel, ContainmentButton, EmergencyGuidance } from './ContainmentPanel';

const GROUPS = [
  ['PROCESS', 'Procesos y firmas'], ['STARTUP', 'Arranque oculto'],
  ['BROWSER', 'Extensiones de navegador'], ['NETWORK', 'Conexiones de red'],
];

function FindingList({ findings }) {
  const [limit, setLimit] = useState(30);
  return <div className="space-y-2">
    {findings.slice(0, limit).map((finding, index) => <article key={finding.id || index} className="rounded-lg border border-white/10 p-3">
      <p className="text-sm font-medium">{finding.userFriendlyTitle} <span className="text-xs text-[#9A9AA2]">{finding.severity}</span></p>
      <p className="mt-1 text-sm text-[#B7B7C0]">{finding.userFriendlyExplanation}</p>
      <p className="mt-1 text-sm">{finding.recommendedAction}</p>
      {['HIGH', 'CRITICAL'].includes(finding.severity) && <ContainmentButton finding={finding} />}
      <details className="mt-2 text-xs text-[#9A9AA2]">
        <summary className="cursor-pointer">Ver evidencia técnica</summary>
        <dl className="mt-2 grid gap-1 break-all">
          {finding.targetPath && <><dt>Archivo</dt><dd>{finding.targetPath}</dd></>}
          {finding.sha256 && <><dt>SHA-256</dt><dd className="font-mono">{finding.sha256}</dd></>}
          {finding.signatureStatus && <><dt>Verificación</dt><dd>{finding.signatureStatus} · {finding.publisher || 'Firmante no disponible'}</dd></>}
        </dl>
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(finding.evidence || {}, null, 2)}</pre>
      </details>
    </article>)}
    {findings.length > limit && <button type="button" onClick={() => setLimit(limit + 30)} className="rounded border border-white/20 px-3 py-1 text-sm">Mostrar más ({findings.length - limit})</button>}
  </div>;
}

function HostProtectionSession({ expanded, desktop, expedienteId }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [sensorError, setSensorError] = useState('');
  const [busy, setBusy] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [report, setReport] = useState(null);
  const [preparing, setPreparing] = useState(true);
  const [setupFailed, setSetupFailed] = useState(false);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const revision = useRef(0);

  useEffect(() => {
    let disposed = false;
    let timer;
    async function poll() {
      const requestRevision = revision.current;
      try {
        const next = await getHostRealtimeStatus();
        if (!disposed && requestRevision === revision.current) { setStatus(next); setSensorError(''); }
      } catch (err) {
        if (!disposed && requestRevision === revision.current) { setStatus(null); setSensorError(err.message || 'Sensor no disponible'); }
      } finally {
        if (!disposed) timer = setTimeout(poll, 5000);
      }
    }
    setPreparing(true);
    setSetupFailed(false);
    prepareDesktopHostSensor().then((prepared) => {
      if (!disposed) {
        setPreparing(false);
        if (prepared?.status) {
          setStatus(prepared.status);
          timer = setTimeout(poll, 5000);
        } else {
          void poll();
        }
      }
    }).catch(err => {
      if (!disposed) { setPreparing(false); setSetupFailed(true); setSensorError(err.message); }
    });
    return () => { disposed = true; clearTimeout(timer); };
  }, [setupAttempt]);

  async function toggle() {
    setBusy(true);
    setError('');
    revision.current += 1;
    try { setStatus(await toggleHostRealtime(!status.enabled)); setError(''); }
    catch (err) { setError(err.message); }
    finally { revision.current += 1; setBusy(false); }
  }

  async function audit() {
    setAuditing(true);
    setError('');
    setReport(null);
    try { setReport(await auditHostPersistence()); }
    catch (err) { setError(err.message); }
    finally { setAuditing(false); }
  }

  const alerts = status?.alerts || [];
  const native = status?.scope === 'native-host';
  const label = preparing ? 'Preparando la protección de tu computadora…' : sensorError ? 'Protección pendiente' : !status ? 'Comprobando vigilancia…'
    : !native ? 'Vigilancia del equipo no disponible'
      : status.active ? (status.dnsCoverage === 'cache-no-pid' ? 'Vigilancia activa' : 'Vigilancia activa · cobertura parcial') : status.enabled ? 'Vigilancia con cobertura incompleta' : 'Pausada';
  const grouped = {
    PROCESS: (report?.processFindings || []).map(finding => ({ ...finding,
      evidence: report?.processes?.find(proc => finding.artifact === `Proceso PID ${proc.pid}`) || finding,
    })),
    STARTUP: (report?.findings || []).filter(f => f.category !== 'BROWSER'),
    BROWSER: (report?.findings || []).filter(f => f.category === 'BROWSER'),
    NETWORK: alerts,
  };
  return <section aria-label="Protección de esta computadora" className={`relative z-40 shrink-0 border-b border-white/10 bg-[#101116] px-4 py-2 text-[#F2F2F4] ${desktop ? 'pr-36' : ''}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p role="status" className="text-sm"><span className={`mr-2 inline-block h-2 w-2 rounded-full ${status?.active && !sensorError ? 'bg-emerald-400' : 'bg-amber-400'}`} aria-hidden="true" />{label}
        {status?.hostname && <span className="ml-2 text-xs text-[#9A9AA2]">{status.hostname} · {status.indicatorCount} indicadores</span>}
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={!native || busy || !status} onClick={toggle} className="rounded border border-white/20 px-3 py-1 text-xs disabled:opacity-40">{busy ? 'Aplicando…' : status?.enabled ? 'Pausar vigilancia' : 'Activar vigilancia'}</button>
        {expanded && <button type="button" disabled={!native || auditing} onClick={audit} className="rounded bg-[#2F6FED] px-3 py-1 text-xs disabled:opacity-40">{auditing ? 'Revisando equipo…' : 'Revisar procesos y arranque'}</button>}
      </div>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-amber-300">{error}</p>}
    {preparing && <p className="mt-1 text-xs text-[#B7B7C0]">Comprobando la conexión con el sensor de esta computadora.</p>}
    {sensorError && <p role="alert" className="mt-2 text-sm text-amber-300">{sensorError}</p>}
    {setupFailed && <button type="button" onClick={() => { setSensorError(''); setSetupAttempt(value => value + 1); }} className="mt-2 rounded border border-white/20 px-3 py-1 text-xs">Reintentar preparación</button>}
    {status && !native && <p className="mt-1 text-xs text-[#B7B7C0]">{status.notice || 'El servicio está aislado en un contenedor y no observa esta computadora. Conecta un sensor nativo para activar la vigilancia del equipo.'}</p>}
    {alerts.length > 0 && <div role="alert" className="mt-2 rounded border border-red-400/40 bg-red-500/10 p-2 text-sm">
      {alerts.at(-1).userFriendlyTitle}. {alerts.length} alerta(s) conservadas en esta sesión del sensor. La alerta no bloquea tráfico por sí sola; consulta las acciones aplicadas en el historial.
    </div>}
    <ContainmentPanel enabled={native} showHistory={expanded} expedienteId={expedienteId}
      candidates={alerts.filter(alert => ['HIGH', 'CRITICAL'].includes(alert.severity)).map(containmentCandidate).filter(Boolean)} />
    {alerts.some(alert => ['HIGH', 'CRITICAL'].includes(alert.severity)) && <details className="mt-2 text-sm"><summary>Guía de emergencia</summary><EmergencyGuidance /></details>}
    <details className="mt-1 text-xs text-[#9A9AA2]">
      <summary className="cursor-pointer">Alcance y resultados de la vigilancia</summary>
      <div className="mt-2 max-h-[45vh] space-y-3 overflow-y-auto pr-2">
        <p>{status?.notice || 'No hay mediciones disponibles.'}</p>
        <p>Última lectura: {status?.lastCheck ? new Date(status.lastCheck).toLocaleString() : 'Pendiente'} · DNS: {status?.dnsCoverage || 'Sin datos'}</p>
        {(status?.catalogError || status?.sensorError) && <p className="text-amber-300">{status.catalogError} {status.sensorError}</p>}
        {report && <><p>Auditoría: {report.hostname} · {new Date(report.collectedAt).toLocaleString()}. {report.complete ? 'Inventario finalizado.' : 'Inventario con limitaciones.'}</p>
          {report.limitations.length > 0 && <details><summary>Limitaciones ({report.limitations.length})</summary><ul>{report.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
          <details><summary>Inventario de procesos ({report.processes?.length || 0})</summary>
            <FindingList findings={(report.processes || []).map(proc => ({ id: String(proc.pid), userFriendlyTitle: proc.name || 'Proceso sin acceso',
              userFriendlyExplanation: proc.signature?.detail || 'Verificación del ejecutable en disco.', targetPath: proc.exe_path,
              sha256: proc.sha256, signatureStatus: proc.signature?.status, publisher: proc.signature?.publisher, evidence: proc }))} />
          </details></>}
        {GROUPS.map(([key, title]) => <details key={key} open={grouped[key].some(f => ['HIGH', 'CRITICAL'].includes(f.severity))}>
          <summary className="cursor-pointer text-sm text-[#F2F2F4]">{title} ({grouped[key].length})</summary>
          {grouped[key].length ? <FindingList findings={grouped[key]} /> : <p className="py-2">{report || key === 'NETWORK' ? 'No hay hallazgos en las fuentes examinadas.' : 'Ejecuta la auditoría para obtener resultados.'}</p>}
        </details>)}
      </div>
    </details>
  </section>;
}

export function HostProtectionPanel({ session, expanded = false, desktop = false, expedienteId = null }) {
  // This sensor sees machine-wide data; only the owner tenant's administrator can inspect it.
  if (session?.role !== 'ADMIN') return null;
  return <HostProtectionSession key={`${session.tenantId}:${session.email}`} expanded={expanded} desktop={desktop} expedienteId={expedienteId} />;
}
