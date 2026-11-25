import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../lib/api';

export function CommercialDocumentsPanel({ authenticated = false, compact = false, registration = false, onRegistrationConsent }) {
  const [config, setConfig] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  useEffect(() => {
    let current = true;
    Promise.all([apiFetch('/public/commercial', { skipAuth: true }), authenticated ? apiFetch('/commercial/acceptance') : Promise.resolve({ accepted: false })])
      .then(([data, consent]) => { if (current) { setConfig(data); setAccepted(consent.accepted); } })
      .catch(err => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [authenticated]);
  useEffect(() => { if (selected && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [selected]);
  return <section className={compact ? 'space-y-2 text-xs' : 'space-y-4 text-sm'}>
    {!compact && <h2 className="text-lg font-semibold text-white/90">Documentos del servicio</h2>}
    <div className="flex flex-wrap gap-4 text-white/65">
      {[['terms', 'Términos y condiciones'], ['privacy', 'Privacidad y tratamiento de datos']].map(([key, label]) =>
        <button key={key} type="button" disabled={!config} onClick={() => setSelected(key)} className="rounded-lg py-1 underline underline-offset-4 hover:text-white disabled:opacity-40">{label}</button>)}
    </div>
    {config && <p className="text-xs text-white/50">{config.published ? `Versión ${config.version}` : 'Borradores en revisión. Pendientes de datos comerciales y validación de las prácticas de tratamiento.'}</p>}
    {registration && config?.published && <button type="button" aria-pressed={registrationConsent}
      className="rounded-lg border border-white/[0.07] bg-[#141923]/75 px-3 py-2 text-left text-xs text-white/75"
      onClick={() => { const next = !registrationConsent; setRegistrationConsent(next); onRegistrationConsent?.(next ? config.version : null); }}>
      {registrationConsent ? 'Aceptación seleccionada' : 'Aceptar términos y tratamiento de datos para crear mi cuenta'}
    </button>}
    {authenticated && config?.published && <div className="space-y-2">
      <p className="text-xs text-white/60">Al aceptar confirmas que revisaste los términos y autorizas el tratamiento necesario para prestar el servicio según la política. La publicidad requiere una autorización independiente.</p>
      {accepted ? <p className="text-xs text-emerald-400" role="status">Aceptación de esta versión registrada.</p> :
        <button type="button" disabled={busy} className="rounded-lg border border-white/[0.07] bg-[#141923]/75 px-3 py-2 text-white/85 disabled:opacity-40"
          onClick={async () => { setBusy(true); setError(''); try { await apiFetch('/commercial/acceptance', { method: 'POST', body: { version: config.version } }); setAccepted(true); } catch (err) { setError(err.message); } finally { setBusy(false); } }}>Aceptar términos y tratamiento de datos</button>}
    </div>}
    {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
    <dialog ref={dialog} onClose={() => setSelected('')} aria-labelledby="commercial-document-title"
      className="m-auto max-h-[85vh] w-[min(760px,94vw)] rounded-2xl border border-white/[0.07] bg-[#0F131B] p-6 text-white/85 backdrop:bg-black/70">
      <div className="flex items-center justify-between gap-4"><h3 id="commercial-document-title" className="font-semibold">{selected === 'terms' ? 'Términos y condiciones' : 'Privacidad y tratamiento de datos'}</h3>
        <button type="button" aria-label="Cerrar documento" className="rounded-lg p-2 hover:bg-white/5" onClick={() => dialog.current.close()}><X size={16} strokeWidth={1.75} /></button></div>
      <p className="mt-2 text-xs text-white/50">{config?.published ? `Versión ${config.version}` : 'BORRADOR · No constituye una publicación definitiva.'}</p>
      <div className="mt-5 whitespace-pre-wrap text-sm leading-7">{config?.documents?.[selected]}</div>
    </dialog>
  </section>;
}
