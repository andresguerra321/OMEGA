import { useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { apiFetch, listDevProjects, listExpedientes } from '../lib/api';
import { OmegaSelect } from './OmegaSelect';
import { AnalysisHistoryPanel } from './AnalysisHistoryPanel';

export async function downloadReportFile(path, filename) {
  const blob = await apiFetch(path, { responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProfessionalReportsPanel({ profile = 'GENERAL', activeExpedienteId = '' }) {
  const [reports, setReports] = useState([]);
  const [sources, setSources] = useState([]);
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState('');
  const developer = profile === 'DEVELOPER';
  useEffect(() => {
    let current = true;
    setBusy(true); setError('');
    Promise.all([apiFetch('/reports'), developer ? listDevProjects() : listExpedientes()])
      .then(([items, options]) => {
        if (!current) return;
        setReports(items); setSources(options);
        setScope(developer ? '' : options.find(item => profile === 'GENERAL' && item.title === 'Análisis personales')?.id || (options.some(item => item.id === activeExpedienteId) ? activeExpedienteId : options[0]?.id || ''));
      }).catch(err => { if (current) setError(err.message); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [profile, activeExpedienteId, developer]);
  useEffect(() => {
    const refresh = () => apiFetch('/reports').then(setReports).catch(err => setError(err.message));
    window.addEventListener('omega:reports-updated', refresh);
    return () => window.removeEventListener('omega:reports-updated', refresh);
  }, []);

  async function run(action) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (err) { setError(err.message || 'No se pudo completar la operación.'); }
    finally { setBusy(false); }
  }
  const descriptions = {
    GENERAL: 'Evidencia de exposición y protección, límites del análisis y próximos pasos.',
    DEVELOPER: 'Hallazgos completos, alcance de cada evaluación y acciones de corrección verificables.',
    LEGAL: 'Inventario documental y cronología con citas, confianza y estado de revisión.',
  };
  return <section className="space-y-6 text-sm text-white/85" aria-busy={busy}>
    <div className="space-y-2">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><FileText size={18} strokeWidth={1.75} /> Informes</h2>
      <p className="text-white/55">{descriptions[profile] || descriptions.GENERAL}</p>
      <p className="text-xs text-white/50">Generar y descargar con resultados existentes cuesta 0 créditos. Guarda una versión de esos resultados; una nueva evaluación se realiza desde su módulo.</p>
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-56 flex-1 flex-col gap-2 text-xs text-white/65">{developer ? 'Proyecto' : profile === 'LEGAL' ? 'Expediente' : 'Espacio de análisis'}
        <OmegaSelect value={scope} onChange={event => setScope(event.target.value)} disabled={busy}>
          {developer && <option value="">Todos los proyectos evaluados</option>}
          {!developer && !sources.length && <option value="">Sin expedientes disponibles</option>}
          {sources.map(item => <option key={item.id} value={item.id}>{item.title || item.name}</option>)}
        </OmegaSelect>
      </label>
      <button type="button" disabled={busy || (!developer && !scope)} className="rounded-lg bg-[#2F6FED] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        onClick={() => run(async () => {
          const item = await apiFetch('/reports', { method: 'POST', body: { profile, expedienteId: developer ? null : scope, projectId: developer ? scope || null : null } });
          setReports(await apiFetch('/reports'));
          setNotice(`Informe guardado: ${item.id}. Ya puedes descargar su versión PDF o JSON.`);
        })}>{busy ? 'Preparando…' : 'Generar informe'}</button>
    </div>
    {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-400">{notice}</p>}
    {profile === 'GENERAL' && <AnalysisHistoryPanel caseId={scope} />}
    <div className="divide-y divide-white/[0.06]">
      {!reports.length && <p className="py-6 text-white/50">Tus informes guardados aparecerán aquí.</p>}
      {reports.map(item => <div key={item.id} className="space-y-2 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="font-medium">{item.title}</p><p className="text-xs text-white/50">{new Date(item.created_at).toLocaleString('es-CO')} · {item.profile}</p></div>
          <div className="flex gap-3">{['pdf', 'json'].map(format => <button key={format} type="button" disabled={busy}
            onClick={() => run(() => downloadReportFile(`/reports/${item.id}/${format}`, `omega-report-${item.id}.${format}`))}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-white/70 hover:bg-white/5 disabled:opacity-40">
            <Download size={14} strokeWidth={1.75} />{format.toUpperCase()}</button>)}</div>
        </div>
        <p className="break-all font-mono text-[10px] text-white/40">ID: {item.id}<br />SHA-256 PDF: {item.pdf_sha256}</p>
        <details className="text-xs text-white/50"><summary className="cursor-pointer rounded-lg py-1">Opciones de esta versión</summary>
          {deleting === item.id ? <div className="flex flex-wrap items-center gap-3 py-2">
            <span>Se eliminará esta versión guardada.</span>
            <button type="button" disabled={busy} className="rounded-lg px-2 py-1 text-rose-400" onClick={() => run(async () => {
              await apiFetch(`/reports/${item.id}`, { method: 'DELETE' }); setDeleting(''); setReports(await apiFetch('/reports'));
            })}>Confirmar eliminación</button>
            <button type="button" onClick={() => setDeleting('')} className="rounded-lg px-2 py-1">Cancelar</button>
          </div> : <button type="button" className="rounded-lg px-2 py-2 text-rose-400" onClick={() => setDeleting(item.id)}>Eliminar versión guardada</button>}
        </details>
      </div>)}
    </div>
    <p className="text-xs text-white/45">Se muestran hasta 100 versiones recientes con tus permisos actuales. Los informes contienen datos derivados: eliminar el expediente o un documento fuente elimina sus versiones asociadas.</p>
  </section>;
}
