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
        className="rounded-lg border border-[#2F6FED]/40 bg-[#2F6FED]/10 px-3 py-2 text-xs text-[#C9D9FF] disabled:opacity-40">
        {busy === 'pdf' ? 'Preparando informe…' : 'Descargar informe oficial de seguridad (PDF)'}
      </button>
      <button type="button" disabled={!expedienteId || Boolean(busy)} onClick={() => download('json')}
        className="rounded-lg border border-white/15 px-3 py-2 text-xs text-[#C2C7D6] disabled:opacity-40">
        {busy === 'json' ? 'Preparando evidencia…' : 'Exportar evidencia técnica (JSON)'}
      </button>
    </div>
    <p className="text-[11px] text-[#8F9099]">Informe automatizado del expediente con comprobación de auditoría. No incluye firma profesional de un perito.</p>
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </div>;
}
