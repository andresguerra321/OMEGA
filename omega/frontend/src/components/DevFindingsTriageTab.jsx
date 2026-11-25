import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Filter,
  MessageSquare,
  ShieldAlert,
  ShieldOff,
} from 'lucide-react';
import {
  addDevFindingComment,
  createDevSuppression,
  listDevFindingComments,
  listDevFindings,
  listDevProjects,
  listDevSuppressions,
  revokeDevSuppression,
  updateDevFindingTriage,
} from '../lib/api';
import { OmegaSelect } from './OmegaSelect';

const TRIAGE_LABELS = {
  NEW: 'Nuevo',
  CONFIRMED: 'Confirmado',
  FALSE_POSITIVE: 'Falso positivo',
  ACCEPTED: 'Aceptado',
  RESOLVED: 'Marcado como resuelto',
};

function severityBadge(sev) {
  const s = String(sev || 'LOW').toUpperCase();
  if (s === 'CRITICAL' || s === 'HIGH') return 'border-rose-500/35 bg-rose-500/10 text-rose-400';
  if (s === 'MEDIUM') return 'border-amber-400/35 bg-amber-400/10 text-amber-300';
  return 'border-white/[0.12] bg-white/[0.04] text-slate-400';
}

export function DevFindingsTriageTab({ authSession }) {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [severity, setSeverity] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [triageStatus, setTriageStatus] = useState('');
  const [latestOnly, setLatestOnly] = useState(true);

  const [findings, setFindings] = useState([]);
  const [suppressions, setSuppressions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [expandedId, setExpandedId] = useState(null);
  const [commentsById, setCommentsById] = useState({});
  const [commentText, setCommentText] = useState('');
  const [supReason, setSupReason] = useState('');
  const [supDays, setSupDays] = useState('30');

  const canWrite = authSession?.role === 'ADMIN' || authSession?.role === 'ANALYST';

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const [projs, fList] = await Promise.all([
        listDevProjects().catch(() => []),
        listDevFindings({ projectId, severity, ruleId, triageStatus, latestOnly }),
      ]);
      setProjects(Array.isArray(projs) ? projs : []);
      setFindings(Array.isArray(fList) ? fList : []);
      if (projectId) {
        const sups = await listDevSuppressions(projectId).catch(() => []);
        setSuppressions(Array.isArray(sups) ? sups : []);
      } else {
        setSuppressions([]);
      }
    } catch (err) {
      setError(err?.message || 'No se pudieron cargar los hallazgos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [authSession?.tenantId, projectId, severity, triageStatus, ruleId, latestOnly]);

  async function toggleExpand(finding) {
    if (expandedId === finding.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(finding.id);
    if (!commentsById[finding.id]) {
      const list = await listDevFindingComments(finding.id).catch(() => []);
      setCommentsById((prev) => ({ ...prev, [finding.id]: Array.isArray(list) ? list : [] }));
    }
  }

  async function handleStatusChange(findingId, nextStatus) {
    if (!canWrite) return;
    setError('');
    try {
      const updated = await updateDevFindingTriage(findingId, { status: nextStatus });
      setFindings((prev) => prev.map((f) => (f.id === findingId ? updated : f)));
    } catch (err) {
      setError(err?.message || 'No se pudo actualizar el estado del hallazgo.');
    }
  }

  async function handleAddComment(findingId) {
    if (!commentText.trim() || !canWrite) return;
    setError('');
    try {
      const added = await addDevFindingComment(findingId, commentText.trim());
      setCommentsById((prev) => ({
        ...prev,
        [findingId]: [...(prev[findingId] || []), added],
      }));
      setCommentText('');
    } catch (err) {
      setError(err?.message || 'No se pudo guardar el comentario.');
    }
  }

  async function handleSuppress(finding) {
    if (!supReason.trim() || !canWrite) return;
    setError('');
    try {
      await createDevSuppression(finding.projectId, {
        ruleId: finding.ruleId,
        fingerprint: finding.fingerprint,
        reason: supReason.trim(),
        expiresInDays: Number(supDays || 30),
      });
      setSupReason('');
      await handleStatusChange(finding.id, 'ACCEPTED');
      await refresh();
    } catch (err) {
      setError(err?.message || 'No se pudo registrar la supresión.');
    }
  }

  async function handleRevokeSuppression(supId) {
    if (!canWrite) return;
    try {
      await revokeDevSuppression(supId);
      await refresh();
    } catch (err) {
      setError(err?.message || 'No se pudo revocar la supresión.');
    }
  }

  const activeSupCount = suppressions.filter((s) => s.active).length;

  return (
    <div className="space-y-5">
      <details className="text-xs text-white/55"><summary className="cursor-pointer rounded-lg py-2">Opciones avanzadas</summary>
        <button type="button" aria-pressed={!latestOnly} className="rounded-lg border border-white/[0.06] px-3 py-2" onClick={() => setLatestOnly(value => !value)}>{latestOnly ? 'Mostrar también evaluaciones anteriores' : 'Volver a la evaluación más reciente'}</button>
        <p className="mt-2">{latestOnly ? 'Se muestran los hallazgos de la última evaluación de cada proyecto.' : 'El historial puede incluir hallazgos que ya no aparecen en la evaluación actual.'}</p>
      </details>
      <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
              <ShieldAlert className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Hallazgos y Triaje</h2>
              <p className="text-[11px] text-slate-400">
                Prioriza señales estáticas, gestiona falsos positivos y aplica supresiones auditadas con expiración.
              </p>
            </div>
          </div>

          {activeSupCount > 0 && (
            <span className="rounded-full bg-amber-400/10 border border-amber-400/30 px-3 py-1 text-[11px] text-amber-300">
              {activeSupCount} {activeSupCount === 1 ? 'supresión activa' : 'supresiones activas'} en el puntaje
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <OmegaSelect
            aria-label="Filtrar por proyecto"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Todos los proyectos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </OmegaSelect>

          <OmegaSelect
            aria-label="Filtrar por severidad"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="">Todas las severidades</option>
            <option value="CRITICAL">Crítica</option>
            <option value="HIGH">Alta</option>
            <option value="MEDIUM">Media</option>
            <option value="LOW">Baja</option>
          </OmegaSelect>

          <OmegaSelect
            aria-label="Filtrar por estado de triaje"
            value={triageStatus}
            onChange={(e) => setTriageStatus(e.target.value)}
          >
            <option value="">Todos los estados</option>
            {Object.entries(TRIAGE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </OmegaSelect>

          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={ruleId}
              onChange={(e) => setRuleId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void refresh()}
              placeholder="Filtrar por regla (ej. NPM-POSTINSTALL)"
              aria-label="Filtrar por regla"
              className="flex-1 min-w-0 rounded-lg bg-[#141923]/80 border border-white/[0.08] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#2F6FED]"
            />
            <button
              type="button"
              onClick={() => void refresh()}
              aria-label="Aplicar filtro de regla"
              className="rounded-lg bg-[#141923] border border-white/[0.08] hover:border-[#2F6FED] p-2 text-slate-300 cursor-pointer"
            >
              <Filter className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <p className="text-xs text-slate-400 py-4">Cargando hallazgos...</p>
        ) : findings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.1] bg-[#141923]/40 p-6 text-center space-y-1">
            <p className="text-xs font-medium text-slate-200">
              Sin señales detectadas con las reglas actuales y filtros seleccionados
            </p>
            <p className="text-[11px] text-slate-400">
              Ajusta los filtros o ejecuta un nuevo análisis para evaluar manifiestos y dependencias.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {findings.map((f) => {
              const isOpen = expandedId === f.id;
              const comments = commentsById[f.id] || [];
              return (
                <article key={f.id} className="py-4 first:pt-0 last:pb-0 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 font-mono text-[10.5px] ${severityBadge(f.severity)}`}>
                          {f.severity}
                        </span>
                        <span className="font-mono text-[11px] text-slate-300">{f.ruleId}</span>
                        {f.location && (
                          <span className="font-mono text-[11px] text-slate-400 truncate">{f.location}</span>
                        )}
                        <span className="rounded-md bg-[#141923] border border-white/[0.07] px-2 py-0.5 font-mono text-[10.5px] text-slate-300">
                          +{Number(f.scorePoints || 0).toFixed(0)} pts
                        </span>
                      </div>
                      <h3 className="text-sm font-medium text-slate-100">{f.title}</h3>
                      <p className="text-xs text-slate-400 leading-relaxed">{f.explanation}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <OmegaSelect
                        aria-label={`Estado de triaje para ${f.ruleId}`}
                        disabled={!canWrite}
                        value={f.triageStatus}
                        onChange={(e) => void handleStatusChange(f.id, e.target.value)}
                        className="min-w-[165px]"
                      >
                        {Object.entries(TRIAGE_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </OmegaSelect>

                      <button
                        type="button"
                        onClick={() => void toggleExpand(f)}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#141923] border border-white/[0.07] hover:border-white/[0.15] px-2.5 py-1.5 text-[11px] text-slate-200 cursor-pointer"
                      >
                        <span>Detalle y triaje</span>
                        {isOpen ? (
                          <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                        )}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="rounded-xl bg-[#141923]/75 border border-white/[0.06] p-4 space-y-4 text-xs">
                      {f.remediation && <div className="space-y-3">
                        <p className="font-medium text-white/85">Corrección y verificación</p>
                        <ol className="list-decimal space-y-2 pl-4 text-white/70">{f.remediation.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
                        <p className="text-white/60">{f.remediation.verification}</p>
                        <p className="text-[11px] text-white/40">{f.remediation.basis}</p>
                      </div>}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono">
                        <span>Detector: {f.detector}</span>
                        <span>Huella: {f.fingerprint?.slice(0, 16)}...</span>
                        <span>Contribución al puntaje: +{Number(f.scorePoints || 0).toFixed(1)} pts</span>
                      </div>

                      {canWrite && (
                        <div className="pt-2 border-t border-white/[0.06] space-y-2">
                          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                            <ShieldOff className="h-3.5 w-3.5 text-amber-400" strokeWidth={1.75} />
                            <span>Suprimir hallazgo con motivo y expiración</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <input
                              type="text"
                              value={supReason}
                              onChange={(e) => setSupReason(e.target.value)}
                              placeholder="Motivo verificable (ej. script de compilación interna auditado)"
                              className="sm:col-span-7 rounded-lg bg-[#0F131B] border border-white/[0.08] px-3 py-1.5 text-xs text-slate-100"
                            />
                            <OmegaSelect
                              aria-label="Expiración de supresión"
                              value={supDays}
                              onChange={(e) => setSupDays(e.target.value)}
                              className="sm:col-span-3"
                            >
                              <option value="7">Expira en 7 días</option>
                              <option value="30">Expira en 30 días</option>
                              <option value="90">Expira en 90 días</option>
                              <option value="0">Sin expiración</option>
                            </OmegaSelect>
                            <button
                              type="button"
                              disabled={!supReason.trim()}
                              onClick={() => void handleSuppress(f)}
                              className="sm:col-span-2 rounded-lg bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-45 px-3 py-1.5 text-xs font-medium text-white cursor-pointer"
                            >
                              Suprimir
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="pt-2 border-t border-white/[0.06] space-y-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                          <MessageSquare className="h-3.5 w-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                          <span>Comentarios de triaje ({comments.length})</span>
                        </div>
                        {comments.length > 0 && (
                          <div className="space-y-1.5">
                            {comments.map((c) => (
                              <div key={c.id} className="rounded-lg bg-[#0F131B] border border-white/[0.05] px-3 py-2 text-[11px] text-slate-300">
                                {c.body}
                              </div>
                            ))}
                          </div>
                        )}
                        {canWrite && (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={commentText}
                              onChange={(e) => setCommentText(e.target.value)}
                              placeholder="Añadir nota de revisión (sin secretos ni tokens)..."
                              className="flex-1 rounded-lg bg-[#0F131B] border border-white/[0.08] px-3 py-1.5 text-xs text-slate-100"
                            />
                            <button
                              type="button"
                              disabled={!commentText.trim()}
                              onClick={() => void handleAddComment(f.id)}
                              className="rounded-lg bg-[#141923] border border-white/[0.1] hover:border-[#2F6FED] px-3 py-1.5 text-xs text-slate-200 cursor-pointer"
                            >
                              Comentar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {suppressions.length > 0 && (
        <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-3">
          <h3 className="text-xs font-semibold text-slate-200">Supresiones del proyecto seleccionado</h3>
          <div className="divide-y divide-white/[0.06]">
            {suppressions.map((s) => (
              <div key={s.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-mono text-slate-200">{s.ruleId}</span>
                  <span className="ml-2 text-slate-400">— {s.reason}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${s.active ? 'bg-amber-400/10 text-amber-300' : 'bg-white/[0.05] text-slate-500'}`}>
                    {s.active ? 'Activa' : 'Revocada / Expirada'}
                  </span>
                  {s.active && canWrite && (
                    <button
                      type="button"
                      onClick={() => void handleRevokeSuppression(s.id)}
                      className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 py-1 text-[11px] text-rose-300 cursor-pointer"
                    >
                      Revocar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
