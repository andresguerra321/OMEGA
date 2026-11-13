import { X, FileText, ExternalLink, ShieldCheck } from 'lucide-react';

export function CitationDrawer({ citation, onClose }) {
  if (!citation) return null;

  return (
    <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-[360px] border-l border-[#232329] bg-[#141418] flex flex-col justify-between transition-transform duration-150">
      <div className="p-5 space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#232329] pb-3">
          <div className="flex items-center gap-2 text-[13px] font-medium text-[#F5F7FA]">
            <ShieldCheck className="h-4 w-4 text-[#2F6FED]" />
            <span>Fuente Verificada</span>
            <span className="font-tech rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-1.5 py-0.5 text-[11.5px] text-[#8AB4FF]">
              [{citation.index}]
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel de cita"
            className="rounded-[4px] border border-transparent p-1 text-[#9CA3B0] hover:border-[#232329] hover:bg-[#0A0A0C] hover:text-[#F2F4F8] transition-colors duration-150 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          <h3 className="text-[14.5px] font-semibold leading-snug text-[#F5F7FA]">
            {citation.title}
          </h3>
          <div className="flex flex-wrap gap-1.5 text-[12px]">
            <span className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-0.5 text-[#F2F4F8]">
              {citation.organization}
            </span>
            <span className="font-tech rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-0.5 text-[#9CA3B0]">
              p.{citation.page}
            </span>
            <span className="font-tech rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-2 py-0.5 text-[#8AB4FF]">
              {(Number(citation.similarity || 0) * 100).toFixed(1)}% sim
            </span>
            {citation.retrieval_method && (
              <span className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-0.5 text-[#9CA3B0]">
                {citation.retrieval_method}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11.5px] font-medium uppercase tracking-wider text-[#9CA3B0]">
            Fragmento del reporte
          </p>
          <div className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] p-3.5 text-[14px] leading-[1.68] text-[#DCE1EA]">
            “{citation.snippet}”
          </div>
        </div>
      </div>

      <div className="border-t border-[#232329] bg-[#0A0A0C] p-4">
        {citation.source_url?.startsWith('http') ? (
          <a
            href={citation.source_url}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-[4px] bg-[#2F6FED] px-3 py-2 text-[13px] font-medium text-[#F5F7FA] hover:bg-[#255ED4] transition-colors duration-150"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Abrir publicación original</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <p className="font-tech text-center text-[12px] text-[#9CA3B0] truncate">
            {citation.source_url}
          </p>
        )}
      </div>
    </aside>
  );
}
