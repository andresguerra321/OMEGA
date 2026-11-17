import { containmentCandidate } from '../lib/containment';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { containmentChallenge, containmentHistory, executeContainment, previewContainment, rollbackContainment, getAuthSession } from '../lib/api';

export function ContainmentButton({ finding }) {
  const candidate = containmentCandidate(finding);
  if (!candidate) return null;
  const admin = getAuthSession()?.role === 'ADMIN';
  return <button type="button" disabled={!admin} title={admin ? undefined : 'La contención requiere una cuenta administradora del equipo.'} className="mt-2 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 disabled:opacity-40"
    onClick={() => window.dispatchEvent(new CustomEvent('omega:containment-preview', { detail: candidate }))}>
    Aislar y bloquear amenaza ahora
  </button>;
}

export function EmergencyGuidance({ mobile = false }) {
  return <aside className="mt-3 rounded-lg border border-amber-400/30 p-3 text-sm">
    <p className="font-medium">Qué hacer mientras revisas el hallazgo</p>
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-[#B7B7C0]">
      <li>No abras el enlace ni respondas al remitente. Conserva el mensaje o la captura.</li>
      <li>Revisa sesiones y credenciales desde otro dispositivo confiable.</li>
      <li>{mobile ? 'En iPhone, valora Modo de aislamiento en Ajustes → Privacidad y seguridad. Consulta antes con soporte si necesitas preservar evidencia: su activación puede requerir reiniciar.' : 'Si la conexión es un riesgo inmediato, desconecta la red sin apagar el equipo y solicita revisión especializada.'}</li>
    </ol>
  </aside>;
}

export function InfrastructureBadges({ result }) {
  if (!result) return null;
  const info = result.infrastructure_intelligence || result;
  return <div className="mt-3 flex flex-wrap gap-2 text-xs" aria-label="Señales de infraestructura">
    {Number.isInteger(info.domainAgeDays) && <span className="rounded border border-amber-300/30 px-2 py-1">Dominio registrado hace {info.domainAgeDays} días{info.domainAgeDays < 30 ? ' · Infraestructura reciente' : ''}</span>}
    {info.freshTlsCertificate === true && <span className="rounded border border-white/20 px-2 py-1">Certificado reciente · Puede ser una renovación legítima</span>}
    {info.cloakingDetected === true && <span className="rounded border border-red-300/30 px-2 py-1">Respuestas distintas según el perfil · Posible evasión</span>}
    {info.evasionReasons?.map(reason => <p key={reason} className="w-full text-[#B7B7C0]">{reason}</p>)}
    {info.limitations?.length > 0 && <details className="w-full text-[#B7B7C0]"><summary className="cursor-pointer">Fuentes y límites de esta comprobación</summary>
      <ul className="mt-1 list-disc pl-4">{info.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
    </details>}
  </div>;
}

export function ContainmentPanel({ enabled, candidates = [], showHistory = false, expedienteId = null }) {
  const [modal, setModal] = useState(null);
  const [actions, setActions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const opener = useRef(null);
  const dialog = useRef(null);
  const alive = useRef(true);
  const epoch = useRef(0);
  const busyRef = useRef(false);

  async function refresh() {
    try { const response = await containmentHistory(); if (alive.current) setActions(response.actions || []); }
    catch (err) { if (alive.current) setError(err.message); }
  }
  function resetCredentials() { setPassword(''); setCode(''); setChallenge(null); }
  function close() { if (busyRef.current) return; epoch.current += 1; setModal(null); resetCredentials(); opener.current?.focus?.(); }

  async function preview(candidate) {
    candidate = { ...candidate, expedienteId };
    if (busyRef.current) return;
    if (!enabled) { setError('Conecta el sensor nativo y una cuenta administradora para contener en esta computadora.'); return; }
    const requestEpoch = ++epoch.current;
    opener.current = document.activeElement;
    busyRef.current = true; setBusy(true); setError(''); resetCredentials();
    try { const plan = await previewContainment(candidate); if (alive.current && epoch.current === requestEpoch) setModal({ candidate, plan }); }
    catch (err) { if (alive.current && epoch.current === requestEpoch) setError(err.message); }
    finally { busyRef.current = false; if (alive.current && epoch.current === requestEpoch) setBusy(false); }
  }

  useEffect(() => {
    alive.current = true;
    const listener = event => { void preview(event.detail); };
    window.addEventListener('omega:containment-preview', listener);
    return () => { alive.current = false; epoch.current += 1; window.removeEventListener('omega:containment-preview', listener); };
    // Every machine/tenant mounts its own panel; sensitive operations re-check ownership on the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, expedienteId]);

  useEffect(() => {
    if (!modal) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    function keydown(event) {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const controls = dialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled)');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, busy]);

  async function confirm(event) {
    event.preventDefault();
    if (!password || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      let verification = challenge;
      if (!verification) {
        verification = await containmentChallenge(password);
        setChallenge(verification);
        if (verification.mfaRequired) return;
      }
      const credentials = { currentPassword: password, challengeToken: verification.challengeToken, code,
        expedienteId: modal.candidate?.expedienteId || modal.expedienteId || null };
      const response = modal.rollbackId
        ? await rollbackContainment(modal.rollbackId, credentials)
        : await executeContainment(modal.candidate, modal.plan.previewToken, credentials);
      if (!alive.current) return;
      setMessage(response.status === 'ACTIVE' ? 'La acción se aplicó en la computadora indicada. Puedes revisarla y deshacerla en el historial.'
        : response.status === 'ROLLED_BACK' && !response.error ? 'Restauración completada.' : 'La operación requiere revisión. Consulta su estado y evidencia en el historial.');
      setModal(null); resetCredentials(); await refresh(); opener.current?.focus?.();
    } catch (err) { if (alive.current) { setError(err.message); setChallenge(null); setCode(''); } }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }

  return <div className="mt-2 text-[#F2F2F4]">
    {candidates.length > 0 && enabled && <button type="button" disabled={busy} onClick={() => preview(candidates[0])}
      className="rounded-lg border border-red-400/40 bg-red-500/15 px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Preparando previsualización…' : 'Aislar y bloquear amenaza ahora'}</button>}
    {error && <p role="alert" className="mt-2 text-sm text-amber-300">{error}</p>}
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
    {(showHistory || actions.length > 0) && <details onToggle={event => { if (event.currentTarget.open && enabled) void refresh(); }} className="mt-2 text-sm">
      <summary className="cursor-pointer">Historial de Protección y Cuarentena</summary>
      {!enabled && <p>Se necesita el sensor nativo del equipo propietario para consultar la bóveda.</p>}
      <div className="max-h-64 space-y-2 overflow-y-auto py-2">
        {actions.map(action => <article key={action.actionId} className="rounded border border-white/10 p-2">
          <p>{action.actionType} · {action.status}{action.observedState ? ` · ${action.observedState}` : ''}</p><p className="break-all text-xs">{action.target?.originalPath || action.target?.indicator} · {action.timestamp}</p>
          {action.observedState === 'DRIFTED' && <p className="text-amber-300">Las reglas actuales ya no coinciden con la acción registrada. Revisa el estado antes de confiar en el bloqueo.</p>}
          {action.error && <p className="text-amber-300">{action.errorMessage || 'Se requiere revisión antes de confirmar la recuperación.'}</p>}
          {action.status !== 'ROLLED_BACK' && <button type="button" disabled={busy} onClick={() => { opener.current = document.activeElement; resetCredentials(); setModal({ rollbackId: action.actionId, plan: action, expedienteId }); }} className="mt-1 rounded border border-white/20 px-2 py-1">Deshacer / Restaurar</button>}
        </article>)}
        {enabled && actions.length === 0 && <p>No hay acciones registradas en la bóveda consultada.</p>}
      </div>
    </details>}
    {modal && createPortal(<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4">
      <form ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="containment-title" onSubmit={confirm} className="max-h-[90vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-xl border border-white/20 bg-[#141418] p-5 text-[#F2F2F4]">
        <h2 id="containment-title" className="text-lg font-medium">{modal.rollbackId ? 'Confirmar restauración' : 'Revisar impacto antes de contener'}</h2>
        <p className="text-sm">{modal.rollbackId ? 'Se intentará restaurar el estado anterior sin sobrescribir archivos diferentes ni actuar sobre otro proceso.' : modal.plan.impact}</p>
        <p className="text-sm text-amber-200">Equipo: {modal.plan.hostname || 'sensor nativo'}. No configura ni aísla el teléfono conectado por USB.</p>
        {(modal.candidate?.expedienteId || modal.expedienteId) && <p className="text-xs text-[#B7B7C0]">Este evento también quedará registrado en el expediente activo al abrir esta confirmación.</p>}
        {!modal.rollbackId && !modal.plan.executionEnabled && <p role="alert" className="text-sm text-amber-300">La ejecución de contención está deshabilitada en este sensor. El administrador debe habilitarla antes de solicitar una previsualización nueva.</p>}
        <details className="text-xs"><summary>Ver objetivo y evidencia</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(modal.plan.target, null, 2)}</pre></details>
        <p className="text-xs text-[#B7B7C0]">La restauración requiere conservar la clave del almacén seguro y la evidencia. Si el SO o un tercero modifica el objetivo, puede necesitar recuperación manual.</p>
        <label className="block text-sm">Contraseña actual<input type="password" required disabled={busy} autoComplete="current-password" value={password} onChange={e => { setPassword(e.target.value); setChallenge(null); setCode(''); }} className="mt-1 block w-full rounded border border-white/20 bg-black/30 p-2" /></label>
        {challenge?.mfaRequired && <label className="block text-sm">Código 2FA ({challenge.method})<input type="text" required disabled={busy} autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} className="mt-1 block w-full rounded border border-white/20 bg-black/30 p-2" /></label>}
        {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={close} className="rounded border border-white/20 px-3 py-2">Cancelar</button>
          <button type="submit" disabled={busy || (!modal.rollbackId && !modal.plan.executionEnabled)} className="rounded bg-[#2F6FED] px-3 py-2 disabled:opacity-50">{busy ? 'Verificando…' : modal.rollbackId ? 'Deshacer / Restaurar' : 'Confirmar acción'}</button></div>
      </form>
    </div>, document.body)}
  </div>;
}
