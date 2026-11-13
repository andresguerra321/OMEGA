import { useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { verifySuspiciousLink } from '../lib/api';

function getVerdictPresentation(result) {
  if (result.risk_level === 'HIGH') {
    return {
      borderLeft: 'border-l-[#F87171]',
      titleColor: 'text-[#F87171]',
      headline: 'Peligroso — Infraestructura Spyware',
    };
  }
  if (result.risk_level === 'MEDIUM') {
    return {
      borderLeft: 'border-l-[#FBBF24]',
      titleColor: 'text-[#FBBF24]',
      headline: 'Precaución — Señales estructurales sospechosas',
    };
  }
  return {
    borderLeft: 'border-l-[#2F6FED]',
    titleColor: 'text-[#7AA7FF]',
    headline: 'Seguro / Sin registros',
  };
}

export function LinkVerifierPanel() {
  const [urlInput, setUrlInput] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCheck(e) {
    e.preventDefault();
    const cleaned = urlInput.trim();
    if (!cleaned || loading) return;
    setLoading(true);
    setError('');
    try {
      const data = await verifySuspiciousLink(cleaned);
      setResult(data);
    } catch (err) {
      setError(err?.message || 'No se pudo inspeccionar el enlace.');
    } finally {
      setLoading(false);
    }
  }

  // --- ESTADO 2: RESULTADO (Columna única centrada, max-w-[660px]) ---
  if (result) {
    const verdictMeta = getVerdictPresentation(result);
    const heuristics = result.heuristics || [];
    const ctiMatches = result.cti_matches || [];

    return (
      <div className="w-full max-w-[660px] mx-auto pt-2 pb-12 space-y-5">
        {/* Barra superior */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setError('');
            }}
            className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-3 py-1.5 text-[12.5px] font-medium text-[#F2F2F4] hover:border-[#2F6FED] transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#8E8E96]" />
            <span>Verificar otro enlace</span>
          </button>

          <span className="font-tech text-[12px] text-[#8E8E96] truncate max-w-[400px]">
            {result.normalized_url}
          </span>
        </header>

        {/* Bloque limpio con el veredicto */}
        <section
          className={`rounded-[6px] bg-[#141418] border border-[#232329] border-l-2 p-5 ${verdictMeta.borderLeft}`}
        >
          <h2 className={`text-[16px] font-semibold ${verdictMeta.titleColor}`}>
            {verdictMeta.headline}
          </h2>
          <p className="mt-1.5 text-[13px] text-[#F2F2F4] leading-relaxed">
            {result.recommendation}
          </p>
          <p className="mt-3 text-[12px] text-[#8E8E96]">
            {result.privacy_notice}
          </p>
        </section>

        {/* Desglose en 3 datos (Host, Dominio raíz, Certificados crt.sh) */}
        <section className="grid grid-cols-1 sm:grid-cols-3 rounded-[6px] bg-[#141418] border border-[#232329] divide-y sm:divide-y-0 sm:divide-x divide-[#232329]">
          <div className="p-3.5 min-w-0">
            <div className="text-[11.5px] text-[#8E8E96]">Host</div>
            <div className="font-tech mt-1 text-[12.5px] text-[#F2F2F4] break-all">
              {result.host}
            </div>
          </div>

          <div className="p-3.5 min-w-0">
            <div className="text-[11.5px] text-[#8E8E96]">Dominio raíz</div>
            <div className="font-tech mt-1 text-[12.5px] text-[#F2F2F4] break-all">
              {result.root_domain || result.host}
            </div>
          </div>

          <div className="p-3.5 min-w-0">
            <div className="text-[11.5px] text-[#8E8E96]">Certificados crt.sh</div>
            <div className="font-tech mt-1 text-[12.5px] text-[#F2F2F4]">
              {result.passive_ct_certificates !== null && result.passive_ct_certificates !== undefined
                ? `${result.passive_ct_certificates} registros`
                : 'N/D'}
            </div>
          </div>
        </section>

        {/* Alertas estructurales */}
        {heuristics.length > 0 && (
          <section className="rounded-[6px] bg-[#141418] border border-[#232329]">
            <div className="px-4 py-2.5 border-b border-[#232329] text-[12.5px] font-medium text-[#F2F2F4]">
              Alertas estructurales
            </div>
            <ul className="divide-y divide-[#232329]">
              {heuristics.map((item, idx) => (
                <li key={idx} className="px-4 py-2.5 text-[12.5px] text-[#8E8E96]">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Coincidencias CTI si aplica */}
        {ctiMatches.length > 0 && (
          <section className="rounded-[6px] bg-[#141418] border border-[#232329]">
            <div className="px-4 py-2.5 border-b border-[#232329] text-[12.5px] font-medium text-[#F87171]">
              Coincidencias en reportes de spyware ({ctiMatches.length})
            </div>
            <div className="divide-y divide-[#232329]">
              {ctiMatches.map((m, idx) => (
                <div
                  key={`${m.ioc_value}-${idx}`}
                  className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-tech text-[13px] text-[#F2F2F4]">
                        {m.ioc_value}
                      </span>
                      <span className="rounded-[4px] border border-[#232329] px-2 py-0.5 text-[11px] text-[#F87171]">
                        {m.spyware_family}
                      </span>
                    </div>
                    <div className="text-[12px] text-[#8E8E96]">
                      {m.campaign} · {m.source_report} ({m.organization})
                    </div>
                  </div>

                  {m.source_url?.startsWith('http') && (
                    <a
                      href={m.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-[4px] border border-[#232329] px-2.5 py-1 text-[11.5px] text-[#7AA7FF] hover:border-[#2F6FED] transition-colors shrink-0"
                    >
                      <span>Fuente</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  // --- ESTADO 1: INICIAL (Centrado vertical y horizontalmente, max-w-[620px]) ---
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-6">
      <div className="w-full max-w-[620px]">
        <header className="text-center mb-6">
          <span className="font-tech inline-block rounded-[4px] border border-[#232329] bg-[#141418] px-2.5 py-1 text-[11px] text-[#8E8E96]">
            INSPECCIÓN PASIVA · SIN CONEXIÓN AL DESTINO
          </span>
          <h1 className="mt-3 text-[24px] font-semibold tracking-tight text-[#F2F2F4]">
            Verifica un enlace antes de abrirlo
          </h1>
          <p className="mt-2 text-[13px] text-[#8E8E96] leading-relaxed">
            Detecta dominios vinculados a campañas 1-click o URLs ofuscadas sin realizar peticiones HTTP al servidor.
          </p>
        </header>

        <form
          onSubmit={handleCheck}
          className="rounded-[6px] bg-[#141418] border border-[#232329] p-2 flex items-center gap-2"
        >
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://enlace-sospechoso.ejemplo/ruta"
            className="font-tech flex-1 min-w-0 h-9 rounded-[4px] bg-transparent px-2.5 text-[13px] text-[#F2F2F4] placeholder-[#8E8E96]/70 focus:outline-none"
          />

          <button
            type="submit"
            disabled={loading || !urlInput.trim()}
            className="h-9 rounded-[4px] bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-45 px-4 text-[13px] font-medium text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Verificar</span>
          </button>
        </form>

        {error && (
          <p className="mt-2.5 text-[12px] text-[#F87171] text-center">{error}</p>
        )}
      </div>
    </div>
  );
}
