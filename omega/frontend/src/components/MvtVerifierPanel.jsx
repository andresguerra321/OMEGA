import { useState } from 'react';
import {
  Upload,
  Lock,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Cpu,
  Network,
  Database,
  CheckCircle2,
} from 'lucide-react';
import { runParallelTriage } from '../lib/api';

const AGENT_ICONS = {
  subagent_a_messaging: Database,
  subagent_b_network: Network,
  subagent_c_processes: Cpu,
};

export function MvtVerifierPanel() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleMultiUpload(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const data = await runParallelTriage(files);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }

  const verdictStyles = {
    CLEAN: 'border-emerald-800/60 bg-emerald-950/25 text-emerald-200',
    LIKELY_FALSE_POSITIVE: 'border-amber-700/60 bg-amber-950/25 text-amber-200',
    SUSPICIOUS_SINGLE_VECTOR: 'border-orange-700/60 bg-orange-950/25 text-orange-200',
    CORROBORATED_INFECTION_PATTERN: 'border-rose-700/70 bg-rose-950/30 text-rose-200',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">
            Orquestador de Triage Forense Paralelo (3 Subagentes)
          </h2>
          <p className="text-xs text-zinc-400">
            Carga simultáneamente respaldos SQLite (<code className="text-zinc-300">sms.db</code>, <code className="text-zinc-300">History.db</code>), logs DNS/red y volcados de procesos (<code className="text-zinc-300">shutdown_log.json</code>, <code className="text-zinc-300">.ips</code>) para correlación multi-vectorial.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-1.5 text-[11px] text-emerald-300">
          <Lock className="h-3.5 w-3.5" />
          <span>SQLite y JSON en RAM (RNF4)</span>
        </div>
      </div>

      {/* Zona de carga múltiple */}
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/20 p-8 text-center hover:border-emerald-500/50 hover:bg-zinc-900/40 transition">
        <Upload className="mb-2.5 h-7 w-7 text-emerald-400" />
        <span className="text-sm font-medium text-zinc-100">
          {loading
            ? 'Orquestando Subagentes A, B y C en paralelo...'
            : 'Seleccionar uno o varios artefactos forenses (JSON, SQLite .db, .ips, .txt)'}
        </span>
        <span className="mt-1 text-xs text-zinc-500">
          El orquestador enruta cada evidencia al subagente especializado y evalúa convergencia de patrones
        </span>
        <input
          type="file"
          multiple
          accept=".json,.db,.sqlite,.sqlite3,.ips,.txt,.log,.csv"
          onChange={handleMultiUpload}
          className="hidden"
        />
      </label>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {result && (
        <div className="space-y-5">
          {/* Diagnóstico Principal: Falso Positivo vs Infección Real */}
          <div
            className={`rounded-2xl border p-5 space-y-3 ${
              verdictStyles[result.diagnosis?.verdict_code] || 'border-zinc-800 bg-zinc-900/40'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {result.diagnosis?.verdict_code === 'CLEAN' ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                ) : result.diagnosis?.is_likely_false_positive ? (
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                ) : (
                  <ShieldAlert className="h-5 w-5 text-rose-400" />
                )}
                <h3 className="text-sm font-semibold">{result.diagnosis?.verdict_label}</h3>
              </div>
              <span className="rounded-md border border-current/30 px-2.5 py-0.5 text-[11px] font-medium">
                Confianza: {result.diagnosis?.confidence} · {result.total_matches} IOCs · {result.total_indicators_analyzed} evaluados
              </span>
            </div>

            <p className="text-xs leading-relaxed opacity-90">{result.diagnosis?.rationale}</p>

            {result.diagnosis?.recommended_actions?.length > 0 && (
              <div className="pt-1 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider opacity-75">
                  Acciones defensivas recomendadas:
                </p>
                <ul className="list-disc pl-4 space-y-1 text-xs opacity-90">
                  {result.diagnosis.recommended_actions.map((act, i) => (
                    <li key={i}>{act}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Tarjetas de estado de los 3 Subagentes Paralelos */}
          <div className="grid gap-3 md:grid-cols-3">
            {result.subagents?.map((ag) => {
              const Icon = AGENT_ICONS[ag.agent_id] || ShieldCheck;
              return (
                <div
                  key={ag.agent_id}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="h-4 w-4 text-emerald-400" />
                    <span
                      className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                        ag.matches_count > 0
                          ? 'bg-rose-950 text-rose-300 border border-rose-800/50'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {ag.matches_count} hits
                    </span>
                  </div>
                  <p className="font-semibold text-zinc-100 leading-snug">{ag.agent_name}</p>
                  <p className="text-[11px] text-zinc-400">
                    Archivos: {ag.files_processed} · Artefactos: {ag.indicators_extracted}
                  </p>
                  {ag.notes?.length > 0 && (
                    <p className="text-[11px] text-zinc-500 border-t border-zinc-800/80 pt-2">
                      {ag.notes[0]}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Detalle de coincidencias por subagente */}
          {result.subagents?.some((ag) => ag.matches?.length > 0) && (
            <div className="space-y-2.5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Evidencia Correlacionada por Vector
              </h4>
              {result.subagents.map((ag) =>
                ag.matches.map((m, idx) => (
                  <div
                    key={`${ag.agent_id}-${idx}`}
                    className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-3.5 text-xs space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-rose-200">
                        [{m.ioc_type.toUpperCase()}] {m.ioc_value}
                      </span>
                      <span className="text-[11px] text-emerald-300">{ag.agent_name}</span>
                    </div>
                    <p className="text-zinc-300">
                      Origen: {m.artifact_origin} · Campaña: <strong>{m.campaign}</strong> ({m.spyware_family})
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      Fuente: {m.source_report} ({m.organization})
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
