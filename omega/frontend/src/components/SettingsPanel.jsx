import { useEffect, useState } from 'react';
import { Lock, Database, RotateCcw, FileCheck2 } from 'lucide-react';
import { fetchSystemGovernance } from '../lib/api';

export function SettingsPanel({ topK, onChangeTopK }) {
  const [gov, setGov] = useState(null);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    fetchSystemGovernance()
      .then(setGov)
      .catch(() => setGov(null));
  }, []);

  function handleResetWorkspace() {
    localStorage.removeItem('omega_workspace_id');
    setResetDone(true);
    setTimeout(() => window.location.reload(), 700);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-1">
        <h2 className="text-base font-semibold">Ajustes — Cuenta, Privacidad y Permisos</h2>
        <p className="text-xs text-zinc-400">
          Gestiona tu identificador de sesión local, las garantías de privacidad de datos y el registro de fuentes indexadas (RF7, RNF4, RNF8).
        </p>
      </div>

      {/* Sesión / Cuenta Local */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4 text-xs">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-zinc-100">Espacio de trabajo local</p>
            <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
              ID de sesión: {gov?.workspace_id || localStorage.getItem('omega_workspace_id') || 'default_analyst'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleResetWorkspace}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-zinc-300 hover:border-rose-500/50 hover:text-rose-300 transition"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{resetDone ? 'Reiniciando...' : 'Rotar ID de sesión'}</span>
          </button>
        </div>

        <div className="border-t border-zinc-800/80 pt-4 flex items-center justify-between">
          <div>
            <p className="font-medium text-zinc-200">Fragmentos recuperados por consulta RAG (Top-K)</p>
            <p className="text-[11px] text-zinc-500">Define cuántas fuentes documentales se evalúan por pregunta</p>
          </div>
          <select
            value={topK}
            onChange={(e) => onChangeTopK(Number(e.target.value))}
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200"
          >
            <option value={4}>4 fragmentos (Rápido)</option>
            <option value={6}>6 fragmentos (Balanceado)</option>
            <option value={10}>10 fragmentos (Exhaustivo)</option>
          </select>
        </div>
      </div>

      {/* Permisos y Salvaguardas Éticas (RNF4, RNF7, RNF8) */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3 text-xs">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold">
          <Lock className="h-4 w-4" />
          <span>Permisos y Límites Éticos Activos</span>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-1">
            <p className="font-medium text-zinc-100">Procesamiento Forense Volátil (RNF4)</p>
            <p className="text-[11px] text-zinc-400">
              Activo. Los archivos subidos en &ldquo;Revisar mi equipo&rdquo; se analizan en RAM y nunca se guardan en disco ni base de datos.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-1">
            <p className="font-medium text-zinc-100">Consentimiento OSINT Obligatorio (RNF8)</p>
            <p className="text-[11px] text-zinc-400">
              Activo ({gov?.consented_osint_assets ?? 0} activos propios autorizados en esta sesión). Prohibida la consulta sobre terceros.
            </p>
          </div>
        </div>
      </div>

      {/* Auditoría del Corpus Indexado (RF7) */}
      {gov && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-zinc-100">
              <Database className="h-4 w-4 text-emerald-400" />
              <span>Base de Inteligencia Indexada (RF7)</span>
            </div>
            <div className="flex gap-3 text-[11px] text-zinc-400">
              <span>{gov.corpus_stats.reports} reportes</span>
              <span>·</span>
              <span>{gov.corpus_stats.campaigns} campañas</span>
              <span>·</span>
              <span>{gov.corpus_stats.iocs} IOCs</span>
            </div>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {gov.indexed_sources?.map((rep, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-950/60 px-3.5 py-2.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileCheck2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate text-zinc-200">{rep.title}</span>
                </div>
                <span className="shrink-0 ml-3 text-[11px] text-zinc-500">
                  {rep.organization}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
