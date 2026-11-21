import { useRef, useState } from 'react';
import { exportExpedienteDossier } from '../lib/api';

export default function DossierExportButtons({ expedienteId }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function download(format) {
    if (!expedienteId || pending.current) return;
    pending.current = true; setBusy(format); setError('');
    try {
      const blob = await exportExpedienteDossier(expedienteId, format);
      if (!blob.type.includes(format === 'pdf' ? 'application/pdf' : 'application/json')) throw new Error('El servidor no devolvió un informe válido.');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `OMEGA-${expedienteId}.${format}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message || 'No se pudo exportar el expediente.'); }
    finally { pending.current = false; setBusy(''); }
  }

  return <div className="space-y-2" aria-busy={Boolean(busy)}>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!expedienteId || Boolean(busy)} onClick={() => download('pdf')}
        className="rounded-lg border border-[#2F6FED]/40 bg-[#2F6FED]/15 hover:bg-[#2F6FED]/25 px-3 py-2 text-xs font-medium text-[#D9E6FF] transition-colors cursor-pointer disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-white">
        {busy === 'pdf' ? 'Preparando dossier…' : 'Exportar dossier (PDF)'}
      </button>
      <button type="button" disabled={!expedienteId || Boolean(busy)} onClick={() => download('json')}
        className="rounded-lg border border-white/[0.1] bg-[#141923]/75 hover:border-white/25 px-3 py-2 text-xs font-medium text-[#C2C7D6] transition-colors cursor-pointer disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-white">
        {busy === 'json' ? 'Preparando paquete…' : 'Exportar paquete técnico (JSON)'}
      </button>
    </div>
    <p className="text-[11px] text-white/55">Verificación técnica de integridad con inventario SHA-256, permisos vigentes y cadena de auditoría. No constituye firma electrónica ni acredita valor probatorio.</p>
    {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
  </div>;
}
