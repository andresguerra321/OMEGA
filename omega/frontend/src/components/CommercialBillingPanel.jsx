import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { CommercialDocumentsPanel } from './CommercialDocumentsPanel';
import { downloadReportFile } from './ProfessionalReportsPanel';
import { OmegaSelect } from './OmegaSelect';

const empty = { legalName: '', documentType: 'CC', documentNumber: '', billingEmail: '', address: '', city: '' };
const labels = { legalName: 'Nombre o razón social', documentNumber: 'Número de identificación', billingEmail: 'Correo para facturación', address: 'Dirección de facturación', city: 'Ciudad' };
const statuses = { PENDING: 'Pendiente', SENT: 'Enviado al servidor de correo', FAILED: 'Requiere atención', SKIPPED: 'Sin destinatario activo' };
export function CommercialBillingPanel({ canManage = false }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!canManage) return;
    let current = true;
    apiFetch('/commercial/billing').then(value => {
      if (!current) return;
      setData(value);
      const item = value.customer;
      if (item?.legal_name) setForm({ legalName: item.legal_name, documentType: item.document_type, documentNumber: item.document_number, billingEmail: item.billing_email, address: item.address, city: item.city });
    }).catch(err => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [canManage]);
  return <div className="space-y-8 text-sm text-white/80">
    <CommercialDocumentsPanel authenticated />
    {canManage && <>
      <section className="space-y-4 border-t border-white/[0.06] pt-6">
        <h2 className="text-lg font-semibold">Datos de facturación</h2>
        <p className="text-xs text-white/55">La facturación fiscal se gestiona manualmente por el prestador. Guardar estos datos no emite una factura ni confirma validación DIAN.</p>
        <form className="space-y-4" onSubmit={async event => {
          event.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice('');
          try { await apiFetch('/commercial/billing/customer', { method: 'PUT', body: form }); setNotice('Datos de facturación guardados.'); }
          catch (err) { setError(err.message); } finally { setBusy(false); }
        }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-xs text-white/60"><span>Tipo de identificación</span><OmegaSelect value={form.documentType} onChange={event => setForm({ ...form, documentType: event.target.value })}>{[['CC', 'Cédula'], ['NIT', 'NIT'], ['CE', 'Cédula de extranjería'], ['PASSPORT', 'Pasaporte']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OmegaSelect></label>
            {Object.entries(labels).map(([key, label]) => <label key={key} className="space-y-2 text-xs text-white/60"><span>{label}</span><input required type={key === 'billingEmail' ? 'email' : 'text'} maxLength={key === 'documentNumber' ? 40 : key === 'city' ? 100 : key === 'address' ? 300 : key === 'billingEmail' ? 255 : 200} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} className="block w-full rounded-lg border border-white/[0.05] bg-[#141923]/75 px-3 py-2 text-sm text-white/90" /></label>)}
          </div>
          <button disabled={busy} className="rounded-lg bg-[#2F6FED] px-4 py-2 font-medium text-white disabled:opacity-40">{busy ? 'Guardando…' : 'Guardar datos'}</button>
        </form>
      </section>
      <section className="space-y-3 border-t border-white/[0.06] pt-6">
        <h2 className="font-semibold">Pagos y comprobantes</h2>
        <p className="text-xs text-white/55">El comprobante acredita el pago registrado. La factura fiscal, cuando corresponda, se entrega por separado mediante el proceso manual.</p>
        {!data?.payments?.length && <p className="text-xs text-white/50">Sin pagos registrados.</p>}
        {data?.payments?.map(payment => <div key={payment.mp_payment_id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs">
          <span>{Number(payment.amount).toLocaleString('es-CO')} {payment.currency} · {payment.status} · Ref. {payment.mp_payment_id}</span>
          {payment.approved_at && <button type="button" disabled={busy} className="rounded-lg px-3 py-2 underline underline-offset-4 disabled:opacity-40" onClick={async () => {
            setBusy(true); setError(''); try { await downloadReportFile(`/commercial/billing/receipts/${payment.mp_payment_id}`, `omega-payment-${payment.mp_payment_id}.pdf`); } catch (err) { setError(err.message); } finally { setBusy(false); }
          }}>Descargar comprobante</button>}
        </div>)}
      </section>
      <section className="space-y-3 border-t border-white/[0.06] pt-6">
        <h2 className="font-semibold">Notificaciones recientes</h2>
        {data && !data.mailEnabled && <p className="text-xs text-amber-400">El envío de correo está desactivado en esta instalación. Las notificaciones quedan pendientes hasta habilitarlo.</p>}
        <p className="text-xs text-white/50">El estado «enviado» confirma entrega al servidor de correo; no confirma lectura ni llegada a la bandeja de entrada.</p>
        {!data?.notifications?.length && <p className="text-xs text-white/50">Sin notificaciones registradas.</p>}
        {data?.notifications?.map((item, index) => <div key={item.id || index} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>{item.subject}</span><span className="text-white/50">{statuses[item.status] || item.status}</span>
          {item.status === 'FAILED' && data.mailEnabled && <button type="button" disabled={busy || new Date(item.next_attempt_at) > new Date()} className="rounded-lg px-2 py-1 underline disabled:opacity-40" onClick={async () => {
            setBusy(true); setError(''); try { await apiFetch(`/commercial/billing/notifications/${item.id}/retry`, { method: 'POST' }); setData(await apiFetch('/commercial/billing')); setNotice('Notificación encolada para reintentar.'); } catch (err) { setError(err.message); } finally { setBusy(false); }
          }}>Reintentar envío</button>}
        </div>)}
      </section>
    </>}
    {error && <p role="alert" className="text-rose-400">{error}</p>}
    {notice && <p role="status" className="text-emerald-400">{notice}</p>}
  </div>;
}
