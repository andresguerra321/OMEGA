import { useRef, useState } from 'react';
import {
  Upload,
  Lock,
  ShieldCheck,
  Download,
  ExternalLink,
  AlertCircle,
  Copy,
  Check,
  FileCode2,
} from 'lucide-react';
import { verifyMvtFile, verifyMvtText } from '../lib/api';

const MVT_CLI_COMMAND = 'mvt-ios check-backup --output ./dump /ruta/backup';

const SAMPLE_SAFARI_ENTRIES = [
  { url: 'https://www.apple.com/iphone/', visit_date: '2024-06-14T15:10:02Z' },
  { url: 'https://news.ycombinator.com/', visit_date: '2024-06-14T16:04:19Z' },
  { url: 'https://developer.mozilla.org/es/', visit_date: '2024-06-14T16:40:12Z' },
  { url: 'https://cdn.weather4free.com/report', visit_date: '2024-06-14T17:41:05Z' },
  { url: 'https://adtracker.link/pixel', visit_date: '2024-06-14T18:22:10Z' },
  { url: 'https://en.wikipedia.org/wiki/Spyware', visit_date: '2024-06-14T19:01:44Z' },
];

const SAMPLE_OFFLINE_FALLBACK = {
  detected_format: 'MVT — Historial de Navegación (Safari/Chrome)',
  analyzed_indicators: 12,
  total_matches: 2,
  breakdown: { domains: 6, ips: 0, sha256: 0, processes_or_urls: 6 },
  ephemeral_notice: 'Análisis volátil completado en RAM.',
  matches: [
    {
      ioc_type: 'domain',
      ioc_value: 'weather4free.com',
      match_precision: 'Dominio Raíz Relacionado',
      artifact_origin: 'Historial Web (2024-06-14T17:41:05Z) (subdominio: cdn.weather4free.com)',
      context: 'Indicador C2 documentado en infraestructura Pegasus (STIX2).',
      campaign: 'How to Catch NSO Group’s Pegasus',
      spyware_family: 'Pegasus',
      source_report: 'Forensic Methodology Report: How to Catch NSO Group’s Pegasus',
      organization: 'Amnesty Tech / Citizen Lab STIX2',
      source_url: 'https://www.amnesty.org/en/latest/research/2021/07/forensic-methodology-report-how-to-catch-nso-groups-pegasus/',
    },
    {
      ioc_type: 'domain',
      ioc_value: 'adtracker.link',
      match_precision: 'Exacto',
      artifact_origin: 'Historial Web (2024-06-14T18:22:10Z)',
      context: 'Extraído de reporte: Hooking Candiru: Another Mercenary Spyware Vendor Comes into Focus',
      campaign: 'Operaciones de espionaje Candiru contra disidentes y periodistas',
      spyware_family: 'Candiru',
      source_report: 'Hooking Candiru: Another Mercenary Spyware Vendor Comes into Focus',
      organization: 'Citizen Lab',
      source_url: 'https://citizenlab.ca/2021/07/hooking-candiru-another-mercenary-spyware-vendor-comes-into-focus/',
    },
  ],
};

