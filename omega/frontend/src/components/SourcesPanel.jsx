import { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, ShieldCheck, Search } from 'lucide-react';

import {
  PanelSkeleton,
  PanelErrorBanner,
  PanelEmptyState,
} from './PanelStatePrimitives';

export function SourcesPanel({
  citations = [],
  selectedCitation,
  onSelectCitation,
  onClose,
  isLoading = false,
  error = '',
  onRetry,
  onSuggestPrompt,
}) {
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
    <aside className="animate-slide-right absolute inset-0 md:static md:inset-auto w-full md:w-[340px] lg:w-[376px] shrink-0 h-full apple-vibrancy md:border-l border-white/[0.07] flex flex-col justify-between z-30 md:z-20">
      <div className="flex flex-col min-h-0 flex-1">
        {/* Header Inspector */}
        <div className="h-12 px-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck strokeWidth={1.7} className="h-4 w-4 text-[#3B82F6]" />
            <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">
              Evidencia documental
            </span>
            <span className="font-tech text-[11.5px] rounded-full bg-[#1D4ED8]/18 border border-[#1D4ED8]/35 px-2 py-0.5 text-[#93C5FD]">
              {citations.length}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel de fuentes"
            className="h-7 w-7 inline-flex items-center justify-center rounded-full text-[#8E8E93] hover:bg-white/[0.08] hover:text-[#F5F5F7] active:scale-[0.94] transition-all duration-150 ease-apple cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Buscador interno de fragmentos */}
        {citations.length > 3 && (
          <div className="p-3 border-b border-white/[0.06]">
            <div className="relative flex items-center">
              <Search className="absolute left-3 h-3.5 w-3.5 text-[#8E8E93] pointer-events-none" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrar por término u organización..."
                className="apple-well w-full rounded-[9px] py-1.5 pl-8 pr-3 text-[13px] text-[#F5F5F7] placeholder-[#9097A5] focus:border-[#1D4ED8]/65 focus:outline-none transition-colors duration-150"
              />
            </div>
          </div>
        )}

        {/* Lista de fragmentos */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {error && <PanelErrorBanner message={error} onRetry={onRetry} />}

          {isLoading && (
            <PanelSkeleton
              label={citations.length > 0 ? 'Buscando evidencia adicional...' : 'Recuperando fuentes del corpus...'}
              lines={citations.length > 0 ? 2 : 3}
            />
          )}

          {!isLoading && !error && filtered.length === 0 ? (
            citations.length === 0 ? (
              <PanelEmptyState
                icon={ExternalLink}
                title="Aún no hay fuentes citadas"
                description="Haz una pregunta en el Asistente para inspeccionar aquí los fragmentos verificables de Citizen Lab, Amnesty Tech y Google TAG."
                actionLabel={onSuggestPrompt ? 'Probar consulta de ejemplo' : undefined}
                onAction={onSuggestPrompt}
              />
            ) : (
              <PanelEmptyState
                icon={ExternalLink}
                title="Sin fuentes coincidentes"
                description="Ningún fragmento recuperado coincide con la búsqueda o filtro actual."
              />
            )
          ) : (
            filtered.map((cit, idx) => {
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
                  style={{ animationDelay: `${Math.min(idx * 30, 180)}ms` }}
                  className={`animate-fade-up rounded-[12px] border p-3.5 space-y-2.5 cursor-pointer transition-all duration-200 ease-apple hover:-translate-y-0.5 active:scale-[0.99] ${
                    isSelected
                      ? 'border-[#1D4ED8]/60 bg-[#1D4ED8]/14 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                      : 'border-white/[0.075] bg-white/[0.025] hover:border-white/[0.14] hover:bg-white/[0.045]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-tech font-medium text-[#93C5FD] bg-[#1D4ED8]/18 border border-[#1D4ED8]/35 px-1.5 py-0.5 rounded-[5px]">
                        [{cit.index}]
                      </span>
                      <span className="font-medium tracking-[-0.01em] text-[#F5F5F7] truncate">
                        {cit.organization}
                      </span>
                    </div>
                    <span className="font-tech text-[#8E8E93] shrink-0">
                      Pág. {cit.page}
                    </span>
                  </div>

                  <h4 className="text-[13.5px] font-semibold tracking-[-0.01em] text-[#F5F5F7] leading-snug">
                    {cit.title}
                  </h4>

                  <div className="apple-well rounded-[9px] p-3 text-[13px] leading-[1.62] text-[#D1D1D6]">
                    “{cit.snippet}”
                  </div>

                  <div className="flex items-center justify-between pt-0.5 text-[11.5px] text-[#8E8E93]">
                    <span className="font-tech text-[#93C5FD]">
                      {(Number(cit.similarity || 0) * 100).toFixed(1)}% ·{' '}
                      <span className="text-[#8E8E93]">{cit.retrieval_method || 'RRF'}</span>
                    </span>
                    {cit.source_url?.startsWith('http') && (
                      <a
                        href={cit.source_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[#93C5FD] hover:text-[#93C5FD] hover:underline underline-offset-2 transition-colors"
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

      {/* Footer del inspector */}
      <div className="px-4 py-3 border-t border-white/[0.06] bg-black/20 flex items-center justify-between text-[12px] text-[#8E8E93]">
        <span>Fragmentos verificados</span>
        <span className="font-tech text-[#8E8E93]">Corpus público</span>
      </div>
    </aside>
  );
}
