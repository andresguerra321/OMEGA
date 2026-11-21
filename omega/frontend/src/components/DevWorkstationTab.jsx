import { useState } from 'react';
import { AlertTriangle, Check, Laptop, Play, ShieldCheck } from 'lucide-react';
import { auditDevWorkstationPosture } from '../lib/api';

export function DevWorkstationTab() {
  const [consent, setConsent] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleRunAudit(e) {
    e?.preventDefault?.();
    if (!consent || running) return;
    setRunning(true);
    setError('');
    try {
      const res = await auditDevWorkstationPosture({
        consentConfirmed: true,
        inspectLocalHostMetadata: true,
      });
      setResult(res);
    } catch (err) {
      setError(err?.message || 'No se pudo completar la auditoría de la estación de trabajo.');
    } finally {
      setRunning(false);
    }
  }

  const controls = Array.isArray(result?.controls) ? result.controls : [];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
              <Laptop className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Mi Estación de Trabajo — Postura contra Robo de Credenciales
              </h2>
              <p className="text-xs text-slate-400">
                Auditoría local en solo lectura de metadatos (permisos en ~/.ssh, presencia de ~/.npmrc/.pypirc y nombres de variables de entorno) sin abrir ni leer secretos.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={!consent || running}
            onClick={handleRunAudit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#2558C7] disabled:opacity-50 px-4 py-2 text-xs font-medium text-white transition-colors cursor-pointer"
          >
            <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>{running ? 'Auditando metadatos...' : 'Auditar mi estación (solo lectura)'}</span>
          </button>
        </div>

        <div className="rounded-xl bg-[#141923]/65 border border-white/[0.06] p-4 flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-100">
              Consentimiento explícito de inspección en solo lectura
            </p>
            <p className="text-[11px] text-slate-400">
              Autorizo a OMEGA a comprobar únicamente la existencia de archivos de configuración y nombres de variables en esta sesión, sin leer ni almacenar llaves privadas ni tokens.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={consent}
            aria-label="Autorizar auditoría en solo lectura de mi estación"
            onClick={() => setConsent((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer shrink-0 ${
              consent
                ? 'bg-emerald-500/15 border border-emerald-400/35 text-emerald-300'
                : 'bg-[#0F131B] border border-white/[0.08] text-slate-400 hover:text-slate-200'
            }`}
          >
            {consent && <Check className="h-3.5 w-3.5" strokeWidth={1.75} />}
            <span>{consent ? 'Consentimiento activo' : 'Autorizar revisión'}</span>
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300"
          >
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4 pt-2 border-t border-white/[0.06]">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
              <span>
                Controles evaluados: <strong className="text-slate-100">{result.controlsEvaluated}</strong> ·{' '}
                Advertencias: <strong className={result.warningsCount > 0 ? 'text-amber-300' : 'text-emerald-300'}>{result.warningsCount}</strong>
              </span>
              <span className="text-[11px] text-slate-400">{result.zeroRetentionNotice}</span>
            </div>

            <div className="divide-y divide-white/[0.06] rounded-xl bg-[#141923]/60 border border-white/[0.05]">
              {controls.map((ctrl) => (
                <div key={ctrl.controlId} className="p-4 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-[#60A5FA]">
                        {ctrl.controlId}
                      </span>
                      <h3 className="text-xs font-semibold text-slate-100">
                        {ctrl.title}
                      </h3>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                        ctrl.status === 'WARN'
                          ? 'border border-amber-400/35 bg-amber-400/10 text-amber-300'
                          : 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                      }`}
                    >
                      {ctrl.status === 'WARN' ? (
                        <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
                      ) : (
                        <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
                      )}
                      <span>{ctrl.status}</span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">{ctrl.summary}</p>
                  <p className="text-[11px] text-slate-400">
                    <strong className="text-slate-200">Recomendación:</strong> {ctrl.remediation}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
