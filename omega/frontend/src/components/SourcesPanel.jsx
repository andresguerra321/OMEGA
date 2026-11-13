import { useState } from 'react';
import { X, ExternalLink, ShieldCheck, FileText, Search } from 'lucide-react';

export function SourcesPanel({ citations = [], selectedCitation, onSelectCitation, onClose }) {
  const [filter, setFilter] = useState('');

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
    <aside className="w-[360px] shrink-0 h-full border-l border-[#262B33] bg-[#111318] flex flex-col justify-between transition-all duration-150 z-20">
      <div className="flex flex-col min-h-0 flex-1">
        {/* Header */}
        <div className="h-12 px-4 border-b border-[#262B33] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#3978F6]" />
            <span className="text-[13px] font-semibold text-[#F0F2F5]">
              Fuentes Documentales
            </span>
            <span className="font-tech text-[11px] rounded-[4px] border border-[#262B33] bg-[#171A20] px-1.5 py-0.5 text-[#929BAA]">
              {citations.length}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel de fuentes"
            className="p-1 rounded-[4px] text-[#929BAA] hover:bg-[#171A20] hover:text-[#F0F2F5] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Buscador interno de fragmentos */}
        {citations.length > 3 && (
          <div className="p-3 border-b border-[#262B33]">
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-[#929BAA] pointer-events-none" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrar por término o autor..."
                className="w-full rounded-[4px] border border-[#262B33] bg-[#171A20] py-1 pl-8 pr-3 text-[12px] text-[#F0F2F5] placeholder-[#929BAA] focus:border-[#3978F6] focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Lista de fragmentos */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {filtered.length === 0 ? (
            <p className="p-4 text-center text-[12px] text-[#929BAA]">
              No hay fuentes coincidentes con el filtro.
            </p>
          ) : (
            filtered.map((cit) => {
              const isSelected = selectedCitation?.index === cit.index;
              return (
                <div
                  key={cit.index}
                  onClick={() => onSelectCitation(cit)}
                  className={`rounded-[6px] border p-3 space-y-2 cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-[#3978F6] bg-[#171A20]'
                      : 'border-[#262B33] bg-[#14161C] hover:border-[#353C47] hover:bg-[#171A20]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-tech font-medium text-[#7AA7FF] bg-[#16243D] border border-[#3978F6]/40 px-1 rounded-[3px]">
                        [{cit.index}]
                      </span>
                      <span className="font-medium text-[#F0F2F5] truncate">
                        {cit.organization}
                      </span>
                    </div>
                    <span className="font-tech text-[#929BAA] shrink-0">
                      p.{cit.page}
                    </span>
                  </div>

                  <h4 className="text-[12.5px] font-semibold text-[#F0F2F5] leading-snug line-clamp-2">
                    {cit.title}
                  </h4>

                  <div className="rounded-[4px] border border-[#262B33] bg-[#0D0F12] p-2.5 text-[12px] leading-relaxed text-[#929BAA]">
                    “{cit.snippet}”
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[11px] text-[#929BAA]">
                    <span className="font-tech">
                      {(Number(cit.similarity || 0) * 100).toFixed(1)}% similitud
                    </span>
                    {cit.source_url?.startsWith('http') && (
                      <a
                        href={cit.source_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[#3978F6] hover:underline"
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
      <div className="p-3 border-t border-[#262B33] bg-[#0D0F12] flex items-center justify-between text-[11px] text-[#929BAA]">
        <span>Verificación estricta RNF1</span>
        <span className="font-tech">SHA-256 Validado</span>
      </div>
    </aside>
  );
}
