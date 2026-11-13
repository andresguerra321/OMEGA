import { useState } from 'react';
import { Globe, Loader2, ShieldAlert, ShieldCheck, Check, Copy } from 'lucide-react';
import { scanWebIntelUrl } from '../lib/api';

export function OmegaWebIntelCard({
  activeNet4Ips = [],
  onAskInChat,
  title = 'Extractor CTI volátil en RAM (WebBaseLoader)',
  subtitle = 'Lee artículos de Citizen Lab, Amnesty Tech o Google TAG en memoria y destruye el HTML tras extraer IPv4, dominios y CVEs.',
  compact = false,
}) {
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [showAllDomains, setShowAllDomains] = useState(false);
  const [copiedToken, setCopiedToken] = useState('');

  async function handleScan(e) {
    e.preventDefault();
    const cleaned = urlInput.trim();
    if (!cleaned || loading) return;
    setLoading(true);
    setError('');
    setShowAllDomains(false);
    try {
      const data = await scanWebIntelUrl(cleaned, activeNet4Ips);
      setScanResult(data);
    } catch (err) {
      setError(err?.message || 'No se pudo analizar la fuente CTI en RAM.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(val) {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedToken(val);
      setTimeout(() => setCopiedToken(''), 1400);
    } catch {
      // Clipboard unavailable
    }
  }

  const ipv4List = scanResult?.ipv4_iocs || [];
  const domainsList = scanResult?.domains || [];
  const cvesList = scanResult?.cves || [];
  const matchedLive = scanResult?.matched_live_net4 || [];
  const knownMatches = scanResult?.known_cti_matches || [];
  const visibleDomains = showAllDomains ? domainsList : domainsList.slice(0, 12);

  return (
    <div className="apple-group rounded-[13px] p-4 space-y-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-[#5E9BFF] shrink-0" />
            <h3 className={`${compact ? 'text-[13.5px]' : 'text-[14px]'} font-semibold tracking-[-0.01em] text-[#F5F5F7]`}>
              {title}
            </h3>
          </div>
          {subtitle && (
            <p className="text-[12px] text-[#8E8E93] leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <span className="font-tech rounded-full border border-[#2F6FED]/35 bg-[#2F6FED]/15 px-2.5 py-0.5 text-[10.5px] text-[#8AB4FF]">
            RAM · RNF4
          </span>
          {scanResult?.persisted_to_db && (
            <span className="font-tech rounded-full border border-[#30D158]/35 bg-[#30D158]/12 px-2.5 py-0.5 text-[10.5px] text-[#30D158]">
              Indexado RF7
            </span>
          )}
        </div>
      </div>

      <form onSubmit={handleScan} className="apple-well rounded-[11px] p-1.5 flex items-center gap-2">
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://citizenlab.ca/... o https://blog.google/threat-analysis-group/..."
          className="font-tech flex-1 min-w-0 h-8 bg-transparent px-2 text-[12.5px] text-[#F5F5F7] placeholder-[#9097A5] focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !urlInput.trim()}
          className="h-8 rounded-[8px] bg-[#2F6FED] hover:bg-[#3B7BF2] disabled:bg-white/[0.07] disabled:text-[#9097A5] px-3 text-[12px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer shrink-0 disabled:cursor-not-allowed"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>{activeNet4Ips.length > 0 ? 'Cruzar IPv4' : 'Extraer en RAM'}</span>
        </button>
      </form>

      {error && (
        <p className="text-[12px] text-[#FF6961]">{error}</p>
      )}

      {scanResult && (
        <div className="pt-2 border-t border-white/[0.06] space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <p className="text-[13px] font-medium text-[#F5F5F7] truncate">
                {scanResult.title || scanResult.url}
              </p>
              <p className="font-tech text-[11px] text-[#8E8E93] truncate">
                {ipv4List.length} IPv4 · {domainsList.length} dominios · {cvesList.length} CVEs · {knownMatches.length} en catálogo
                {scanResult.persisted_to_db
                  ? ` · +${scanResult.persisted_chunks_count ?? 0} frags RAG`
                  : ''}
              </p>
            </div>

            {onAskInChat && (
              <button
                type="button"
                onClick={() => {
                  const prompt = [
                    `Resume y correlaciona los indicadores extraídos en RAM desde ${scanResult.url}:`,
                    `- IPv4 públicas (net4): ${ipv4List.slice(0, 12).join(', ') || 'ninguna'}`,
                    `- CVEs: ${cvesList.join(', ') || 'ninguno'}`,
                    `- Dominios destacados: ${domainsList.slice(0, 12).join(', ') || 'ninguno'}`,
                    matchedLive.length > 0
                      ? `- ALERTA: Coincidencia activa con sockets del dispositivo: ${matchedLive.join(', ')}`
                      : '',
                    `¿Guardan relación con campañas de spyware comercial indexadas en OMEGA?`,
                  ]
                    .filter(Boolean)
                    .join('\n');
                  onAskInChat(prompt);
                }}
                className="shrink-0 rounded-[8px] border border-[#2F6FED]/40 bg-[#2F6FED]/15 px-2.5 py-1 text-[11.5px] font-medium text-[#8AB4FF] hover:bg-[#2F6FED]/24 active:scale-[0.97] transition-all cursor-pointer"
              >
                Investigar en Preguntar
              </button>
            )}
          </div>

          {activeNet4Ips.length > 0 && (
            <div
              className={`rounded-[10px] border px-3 py-2 flex items-center gap-2 text-[12px] ${
                matchedLive.length > 0
                  ? 'border-[#FF453A]/40 bg-[#FF453A]/12 text-[#FF6961]'
                  : 'border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]'
              }`}
            >
              {matchedLive.length > 0 ? (
                <ShieldAlert className="h-4 w-4 shrink-0" />
              ) : (
                <ShieldCheck className="h-4 w-4 shrink-0" />
              )}
              <span>
                {matchedLive.length > 0
                  ? `Coincidencia crítica con socket activo /proc/net/tcp: ${matchedLive.join(', ')}`
                  : `0 coincidencias entre ${activeNet4Ips.length} socket(s) activos y ${ipv4List.length} IPv4 del artículo.`}
              </span>
            </div>
          )}

          {cvesList.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-[#8E8E93]">CVEs identificados</div>
              <div className="flex flex-wrap gap-1.5">
                {cvesList.map((cve) => (
                  <span
                    key={cve}
                    className="font-tech rounded-[6px] border border-[#FF9F0A]/35 bg-[#FF9F0A]/12 px-2 py-0.5 text-[11px] text-[#FFD60A]"
                  >
                    {cve}
                  </span>
                ))}
              </div>
            </div>
          )}

          {ipv4List.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-[#8E8E93]">IPv4 públicas (net4)</div>
              <div className="flex flex-wrap gap-1.5">
                {ipv4List.slice(0, 24).map((ip) => {
                  const isLiveMatch = matchedLive.includes(ip);
                  return (
                    <button
                      key={ip}
                      type="button"
                      onClick={() => handleCopy(ip)}
                      title="Copiar IPv4"
                      className={`font-tech inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-[11px] cursor-pointer transition-colors ${
                        isLiveMatch
                          ? 'border-[#FF453A]/45 bg-[#FF453A]/15 text-[#FF6961]'
                          : 'border-white/[0.08] bg-black/35 text-[#F5F5F7] hover:bg-white/[0.07]'
                      }`}
                    >
                      <span>{ip}</span>
                      {copiedToken === ip ? (
                        <Check className="h-2.5 w-2.5 text-[#30D158]" />
                      ) : (
                        <Copy className="h-2.5 w-2.5 text-[#8E8E93]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {domainsList.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-[#8E8E93]">
                  Dominios mencionados ({domainsList.length})
                </span>
                {domainsList.length > 12 && (
                  <button
                    type="button"
                    onClick={() => setShowAllDomains((prev) => !prev)}
                    className="text-[11px] text-[#8AB4FF] hover:underline cursor-pointer"
                  >
                    {showAllDomains ? 'Ver menos' : 'Ver todos'}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {visibleDomains.map((dom) => (
                  <span
                    key={dom}
                    className="font-tech rounded-[6px] border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[11px] text-[#D1D1D6]"
                  >
                    {dom}
                  </span>
                ))}
              </div>
            </div>
          )}

          {knownMatches.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-[#FF6961]">
                Ya presentes en catálogo CTI de OMEGA ({knownMatches.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {knownMatches.slice(0, 12).map((km) => (
                  <span
                    key={`${km.ioc_type}-${km.ioc_value}-${km.spyware_family}`}
                    className="font-tech rounded-[6px] border border-[#FF453A]/35 bg-[#FF453A]/12 px-2 py-0.5 text-[11px] text-[#FF6961]"
                  >
                    {km.ioc_value} ({km.spyware_family})
                  </span>
                ))}
              </div>
            </div>
          )}

          {scanResult.chunks_preview && (
            <p className="rounded-[9px] border border-white/[0.06] bg-black/30 px-3 py-2 text-[11.5px] text-[#8E8E93] leading-relaxed">
              {scanResult.chunks_preview}
              {scanResult.chunks_preview.length >= 400 ? '…' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

