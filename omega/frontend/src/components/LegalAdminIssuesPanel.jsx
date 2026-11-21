import { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { legalApi } from '../lib/legalApi.js';
import { LEGAL_SECONDARY } from '../lib/legalPresentation.js';

export function LegalAdminIssuesPanel({ role }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState(null);
  const [error, setError] = useState('');

  if (role !== 'ADMIN') return null;

  async function loadIssues() {
    setLoading(true);
    setError('');
    try {
      const data = await legalApi.adminDocumentIssues();
      setIssues(Array.isArray(data) ? data : []);
    } catch {
      setError('No se pudo consultar el estado de documentos con incidencias.');
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && issues === null) {
      void loadIssues();
    }
  }

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-[#0F131B]/85 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-white cursor-pointer"
        >
          <AlertTriangle size={14} strokeWidth={1.75} className="text-amber-400" aria-hidden="true" />
          <span>Panel de administración: documentos con fallo o atascados</span>
        </button>
        {open && (
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadIssues()}
            className={`${LEGAL_SECONDARY} !py-1 !px-2.5 text-xs inline-flex items-center gap-1.5`}
          >
            <RefreshCw size={12} strokeWidth={1.75} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            <span>Actualizar</span>
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
          <p className="text-[11px] text-white/55">
            Solo muestra identificadores técnicos, hashes SHA-256 y motivos saneados (sin nombres de archivo ni contenido).
          </p>
          {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
          {loading ? (
            <p role="status" className="text-xs text-white/60">Consultando incidencias…</p>
          ) : !issues || issues.length === 0 ? (
            <p className="text-xs text-emerald-300">No hay documentos en fallo ni atascados en el despacho.</p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {issues.map((item) => (
                <li key={item.documentId} className="py-2.5 text-xs space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-white/85">Doc: {item.documentId}</span>
                    <span className="rounded-full border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 text-[10.5px] text-amber-300">
                      {item.stuck ? 'ATASCADO' : item.status} · {item.failureCode}
                    </span>
                  </div>
                  <p className="text-white/70">{item.reason}</p>
                  <p className="font-mono text-[10.5px] text-white/45 break-all">
                    Expediente: {item.expedienteId} · SHA-256: {item.sha256Hash}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
