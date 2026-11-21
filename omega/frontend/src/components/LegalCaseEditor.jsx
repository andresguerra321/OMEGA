import { useEffect, useRef, useState } from 'react';
import { CASE_CLASSES, CASE_STATES, LEGAL_INPUT, LEGAL_PRIMARY, LEGAL_SECONDARY } from '../lib/legalPresentation.js';

export function LegalCaseEditor({ value, onSave, onClose }) {
  const [draft, setDraft] = useState(() => value ? { title: value.title, classification: value.classification, description: value.description, reference: value.reference, status: value.status } : { title: '', classification: 'CONFIDENTIAL', description: '', reference: '', status: 'OPEN' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.querySelector('input')?.focus();
    return () => previous?.focus();
  }, []);
  const change = event => setDraft(previous => ({ ...previous, [event.target.name]: event.target.value }));
  async function save(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { await onSave(draft); } catch { setError('No se pudo guardar el expediente. Revisa los datos e intenta de nuevo.'); setBusy(false); }
  }
  function keyboard(event) {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled),input,textarea,select')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A0A0C]/85 p-4">
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="case-editor-title" onKeyDown={keyboard} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/[0.07] bg-[#0F131B]/95 p-6 backdrop-blur-md">
      <h2 id="case-editor-title" className="text-lg font-semibold text-white">{value ? 'Editar expediente' : 'Crear expediente'}</h2>
      <form onSubmit={save} className="mt-5 space-y-4">
        <label className="block space-y-1 text-sm text-white/70">Título<input name="title" required minLength={3} maxLength={255} value={draft.title} onChange={change} className={LEGAL_INPUT} /></label>
        <label className="block space-y-1 text-sm text-white/70">Referencia del caso<input name="reference" maxLength={160} value={draft.reference} onChange={change} className={LEGAL_INPUT} /></label>
        <label className="block space-y-1 text-sm text-white/70">Descripción<textarea name="description" maxLength={10000} rows={3} value={draft.description} onChange={change} className={LEGAL_INPUT} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm text-white/70">Estado<select name="status" value={draft.status} onChange={change} className={LEGAL_INPUT}>{Object.entries(CASE_STATES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label className="space-y-1 text-sm text-white/70">Clasificación<select name="classification" value={draft.classification} onChange={change} className={LEGAL_INPUT}>{Object.entries(CASE_CLASSES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        </div>
        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
        <div className="flex justify-end gap-3 pt-2"><button type="button" disabled={busy} className={LEGAL_SECONDARY} onClick={onClose}>Cancelar</button><button type="submit" disabled={busy} className={LEGAL_PRIMARY}>{busy ? 'Guardando…' : 'Guardar expediente'}</button></div>
      </form>
    </section>
  </div>;
}
