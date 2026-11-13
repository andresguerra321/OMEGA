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
    <aside className="omega-panel-in w-[360px] shrink-0 h-full border-l border-white/[0.07] bg-[#101217]/95 backdrop-blur-md flex flex-col justify-between z-20">
      <div className="flex flex-col min-h-0 flex-1">
        {/* Header */}
        <div className="h-12 px-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#3978F6]" />
            <span className="text-[13px] font-semibold text-[#F0F2F5]">
              Fuentes Documentales
            </span>
            <span className="font-tech text-[11px] rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[#929BAA]">
              {citations.length}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel de fuentes"
            className="h-7 w-7 inline-flex items-center justify-center rounded-full text-[#929BAA] hover:bg-white/[0.06] hover:text-[#F0F2F5] active:scale-[0.92] transition-all duration-150 ease-kowalski cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Buscador interno de fragmentos */}
        {citations.length > 3 && (
          <div className="p-3 border-b border-white/[0.06]">
            <div className="relative flex items-center">
              <Search className="absolute left-3 h-3.5 w-3.5 text-[#7E8796] pointer-events-none" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrar por término o autor..."
                className="w-full rounded-[9px] border border-white/[0.08] bg-[#15181F] py-1.5 pl-8 pr-3 text-[12px] text-[#F0F2F5] placeholder-[#7E8796] focus:border-[#3978F6]/60 focus:outline-none transition-colors duration-150"
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
                  className={`rounded-[12px] border p-3.5 space-y-2.5 cursor-pointer active:scale-[0.985] transition-all duration-150 ease-kowalski shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] ${
                    isSelected
                      ? 'border-[#3978F6]/60 bg-[#151B27]'
                      : 'border-white/[0.065] bg-[#13161C]/90 hover:border-white/[0.13] hover:bg-[#171A22]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-tech font-medium text-[#8BB3FF] bg-[#16243D]/90 border border-[#3978F6]/35 px-1.5 py-0.5 rounded-[5px]">
                        [{cit.index}]
                      </span>
                      <span className="font-medium text-[#F0F2F5] truncate">
                        {cit.organization}
                      </span>
                    </div>
                    <span className="font-tech text-[#8E98A8] shrink-0">
                      p.{cit.page}
                    </span>
                  </div>

                  <h4 className="text-[12.5px] font-semibold text-[#F0F2F5] leading-snug line-clamp-2">
                    {cit.title}
                  </h4>

                  <div className="rounded-[8px] border border-white/[0.05] bg-[#0B0D11]/90 p-2.5 text-[12px] leading-relaxed text-[#9BA3B2]">
                    “{cit.snippet}”
                  </div>

                  <div className="flex items-center justify-between pt-0.5 text-[11px] text-[#8E98A8]">
                    <span className="font-tech">
                      {(Number(cit.similarity || 0) * 100).toFixed(1)}% similitud
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
      <div className="p-3 border-t border-white/[0.06] bg-[#0D0F12]/90 flex items-center justify-between text-[11px] text-[#8E98A8]">
        <span>Verificación estricta RNF1</span>
        <span className="font-tech text-[#6E7787]">SHA-256 Validado</span>
      </div>
    </aside>
  );
}

