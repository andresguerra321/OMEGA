import { useRef, useState } from 'react';
import { apiFetch, exportExpedienteDossier } from '../lib/api';

export default function DossierExportButtons({ expedienteId, profile = 'GENERAL' }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function download(format, technical = false) {
    if (!expedienteId || pending.current) return;
    pending.current = true; setBusy(format); setError('');
    try {
      let blob;
      if (technical) blob = await exportExpedienteDossier(expedienteId, format);
      else {
        const report = await apiFetch('/reports', { method: 'POST', body: { profile: profile === 'LEGAL' ? 'LEGAL' : 'GENERAL', expedienteId } });
        blob = await apiFetch(`/reports/${report.id}/${format}`, { responseType: 'blob' });
      }
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
        {busy === 'pdf' ? 'Preparando informe…' : 'Descargar informe (PDF)'}
      </button>
      <button type="button" disabled={!expedienteId || Boolean(busy)} onClick={() => download('json')}
        className="rounded-lg border border-white/[0.1] bg-[#141923]/75 hover:border-white/25 px-3 py-2 text-xs font-medium text-[#C2C7D6] transition-colors cursor-pointer disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-white">
        {busy === 'json' ? 'Preparando datos…' : 'Datos del informe (JSON)'}
      </button>
    </div>
    <p className="text-[11px] text-white/55">Informe de resultados existentes, sin créditos adicionales. La versión queda disponible en Cuenta → Informes.</p>
    <details className="text-[11px] text-white/55"><summary className="cursor-pointer rounded-lg py-1">Opciones avanzadas</summary>
      <button type="button" disabled={Boolean(busy)} onClick={() => download('pdf', true)} className="rounded-lg px-2 py-2 underline underline-offset-4">Dossier técnico de integridad (PDF)</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => download('json', true)} className="rounded-lg px-2 py-2 underline underline-offset-4">Paquete de auditoría (JSON)</button>
      <p>Incluye inventario SHA-256, permisos y cadena de auditoría. No constituye firma electrónica ni dictamen pericial.</p>
    </details>
    {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
  </div>;
}
