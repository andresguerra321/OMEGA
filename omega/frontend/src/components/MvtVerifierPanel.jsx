import { useState } from 'react';
import {
  Upload,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Download,
  FileCode2,
  ExternalLink,
} from 'lucide-react';
import { verifyMvtFile, verifyMvtText } from '../lib/api';

export function MvtVerifierPanel() {
  const [iocText, setIocText] = useState('');
  const [mvtResult, setMvtResult] = useState(null);
  const [analyzedFilename, setAnalyzedFilename] = useState('');
  const [loadingMvt, setLoadingMvt] = useState(false);
  const [error, setError] = useState('');

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadingMvt(true);
    setError('');
    try {
      const res = await verifyMvtFile(file);
      setMvtResult(res);
      setAnalyzedFilename(file.name);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMvt(false);
      e.target.value = '';
    }
  }

  async function handleTextVerify(e) {
    e.preventDefault();
    if (!iocText.trim()) return;
    setLoadingMvt(true);
    setError('');
    try {
      const res = await verifyMvtText(iocText);
      setMvtResult(res);
      setAnalyzedFilename('entrada_manual.txt');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMvt(false);
    }
  }

  function downloadEphemeralReport() {
    if (!mvtResult) return;

    const now = new Date().toISOString();
    const lines = [
      '# Reporte Forense de Correlación de IOCs — Omega CTI',
      '',
      `- **Fecha de análisis:** ${now}`,
      `- **Artefacto evaluado:** ${analyzedFilename}`,
      `- **Formato detectado:** ${mvtResult.detected_format}`,
      `- **Indicadores únicos evaluados:** ${mvtResult.analyzed_indicators}`,
      `- **Coincidencias detectadas:** ${mvtResult.total_matches}`,
      `- **Garantía de privacidad (RNF4):** ${mvtResult.ephemeral_notice}`,
      '',
      '## Desglose de Artefactos Extraídos',
      `- Dominios: ${mvtResult.breakdown?.domains ?? 0}`,
      `- Direcciones IPv4: ${mvtResult.breakdown?.ips ?? 0}`,
      `- Hashes SHA-256: ${mvtResult.breakdown?.sha256 ?? 0}`,
      `- URLs / Procesos / Paquetes: ${mvtResult.breakdown?.processes_or_urls ?? 0}`,
      '',
      '## Hallazgos y Correlación con Campañas Documentadas',
      '',
    ];

    if (mvtResult.matches.length === 0) {
      lines.push('No se encontraron coincidencias contra la base de indicadores conocidos indexados en Omega.');
    } else {
      mvtResult.matches.forEach((m, idx) => {
        lines.push(`### ${idx + 1}. [${m.ioc_type.toUpperCase()}] \`${m.ioc_value}\``);
        lines.push(`- **Precisión de coincidencia:** ${m.match_precision}`);
        lines.push(`- **Ubicación en artefacto:** ${m.artifact_origin}`);
        lines.push(`- **Familia / Campaña:** ${m.spyware_family} — ${m.campaign}`);
        lines.push(`- **Fuente:** ${m.source_report} (${m.organization}) — ${m.source_url}`);
        if (m.context) lines.push(`- **Contexto CTI:** ${m.context}`);
        lines.push('');
      });
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `omega_forensic_report_${Date.now()}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Motor Forense de Correlación MVT / IOCs</h2>
          <p className="text-xs text-zinc-400">
            Soporta módulos nativos de Mobile Verification Toolkit (<code className="text-zinc-300">safari_history.json</code>,{' '}
            <code className="text-zinc-300">sms.json</code>, <code className="text-zinc-300">shutdown_log.json</code>,{' '}
            <code className="text-zinc-300">packages.json</code>, <code className="text-zinc-300">timeline.json</code>) y listas ofuscadas (<code className="text-zinc-300">[.]</code>).
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-1.5 text-[11px] text-emerald-300">
          <Lock className="h-3.5 w-3.5" />
          <span>Cero persistencia en servidor (RNF4)</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/20 p-6 text-center hover:border-emerald-500/50 hover:bg-zinc-900/40 transition">
          <Upload className="mb-2 h-6 w-6 text-zinc-400" />
          <span className="text-xs font-medium text-zinc-200">
            Cargar artefacto JSON / CSV / TXT de MVT
          </span>
          <span className="mt-1 text-[11px] text-zinc-500">
            Autodetección de esquema MVT iOS / Android en RAM
          </span>
          <input type="file" accept=".json,.txt,.log,.csv" onChange={handleFileUpload} className="hidden" />
        </label>

        <form onSubmit={handleTextVerify} className="flex flex-col gap-2">
          <textarea
            rows={4}
            value={iocText}
            onChange={(e) => setIocText(e.target.value)}
            placeholder="Pega dominios (incluso ofuscados como evil[.]domain[.]com), URLs, IPs, hashes SHA-256 o procesos..."
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loadingMvt || !iocText.trim()}
            className="self-end rounded-lg bg-zinc-100 px-4 py-2 text-xs font-medium text-zinc-950 hover:bg-white disabled:opacity-40 transition"
          >
            {loadingMvt ? 'Correlacionando...' : 'Analizar indicadores'}
          </button>
        </form>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {mvtResult && (
        <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          {/* Cabecera del resultado forense */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <FileCode2 className="h-4 w-4 text-emerald-400" />
                <span className="font-medium text-zinc-100">{mvtResult.detected_format}</span>
                <span className="text-zinc-500">({analyzedFilename})</span>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] text-zinc-400">
                <span>Dominios: <strong className="text-zinc-200">{mvtResult.breakdown?.domains ?? 0}</strong></span>
                <span>·</span>
                <span>IPs: <strong className="text-zinc-200">{mvtResult.breakdown?.ips ?? 0}</strong></span>
                <span>·</span>
                <span>SHA-256: <strong className="text-zinc-200">{mvtResult.breakdown?.sha256 ?? 0}</strong></span>
                <span>·</span>
                <span>URLs/Procesos: <strong className="text-zinc-200">{mvtResult.breakdown?.processes_or_urls ?? 0}</strong></span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={`rounded-lg border px-3 py-1 text-xs font-medium ${
                  mvtResult.total_matches > 0
                    ? 'border-rose-800/70 bg-rose-950/40 text-rose-300'
                    : 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300'
                }`}
              >
                {mvtResult.total_matches} coincidencias
              </span>

              <button
                type="button"
                onClick={downloadEphemeralReport}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-500 transition"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Exportar informe (.md)</span>
              </button>
            </div>
          </div>

          {mvtResult.matches.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 text-xs text-zinc-300">
              <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>
                Ninguno de los {mvtResult.analyzed_indicators} indicadores únicos extraídos coincide con los IOCs de spyware comercial indexados actualmente.
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              {mvtResult.matches.map((m, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-4 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-rose-400" />
                      <span className="font-mono font-semibold text-rose-200">
                        [{m.ioc_type.toUpperCase()}] {m.ioc_value}
                      </span>
                      <span className="rounded border border-rose-800/60 bg-rose-950/70 px-2 py-0.5 text-[10px] text-rose-300">
                        {m.match_precision}
                      </span>
                    </div>
                    <span className="rounded bg-rose-900/50 px-2.5 py-0.5 font-medium text-rose-100">
                      {m.spyware_family}
                    </span>
                  </div>

                  <div className="grid gap-1 text-zinc-300 sm:grid-cols-2">
                    <p><span className="text-zinc-500">Hallado en:</span> {m.artifact_origin}</p>
                    <p><span className="text-zinc-500">Campaña:</span> {m.campaign}</p>
                  </div>

                  {m.context && (
                    <p className="rounded-lg bg-zinc-950/70 p-2.5 text-[11px] text-zinc-400 border border-zinc-800/70">
                      {m.context}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-1 text-[11px] text-zinc-400">
                    <span>Fuente: {m.source_report} ({m.organization})</span>
                    {m.source_url?.startsWith('http') && (
                      <a
                        href={m.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                      >
                        <span>Ver reporte</span>
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

