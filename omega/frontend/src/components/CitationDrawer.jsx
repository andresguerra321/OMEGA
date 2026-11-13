import { X, FileText, ExternalLink, ShieldCheck } from 'lucide-react';

export function CitationDrawer({ citation, onClose }) {
  if (!citation) return null;

  return (
    <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-[400px] border-l border-[#262B33] bg-[#111318] flex flex-col justify-between transition-transform duration-150">
      <div className="p-5 space-y-5 overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#262B33] pb-3.5">
          <div className="flex items-center gap-2 text-[12px] font-medium text-[#F0F2F5]">
            <ShieldCheck className="h-4 w-4 text-[#3978F6]" />
            <span>Evidencia Documental</span>
            <span className="rounded-[4px] border border-[#262B33] bg-[#171A20] px-1.5 py-0.5 text-[11px] font-medium text-[#F0F2F5]">
              [{citation.index}]
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel de evidencia"
            className="rounded-[4px] border border-transparent p-1 text-[#929BAA] hover:border-[#262B33] hover:bg-[#171A20] hover:text-[#F0F2F5] transition-colors duration-150 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2.5">
          <h3 className="text-[14px] font-semibold leading-snug text-[#F0F2F5]">
            {citation.title}
          </h3>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-[4px] border border-[#262B33] bg-[#171A20] px-2 py-0.5 text-[#F0F2F5]">
              {citation.organization}
            </span>
            <span className="font-tech rounded-[4px] border border-[#262B33] bg-[#0D0F12] px-2 py-0.5 text-[#929BAA]">
              p.{citation.page}
            </span>
            <span className="font-tech rounded-[4px] border border-[#262B33] bg-[#171A20] px-2 py-0.5 text-[#F0F2F5]">
              {(Number(citation.similarity || 0) * 100).toFixed(1)}% sim
            </span>
            {citation.retrieval_method && (
              <span className="rounded-[4px] border border-[#262B33] bg-[#0D0F12] px-2 py-0.5 text-[#929BAA]">
                {citation.retrieval_method}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#929BAA]">
            Fragmento literal indexado
          </p>
          <div className="rounded-[6px] border border-[#262B33] bg-[#0D0F12] p-3.5 text-[13px] leading-relaxed text-[#F0F2F5]/90">
            “{citation.snippet}”
          </div>
        </div>
      </div>

      <div className="border-t border-[#262B33] bg-[#0D0F12] p-4">
        {citation.source_url?.startsWith('http') ? (
          <a
            href={citation.source_url}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-[5px] bg-[#3978F6] px-4 py-2 text-[12px] font-medium text-[#F0F2F5] hover:bg-[#2F69DE] transition-colors duration-150"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Abrir publicación original</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <p className="font-tech text-center text-[11px] text-[#929BAA] truncate">
            {citation.source_url}
          </p>
        )}
      </div>
    </aside>
  );
}
