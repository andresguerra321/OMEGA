import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  ExternalLink,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  evaluateDevProjectMonitoring,
  getDevProjectMonitoring,
  listDevProjects,
  listDevSupplyChainAdvisories,
  queryDevSupplyChainIntel,
  updateDevProjectMonitoring,
} from '../lib/api';

export function DevSupplyChainIntelTab() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [ecosystem, setEcosystem] = useState('');
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [ragResponse, setRagResponse] = useState(null);

  const [monitoring, setMonitoring] = useState(null);
  const [evalResult, setEvalResult] = useState(null);
  const [monitoringBusy, setMonitoringBusy] = useState(false);

  async function loadMonitoring(targetProjId) {
    if (!targetProjId) {
      setMonitoring(null);
      setEvalResult(null);
      return;
    }
    try {
      const m = await getDevProjectMonitoring(targetProjId);
      setMonitoring(m || null);
    } catch {
      setMonitoring(null);
    }
  }

  async function handleToggleMonitoring(nextEnabled) {
    if (!projectId || monitoringBusy) return;
    setMonitoringBusy(true);
    setError('');
    try {
      const updated = await updateDevProjectMonitoring(projectId, {
        enabled: nextEnabled,
        channel: monitoring?.channel || 'WEBHOOK',
        minSeverity: monitoring?.minSeverity || 'HIGH',
      });
      setMonitoring(updated);
    } catch (err) {
      setError(err?.message || 'No se pudo actualizar la suscripción de monitoreo continuo.');
    } finally {
      setMonitoringBusy(false);
    }
  }

  async function handleEvaluateNow() {
    if (!projectId || monitoringBusy) return;
    setMonitoringBusy(true);
    setError('');
    try {
      const res = await evaluateDevProjectMonitoring(projectId);
      setEvalResult(res);
      await loadMonitoring(projectId);
    } catch (err) {
      setError(err?.message || 'No se pudo reevaluar el inventario almacenado.');
    } finally {
      setMonitoringBusy(false);
    }
  }

  async function loadCatalog(proj = projectId, eco = ecosystem, q = query) {
    setLoading(true);
    setError('');
    try {
      const [projList, advRes] = await Promise.all([
        projects.length ? Promise.resolve(projects) : listDevProjects(),
        listDevSupplyChainAdvisories({ ecosystem: eco, q, projectId: proj }),
      ]);
      if (!projects.length) {
        setProjects(Array.isArray(projList) ? projList : []);
      }
      setCatalog(advRes || null);
    } catch (err) {
      setError(err?.message || 'No se pudo cargar la inteligencia de cadena de suministro.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
    void loadMonitoring(projectId);
  }, [projectId, ecosystem]);

  async function handleAsk(e) {
    e?.preventDefault?.();
    if (!question.trim() || asking) return;
    setAsking(true);
    setError('');
    try {
      const res = await queryDevSupplyChainIntel(question);
      setRagResponse(res);
    } catch (err) {
      setError(err?.message || 'No se pudo consultar el asistente de cadena de suministro.');
    } finally {
      setAsking(false);
    }
  }

  const advisories = Array.isArray(catalog?.advisories) ? catalog.advisories : [];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
              <BookOpen className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Inteligencia de Cadena de Suministro (dev_supply_chain_cti)
              </h2>
              <p className="text-xs text-slate-400">
                Catálogo curado de advisories con fuente y licencia verificada, cruzado contra las dependencias de tus proyectos.
              </p>
            </div>
          </div>

          <span className="rounded-full bg-[#141923] border border-white/[0.08] px-3 py-1 text-[11px] font-mono text-slate-300">
            Corpus: {catalog?.corpusScope || 'dev_supply_chain_cti'}
          </span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void loadCatalog(projectId, ecosystem, query);
          }}
          className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-white/[0.06]"
        >
          <div>
            <label htmlFor="sc-project-select" className="block text-[11px] text-slate-400 mb-1">
              Cruzar con proyecto
            </label>
            <select
              id="sc-project-select"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded-lg bg-[#141923]/75 border border-white/[0.08] px-3 py-1.5 text-xs text-slate-100"
            >
              <option value="">Todos (sin cruce de proyecto)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sc-eco-select" className="block text-[11px] text-slate-400 mb-1">
              Ecosistema
            </label>
            <select
              id="sc-eco-select"
              value={ecosystem}
              onChange={(e) => setEcosystem(e.target.value)}
              className="w-full rounded-lg bg-[#141923]/75 border border-white/[0.08] px-3 py-1.5 text-xs text-slate-100"
            >
              <option value="">Todos</option>
              <option value="npm">npm</option>
              <option value="pypi">pypi</option>
              <option value="github-actions">github-actions</option>
              <option value="maven">maven</option>
              <option value="cargo">cargo</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="sc-search-input" className="block text-[11px] text-slate-400 mb-1">
              Buscar advisory, técnica o paquete
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                  strokeWidth={1.75}
                />
                <input
                  id="sc-search-input"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ej. postinstall, setup.py, OSV-MAL, event-stream..."
                  className="w-full rounded-lg bg-[#141923]/75 border border-white/[0.08] pl-8 pr-3 py-1.5 text-xs text-slate-100"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#141923] border border-white/[0.08] hover:border-white/[0.16] px-3 py-1.5 text-xs text-slate-200 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Filtrar</span>
              </button>
            </div>
          </div>
        </form>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300"
          >
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-xs text-slate-400 py-6 text-center">
            Cargando catálogo de inteligencia de cadena de suministro...
          </p>
        ) : (
          <div className="divide-y divide-white/[0.06] rounded-xl bg-[#141923]/60 border border-white/[0.05]">
            {advisories.map((adv) => (
              <article key={adv.id} className="p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#2F6FED]/15 border border-[#2F6FED]/30 px-2 py-0.5 text-[10px] font-mono text-[#60A5FA] uppercase">
                      {adv.ecosystem}
                    </span>
                    <span className="text-xs font-mono font-semibold text-slate-200">
                      {adv.id}
                    </span>
                    <h3 className="text-xs font-semibold text-slate-100">
                      {adv.title}
                    </h3>
                  </div>

                  {adv.affectsSelectedProject ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/35 bg-rose-500/10 px-2.5 py-0.5 text-[11px] text-rose-300">
                      <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
                      <span>Afecta al proyecto ({adv.matchedProjectDependencies.join(', ')})</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-slate-400">
                      <ShieldCheck className="h-3 w-3 text-emerald-400" strokeWidth={1.75} />
                      <span>{adv.severity}</span>
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{adv.summary}</p>
                <p className="text-xs text-slate-400">
                  <strong className="text-slate-200">Mitigación recomendada:</strong> {adv.mitigation}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-400">
                  <span>
                    Paquetes vigilados:{' '}
                    <code className="font-mono text-slate-300">
                      {Array.isArray(adv.affectedPackages) ? adv.affectedPackages.join(', ') : ''}
                    </code>
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span>
                      Fuente: <strong className="text-slate-300">{adv.sourceName}</strong> ({adv.license})
                    </span>
                    {adv.sourceUrl && (
                      <a
                        href={adv.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[#60A5FA] hover:underline"
                      >
                        <span>Ver fuente</span>
                        <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                      </a>
                    )}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
              <Bell className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Monitoreo Continuo sobre SBOM Guardado (Zero-Retention)
              </h3>
              <p className="text-xs text-slate-400">
                Reevalúa el inventario de dependencias almacenado ante nuevos advisories sin volver a descargar el código fuente.
              </p>
            </div>
          </div>

          {projectId ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={monitoringBusy}
                onClick={() => handleToggleMonitoring(!monitoring?.enabled)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  monitoring?.enabled
                    ? 'bg-emerald-500/15 border border-emerald-400/35 text-emerald-300'
                    : 'bg-[#141923] border border-white/[0.08] text-slate-300'
                }`}
              >
                <span>{monitoring?.enabled ? 'Monitoreo activo' : 'Activar monitoreo'}</span>
              </button>
              <button
                type="button"
                disabled={monitoringBusy}
                onClick={handleEvaluateNow}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#2558C7] disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer"
              >
                <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>{monitoringBusy ? 'Evaluando...' : 'Reevaluar SBOM ahora'}</span>
              </button>
            </div>
          ) : (
            <span className="text-xs text-slate-400">
              Selecciona un proyecto arriba para configurar y ejecutar su monitoreo continuo.
            </span>
          )}
        </div>

        {monitoring && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            <span>
              Frecuencia programada por plan:{' '}
              <strong className="text-slate-200">cada {monitoring.frequencyHours || 24}h</strong>
            </span>
            {monitoring.lastEvaluatedAt && (
              <span>
                Última evaluación:{' '}
                <strong className="text-slate-200">
                  {new Date(monitoring.lastEvaluatedAt).toLocaleString()}
                </strong>
              </span>
            )}
            {monitoring.enabled && monitoring.nextScheduledAt && (
              <span>
                Próxima ejecución:{' '}
                <strong className="text-slate-200">
                  {new Date(monitoring.nextScheduledAt).toLocaleString()}
                </strong>
              </span>
            )}
          </div>
        )}

        {monitoring?.feedStaleWarning && (
          <div
            role="alert"
            className="rounded-xl border border-amber-400/35 bg-amber-400/10 px-4 py-2.5 text-xs text-amber-300"
          >
            {monitoring.feedStatusMessage}
          </div>
        )}

        {evalResult && (
          <div className="rounded-xl bg-[#141923]/75 border border-white/[0.06] p-4 text-xs text-slate-300 space-y-1">
            <p>
              Dependencias reevaluadas: <strong className="text-slate-100">{evalResult.evaluatedDependencies}</strong> ·{' '}
              Nuevas alertas generadas: <strong className="text-rose-300">{evalResult.newAlertsCount}</strong> ·{' '}
              Alertas deduplicadas: <strong className="text-slate-100">{evalResult.deduplicatedCount}</strong>
            </p>
            <p className="text-[11px] text-slate-400">{evalResult.feedStatusMessage}</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
            <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Asistente Grounded de Cadena de Suministro
            </h3>
            <p className="text-xs text-slate-400">
              Responde citando únicamente fuentes verificadas del corpus y se abstiene si no hay evidencia suficiente.
            </p>
          </div>
        </div>

        <form onSubmit={handleAsk} className="flex items-center gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ej. ¿Cómo mitigar campañas postinstall en npm o secuestro de setup.py en PyPI?"
            aria-label="Consulta al corpus de cadena de suministro"
            className="flex-1 rounded-lg bg-[#141923]/75 border border-white/[0.08] px-3 py-2 text-xs text-slate-100"
          />
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#2558C7] disabled:opacity-50 px-4 py-2 text-xs font-medium text-white cursor-pointer"
          >
            <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>{asking ? 'Consultando...' : 'Consultar con citas'}</span>
          </button>
        </form>

        {ragResponse && (
          <div className="rounded-xl bg-[#141923]/75 border border-white/[0.06] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  ragResponse.status === 'GROUNDED'
                    ? 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                    : 'border border-amber-400/30 bg-amber-400/10 text-amber-300'
                }`}
              >
                <ShieldAlert className="h-3 w-3" strokeWidth={1.75} />
                <span>
                  {ragResponse.status === 'GROUNDED'
                    ? 'Respuesta con citas verificadas'
                    : 'Abstención por falta de evidencia'}
                </span>
              </span>
              <span className="text-[11px] text-slate-400">{ragResponse.notice}</span>
            </div>

            <p className="text-xs text-slate-200 whitespace-pre-line leading-relaxed">
              {ragResponse.answer}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
