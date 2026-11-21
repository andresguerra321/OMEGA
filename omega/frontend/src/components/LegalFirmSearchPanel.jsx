import { useState } from 'react';
import { FileText, FolderOpen, Search } from 'lucide-react';
import { legalApi } from '../lib/legalApi.js';
import { LEGAL_INPUT, LEGAL_PRIMARY } from '../lib/legalPresentation.js';
import { LegalPagination } from './LegalWorkspacePrimitives';

export function LegalFirmSearchPanel({ onOpenCase }) {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [page, setPage] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function runSearch(nextQuery = query, nextPage = 0) {
    const q = String(nextQuery || '').trim();
    if (q.length < 2) {
      setResult(null);
      setActiveQuery('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await legalApi.firmSearch({ q, page: nextPage, size: 10 });
      setResult(data);
      setActiveQuery(q);
      setPage(nextPage);
    } catch {
      setError('No se pudo completar la búsqueda en el despacho.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      aria-label="Búsqueda en todo el despacho"
      className="rounded-2xl border border-white/[0.07] bg-[#0F131B]/85 p-4 backdrop-blur-md space-y-3"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(query, 0);
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <div className="relative flex-1">
          <Search
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={120}
            placeholder="Buscar en todo el despacho (metadatos y texto indexado de tus expedientes)…"
            aria-label="Buscar en todo el despacho"
            className={`${LEGAL_INPUT} pl-9`}
          />
        </div>
        <button
          type="submit"
          disabled={loading || query.trim().length < 2}
          className={`${LEGAL_PRIMARY} shrink-0`}
        >
          {loading ? 'Buscando…' : 'Buscar en despacho'}
        </button>
      </form>

      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}

      {result && (
        <div className="space-y-2 border-t border-white/[0.06] pt-3">
          <div className="flex items-center justify-between text-xs text-white/60">
            <span>
              {result.totalElements} coincidencia(s) autorizada(s) para «{activeQuery}»
            </span>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setActiveQuery('');
                setQuery('');
              }}
              className="text-[#60A5FA] hover:underline cursor-pointer"
            >
              Limpiar
            </button>
          </div>

          {result.content.length === 0 ? (
            <p className="text-xs text-white/55">
              Sin coincidencias en los expedientes a los que tienes acceso.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {result.content.map((hit, idx) => (
                <li key={`${hit.expedienteId}-${hit.documentId || 'meta'}-${idx}`} className="py-2.5">
                  <button
                    type="button"
                    onClick={() => onOpenCase(hit.expedienteId)}
                    className="w-full text-left space-y-1 rounded-lg p-1.5 hover:bg-white/[0.03] cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {hit.matchType === 'DOCUMENT_TEXT' ? (
                        <FileText size={13} strokeWidth={1.75} className="text-[#2F6FED]" aria-hidden="true" />
                      ) : (
                        <FolderOpen size={13} strokeWidth={1.75} className="text-white/60" aria-hidden="true" />
                      )}
                      <span className="font-medium text-white">{hit.expedienteTitle}</span>
                      {hit.pageNumber && (
                        <span className="rounded-full border border-white/[0.08] bg-[#141923] px-2 py-0.5 text-[10.5px] text-white/65">
                          Pág. {hit.pageNumber}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/65 line-clamp-2">{hit.excerpt}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <LegalPagination
            value={{ ...result, page }}
            onPage={(nextP) => void runSearch(activeQuery, nextP)}
            label="Páginas de búsqueda del despacho"
          />
        </div>
      )}
    </section>
  );
}
