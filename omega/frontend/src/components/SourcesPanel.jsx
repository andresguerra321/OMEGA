import { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, ShieldCheck, Search } from 'lucide-react';

export function SourcesPanel({ citations = [], selectedCitation, onSelectCitation, onClose }) {
  const [filter, setFilter] = useState('');
  const cardRefs = useRef(new Map());

  useEffect(() => {
    if (!selectedCitation) return;
    const key = `${selectedCitation.index}-${selectedCitation.title}`;
    const el = cardRefs.current.get(key);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedCitation]);

  const filtered = citations.filter((c) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      c.title?.toLowerCase().includes(q) ||
      c.organization?.toLowerCase().includes(q) ||
      c.snippet?.toLowerCase().includes(q)
    );
  });

  return (
    <aside className="omega-panel-in w-[368px] shrink-0 h-full border-l border-[#232329] bg-[#141418] flex flex-col justify-between z-20">
      <div className="flex flex-col min-h-0 flex-1">
        {/* Header */}
        <div className="h-12 px-4 border-b border-[#232329] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#2F6FED]" />
            <span className="text-[13px] font-semibold text-[#F2F2F4]">
              Evidencia Documental
            </span>
            <span className="font-tech text-[11px] rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-1.5 py-0.5 text-[#7AA7FF]">
              {citations.length}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel de fuentes"
            className="h-7 w-7 inline-flex items-center justify-center rounded-[4px] text-[#8E8E96] hover:bg-[#0A0A0C] hover:text-[#F2F2F4] active:scale-[0.94] transition-all duration-150 ease-kowalski cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Buscador interno de fragmentos */}
        {citations.length > 3 && (
          <div className="p-3 border-b border-[#232329]">
            <div className="relative flex items-center">
              <Search className="absolute left-3 h-3.5 w-3.5 text-[#8E8E96] pointer-events-none" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrar por término u organización..."
                className="w-full rounded-[4px] border border-[#232329] bg-[#0A0A0C] py-1.5 pl-8 pr-3 text-[12px] text-[#F2F2F4] placeholder-[#8E8E96] focus:border-[#2F6FED] focus:outline-none transition-colors duration-150"
              />
            </div>
          </div>
        )}

        {/* Lista de fragmentos */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {filtered.length === 0 ? (
            <p className="p-4 text-center text-[12px] text-[#8E8E96]">
              No hay fuentes coincidentes con el filtro.
            </p>
          ) : (
            filtered.map((cit) => {
              const isSelected =
                selectedCitation?.index === cit.index &&
                selectedCitation?.title === cit.title;
              const key = `${cit.index}-${cit.title}`;
              return (
                <div
                  key={key}
                  ref={(node) => {
                    if (node) cardRefs.current.set(key, node);
                    else cardRefs.current.delete(key);
                  }}
                  onClick={() => onSelectCitation(cit)}
                  className={`rounded-[6px] border p-3.5 space-y-2.5 cursor-pointer transition-all duration-150 ease-kowalski ${
                    isSelected
                      ? 'border-[#2F6FED] bg-[#15223D]/45'
                      : 'border-[#232329] bg-[#0A0A0C]/65 hover:border-[#2F6FED]/55 hover:bg-[#141418]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-tech font-medium text-[#7AA7FF] bg-[#15223D] border border-[#2F6FED]/40 px-1.5 py-0.5 rounded-[4px]">
                        [{cit.index}]
                      </span>
                      <span className="font-medium text-[#F2F2F4] truncate">
                        {cit.organization}
                      </span>
                    </div>
                    <span className="font-tech text-[#8E8E96] shrink-0">
                      Pág. {cit.page}
                    </span>
                  </div>

                  <h4 className="text-[12.5px] font-semibold text-[#F2F2F4] leading-snug">
                    {cit.title}
                  </h4>

                  <div className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] p-2.5 text-[12px] leading-relaxed text-[#F2F2F4]/85">
                    “{cit.snippet}”
                  </div>

                  <div className="flex items-center justify-between pt-0.5 text-[11px] text-[#8E8E96]">
                    <span className="font-tech text-[#7AA7FF]">
                      {(Number(cit.similarity || 0) * 100).toFixed(1)}% match ·{' '}
                      <span className="text-[#8E8E96]">{cit.retrieval_method || 'RRF'}</span>
                    </span>
                    {cit.source_url?.startsWith('http') && (
                      <a
                        href={cit.source_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[#7AA7FF] hover:text-[#9FC0FF] hover:underline underline-offset-2 transition-colors"
                      >
                        <span>Abrir reporte</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Footer del panel */}
      <div className="p-3 border-t border-[#232329] bg-[#0A0A0C] flex items-center justify-between text-[11px] text-[#8E8E96]">
        <span>Trazabilidad estricta RNF1</span>
        <span className="font-tech text-[#8E8E96]/75">Corpus Auditado</span>
      </div>
    </aside>
  );
}
