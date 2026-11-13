import { useState } from 'react';
import {
  Upload,
  Lock,
  ShieldCheck,
  Download,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { verifyMvtFile, verifyMvtText } from '../lib/api';

export function MvtVerifierPanel() {
  const [textInput, setTextInput] = useState('');
  const [analyzedLabel, setAnalyzedLabel] = useState('');
  const [result, setResult] = useState(null);
  const [loadingMode, setLoadingMode] = useState(''); // '' | 'file' | 'text'
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');

  async function processFile(file) {
    if (!file || loadingMode) return;
    setLoadingMode('file');
    setError('');
    setAnalyzedLabel(file.name);
    try {
      const data = await verifyMvtFile(file);
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err?.message || 'Error analizando el archivo.');
    } finally {
      setLoadingMode('');
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    await processFile(file);
  }

  async function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    await processFile(file);
  }

  async function handleTextSubmit(e) {
    e.preventDefault();
    const clean = textInput.trim();
    if (clean.length < 3 || loadingMode) return;
    setLoadingMode('text');
    setError('');
    setAnalyzedLabel('consulta_manual.txt');
    try {
      const data = await verifyMvtText(clean);
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err?.message || 'Error analizando los indicadores.');
    } finally {
      setLoadingMode('');
    }
  }

  function handleExportReport() {
    if (!result) return;
    const lines = [
      `# Informe de Verificación Forense — OMEGA`,
      '',
      `- **Origen:** ${analyzedLabel || 'Entrada manual'}`,
      `- **Formato detectado:** ${result.detected_format}`,
      `- **Indicadores evaluados:** ${result.analyzed_indicators}`,
      `- **Coincidencias:** ${result.total_matches}`,
      `- **Desglose:** Dominios ${result.breakdown?.domains ?? 0} · IPs ${result.breakdown?.ips ?? 0} · SHA-256 ${result.breakdown?.sha256 ?? 0} · Procesos/URLs ${result.breakdown?.processes_or_urls ?? 0}`,
      '',
    ];

    if (result.matches?.length > 0) {
      lines.push('## Coincidencias detectadas');
      result.matches.forEach((m) => {
        lines.push(
          `- **[${m.ioc_type.toUpperCase()}]** \`${m.ioc_value}\` (${m.match_precision} · ${m.spyware_family}) — ${m.campaign} | Origen: \`${m.artifact_origin}\` | Fuente: ${m.organization} (${m.source_report})`
        );
      });
    } else {
      lines.push('Sin coincidencias con los indicadores públicos indexados.');
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omega_verificacion_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isLoading = Boolean(loadingMode);

  return (
    <div className="max-w-[840px] mx-auto space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-[#232329] pb-5">
        <div className="space-y-1">
          <h1 className="text-[20px] font-semibold tracking-[-0.015em] text-[#F2F2F4]">
            Revisar mi equipo
          </h1>
          <p className="text-[13px] text-[#8E8E96]">
            Cruza volcados de Mobile Verification Toolkit (MVT) o indicadores manuales contra la base pública de spyware.
          </p>
        </div>

        <div className="shrink-0 inline-flex items-center gap-1.5 rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-2.5 py-1.5 text-[11px] font-medium text-[#7AA7FF]">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          <span>En RAM · Sin guardado en disco</span>
        </div>
      </div>

      {/* Zona de Entrada Dual */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Carga de archivo MVT */}
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center text-center rounded-[6px] border border-dashed bg-[#141418] p-6 transition-colors cursor-pointer ${
            isDragging
              ? 'border-[#2F6FED] bg-[#15223D]/25'
              : 'border-[#232329] hover:border-[#2F6FED]'
          }`}
        >
          <Upload className="h-5 w-5 text-[#8E8E96] mb-3" />
          <span className="text-[13px] font-medium text-[#F2F2F4]">
            {loadingMode === 'file'
              ? `Analizando ${analyzedLabel}...`
              : 'Seleccionar o arrastrar salida MVT'}
          </span>
          <span className="mt-1.5 font-tech text-[11px] text-[#8E8E96]">
            safari_history.json · sms.json · shutdown_log.json
          </span>
          <span className="mt-2 font-tech text-[10.5px] text-[#8E8E96]/70">
            .json · .txt · .log · .ips
          </span>
          <input
            type="file"
            accept=".json,.txt,.log,.ips,.csv"
            onChange={handleFileChange}
            disabled={isLoading}
            className="hidden"
          />
        </label>

        {/* Pegado rápido de indicadores */}
        <form
          onSubmit={handleTextSubmit}
          className="rounded-[6px] border border-[#232329] bg-[#141418] p-4 flex flex-col justify-between gap-3"
        >
          <div className="space-y-2">
            <label
              htmlFor="manual-ioc-input"
              className="block text-[11.5px] font-medium text-[#8E8E96]"
            >
              O pegar indicadores (uno por línea)
            </label>
            <textarea
              id="manual-ioc-input"
              rows={4}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="dominios (ej. evil[.]domain[.]com), IPs, SHA-256 o procesos..."
              className="w-full resize-none rounded-[4px] border border-[#232329] bg-[#0A0A0C] p-2.5 font-tech text-[12px] leading-relaxed text-[#F2F2F4] placeholder-[#8E8E96]/70 focus:border-[#2F6FED] focus:outline-none"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isLoading || textInput.trim().length < 3}
              className="rounded-[4px] bg-[#2F6FED] px-3.5 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:bg-[#255ED4] disabled:bg-[#1C1C22] disabled:text-[#8E8E96] transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {loadingMode === 'text' ? 'Cruzando...' : 'Cruzar indicadores'}
            </button>
          </div>
        </form>
      </div>

      {/* Error real de conexión o entrada */}
      {error && (
        <div className="rounded-[6px] border border-[#5C2128] bg-[#1F1215] px-4 py-3 flex items-center gap-2 text-[12.5px] text-[#F87171]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Resultados forenses */}
      {result && (
        <div className="space-y-3.5">
          {/* Barra de resumen */}
          <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <p className="text-[13.5px] font-medium text-[#F2F2F4]">
                  {result.detected_format}
                </p>
                {analyzedLabel && (
                  <p className="font-tech text-[11.5px] text-[#8E8E96] truncate">
                    {analyzedLabel}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`font-tech rounded-[4px] border px-2.5 py-1 text-[11px] font-medium ${
                    result.total_matches > 0
                      ? 'border-[#5C2128] bg-[#1F1215] text-[#F87171]'
                      : 'border-[#2F6FED]/40 bg-[#15223D] text-[#7AA7FF]'
                  }`}
                >
                  {result.total_matches === 0
                    ? '0 coincidencias'
                    : `${result.total_matches} ${
                        result.total_matches === 1
                          ? 'coincidencia detectada'
                          : 'coincidencias detectadas'
                      }`}
                </span>

                <button
                  type="button"
                  onClick={handleExportReport}
                  className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2.5 py-1 text-[11.5px] text-[#F2F2F4] hover:border-[#2F6FED] transition-colors cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-[#8E8E96]" />
                  <span>Exportar (.md)</span>
                </button>
              </div>
            </div>

            <div className="border-t border-[#232329] pt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-tech text-[11px] text-[#8E8E96]">
              <span>Evaluados: {result.analyzed_indicators}</span>
              <span>·</span>
              <span>Dominios: {result.breakdown?.domains ?? 0}</span>
              <span>·</span>
              <span>IPs: {result.breakdown?.ips ?? 0}</span>
              <span>·</span>
              <span>SHA-256: {result.breakdown?.sha256 ?? 0}</span>
              <span>·</span>
              <span>Procesos/URLs: {result.breakdown?.processes_or_urls ?? 0}</span>
            </div>
          </div>

          {/* Estado limpio vs Coincidencias */}
          {result.total_matches === 0 ? (
            <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-4 flex items-center gap-2.5 text-[13px] text-[#F2F2F4]">
              <ShieldCheck className="h-4 w-4 text-[#2F6FED] shrink-0" />
              <span>
                No se detectaron coincidencias con los indicadores públicos de spyware comercial indexados.
              </span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {result.matches.map((m, idx) => (
                <div
                  key={`${m.ioc_type}-${m.ioc_value}-${idx}`}
                  className="rounded-[6px] border border-[#5C2128] border-l-2 border-l-[#F87171] bg-[#141418] p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-tech text-[13px] text-[#F2F2F4] break-all">
                      <span className="text-[#F87171]">[{m.ioc_type.toUpperCase()}]</span>{' '}
                      {m.ioc_value}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 font-tech text-[10.5px]">
                      <span className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-0.5 text-[#8E8E96]">
                        {m.match_precision}
                      </span>
                      <span className="rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-2 py-0.5 text-[#7AA7FF]">
                        {m.spyware_family}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 text-[12px]">
                    <div className="space-y-0.5">
                      <span className="text-[#8E8E96]">Ubicación en dump: </span>
                      <span className="font-tech text-[#F2F2F4]">{m.artifact_origin}</span>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[#8E8E96]">Campaña vinculada: </span>
                      <span className="font-medium text-[#F2F2F4]">{m.campaign}</span>
                    </div>
                  </div>

                  {m.context && (
                    <div className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] p-2.5 text-[12px] text-[#8E8E96]">
                      {m.context}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8E8E96]">
                    <span>
                      Fuente: {m.organization} — {m.source_report}
                    </span>
                    {m.source_url?.startsWith('http') && (
                      <a
                        href={m.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[#7AA7FF] hover:underline underline-offset-2"
                      >
                        <span>Ver reporte original</span>
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
