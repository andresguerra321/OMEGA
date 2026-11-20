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

export function SaasFleetCard({ authSession, mode = 'full', embedded = false }) {
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
        sensorVersion: '2.0.8',
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

  const showQuota = mode === 'full' || mode === 'quota';
  const showFleet = mode === 'full' || mode === 'fleet';

  const content = (
    <>
      {!embedded && (
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
      )}

      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
          {error}
        </div>
      )}

      {showQuota && (
        <div>
          <div className="pb-5 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-white">Plan comercial activo</div>
              <p className="mt-0.5 text-xs text-[#8E95A5]">
                {sub ? (
                  <>
                    Plan <strong className="text-white">{sub.planCode}</strong> · Estado{' '}
                    <span className="text-emerald-300">{sub.status}</span> · Límite {sub.activeDevices}/{sub.maxDevices} equipos
                  </>
                ) : (
                  'Cargando información del plan...'
                )}
              </p>
            </div>
            {isAdmin && sub && (
              <div className="flex items-center gap-1.5">
                {PLAN_OPTIONS.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => handlePlanChange(code)}
                    disabled={busyAction === code || sub.planCode === code}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                      sub.planCode === code
                        ? 'bg-[#2F6FED] text-white'
                        : 'border border-white/[0.08] bg-white/[0.03] text-[#B8BCC8] hover:bg-white/[0.08]'
                    }`}
                  >
                    {code}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="py-5 border-b border-white/[0.07] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-white">
                  Cuota IA Cloud {quota ? `(${quota.periodYm})` : ''}
                </div>
                <p className="mt-0.5 text-xs text-[#8E95A5]">
                  Consultas acumuladas en proveedores cloud durante el periodo actual.
                </p>
              </div>
              {quota && (
                <div className="font-tech text-sm font-semibold text-white">
                  {quota.cloudUsed} <span className="text-xs font-normal text-[#8E95A5]">/ {quota.cloudLimit}</span>
                </div>
              )}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-[#2F6FED] transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="pt-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Cpu className="h-4 w-4 text-[#2F6FED]" />
                <span>Modo Soberano Local (Ollama)</span>
              </div>
              <p className="mt-0.5 text-xs text-[#8E95A5]">
                Ejecución local sin consumo de cuota cloud ni envío de datos fuera de tu equipo.
              </p>
            </div>
            <div className="text-right">
              <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                Ilimitado
              </span>
              {quota && (
                <div className="font-tech mt-1 text-[11px] text-[#8E95A5]">
                  {quota.sovereignUsed} consultas locales
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showFleet && (
        <div>
          <div className="pb-5 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-white">Equipos vinculados</div>
              <p className="mt-0.5 text-xs text-[#8E95A5]">
                {sub
                  ? `${sub.activeDevices} de ${sub.maxDevices} dispositivos permitidos en tu plan ${sub.planCode}.`
                  : 'Registra este equipo para habilitar el monitoreo y revocación remota.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleHeartbeatCurrent}
                disabled={busyAction === 'heartbeat'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#2F6FED]/40 bg-[#2F6FED]/15 px-3 py-1.5 text-xs font-medium text-[#DCE8FF] hover:bg-[#2F6FED]/25 cursor-pointer disabled:opacity-50"
              >
                <Laptop className="h-3.5 w-3.5" />
                <span>Registrar este equipo</span>
              </button>
              <button
                type="button"
                onClick={loadSummary}
                disabled={loading}
                aria-label="Actualizar flota"
                className="inline-flex items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04] p-1.5 text-[#9A9AA2] hover:text-white cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="py-5 border-b border-white/[0.07]">
            {devices.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-[#D4D7E0]">
                  <thead className="border-b border-white/[0.07] text-[11px] uppercase text-[#8E95A5]">
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
                        <td className="py-2.5 pr-3 font-medium text-white">{d.hostname}</td>
                        <td className="py-2.5 pr-3 text-[#8E95A5]">{d.osPlatform}</td>
                        <td className="py-2.5 pr-3">
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
                        <td className="py-2.5 pr-3 font-tech text-[11px] text-[#8E95A5]">{d.lastHeartbeatAt}</td>
                        {isAdmin && (
                          <td className="py-2.5 text-right">
                            {d.status === 'ACTIVE' && (
                              <button
                                type="button"
                                onClick={() => handleRevoke(d.id)}
                                disabled={busyAction === d.id}
                                className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/20 cursor-pointer"
                              >
                                <Trash2 className="h-3 w-3" />
                                <span>Revocar</span>
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-[#8E95A5]">
                No hay equipos registrados aún. Pulsa «Registrar este equipo» para vincular el dispositivo actual.
              </div>
            )}
          </div>

          <div className="pt-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                  <span>Alertas fuera de banda</span>
                </div>
                <p className="mt-0.5 text-xs text-[#8E95A5]">
                  Comprueba la entrega de alertas críticas hacia tus canales configurados.
                </p>
              </div>
              <button
                type="button"
                onClick={handleTestAlert}
                disabled={busyAction === 'alert'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-[#E5E7EB] hover:bg-white/[0.08] cursor-pointer disabled:opacity-50"
              >
                <Bell className="h-3.5 w-3.5" />
                <span>Probar alerta</span>
              </button>
            </div>

            <div className="space-y-1.5 text-xs text-[#B8BCC8]">
              {(summary?.recentAlerts || []).slice(0, 4).map((a) => (
                <div key={a.id} className="truncate">
                  <span className={a.delivered ? 'text-emerald-300' : 'text-amber-300'}>[{a.channel}]</span>{' '}
                  {a.title}
                </div>
              ))}
              {(!summary?.recentAlerts || summary.recentAlerts.length === 0) && (
                <div className="text-xs text-[#7E8290]">Sin alertas externas despachadas aún.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <section
      aria-label="Suscripción, cuota de IA y flota de dispositivos"
      className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6"
    >
      <div className="rounded-[18px] border border-white/[0.08] bg-[#101218]/85 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.4)]">
        {content}
      </div>
    </section>
  );
}
