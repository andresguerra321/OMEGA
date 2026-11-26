import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { queryCasePartyConflicts } from '../lib/legalApi.js';
import {
  CASE_CLASSES,
  CASE_STATES,
  CONFLICT_ROLE_LABELS,
  LEGAL_INPUT,
  LEGAL_PRIMARY,
  LEGAL_SECONDARY,
  PROCESS_TYPES,
} from '../lib/legalPresentation.js';

function formatMatchRoles(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return 'Parte relacionada';
  return roles.map(role => CONFLICT_ROLE_LABELS[role] || role).join(' y ');
}

export function LegalConflictBanner({ groups, onDismiss }) {
  if (!Array.isArray(groups) || groups.length === 0) return null;
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-amber-400/25 bg-[#141923]/75 p-3.5 text-xs text-white/85 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-400" />
          <p className="font-medium text-amber-300">Posible conflicto de intereses. Es una alerta orientativa; verifícala.</p>
        </div>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="shrink-0 text-white/55 hover:text-white focus-visible:outline-2 focus-visible:outline-white rounded px-1">
            Ocultar
          </button>
        )}
      </div>
      <div className="space-y-2 pl-6">
        {groups.map(group => (
          <div key={group.fieldLabel} className="space-y-1">
            <p className="text-white/60">Coincidencias al verificar {group.fieldLabel.toLowerCase()}:</p>
            {group.matches.length > 0 && (
              <ul className="space-y-1 text-white/85">
                {group.matches.map((item, idx) => (
                  <li key={`${item.code || 'sin-ref'}-${item.title}-${idx}`} className="break-words">
                    <span className="font-medium text-white">{item.code ? `${item.code} · ` : ''}{item.title}</span>
                    <span className="text-white/60"> — figura como {formatMatchRoles(item.roles)}</span>
                  </li>
                ))}
              </ul>
            )}
            {group.restrictedMatches > 0 && (
              <p className="text-amber-300/90">
                {group.restrictedMatches === 1
                  ? '1 coincidencia adicional en un expediente sin permiso de lectura.'
                  : `${group.restrictedMatches} coincidencias adicionales en expedientes sin permiso de lectura.`}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LegalCaseEditor({ value, onSave, onClose }) {
  const [draft, setDraft] = useState(() => value ? {
    title: value.title || '',
    classification: value.classification || 'CONFIDENTIAL',
    description: value.description || '',
    reference: value.reference || '',
    status: value.status || 'OPEN',
    clientName: value.clientName || '',
    counterpartyName: value.counterpartyName || '',
    courtName: value.courtName || '',
    processType: value.processType || '',
    caseStage: value.caseStage || '',
  } : {
    title: '',
    classification: 'CONFIDENTIAL',
    description: '',
    reference: '',
    status: 'OPEN',
    clientName: '',
    counterpartyName: '',
    courtName: '',
    processType: '',
    caseStage: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflictGroups, setConflictGroups] = useState([]);
  const dialog = useRef(null);
  const checkSeq = useRef(0);

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.querySelector('input')?.focus();
    return () => previous?.focus();
  }, []);

  const runConflictCheck = useCallback(async (clientName, counterpartyName) => {
    const seq = ++checkSeq.current;
    const results = await queryCasePartyConflicts({ clientName, counterpartyName }, value?.id);
    if (seq === checkSeq.current) {
      setConflictGroups(results);
    }
  }, [value?.id]);

  const hasConflictCandidate = (draft.clientName || '').trim().length >= 4
    || (draft.counterpartyName || '').trim().length >= 4;

  useEffect(() => {
    if (!hasConflictCandidate) {
      checkSeq.current++;
      return undefined;
    }
    const timer = setTimeout(() => {
      void runConflictCheck(draft.clientName, draft.counterpartyName);
    }, 250);
    return () => clearTimeout(timer);
  }, [draft.clientName, draft.counterpartyName, hasConflictCandidate, runConflictCheck]);

  const change = event => setDraft(previous => ({ ...previous, [event.target.name]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave({
        ...draft,
        title: draft.title.trim(),
        reference: draft.reference.trim(),
        description: draft.description.trim(),
        clientName: draft.clientName.trim() || null,
        counterpartyName: draft.counterpartyName.trim() || null,
        courtName: draft.courtName.trim() || null,
        processType: draft.processType || null,
        caseStage: draft.caseStage.trim() || null,
      });
    } catch {
      setError('No se pudo guardar el expediente. Revisa los datos e intenta de nuevo.');
      setBusy(false);
    }
  }

  function keyboard(event) {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled),input,textarea,select')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A0A0C]/85 p-4">
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="case-editor-title" onKeyDown={keyboard} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/[0.07] bg-[#0F131B]/95 p-6 backdrop-blur-md">
        <h2 id="case-editor-title" className="text-lg font-semibold text-white">{value ? 'Editar expediente' : 'Crear expediente'}</h2>
        <form onSubmit={save} className="mt-5 space-y-4">
          <label className="block space-y-1 text-sm text-white/70">Título<input name="title" required minLength={3} maxLength={255} value={draft.title} onChange={change} className={LEGAL_INPUT} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm text-white/70">Referencia o radicado<input name="reference" maxLength={160} value={draft.reference} onChange={change} className={LEGAL_INPUT} /></label>
            <label className="space-y-1 text-sm text-white/70">Tipo de proceso<select name="processType" value={draft.processType} onChange={change} className={LEGAL_INPUT}><option value="">Sin especificar</option>{Object.entries(PROCESS_TYPES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm text-white/70">Cliente<input name="clientName" maxLength={200} value={draft.clientName} onChange={change} onBlur={() => void runConflictCheck(draft.clientName, draft.counterpartyName)} className={LEGAL_INPUT} /></label>
            <label className="space-y-1 text-sm text-white/70">Contraparte<input name="counterpartyName" maxLength={200} value={draft.counterpartyName} onChange={change} onBlur={() => void runConflictCheck(draft.clientName, draft.counterpartyName)} className={LEGAL_INPUT} /></label>
          </div>
          <LegalConflictBanner groups={hasConflictCandidate ? conflictGroups : []} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm text-white/70">Despacho o juzgado<input name="courtName" maxLength={200} value={draft.courtName} onChange={change} className={LEGAL_INPUT} /></label>
            <label className="space-y-1 text-sm text-white/70">Etapa procesal<input name="caseStage" maxLength={60} value={draft.caseStage} onChange={change} className={LEGAL_INPUT} /></label>
          </div>
          <label className="block space-y-1 text-sm text-white/70">Descripción<textarea name="description" maxLength={10000} rows={3} value={draft.description} onChange={change} className={LEGAL_INPUT} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm text-white/70">Estado<select name="status" value={draft.status} onChange={change} className={LEGAL_INPUT}>{Object.entries(CASE_STATES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label className="space-y-1 text-sm text-white/70">Clasificación<select name="classification" value={draft.classification} onChange={change} className={LEGAL_INPUT}>{Object.entries(CASE_CLASSES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          </div>
          {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
          <div className="flex justify-end gap-3 pt-2"><button type="button" disabled={busy} className={LEGAL_SECONDARY} onClick={onClose}>Cancelar</button><button type="submit" disabled={busy} className={LEGAL_PRIMARY}>{busy ? 'Guardando…' : 'Guardar expediente'}</button></div>
        </form>
      </section>
    </div>
  );
}
