import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { compareEvaluations } from '../lib/evaluationComparison.js';
import { presentEvaluation } from '../lib/evaluationPresentation.js';
const names = { TRIAGE_FILES: 'Análisis de archivos', LINK_VERIFY: 'Verificación de enlace', YARA_SCAN: 'Reglas YARA', IOC_FILE: 'Indicadores de archivo', IOC_TEXT: 'Indicadores de texto', DEVICE_LIVE: 'Evaluación de dispositivo', PC_LIVE: 'Evaluación del equipo', MOBILE_USB: 'Evaluación USB', HOST_PERSISTENCE: 'Arranque y persistencia del equipo' };

export function AnalysisHistoryPanel({ caseId }) {
  const [snapshot, setSnapshot] = useState({ caseId: '', items: [], canWrite: false });
  const items = snapshot.caseId === caseId ? snapshot.items : [];
  const canWrite = snapshot.caseId === caseId && snapshot.canWrite;
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]);
  const [pendingDelete, setPendingDelete] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!caseId) return;
    let current = true; setError(''); setSelected([]);
    apiFetch(`/expedientes/${caseId}/evaluations`).then(data => {
      if (!Array.isArray(data.items)) throw new Error('No se pudo leer el historial de evaluaciones.');
      if (current) setSnapshot({ caseId, items: data.items, canWrite: Boolean(data.canWrite) });
    })
      .catch(err => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [caseId]);
  if (!caseId) return null;
  let comparison = null;
  const visibleSelected = selected.filter(id => items.some(item => item.id === id));
  if (visibleSelected.length === 2) {
    try { const values = visibleSelected.map(id => items.find(item => item.id === id)).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); comparison = compareEvaluations(...values); }
    catch (err) { comparison = { error: err.message }; }
  }
  return <section className="space-y-3 border-t border-white/[0.06] pt-5" aria-label="Evaluaciones guardadas">
    <h3 className="text-sm font-medium text-white/85">Evidencia de tus evaluaciones</h3>
    <p className="text-xs text-white/50">Se guardan observaciones saneadas, no los archivos originales ni la captura completa del dispositivo. Puedes comparar dos registros o eliminar su detalle. Los análisis antiguos pueden conservar solo contadores.</p>
    {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
    {!items.length && <p className="text-xs text-white/50">Sin evaluaciones guardadas en este espacio.</p>}
    <div className="divide-y divide-white/[0.06]">{items.map(item => { const view = presentEvaluation(item.result); return <article key={item.id} className="space-y-2 py-3 text-xs">
      <div className="flex flex-wrap justify-between gap-3"><span>{names[item.operation] || item.operation} · {new Date(item.created_at).toLocaleString('es-CO')}</span>
        <button type="button" aria-pressed={selected.includes(item.id)} className="rounded-lg px-2 py-1 text-white/65 hover:bg-white/5" onClick={() => setSelected(old => old.includes(item.id) ? old.filter(id => id !== item.id) : [...old.slice(-1), item.id])}>{selected.includes(item.id) ? 'Seleccionada para comparar' : 'Comparar'}</button></div>
      {item.result.truncated && <p className="text-amber-400">Detalle parcial: se alcanzó un límite de conservación.</p>}
      <details><summary className="cursor-pointer rounded-lg py-1 text-white/60">Ver observaciones y recomendaciones</summary>
        <div className="mt-2 space-y-3 leading-6 text-white/75"><p className="font-medium">{view.verdict} · Confianza: {view.confidence}</p><p>{view.explanation}</p>
          {view.findings.length > 0 && <ul className="list-disc space-y-1 pl-4">{view.findings.map((text, index) => <li key={index}>{text}</li>)}</ul>}
          {view.totalFindings > view.findings.length && <p>Se muestran {view.findings.length} de {view.totalFindings} observaciones. El paquete técnico contiene el detalle conservado.</p>}
          {view.actions.length > 0 && <div><p className="font-medium">Acciones recomendadas</p><ol className="list-decimal space-y-1 pl-4">{view.actions.map((text, index) => <li key={index}>{text}</li>)}</ol></div>}
          <p className="text-white/50">Un resultado sin coincidencias no certifica ausencia de amenazas.</p>
        </div>
        <details className="mt-3 text-white/50"><summary className="cursor-pointer rounded-lg py-1">Paquete técnico</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(item.result.observations, null, 2)}</pre></details>
        <p className="mt-2 break-all text-[10px] text-white/40">Referencia: {item.id}</p>
        {canWrite && <div className="flex flex-wrap gap-3 pt-3">
          {pendingDelete === item.id ? <><span>Eliminar el detalle también elimina los informes General derivados de este espacio.</span><button type="button" disabled={busy} className="rounded-lg px-2 py-1 text-rose-400" onClick={async () => {
            setBusy(true); setError(''); try { await apiFetch(`/expedientes/${caseId}/evaluations/${item.id}`, { method: 'DELETE' }); setSnapshot(old => ({ ...old, items: old.items.filter(row => row.id !== item.id) })); setSelected(old => old.filter(id => id !== item.id)); setPendingDelete(''); window.dispatchEvent(new Event('omega:reports-updated')); } catch (err) { setError(err.message); } finally { setBusy(false); }
          }}>Confirmar eliminación</button><button type="button" onClick={() => setPendingDelete('')}>Cancelar</button></> : <button type="button" className="rounded-lg px-2 py-1 text-rose-400" onClick={() => setPendingDelete(item.id)}>Eliminar detalle guardado</button>}
        </div>}
      </details>
    </article>; })}</div>
    {comparison && <div role="status" className="space-y-2 text-xs text-white/65">{comparison.error || <><p>Coincidencias registradas: {comparison.before ?? 'No consta'} → {comparison.after ?? 'No consta'}. Cambio: {comparison.delta ?? 'No comparable'}.</p><p>{comparison.limitation}</p></>}</div>}
    <p className="text-[11px] text-white/45">Se muestran hasta 100 evaluaciones recientes del espacio.</p>
  </section>;
}
