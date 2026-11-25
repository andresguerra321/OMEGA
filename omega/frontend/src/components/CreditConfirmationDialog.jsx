import { useEffect, useRef, useState } from 'react';
import { registerCreditConfirmation } from '../lib/creditConfirmation.js';

const labels = { AI_IMAGE: 'Analizar imagen', YARA_SCAN: 'Escanear archivos', FORENSIC_STANDARD: 'Ejecutar análisis forense', FORENSIC_DEEP: 'Ejecutar análisis profundo', REPO_SCAN: 'Escanear repositorio', DEV_AUDIT: 'Revisar estación de trabajo', LEGAL_INDEX: 'Procesar documento', AI_QUERY: 'Consultar asistente' };

export function CreditConfirmationDialog() {
  const [request, setRequest] = useState(null);
  const pending = useRef(null);
  const dialog = useRef(null);
  const cancel = useRef(null);
  useEffect(() => {
    const unregister = registerCreditConfirmation((value) => new Promise((resolve) => {
      if (pending.current) { resolve(false); return; }
      pending.current = resolve;
      setRequest(value);
    }));
    return () => { unregister(); pending.current?.(false); pending.current = null; };
  }, []);
  useEffect(() => {
    if (request) { dialog.current?.showModal(); cancel.current?.focus(); }
    else dialog.current?.close();
  }, [request]);
  function finish(accepted) {
    pending.current?.(accepted); pending.current = null; setRequest(null);
  }
  return <dialog ref={dialog} aria-labelledby="credit-confirm-title" onCancel={(event) => { event.preventDefault(); finish(false); }} className="m-auto w-[min(420px,calc(100%_-_32px))] rounded-2xl border border-white/[0.07] bg-[#0F131B] p-6 text-white backdrop:bg-black/70">
    <h2 id="credit-confirm-title" className="text-base font-medium">{labels[request?.operation] || 'Confirmar operación'}</h2>
    <p className="mt-3 text-sm text-white/70">{request?.operation === 'LEGAL_INDEX' ? 'Se reservarán hasta' : 'Esta operación utiliza'} <strong className="text-white">{request?.credits} créditos</strong>.</p>
    <p className="mt-2 text-xs text-white/50">{request?.operation === 'LEGAL_INDEX' ? 'La reserva cubre OCR. Al finalizar se devuelve la diferencia si basta con extraer texto.' : 'Si el servicio falla sin entregar un resultado útil, se libera la reserva.'}</p>
    <div className="mt-6 flex justify-end gap-3"><button ref={cancel} type="button" onClick={() => finish(false)} className="rounded-lg px-3 py-2 text-sm text-white/65 focus-visible:outline-2 focus-visible:outline-white">Cancelar</button><button type="button" onClick={() => finish(true)} className="rounded-lg bg-[#2F6FED] px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-white">Confirmar consumo</button></div>
  </dialog>;
}
