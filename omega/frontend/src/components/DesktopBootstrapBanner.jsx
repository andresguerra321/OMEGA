import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react';

/**
 * Banner del arranque de servicios locales (Docker) en la app de escritorio.
 * Se oculta cuando el stack está listo o cuando se ejecuta en web.
 */
export function DesktopBootstrapBanner({ bootstrap }) {
  const { status, pending, failed, retry, retrying } = bootstrap;
  if (!status || (!pending && !failed)) return null;

  return (
    <div
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
      className={`fixed top-3 left-1/2 z-[70] w-[min(92vw,640px)] -translate-x-1/2 rounded-[12px] border px-4 py-3 text-[12.5px] shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl ${
        failed
          ? 'border-[#FF453A]/45 bg-[rgba(48,18,20,0.92)] text-[#FFD7D4]'
          : 'border-[#2F6FED]/45 bg-[rgba(18,24,40,0.92)] text-[#F2F2F4]'
      }`}
    >
      <div className="flex items-start gap-3">
        {failed ? (
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#FF6961]" />
        ) : (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#6FA0FF]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {failed ? 'Los servicios locales de OMEGA no están disponibles' : 'Iniciando servicios locales de OMEGA'}
          </div>
          <p className="mt-0.5 break-words leading-snug opacity-85">{status.message}</p>
        </div>
        {failed && (
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border border-white/[0.14] bg-white/[0.08] px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-white/[0.14] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
            <span>Reintentar</span>
          </button>
        )}
      </div>
    </div>
  );
}
