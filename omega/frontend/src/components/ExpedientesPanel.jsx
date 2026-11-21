import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { listExpedientes } from '../lib/api.js';
import { PanelErrorBanner } from './PanelStatePrimitives';
import { LegalDocumentAiPanel } from './LegalDocumentAiPanel';

export function ExpedientesPanel({ onOpenAccount }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true, items: [], error: '' });

  useEffect(() => {
    let active = true;
    listExpedientes().then((items) => {
      if (!Array.isArray(items)) throw new Error('Respuesta de expedientes inválida');
      if (active) setState({ loading: false, items, error: '' });
    }).catch(() => {
      if (active) setState({ loading: false, items: [], error: 'No pudimos cargar tus expedientes.' });
    });
    return () => { active = false; };
  }, [attempt]);

  function retry() {
    setState({ loading: true, items: [], error: '' });
    setAttempt((value) => value + 1);
  }

  return (
    <section aria-labelledby="expedientes-title" className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 id="expedientes-title" className="flex items-center gap-2 text-xl font-semibold text-white">
            <FolderOpen aria-hidden="true" size={16} strokeWidth={1.75} />
            Expedientes
          </h1>
          <p className="text-sm text-white/60">Consulta los expedientes a los que tienes acceso.</p>
        </header>
        <p className="text-xs text-white/60">El asistente no ofrece asesoría legal. Verifica la información con un profesional.</p>
        <LegalDocumentAiPanel />
        {state.loading ? (
          <p role="status" aria-live="polite" aria-busy="true" className="py-6 text-sm text-white/60">Cargando expedientes…</p>
        ) : state.error ? (
          <PanelErrorBanner message={state.error} onRetry={retry} />
        ) : state.items.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.07] bg-[#0F131B]/85 p-6 backdrop-blur-md">
            <h2 className="font-medium text-white">Aún no tienes expedientes disponibles</h2>
            <p className="mt-2 text-sm text-white/60">Revisa tus documentos desde Cuenta. Si te han compartido un expediente, pide al propietario que revise tu acceso.</p>
            <button type="button" onClick={onOpenAccount} className="mt-4 rounded-lg border border-white/[0.07] px-4 py-2 text-sm text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Ir a Cuenta</button>
          </div>
        ) : (
          <ul aria-label="Expedientes disponibles" className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07] bg-[#0F131B]/85 px-5 backdrop-blur-md">
            {state.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 py-4">
                <h2 className="min-w-0 break-words font-medium text-white">{item.title}</h2>
                <time dateTime={item.createdAt} className="text-xs text-white/60">
                  {new Date(item.createdAt).toLocaleDateString('es-CO')}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