export function MvtVerifierPanel() {
  const [textInput, setTextInput] = useState('');
  const [analyzedLabel, setAnalyzedLabel] = useState('');
  const [result, setResult] = useState(null);
  const [loadingMode, setLoadingMode] = useState(''); // '' | 'file' | 'text' | 'sample'
  const [isDragging, setIsDragging] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [error, setError] = useState('');
  const resultsRef = useRef(null);

  function scrollToResults() {
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  }

  async function processFile(file) {
    if (!file || loadingMode) return;
    setLoadingMode('file');
    setError('');
    setAnalyzedLabel(file.name);
    try {
      const data = await verifyMvtFile(file);
      setResult(data);
      scrollToResults();
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
      scrollToResults();
    } catch (err) {
      setResult(null);
      setError(err?.message || 'Error analizando los indicadores.');
    } finally {
      setLoadingMode('');
    }
  }

  async function handleRunSampleMvt() {
    if (loadingMode) return;
    setLoadingMode('sample');
    setError('');
    setAnalyzedLabel('safari_history.json');
    try {
      const sampleFile = new File(
        [JSON.stringify(SAMPLE_SAFARI_ENTRIES, null, 2)],
        'safari_history.json',
        { type: 'application/json' }
      );
      const data = await verifyMvtFile(sampleFile);
      setResult(data);
    } catch {
      setResult(SAMPLE_OFFLINE_FALLBACK);
    } finally {
      setLoadingMode('');
      scrollToResults();
    }
  }

  function handleCopyCommand() {
    navigator.clipboard.writeText(MVT_CLI_COMMAND);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 1500);
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
    <div className="max-w-[840px] mx-auto space-y-5">
      {/* Cabecera */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between border-b border-[#232329] pb-4">
        <div className="space-y-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-[#F5F7FA]">
            Revisar mi equipo
          </h1>
          <p className="text-[14px] leading-[1.55] text-[#A2AAB7]">
            Cruza volcados de Mobile Verification Toolkit (MVT) o indicadores manuales contra la base pública de spyware.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRunSampleMvt}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-3 py-1.5 text-[12.5px] font-medium text-[#F2F4F8] hover:border-[#2F6FED] disabled:opacity-50 transition-colors cursor-pointer"
          >
            <FileCode2 className="h-3.5 w-3.5 text-[#2F6FED]" />
            <span>{loadingMode === 'sample' ? 'Analizando muestra...' : 'Cargar muestra MVT de prueba'}</span>
          </button>

          <div className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-3 py-1.5 text-[12px] font-medium text-[#8AB4FF]">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            <span>En RAM · Sin guardado en disco</span>
          </div>
        </div>
      </div>

      {/* Barra de Flujo Operativo MVT (3 pasos compactos) */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-3.5 flex flex-col justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-tech text-[11px] font-medium text-[#8AB4FF]">PASO 01</span>
            <span className="text-[13px] font-semibold text-[#F5F7FA]">Extracción local</span>
          </div>
          <div className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2.5 py-2 flex items-center justify-between gap-2">
            <code
              className="font-tech text-[12px] text-[#F2F4F8] truncate"
              title={MVT_CLI_COMMAND}
            >
              {MVT_CLI_COMMAND}
            </code>
            <button
              type="button"
              onClick={handleCopyCommand}
              title="Copiar comando MVT"
              aria-label="Copiar comando MVT"
              className="shrink-0 text-[#9CA3B0] hover:text-[#F2F4F8] transition-colors cursor-pointer"
            >
              {copiedCmd ? (
                <Check className="h-3.5 w-3.5 text-[#2F6FED]" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-3.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-tech text-[11px] font-medium text-[#8AB4FF]">PASO 02</span>
            <span className="text-[13px] font-semibold text-[#F5F7FA]">Carga volátil</span>
          </div>
          <p className="text-[12.5px] leading-[1.55] text-[#B6BDC9]">
            Los JSON (<span className="font-tech text-[#F2F4F8]">sms.json</span>,{' '}
            <span className="font-tech text-[#F2F4F8]">safari_history.json</span>,{' '}
            <span className="font-tech text-[#F2F4F8]">shutdown_log.json</span>) se procesan solo en RAM.
          </p>
        </div>

        <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-3.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-tech text-[11px] font-medium text-[#8AB4FF]">PASO 03</span>
            <span className="text-[13px] font-semibold text-[#F5F7FA]">Correlación CTI</span>
          </div>
          <p className="text-[12.5px] leading-[1.55] text-[#B6BDC9]">
            Cruce instantáneo contra IOCs públicos de Citizen Lab, Amnesty Tech y Google TAG.
          </p>
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
          <Upload className="h-5 w-5 text-[#9CA3B0] mb-3" />
          <span className="text-[14px] font-medium text-[#F5F7FA]">
            {loadingMode === 'file'
              ? `Analizando ${analyzedLabel}...`
              : 'Seleccionar o arrastrar salida MVT'}
          </span>
          <span className="mt-1.5 font-tech text-[12px] text-[#9CA3B0]">
            safari_history.json · sms.json · shutdown_log.json
          </span>
          <span className="mt-2 font-tech text-[11.5px] text-[#8E96A4]">
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
              className="block text-[12.5px] font-medium text-[#B6BDC9]"
            >
              O pegar indicadores (uno por línea)
            </label>
            <textarea
              id="manual-ioc-input"
              rows={4}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="dominios (ej. evil[.]domain[.]com), IPs, SHA-256 o procesos..."
              className="w-full resize-none rounded-[4px] border border-[#232329] bg-[#0A0A0C] p-3 font-tech text-[13px] leading-[1.6] text-[#F2F4F8] placeholder-[#949CA9] focus:border-[#2F6FED] focus:outline-none"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isLoading || textInput.trim().length < 3}
              className="rounded-[4px] bg-[#2F6FED] px-4 py-2 text-[13px] font-medium text-[#F5F7FA] hover:bg-[#255ED4] disabled:bg-[#1C1C22] disabled:text-[#8E8E96] transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {loadingMode === 'text' ? 'Cruzando...' : 'Cruzar indicadores'}
            </button>
          </div>
        </form>
      </div>

      {/* Error real de conexión o entrada */}
      {error && (
        <div className="rounded-[6px] border border-[#5C2128] bg-[#1F1215] px-4 py-3 flex items-center gap-2 text-[13.5px] text-[#F87171]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Resultados del Análisis Forense */}
      {result && (
        <div ref={resultsRef} className="space-y-4 pt-1">
          <div className="flex items-center justify-between">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-wider text-[#9CA3B0]">
              Resultados del análisis forense
            </h2>
          </div>

          {/* Tarjeta de Resumen Técnico */}
          <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <p className="text-[15px] font-semibold text-[#F5F7FA]">
                  {result.detected_format}
                </p>
                {analyzedLabel && (
                  <p className="font-tech text-[12.5px] text-[#9CA3B0] truncate">
                    {analyzedLabel}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`font-tech rounded-[4px] border px-2.5 py-1 text-[12px] font-medium ${
                    result.total_matches > 0
                      ? 'border-[#5C2128] bg-[#1F1215] text-[#F87171]'
                      : 'border-[#2F6FED]/40 bg-[#15223D] text-[#8AB4FF]'
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
                  className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-3 py-1.5 text-[12.5px] text-[#F2F4F8] hover:border-[#2F6FED] transition-colors cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-[#9CA3B0]" />
                  <span>Exportar informe (.md)</span>
                </button>
              </div>
            </div>

            <div className="border-t border-[#232329] pt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-tech text-[12px] text-[#9CA3B0]">
              <span>Evaluados: {result.analyzed_indicators}</span>
              <span>·</span>
              <span>Dominios: {result.breakdown?.domains ?? 0}</span>
              <span>·</span>
              <span>URLs/Procesos: {result.breakdown?.processes_or_urls ?? 0}</span>
              <span>·</span>
              <span>IPs: {result.breakdown?.ips ?? 0}</span>
              <span>·</span>
              <span>SHA-256: {result.breakdown?.sha256 ?? 0}</span>
            </div>
          </div>

          {/* Estado limpio vs Hallazgos Correlacionados */}
          {result.total_matches === 0 ? (
            <div className="rounded-[6px] border border-[#232329] bg-[#141418] p-4 flex items-center gap-2.5 text-[14px] text-[#F2F4F8]">
              <ShieldCheck className="h-4 w-4 text-[#2F6FED] shrink-0" />
              <span>
                No se detectaron coincidencias con los indicadores públicos de spyware comercial indexados.
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              {result.matches.map((m, idx) => (
                <div
                  key={`${m.ioc_type}-${m.ioc_value}-${idx}`}
                  className="rounded-[6px] border border-[#5C2128] border-l-2 border-l-[#F87171] bg-[#141418] p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-tech text-[14px] font-medium text-[#F5F7FA] break-all">
                      <span className="text-[#F87171]">[{m.ioc_type.toUpperCase()}]</span>{' '}
                      {m.ioc_value}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 font-tech text-[11.5px]">
                      <span className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-0.5 text-[#B6BDC9]">
                        {m.match_precision}
                      </span>
                      <span className="rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-2 py-0.5 text-[#8AB4FF]">
                        {m.spyware_family}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2 text-[13px]">
                    <div className="space-y-0.5">
                      <span className="text-[#9CA3B0]">Origen en dump: </span>
                      <span className="font-tech text-[#F2F4F8]">{m.artifact_origin}</span>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[#9CA3B0]">Campaña asociada: </span>
                      <span className="font-medium text-[#F5F7FA]">{m.campaign}</span>
                    </div>
                  </div>

                  {m.context && (
                    <div className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] p-3 text-[13px] leading-[1.58] text-[#CED4DE]">
                      {m.context}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#9CA3B0]">
                    <span>
                      Fuente: {m.organization} — {m.source_report}
                    </span>
                    {m.source_url?.startsWith('http') && (
                      <a
                        href={m.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[#8AB4FF] hover:underline underline-offset-2"
                      >
                        <span>Ver reporte original</span>
                        <ExternalLink className="h-3.5 w-3.5" />
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
