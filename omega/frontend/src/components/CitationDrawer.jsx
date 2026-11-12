import { X, FileText, ExternalLink, ShieldCheck } from 'lucide-react';

export function CitationDrawer({ citation, onClose }) {
  if (!citation) return null;

  return (
    <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-zinc-800 bg-zinc-950/95 p-6 shadow-2xl backdrop-blur-md flex flex-col justify-between">
      <div className="space-y-5 overflow-y-auto pr-1">
        <div className="flex items-start justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            <span>Evidencia Documental [{citation.index}]</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-semibold text-zinc-100 leading-snug">
            {citation.title}
          </h3>
          <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
            <span className="rounded-md bg-zinc-900 px-2.5 py-1 border border-zinc-800">
              {citation.organization}
            </span>
            <span className="rounded-md bg-zinc-900 px-2.5 py-1 border border-zinc-800">
              Página {citation.page}
            </span>
            <span className="rounded-md bg-emerald-950/50 text-emerald-300 px-2.5 py-1 border border-emerald-800/40">
              Similitud: {(citation.similarity * 100).toFixed(1)}%
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Fragmento indexado
          </p>
          <blockquote className="rounded-xl border border-zinc-800/90 bg-zinc-900/60 p-4 text-sm leading-relaxed text-zinc-300">
            “{citation.snippet}”
          </blockquote>
        </div>
      </div>

      <div className="border-t border-zinc-800 pt-4">
        {citation.source_url?.startsWith('http') ? (
          <a
            href={citation.source_url}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-100 px-4 py-2.5 text-xs font-medium text-zinc-950 hover:bg-white transition"
          >
            <FileText className="h-4 w-4" />
            <span>Abrir publicación original</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <p className="text-center text-xs text-zinc-500">
            Fuente local verificada: {citation.source_url}
          </p>
        )}
      </div>
    </aside>
  );
}

