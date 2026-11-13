import { useState } from 'react';
import { Link2, ShieldAlert, ShieldCheck, AlertTriangle, Lock, ExternalLink } from 'lucide-react';
import { verifySuspiciousLink } from '../lib/api';

export function LinkVerifierPanel() {
  const [urlInput, setUrlInput] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCheck(e) {
    e.preventDefault();
    if (!urlInput.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      const data = await verifySuspiciousLink(urlInput.trim());
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const riskBadge = {
    HIGH: 'border-rose-700/70 bg-rose-950/30 text-rose-200',
    MEDIUM: 'border-amber-700/60 bg-amber-950/25 text-amber-200',
    LOW: 'border-emerald-800/60 bg-emerald-950/25 text-emerald-200',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Verificar enlace antes de abrirlo</h2>
          <p className="text-xs text-zinc-400">
            Pega una URL sospechosa recibida por SMS, WhatsApp o correo. Omega la cruza contra dominios documentados de spyware comercial sin visitar el sitio.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-1.5 text-[11px] text-emerald-300">
          <Lock className="h-3.5 w-3.5" />
          <span>Inspección 100% pasiva</span>
        </div>
      </div>

      <form onSubmit={handleCheck} className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Link2 className="absolute left-3.5 top-3 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://enlace-sospechoso.ejemplo/ruta..."
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/70 py-2.5 pl-10 pr-4 font-mono text-xs text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !urlInput.trim()}
          className="rounded-xl bg-zinc-100 px-5 py-2.5 text-xs font-medium text-zinc-950 hover:bg-white disabled:opacity-40 transition"
        >
          {loading ? 'Analizando...' : 'Analizar enlace'}
        </button>
      </form>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {result && (
        <div className="space-y-4">
          <div className={`rounded-2xl border p-5 space-y-2.5 ${riskBadge[result.risk_level]}`}>
            <div className="flex items-center gap-2">
              {result.risk_level === 'HIGH' ? (
                <ShieldAlert className="h-5 w-5 text-rose-400" />
              ) : result.risk_level === 'MEDIUM' ? (
                <AlertTriangle className="h-5 w-5 text-amber-400" />
              ) : (
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
              )}
              <h3 className="text-sm font-semibold">{result.verdict}</h3>
            </div>
            <p className="text-xs leading-relaxed opacity-90">{result.recommendation}</p>
            <p className="text-[11px] opacity-75 pt-1">{result.privacy_notice}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 text-xs">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5">
              <p className="text-zinc-500">Host detectado</p>
              <p className="mt-1 font-mono text-zinc-100 break-all">{result.host}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5">
              <p className="text-zinc-500">Dominio raíz</p>
              <p className="mt-1 font-mono text-zinc-100">{result.root_domain || result.host}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5">
              <p className="text-zinc-500">Certificados públicos (crt.sh)</p>
              <p className="mt-1 font-mono text-zinc-100">
                {result.passive_ct_certificates !== null ? `${result.passive_ct_certificates} registros` : 'N/D'}
              </p>
            </div>
          </div>

          {result.heuristics?.length > 0 && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2 text-xs">
              <p className="font-medium text-zinc-300">Señales estructurales detectadas:</p>
              <ul className="list-disc pl-4 space-y-1 text-zinc-400">
                {result.heuristics.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          )}

          {result.cti_matches?.length > 0 && (
            <div className="space-y-2.5 rounded-2xl border border-rose-900/60 bg-rose-950/20 p-4 text-xs">
              <p className="font-semibold text-rose-300">
                Coincidencias en reportes de spyware ({result.cti_matches.length})
              </p>
              {result.cti_matches.map((m, i) => (
                <div key={i} className="rounded-xl border border-rose-900/40 bg-zinc-950/70 p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-rose-200">{m.ioc_value}</span>
                    <span className="rounded bg-rose-950 px-2 py-0.5 text-[11px] text-rose-300">
                      {m.spyware_family}
                    </span>
                  </div>
                  <p className="text-zinc-300">Campaña: {m.campaign}</p>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>{m.source_report} ({m.organization})</span>
                    {m.source_url?.startsWith('http') && (
                      <a href={m.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-400 hover:underline">
                        <span>Fuente</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
