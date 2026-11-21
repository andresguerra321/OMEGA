import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  FolderGit2,
  GitCompare,
  History,
  Minus,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  compareDevScans,
  createDevProject,
  deleteDevProject,
  getDevProjectDetail,
  listDevProjects,
} from '../lib/api';

function formatDate(iso) {
  if (!iso) return 'Sin escaneos';
  try {
    return new Date(iso).toLocaleString('es-CO', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

export function DevProjectsTab({ authSession, onSelectProjectForScan }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [creating, setCreating] = useState(false);

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const [baseScanId, setBaseScanId] = useState('');
  const [headScanId, setHeadScanId] = useState('');
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);

  const canWrite = authSession?.role === 'ADMIN' || authSession?.role === 'ANALYST';

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const data = await listDevProjects();
      const list = Array.isArray(data) ? data : [];
      setProjects(list);
      if (selectedId && !list.some((p) => p.id === selectedId)) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch (err) {
      setError(err?.message || 'No se pudo cargar el inventario de proyectos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [authSession?.tenantId]);

  async function openDetail(projectId) {
    setSelectedId(projectId);
    setDetailLoading(true);
    setComparison(null);
    setError('');
    try {
      const d = await getDevProjectDetail(projectId);
      setDetail(d);
      const scans = Array.isArray(d?.scans) ? d.scans : [];
      setHeadScanId(scans[0]?.id || '');
      setBaseScanId(scans[1]?.id || scans[0]?.id || '');
    } catch (err) {
      setError(err?.message || 'No se pudo cargar el historial del proyecto.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim() || !canWrite) return;
    setCreating(true);
    setError('');
    try {
      const created = await createDevProject({
        name: newName.trim(),
        repoUrl: newUrl.trim(),
        sourceType: newUrl.trim() ? 'GITHUB_URL' : 'ARCHIVE',
      });
      setNewName('');
      setNewUrl('');
      await refresh();
      if (created?.id) void openDetail(created.id);
    } catch (err) {
      setError(err?.message || 'No se pudo crear el proyecto.');
    } finally {
      setCreating(false);
    }
  }

  async function handleCompare() {
    if (!selectedId || !baseScanId || !headScanId) return;
    setComparing(true);
    setError('');
    try {
      const diff = await compareDevScans(selectedId, baseScanId, headScanId);
      setComparison(diff);
    } catch (err) {
      setError(err?.message || 'No se pudieron comparar los escaneos.');
    } finally {
      setComparing(false);
    }
  }

  async function handleDelete(projectId) {
    setError('');
    try {
      await deleteDevProject(projectId);
      setConfirmDeleteId(null);
      if (selectedId === projectId) {
        setSelectedId(null);
        setDetail(null);
        setComparison(null);
      }
      await refresh();
    } catch (err) {
      setError(err?.message || 'No se pudo eliminar el proyecto.');
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
              <FolderGit2 className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Inventario de Proyectos</h2>
              <p className="text-[11px] text-slate-400">
                Historial de escaneos, tendencia de riesgo y comparación entre análisis. Solo metadatos derivados.
              </p>
            </div>
          </div>
        </div>

        {canWrite && (
          <form
            onSubmit={handleCreate}
            className="rounded-xl bg-[#141923]/80 border border-white/[0.07] grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-white/[0.07] overflow-hidden"
          >
            <label className="md:col-span-4 px-3.5 py-2.5 flex flex-col justify-center cursor-text">
              <span className="text-[11px] text-slate-400">Nombre del proyecto</span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="ej. api-pagos"
                maxLength={160}
                className="mt-0.5 w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
            </label>
            <label className="md:col-span-6 px-3.5 py-2.5 flex flex-col justify-center cursor-text">
              <span className="text-[11px] text-slate-400">Repositorio GitHub (opcional)</span>
              <input
                type="text"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://github.com/organizacion/api-pagos"
                className="mt-0.5 w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
            </label>
            <div className="md:col-span-2 p-2 flex items-center justify-center">
              <button
                type="submit"
                disabled={!newName.trim() || creating}
                className="w-full h-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-45 px-3 py-2 text-xs font-medium text-white transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>{creating ? 'Creando...' : 'Crear'}</span>
              </button>
            </div>
          </form>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <p className="text-xs text-slate-400 py-4">Cargando proyectos del espacio...</p>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.1] bg-[#141923]/40 p-6 text-center space-y-2">
            <p className="text-xs font-medium text-slate-200">Aún no hay proyectos registrados</p>
            <p className="text-[11px] text-slate-400">
              Crea un proyecto arriba o ejecuta un escaneo por URL/archivo para iniciar el historial y seguimiento.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {projects.map((p) => {
              const selected = p.id === selectedId;
              const delta = p.scoreDelta;
              return (
                <div
                  key={p.id}
                  className={`py-3.5 flex flex-wrap items-center justify-between gap-3 transition-colors ${
                    selected ? 'bg-white/[0.02] -mx-3 px-3 rounded-xl' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void openDetail(p.id)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-100 truncate">{p.name}</span>
                      <span className="rounded-full bg-[#141923] border border-white/[0.07] px-2 py-0.5 font-mono text-[10px] text-slate-400">
                        {p.scansCount} {p.scansCount === 1 ? 'escaneo' : 'escaneos'}
                      </span>
                      {p.hasActiveSuppressions && (
                        <span className="rounded-full bg-amber-400/10 border border-amber-400/30 px-2 py-0.5 text-[10px] text-amber-300">
                          Con supresiones
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                      <span>{p.repoUrl || p.sourceType}</span>
                      <span>Último: {formatDate(p.lastScanAt)}</span>
                    </div>
                  </button>

                  <div className="flex items-center gap-3 shrink-0">
                    {p.latestEffectiveScore !== null && p.latestEffectiveScore !== undefined && (
                      <div className="text-right">
                        <div className="font-mono text-xs font-semibold text-slate-100">
                          {Number(p.latestEffectiveScore).toFixed(0)} / 100
                        </div>
                        {delta !== null && delta !== undefined && (
                          <div
                            className={`inline-flex items-center gap-0.5 font-mono text-[10px] ${
                              delta > 0 ? 'text-rose-400' : delta < 0 ? 'text-emerald-400' : 'text-slate-400'
                            }`}
                          >
                            {delta > 0 ? (
                              <ArrowUpRight className="h-3 w-3" />
                            ) : delta < 0 ? (
                              <ArrowDownRight className="h-3 w-3" />
                            ) : (
                              <Minus className="h-3 w-3" />
                            )}
                            <span>{delta > 0 ? `+${delta.toFixed(0)}` : delta.toFixed(0)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {onSelectProjectForScan && (
                      <button
                        type="button"
                        onClick={() => onSelectProjectForScan(p)}
                        className="rounded-lg bg-[#141923] border border-white/[0.08] hover:border-[#2F6FED] px-2.5 py-1.5 text-[11px] text-slate-200 cursor-pointer"
                      >
                        Escanear
                      </button>
                    )}

                    {canWrite && (
                      confirmDeleteId === p.id ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleDelete(p.id)}
                            className="rounded-lg bg-rose-500/20 border border-rose-500/40 px-2.5 py-1 text-[11px] font-medium text-rose-300 cursor-pointer"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-lg bg-[#141923] px-2 py-1 text-[11px] text-slate-400 cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(p.id)}
                          aria-label={`Eliminar proyecto ${p.name}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selectedId && (
        <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[#2F6FED]" strokeWidth={1.75} />
              <h3 className="text-sm font-semibold text-slate-100">
                Historial y comparación — {detail?.name || 'Proyecto'}
              </h3>
            </div>
          </div>

          {detailLoading ? (
            <p className="text-xs text-slate-400">Cargando historial de escaneos...</p>
          ) : !detail?.scans?.length ? (
            <p className="text-xs text-slate-400">
              Este proyecto aún no tiene escaneos registrados. Ejecuta un análisis para ver tendencia y comparaciones.
            </p>
          ) : (
            <>
              <div className="divide-y divide-white/[0.06]">
                {detail.scans.map((s) => (
                  <div key={s.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-[11px] text-slate-300">{formatDate(s.createdAt)}</span>
                      <span className="rounded-full bg-[#141923] border border-white/[0.07] px-2 py-0.5 font-mono text-[10px] text-slate-400">
                        {s.source} · v{s.rulesVersion}
                      </span>
                      {s.branch && <span className="font-mono text-[11px] text-slate-400">{s.branch}</span>}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[11px]">
                      <span className="text-slate-300">{s.findingsCount} hallazgos</span>
                      <span className="text-slate-400">{s.dependenciesCount} deps</span>
                      <span className="font-semibold text-slate-100">
                        {Number(s.effectiveScore).toFixed(0)}/100
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {detail.scans.length >= 2 && (
                <div className="pt-3 border-t border-white/[0.06] space-y-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <GitCompare className="h-4 w-4 text-[#2F6FED]" strokeWidth={1.75} />
                    <span className="text-xs font-medium text-slate-200">Comparar dos escaneos:</span>
                    <select
                      aria-label="Escaneo base"
                      value={baseScanId}
                      onChange={(e) => setBaseScanId(e.target.value)}
                      className="rounded-lg bg-[#141923] border border-white/[0.08] px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      {detail.scans.map((s) => (
                        <option key={s.id} value={s.id}>
                          Base: {formatDate(s.createdAt)} ({Number(s.effectiveScore).toFixed(0)} pts)
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Escaneo objetivo"
                      value={headScanId}
                      onChange={(e) => setHeadScanId(e.target.value)}
                      className="rounded-lg bg-[#141923] border border-white/[0.08] px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      {detail.scans.map((s) => (
                        <option key={s.id} value={s.id}>
                          Actual: {formatDate(s.createdAt)} ({Number(s.effectiveScore).toFixed(0)} pts)
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={comparing || !baseScanId || !headScanId}
                      onClick={() => void handleCompare()}
                      className="rounded-lg bg-[#2F6FED] hover:bg-[#255ED4] disabled:opacity-45 px-3 py-1.5 text-xs font-medium text-white cursor-pointer"
                    >
                      {comparing ? 'Comparando...' : 'Comparar'}
                    </button>
                  </div>

                  {comparison && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="rounded-xl bg-[#141923]/75 border border-white/[0.06] p-3.5 space-y-2">
                        <div className="font-medium text-rose-300">
                          Nuevos hallazgos ({comparison.added?.length || 0})
                        </div>
                        {comparison.added?.length ? (
                          <ul className="space-y-1 text-[11px] text-slate-300">
                            {comparison.added.map((f) => (
                              <li key={f.fingerprint}>
                                [{f.severity}] {f.ruleId} — {f.title}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[11px] text-slate-400">Sin hallazgos nuevos entre ambos escaneos.</p>
                        )}
                      </div>

                      <div className="rounded-xl bg-[#141923]/75 border border-white/[0.06] p-3.5 space-y-2">
                        <div className="font-medium text-emerald-400">
                          Resueltos ({comparison.resolved?.length || 0})
                        </div>
                        {comparison.resolved?.length ? (
                          <ul className="space-y-1 text-[11px] text-slate-300">
                            {comparison.resolved.map((f) => (
                              <li key={f.fingerprint}>
                                [{f.severity}] {f.ruleId} — {f.title}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[11px] text-slate-400">Sin hallazgos resueltos en este intervalo.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
