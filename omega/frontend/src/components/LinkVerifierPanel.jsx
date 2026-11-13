import { useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { verifySuspiciousLink } from '../lib/api';

function getVerdictPresentation(result) {
  if (result.risk_level === 'HIGH') {
    return {
      dotColor: 'bg-[#FF453A] shadow-[0_0_10px_rgba(255,69,58,0.55)]',
      titleColor: 'text-[#FF6961]',
      headline: 'Peligroso — Infraestructura Spyware',
    };
  }
  if (result.risk_level === 'MEDIUM') {
    return {
      dotColor: 'bg-[#FF9F0A] shadow-[0_0_10px_rgba(255,159,10,0.45)]',
      titleColor: 'text-[#FFD60A]',
      headline: 'Precaución — Señales estructurales sospechosas',
    };
  }
  return {
    dotColor: 'bg-[#30D158] shadow-[0_0_10px_rgba(48,209,88,0.45)]',
    titleColor: 'text-[#5E9BFF]',
    headline: 'Seguro / Sin registros',
  };
}

export function LinkVerifierPanel({ onAskInChat }) {
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

  // --- ESTADO 2: RESULTADO ---
  if (result) {
    const verdictMeta = getVerdictPresentation(result);
    const heuristics = result.heuristics || [];
    const ctiMatches = result.cti_matches || [];

    return (
      <div className="omega-fade-up w-full max-w-[660px] mx-auto pt-2 pb-12 space-y-5">
        {/* Barra superior */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setError('');
            }}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[12.5px] font-medium text-[#F5F5F7] hover:bg-white/[0.08] active:scale-[0.97] transition-all cursor-pointer shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#8E8E93]" />
            <span>Verificar otro enlace</span>
          </button>

          <span className="font-tech text-[12px] text-[#8E8E93] truncate max-w-[400px]">
            {result.normalized_url}
          </span>
        </header>

        {/* Bloque de Veredicto Apple Glass (sin bordes laterales de 2px) */}
        <section className="apple-group rounded-[15px] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${verdictMeta.dotColor}`} />
              <h2 className={`text-[17px] font-semibold tracking-[-0.015em] ${verdictMeta.titleColor}`}>
                {verdictMeta.headline}
              </h2>
            </div>
            {onAskInChat && (
              <button
                type="button"
                onClick={() => {
                  const prompt = [
                    `Evalúa este enlace inspeccionado pasivamente en OMEGA:`,
                    `- URL / Host: ${result.normalized_url} (host: ${result.host})`,
                    `- Nivel de riesgo: ${result.risk_level} — ${result.verdict}`,
                    `- Coincidencias CTI: ${ctiMatches.length}`,
                    `¿Existe campaña o infraestructura de spyware asociada a este dominio o patrón en los reportes indexados?`,
                  ].join('\n');
                  onAskInChat(prompt);
                }}
                className="shrink-0 rounded-[8px] border border-[#2F6FED]/40 bg-[#2F6FED]/15 px-3 py-1 text-[11.5px] font-medium text-[#8AB4FF] hover:bg-[#2F6FED]/24 active:scale-[0.97] transition-all cursor-pointer"
              >
                Investigar en Preguntar
              </button>
            )}
          </div>
          <p className="mt-2.5 text-[14px] text-[#E5E5EA] leading-relaxed">
            {result.recommendation}
          </p>
          <p className="mt-3 text-[12px] text-[#8E8E93]">
            {result.privacy_notice}
          </p>
        </section>

        {/* Desglose Agrupado en 3 datos */}
        <section className="apple-group rounded-[13px] grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06] overflow-hidden">
          <div className="p-4 min-w-0">
            <div className="text-[11.5px] font-medium text-[#8E8E93]">Host</div>
            <div className="font-tech mt-1.5 text-[12.5px] text-[#F5F5F7] break-all">
              {result.host}
            </div>
          </div>

          <div className="p-4 min-w-0">
            <div className="text-[11.5px] font-medium text-[#8E8E93]">Dominio raíz</div>
            <div className="font-tech mt-1.5 text-[12.5px] text-[#F5F5F7] break-all">
              {result.root_domain || result.host}
            </div>
          </div>

          <div className="p-4 min-w-0">
            <div className="text-[11.5px] font-medium text-[#8E8E93]">Certificados crt.sh</div>
            <div className="font-tech mt-1.5 text-[12.5px] text-[#F5F5F7]">
              {result.passive_ct_certificates !== null && result.passive_ct_certificates !== undefined
                ? `${result.passive_ct_certificates} registros`
                : 'N/D'}
            </div>
          </div>
        </section>

        {/* Alertas estructurales */}
        {heuristics.length > 0 && (
          <section className="apple-group rounded-[13px] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/[0.06] text-[12.5px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">
              Alertas estructurales
            </div>
            <ul className="divide-y divide-white/[0.06]">
              {heuristics.map((item, idx) => (
                <li key={idx} className="px-4 py-3 text-[13px] text-[#D1D1D6]">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Coincidencias CTI si aplica */}
        {ctiMatches.length > 0 && (
          <section className="apple-group rounded-[13px] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/[0.06] text-[12.5px] font-semibold text-[#FF6961] bg-[#FF453A]/8">
              Coincidencias en reportes de spyware ({ctiMatches.length})
            </div>
            <div className="divide-y divide-white/[0.06]">
              {ctiMatches.map((m, idx) => (
                <div
                  key={`${m.ioc_value}-${idx}`}
                  className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-tech text-[13px] text-[#F5F5F7]">
                        {m.ioc_value}
                      </span>
                      <span className="rounded-full border border-[#FF453A]/35 bg-[#FF453A]/12 px-2 py-0.5 text-[11px] font-medium text-[#FF6961]">
                        {m.spyware_family}
                      </span>
                    </div>
                    <div className="text-[12px] text-[#8E8E93]">
                      {m.campaign} · {m.source_report} ({m.organization})
                    </div>
                  </div>

                  {m.source_url?.startsWith('http') && (
                    <a
                      href={m.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-[8px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-[#8AB4FF] hover:bg-white/[0.08] transition-colors shrink-0"
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
    <div className="omega-fade-up flex-1 flex flex-col items-center justify-center py-6">
      <div className="w-full max-w-[620px]">
        <header className="text-center mb-7">
          <h1 className="text-[28px] sm:text-[31px] font-semibold tracking-[-0.028em] leading-[1.15] text-[#F5F5F7]">
            Verifica un enlace antes de abrirlo
          </h1>
          <p className="mt-2.5 text-[14px] text-[#8E8E93] leading-[1.55] max-w-[500px] mx-auto">
            Detecta dominios vinculados a campañas 1-click o URLs ofuscadas sin realizar peticiones HTTP al servidor destino.
          </p>
        </header>

        <form
          onSubmit={handleCheck}
          className="omega-capsule rounded-[15px] p-2.5 flex items-center gap-2.5"
        >
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://enlace-sospechoso.ejemplo/ruta"
            className="font-tech flex-1 min-w-0 h-9 bg-transparent px-2.5 text-[13.5px] text-[#F5F5F7] placeholder-[#6E6E73] focus:outline-none"
          />

          <button
            type="submit"
            disabled={loading || !urlInput.trim()}
            className="h-9 rounded-[10px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.35),inset_0_1px_0_rgba(255,255,255,0.24)] hover:bg-[#3B7BF2] disabled:bg-white/[0.07] disabled:text-[#6E6E73] disabled:shadow-none px-4 text-[13px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer shrink-0 disabled:cursor-not-allowed"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Verificar</span>
          </button>
        </form>

        {error && (
          <p className="mt-3 text-[12.5px] text-[#FF453A] text-center">{error}</p>
        )}
      </div>
    </div>
  );
}
