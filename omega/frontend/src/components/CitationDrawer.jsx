import { X, FileText, ExternalLink, ShieldCheck } from 'lucide-react';

export function CitationDrawer({ citation, onClose }) {
  if (!citation) return null;

  return (
    <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-[380px] border-l border-[#232329] bg-[#141418] flex flex-col justify-between">
      <div className="p-5 space-y-5 overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#232329] pb-3.5">
          <div className="flex items-center gap-2 text-[12px] font-medium text-[#F2F2F4]">
            <ShieldCheck className="h-4 w-4 text-[#2F6FED]" />
            <span>Fuente Verificada</span>
            <span className="font-tech rounded-[4px] border border-[#2F6FED]/40 bg-[#15223D] px-1.5 py-0.5 text-[11px] text-[#7AA7FF]">
              [{citation.index}]
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[4px] border border-transparent p-1 text-[#8E8E96] hover:border-[#232329] hover:bg-[#0A0A0C] hover:text-[#F2F2F4] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2.5">
          <h3 className="text-[14px] font-semibold leading-snug text-[#F2F2F4]">
            {citation.title}
          </h3>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-0.5 text-[#F2F2F4]">
              {citation.organization}
            </span>
            <span className="font-tech rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-0.5 text-[#8E8E96]">
              p.{citation.page}
            </span>
            <span className="font-tech rounded-[4px] border border-[#2F6FED]/30 bg-[#15223D] px-2 py-0.5 text-[#7AA7FF]">
              Similitud {(citation.similarity * 100).toFixed(1)}%
            </span>
            {citation.retrieval_method && (
              <span className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-2 py-0.5 text-[#8E8E96]">
                {citation.retrieval_method}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#8E8E96]">
            Fragmento extraído del reporte
          </p>
          <div className="rounded-[4px] border border-[#232329] bg-[#0A0A0C] p-3.5 text-[13px] leading-relaxed text-[#F2F2F4]/90">
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
            className="flex w-full items-center justify-center gap-2 rounded-[4px] bg-[#2F6FED] px-4 py-2 text-[12px] font-medium text-[#F2F2F4] hover:bg-[#255ED4] transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Abrir publicación original</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <p className="font-tech text-center text-[11px] text-[#8E8E96] truncate">
            {citation.source_url}
          </p>
        )}
      </div>
    </aside>
  );
}
