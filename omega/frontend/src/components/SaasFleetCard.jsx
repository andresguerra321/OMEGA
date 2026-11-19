import { useCallback, useEffect, useState } from 'react';
import { Bell, Cpu, Laptop, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import {
  dispatchTestAlert,
  fetchSaasSummary,
  revokeFleetDevice,
  sendDeviceHeartbeat,
  updateSubscriptionPlan,
} from '../lib/api';

const PLAN_OPTIONS = ['PERSONAL', 'PRO', 'ENTERPRISE'];

export function SaasFleetCard({ authSession }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const isAdmin = String(authSession?.role || '').toUpperCase() === 'ADMIN';

  const loadSummary = useCallback(async () => {
    if (!authSession) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchSaasSummary();
      setSummary(data);
    } catch (err) {
      setError(err?.message || 'No se pudo cargar el estado de suscripción y flota.');
    } finally {
      setLoading(false);
    }
  }, [authSession]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  async function handleHeartbeatCurrent() {
    setBusyAction('heartbeat');
    setNotice('');
    setError('');
    try {
      const uid =
        window.localStorage.getItem('omega_device_uid') ||
        (() => {
          const generated = `omega-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          window.localStorage.setItem('omega_device_uid', generated);
          return generated;
        })();
      await sendDeviceHeartbeat({
        deviceUid: uid,
        hostname: navigator.platform || 'equipo-omega',
        osPlatform: navigator.userAgentData?.platform || navigator.platform || 'desktop',
        sensorVersion: '1.10.1',
      });
      setNotice('Heartbeat enviado y equipo registrado en tu flota.');
      await loadSummary();
    } catch (err) {
      setError(err?.message || 'No se pudo registrar este dispositivo.');
    } finally {
      setBusyAction('');
    }
  }

  async function handleRevoke(deviceId) {
    setBusyAction(deviceId);
    setNotice('');
    setError('');
    try {
      await revokeFleetDevice(deviceId);
      setNotice('Dispositivo revocado remotamente.');
      await loadSummary();
    } catch (err) {
      setError(err?.message || 'No se pudo revocar el dispositivo.');
    } finally {
      setBusyAction('');
    }
  }

  async function handlePlanChange(planCode) {
    setBusyAction(planCode);
    setNotice('');
    setError('');
    try {
      await updateSubscriptionPlan(planCode);
      setNotice(`Plan actualizado a ${planCode}.`);
      await loadSummary();
    } catch (err) {
      setError(err?.message || 'No se pudo cambiar el plan.');
    } finally {
      setBusyAction('');
    }
  }

  async function handleTestAlert() {
    setBusyAction('alert');
    setNotice('');
    setError('');
    try {
      const res = await dispatchTestAlert({
        severity: 'HIGH',
        title: 'Prueba de alerta crítica OMEGA',
        message: 'Verificación de entrega fuera de banda desde el panel de flota.',
      });
      const first = res?.results?.[0];
      setNotice(first ? `${first.channel}: ${first.detail}` : 'Despacho registrado.');
      await loadSummary();
    } catch (err) {
      setError(err?.message || 'No se pudo despachar la alerta de prueba.');
    } finally {
      setBusyAction('');
    }
  }

  if (!authSession) return null;

  const sub = summary?.subscription;
  const quota = summary?.aiQuota;
  const devices = summary?.devices || [];
  const pct =
    quota && quota.cloudLimit > 0
      ? Math.min(100, Math.round((quota.cloudUsed / quota.cloudLimit) * 100))
      : 0;

  return (
    <section
      aria-label="Suscripción, cuota de IA y flota de dispositivos"
      className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6"
    >
      <div className="rounded-[18px] border border-white/[0.08] bg-[#101218]/85 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.4)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-[#2F6FED]" />
            <div>
              <h2 className="text-[15px] font-semibold text-[#F2F2F4]">
                Plan comercial, cuota IA y flota de dispositivos
              </h2>
              <p className="text-[12px] text-[#9A9AA2]">
                Control de equipos vinculados, límites cloud y alertas fuera de banda.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleHeartbeatCurrent}
              disabled={busyAction === 'heartbeat'}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#2F6FED]/40 bg-[#2F6FED]/15 px-3 py-1.5 text-[12px] font-medium text-[#DCE8FF] hover:bg-[#2F6FED]/25 cursor-pointer disabled:opacity-50"
            >
              <Laptop className="h-3.5 w-3.5" />
              Registrar este equipo
            </button>
            <button
              type="button"
              onClick={handleTestAlert}
              disabled={busyAction === 'alert'}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-[12px] font-medium text-[#E5E7EB] hover:bg-white/[0.08] cursor-pointer disabled:opacity-50"
            >
              <Bell className="h-3.5 w-3.5" />
              Probar alerta
            </button>
            <button
              type="button"
              onClick={loadSummary}
              disabled={loading}
              aria-label="Actualizar flota"
              className="inline-flex items-center justify-center rounded-[10px] border border-white/[0.1] bg-white/[0.04] p-1.5 text-[#9A9AA2] hover:text-white cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {notice && (
          <div className="mt-3 rounded-[10px] border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-200">
            {notice}
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-[10px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
            {error}
          </div>
        )}

        {sub && quota && (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-[12px] border border-white/[0.07] bg-white/[0.02] p-3.5">
              <div className="text-[11px] uppercase tracking-wider text-[#8E93A4]">Plan activo</div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-[18px] font-semibold text-white">{sub.planCode}</span>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                  {sub.status}
                </span>
              </div>
              <div className="mt-2 text-[12px] text-[#9A9AA2]">
                Equipos activos: <strong className="text-white">{sub.activeDevices}</strong> / {sub.maxDevices}
              </div>
              {isAdmin && (
                <div className="mt-3 flex gap-1.5">
                  {PLAN_OPTIONS.map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => handlePlanChange(code)}
                      disabled={busyAction === code || sub.planCode === code}
                      className={`rounded-[7px] px-2 py-1 text-[10px] font-medium transition cursor-pointer ${
                        sub.planCode === code
                          ? 'bg-[#2F6FED] text-white'
                          : 'bg-white/[0.05] text-[#B8BCC8] hover:bg-white/[0.1]'
                      }`}
                    >
                      {code}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[12px] border border-white/[0.07] bg-white/[0.02] p-3.5">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[#8E93A4]">
                <span>Cuota IA Cloud ({quota.periodYm})</span>
                <Cpu className="h-3.5 w-3.5 text-[#2F6FED]" />
              </div>
              <div className="mt-1 text-[18px] font-semibold text-white">
                {quota.cloudUsed} <span className="text-[12px] font-normal text-[#9A9AA2]">/ {quota.cloudLimit}</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full bg-[#2F6FED] transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-2 text-[11px] text-[#9A9AA2]">
                Modo Soberano (Ollama): <strong className="text-emerald-300">Ilimitado</strong> ({quota.sovereignUsed} usadas)
              </div>
            </div>

            <div className="rounded-[12px] border border-white/[0.07] bg-white/[0.02] p-3.5">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[#8E93A4]">
                <span>Alertas recientes</span>
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
              </div>
              <div className="mt-2 space-y-1.5 text-[11px] text-[#B8BCC8]">
                {(summary?.recentAlerts || []).slice(0, 3).map((a) => (
                  <div key={a.id} className="truncate">
                    <span className={a.delivered ? 'text-emerald-300' : 'text-amber-300'}>[{a.channel}]</span>{' '}
                    {a.title}
                  </div>
                ))}
                {(!summary?.recentAlerts || summary.recentAlerts.length === 0) && (
                  <div className="text-[#7E8290]">Sin alertas externas despachadas aún.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {devices.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-[12px] text-[#D4D7E0]">
              <thead className="border-b border-white/[0.07] text-[11px] uppercase text-[#8E93A4]">
                <tr>
                  <th className="py-2 pr-3">Equipo</th>
                  <th className="py-2 pr-3">Plataforma</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3">Último heartbeat</th>
                  {isAdmin && <th className="py-2 text-right">Acción</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 pr-3 font-medium text-white">{d.hostname}</td>
                    <td className="py-2 pr-3 text-[#9A9AA2]">{d.osPlatform}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          d.status === 'ACTIVE'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-red-500/15 text-red-300'
                        }`}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-[#9A9AA2]">{d.lastHeartbeatAt}</td>
                    {isAdmin && (
                      <td className="py-2 text-right">
                        {d.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => handleRevoke(d.id)}
                            disabled={busyAction === d.id}
                            className="inline-flex items-center gap-1 rounded-[7px] border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/20 cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3" />
                            Revocar
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
