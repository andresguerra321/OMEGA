import { useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileArchive,
  PackageSearch,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { scanRepositoryArchive } from '../lib/api';

function severityBadge(severity) {
  const sev = String(severity || 'LOW').toUpperCase();
  if (sev === 'CRITICAL' || sev === 'HIGH') {
    return 'border-rose-500/35 bg-rose-500/10 text-rose-400';
  }
  if (sev === 'MEDIUM') {
    return 'border-amber-400/35 bg-amber-400/10 text-amber-300';
  }
  return 'border-white/[0.12] bg-white/[0.04] text-[#9A9AA2]';
}

export function RepoScannerPanel({ authSession }) {
  const inputId = useId();
  const fileRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [expandedMap, setExpandedMap] = useState({});

  const canScan = authSession?.role === 'ADMIN' || authSession?.role === 'ANALYST';

  async function handleScan(e) {
    e?.preventDefault?.();
    if (!selectedFile || !canScan) return;
    setScanning(true);
    setError('');
    try {
      const data = await scanRepositoryArchive(selectedFile);
      setResult(data);
      setExpandedMap({});
    } catch (err) {
      setError(err?.message || 'No se pudo completar el análisis del archivo.');
    } finally {
      setScanning(false);
    }
  }

  const findings = Array.isArray(result?.findings) ? result.findings : [];
  const overallScore = Number(result?.overall_score ?? 0);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mx-auto max-w-[1120px] space-y-6 pb-16">
        <header className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
                  <PackageSearch className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <h1 className="text-lg font-semibold text-[#F2F2F4]">
                  Análisis de Repositorios y Dependencias
                </h1>
              </div>
              <p className="mt-1.5 text-xs text-[#9A9AA2] max-w-2xl leading-relaxed">
                Inspección estática sin ejecución ni instalación de código de terceros. Evalúa manifiestos, scripts de instalación y señales de cadena de suministro con puntaje explicable.
              </p>
            </div>
            <span className="rounded-full border border-white/[0.08] bg-[#141923]/75 px-3 py-1 font-tech text-[11px] text-[#9A9AA2]">
              Zero-Retention · Solo metadatos
            </span>
          </div>

          <form onSubmit={handleScan} className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              id={inputId}
              ref={fileRef}
              type="file"
              accept=".tar.gz,.tgz,.zip"
              onChange={(e) => {
                setSelectedFile(e.target.files?.[0] || null);
                setError('');
              }}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex-1 min-w-0 flex items-center gap-3 rounded-lg bg-[#141923]/75 border border-white/[0.08] hover:border-white/[0.16] px-3.5 py-2.5 text-left transition-colors cursor-pointer"
            >
              <FileArchive className="h-4 w-4 text-[#8E95A5] shrink-0" strokeWidth={1.75} />
              <span className="text-xs text-[#F2F2F4] truncate">
                {selectedFile ? selectedFile.name : 'Seleccionar archivo comprimido (.tar.gz, .tgz, .zip)'}
              </span>
            </button>

            <button
              type="submit"
              disabled={!selectedFile || scanning || !canScan}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-45 disabled:cursor-not-allowed px-4 py-2.5 text-xs font-medium text-white transition-colors cursor-pointer shrink-0"
            >
              <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>{scanning ? 'Analizando...' : 'Analizar repositorio'}</span>
            </button>
          </form>

          {!canScan && (
            <p className="mt-3 text-xs text-amber-300">
              Tu rol actual ({authSession?.role || 'CLIENT'}) es de solo lectura y no puede iniciar nuevos escaneos.
            </p>
          )}
          {error && (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{error}</span>
            </div>
          )}
        </header>

        {result && (
          <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
              <div>
                <div className="text-xs text-[#8E95A5]">Resultado del escaneo</div>
                <div className="mt-0.5 text-sm font-semibold text-[#F2F2F4]">
                  {findings.length > 0
                    ? `${findings.length} señal(es) detectada(s)`
                    : 'Sin señales detectadas con las reglas actuales'}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-[11px] text-[#8E95A5]">Puntaje compuesto</div>
                  <div className="font-tech text-base font-semibold text-[#F2F2F4]">
                    {overallScore.toFixed(1)} / 100
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                    findings.length > 0
                      ? 'border-amber-400/35 bg-amber-400/10 text-amber-300'
                      : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
                  }`}
                >
                  {findings.length > 0 ? (
                    <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  <span>
                    {findings.length > 0
                      ? 'Requiere revisión'
                      : 'Sin señales detectadas con las reglas actuales'}
                  </span>
                </span>
              </div>
            </div>

            {findings.length === 0 ? (
              <p className="text-xs text-[#9A9AA2] leading-relaxed">
                No se identificaron patrones sospechosos ni anomalías de cadena de suministro con el conjunto actual de reglas y metadatos consultados. Esto no certifica ausencia de riesgo en código no analizado o reglas futuras.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {findings.map((finding, idx) => {
                  const key = finding.id || `finding-${idx}`;
                  const isOpen = Boolean(expandedMap[key]);
                  const breakdown = finding.score_breakdown || {};
                  const contributions = Array.isArray(breakdown.contributions) ? breakdown.contributions : [];
                  return (
                    <article key={key} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full border px-2 py-0.5 font-tech text-[10.5px] ${severityBadge(
                                finding.severity,
                              )}`}
                            >
                              {String(finding.severity || 'LOW').toUpperCase()}
                            </span>
                            <span className="font-tech text-[11px] text-[#8E95A5]">
                              {finding.detector || 'detector'}
                            </span>
                            {finding.file_path && (
                              <span className="font-tech text-[11px] text-[#9A9AA2] truncate">
                                {finding.file_path}
                              </span>
                            )}
                          </div>
                          <h3 className="mt-1.5 text-sm font-medium text-[#F2F2F4]">
                            {finding.title || finding.rule_id || 'Hallazgo de seguridad'}
                          </h3>
                          {finding.summary && (
                            <p className="mt-1 text-xs text-[#9A9AA2] leading-relaxed">
                              {finding.summary}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedMap((prev) => ({ ...prev, [key]: !prev[key] }))
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-[#141923]/75 border border-white/[0.06] hover:border-white/[0.14] px-2.5 py-1.5 text-[11px] text-[#F2F2F4] cursor-pointer shrink-0"
                        >
                          <span>Evidencia ({Number(finding.score ?? breakdown.total_score ?? 0).toFixed(0)} pts)</span>
                          {isOpen ? (
                            <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                          )}
                        </button>
                      </div>

                      {isOpen && (
                        <div className="mt-3 rounded-xl bg-[#141923]/75 border border-white/[0.05] p-3.5 space-y-2.5 text-xs">
                          {contributions.length > 0 && (
                            <div>
                              <div className="text-[11px] font-medium text-[#9A9AA2] mb-1">
                                Desglose de puntaje explicable
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {contributions.map((c, cIdx) => (
                                  <span
                                    key={`${key}-contrib-${cIdx}`}
                                    className="rounded-md bg-[#0F131B] border border-white/[0.06] px-2 py-1 font-tech text-[11px] text-[#F2F2F4]"
                                  >
                                    {c.signal || c.label}: +{Number(c.points ?? 0).toFixed(1)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {finding.evidence && (
                            <div>
                              <div className="text-[11px] font-medium text-[#9A9AA2] mb-1">
                                Evidencia observada
                              </div>
                              <pre className="overflow-x-auto rounded-lg bg-[#0A0A0C] p-2.5 font-tech text-[11px] text-[#D1D5DB]">
                                {typeof finding.evidence === 'string'
                                  ? finding.evidence
                                  : JSON.stringify(finding.evidence, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export default RepoScannerPanel;
