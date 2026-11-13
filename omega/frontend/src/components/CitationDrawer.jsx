import { X, FileText, ExternalLink, ShieldCheck } from 'lucide-react';

export function CitationDrawer({ citation, onClose }) {
  if (!citation) return null;

  return (
    <aside className="omega-panel-in fixed inset-y-0 right-0 z-50 w-full max-w-[368px] border-l border-white/[0.08] apple-vibrancy flex flex-col justify-between">
      <div className="p-5 space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3.5">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">
            <ShieldCheck className="h-4 w-4 text-[#5E9BFF]" />
            <span>Fuente verificada</span>
            <span className="font-tech rounded-full border border-[#2F6FED]/35 bg-[#2F6FED]/15 px-2 py-0.5 text-[11px] text-[#8AB4FF]">
              [{citation.index}]
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel de cita"
            className="rounded-full p-1 text-[#8E8E93] hover:bg-white/[0.08] hover:text-[#F5F5F7] transition-colors duration-150 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2.5">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] leading-snug text-[#F5F5F7]">
            {citation.title}
          </h3>
          <div className="flex flex-wrap gap-1.5 text-[11.5px]">
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[#F5F5F7]">
              {citation.organization}
            </span>
            <span className="font-tech rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[#8E8E93]">
              p.{citation.page}
            </span>
            <span className="font-tech rounded-full border border-[#2F6FED]/35 bg-[#2F6FED]/15 px-2.5 py-0.5 text-[#8AB4FF]">
              {(Number(citation.similarity || 0) * 100).toFixed(1)}% sim
            </span>
            {citation.retrieval_method && (
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[#8E8E93]">
                {citation.retrieval_method}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[12px] font-medium text-[#8E8E93]">
            Fragmento del reporte
          </p>
          <div className="apple-well rounded-[11px] p-3.5 text-[13.5px] leading-[1.68] text-[#D1D1D6]">
            “{citation.snippet}”
          </div>
        </div>
      </div>

      <div className="border-t border-white/[0.06] bg-black/25 p-4">
        {citation.source_url?.startsWith('http') ? (
          <a
            href={citation.source_url}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.35),inset_0_1px_0_rgba(255,255,255,0.24)] px-3 py-2 text-[13px] font-medium text-white hover:bg-[#3B7BF2] transition-colors duration-150"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Abrir publicación original</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <p className="font-tech text-center text-[12px] text-[#8E8E93] truncate">
            {citation.source_url}
          </p>
        )}
      </div>
    </aside>
  );
}
