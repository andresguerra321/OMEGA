import { RefreshCw, TriangleAlert } from 'lucide-react';
import { OmegaLoader } from './OmegaLoader';

export function DesktopStartupGate({ bootstrap, children }) {
  if (!bootstrap.blocking) return children;

  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-obsidian px-6 text-ink-primary"
      aria-label="Inicio de OMEGA" aria-busy={!bootstrap.failed}>
      {bootstrap.failed ? (
        <div role="alert" className="w-full max-w-md space-y-4 text-center">
          <TriangleAlert className="mx-auto h-7 w-7 text-cobalt" aria-hidden="true" />
          <h1 className="text-lg font-semibold">No se pudo completar el inicio</h1>
          <p className="break-words text-sm leading-relaxed text-ink-secondary">{bootstrap.status?.message}</p>
          <button type="button" onClick={() => void bootstrap.retry()} disabled={bootstrap.retrying}
            className="inline-flex items-center gap-2 rounded-xl bg-cobalt px-5 py-2.5 text-sm font-semibold text-ink-primary transition-colors hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${bootstrap.retrying ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
            {bootstrap.retrying ? 'Reintentando…' : 'Reintentar'}
          </button>
        </div>
      ) : (
        <OmegaLoader variant="startup" label="Preparando OMEGA. El inicio de sesión aparecerá cuando esté listo." />
      )}
    </main>
  );
}
