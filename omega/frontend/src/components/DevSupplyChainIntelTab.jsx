import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  ChevronDown,
  ChevronUp,
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
import { OmegaSelect } from './OmegaSelect';

const ECOSYSTEM_FILTERS = [
  { id: '', label: 'Todos' },
  { id: 'npm', label: 'npm' },
  { id: 'pypi', label: 'PyPI' },
  { id: 'github-actions', label: 'GitHub Actions' },
  { id: 'maven', label: 'Maven' },
  { id: 'cargo', label: 'Cargo' },
];

const SUGGESTED_QUESTIONS = [
  '¿Cómo mitigar scripts postinstall maliciosos en npm?',
  '¿Cómo proteger pipelines contra abuso de pull_request_target en GitHub Actions?',
  '¿Cómo evitar ejecución arbitraria de setup.py en PyPI?',
];

function getSeverityMeta(severity) {
  const sev = String(severity || 'MEDIUM').toUpperCase();
  if (sev === 'CRITICAL') {
    return {
      label: 'CRITICAL',
      badgeClass: 'border-rose-500/35 bg-rose-500/10 text-rose-300',
      dotClass: 'bg-rose-500',
      Icon: ShieldAlert,
    };
  }
  if (sev === 'HIGH') {
    return {
      label: 'HIGH',
      badgeClass: 'border-amber-400/35 bg-amber-400/10 text-amber-300',
      dotClass: 'bg-amber-400',
      Icon: AlertTriangle,
    };
  }
  return {
    label: sev,
    badgeClass: 'border-white/[0.12] bg-white/[0.04] text-slate-300',
    dotClass: 'bg-slate-400',
    Icon: ShieldCheck,
  };
}

export function DevSupplyChainIntelTab() {
  const [activeSubView, setActiveSubView] = useState('catalog');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [ecosystem, setEcosystem] = useState('');
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedIds, setExpandedIds] = useState({});

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
      const list = Array.isArray(advRes?.advisories) ? advRes.advisories : [];
      if (list.length > 0 && Object.keys(expandedIds).length === 0) {
        const firstAffected = list.find((a) => a.affectsSelectedProject) || list[0];
        if (firstAffected?.id) {
          setExpandedIds({ [firstAffected.id]: true });
        }
      }
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

  async function runQuestion(rawQuestion) {
    const qText = String(rawQuestion ?? question).trim();
    if (!qText || asking) return;
    setQuestion(qText);
    setAsking(true);
    setError('');
    try {
      const res = await queryDevSupplyChainIntel(qText);
      setRagResponse(res);
    } catch (err) {
      setError(err?.message || 'No se pudo consultar el asistente de cadena de suministro.');
    } finally {
      setAsking(false);
    }
  }

  async function handleAsk(e) {
    e?.preventDefault?.();
    await runQuestion(question);
  }

  function toggleAdvisory(id) {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const advisories = Array.isArray(catalog?.advisories) ? catalog.advisories : [];
  const criticalCount = advisories.filter((a) => String(a.severity).toUpperCase() === 'CRITICAL').length;
  const matchedInProjectCount = advisories.filter((a) => a.affectsSelectedProject).length;
  const selectedProjectName = projects.find((p) => String(p.id) === String(projectId))?.name || '';

  return (
    <div className="space-y-5">
      {/* Cabecera principal y selector de vista */}
      <header className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
              <BookOpen className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-base font-semibold text-slate-100">
                  Inteligencia de Cadena de Suministro
                </h1>
                <span className="rounded-full bg-[#141923] border border-white/[0.07] px-2.5 py-0.5 text-[10.5px] font-mono text-slate-400">
                  {catalog?.corpusScope || 'dev_supply_chain_cti'}
                </span>
              </div>
              <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
                Advisories verificados sobre paquetes maliciosos, typosquatting y riesgos de CI/CD cruzados contra el SBOM de tus proyectos.
              </p>
            </div>
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg bg-[#141923]/90 border border-white/[0.06] p-1">
            <button
              type="button"
              onClick={() => setActiveSubView('catalog')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                activeSubView === 'catalog'
                  ? 'bg-[#2F6FED] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Catálogo y Cruce SBOM</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubView('assistant')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                activeSubView === 'assistant'
                  ? 'bg-[#2F6FED] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Asistente Técnico CTI</span>
            </button>
          </div>
        </div>

        {/* Resumen rápido en 3 indicadores sin bordes ruidosos */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-white/[0.06]">
          <div className="rounded-xl bg-[#141923]/60 border border-white/[0.05] px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-slate-400">Advisories en vista</span>
            <span className="font-mono text-sm font-semibold text-slate-100">{advisories.length}</span>
          </div>
          <div className="rounded-xl bg-[#141923]/60 border border-white/[0.05] px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-slate-400">Severidad crítica</span>
            <span className="font-mono text-sm font-semibold text-rose-400">{criticalCount}</span>
          </div>
          <div className="rounded-xl bg-[#141923]/60 border border-white/[0.05] px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {projectId ? `Impacto en ${selectedProjectName || 'proyecto'}` : 'Cruce con SBOM'}
            </span>
            <span
              className={`font-mono text-xs font-semibold ${
                !projectId
                  ? 'text-slate-400'
                  : matchedInProjectCount > 0
                  ? 'text-rose-400'
                  : 'text-emerald-400'
              }`}
            >
              {!projectId
                ? 'Selecciona un proyecto'
                : matchedInProjectCount > 0
                ? `${matchedInProjectCount} coincidencia(s)`
                : '0 coincidencias'}
            </span>
          </div>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 flex items-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      {activeSubView === 'catalog' ? (
        <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-5">
          {/* Barra de filtros limpia */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Píldoras de ecosistema de 1 clic */}
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por ecosistema">
                {ECOSYSTEM_FILTERS.map((ecoItem) => {
                  const active = ecosystem === ecoItem.id;
                  return (
                    <button
                      key={ecoItem.id || 'all'}
                      type="button"
                      onClick={() => setEcosystem(ecoItem.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#2F6FED] text-white'
                          : 'bg-[#141923]/80 border border-white/[0.06] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {ecoItem.label}
                    </button>
                  );
                })}
              </div>

              {/* Selector de proyecto para cruce de SBOM */}
              <div className="flex items-center gap-2 min-w-[250px] sm:min-w-[280px]">
                <label htmlFor="sc-project-select" className="text-xs text-slate-400 shrink-0">
                  Proyecto:
                </label>
                <OmegaSelect
                  id="sc-project-select"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="flex-1"
                >
                  <option value="">Todos (sin cruce de SBOM)</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </OmegaSelect>
              </div>
            </div>

            {/* Buscador por texto */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void loadCatalog(projectId, ecosystem, query);
              }}
              className="flex items-center gap-2"
            >
              <div className="relative flex-1">
                <Search
                  className="h-3.5 w-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
                  strokeWidth={1.75}
                />
                <input
                  id="sc-search-input"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por ID (ej. OSV-MAL), técnica (postinstall, setup.py) o paquete..."
                  className="w-full rounded-lg bg-[#141923]/75 border border-white/[0.08] focus:border-[#2F6FED] focus:outline-none pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#141923] border border-white/[0.08] hover:border-white/[0.18] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Buscar</span>
              </button>
            </form>
          </div>

          {/* Barra contextual de Monitoreo Continuo cuando hay un proyecto seleccionado */}
          {projectId && (
            <div className="rounded-xl bg-[#141923]/75 border border-white/[0.06] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Bell className="h-4 w-4 text-[#2F6FED] shrink-0" strokeWidth={1.75} />
                  <div>
                    <div className="text-xs font-medium text-slate-100">
                      Monitoreo continuo de SBOM para {selectedProjectName || 'este proyecto'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Reevalúa las dependencias guardadas ante nuevos advisories sin volver a clonar el repositorio.
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={monitoringBusy}
                    onClick={() => handleToggleMonitoring(!monitoring?.enabled)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      monitoring?.enabled
                        ? 'bg-emerald-500/15 border border-emerald-400/35 text-emerald-300'
                        : 'bg-[#0F131B] border border-white/[0.08] text-slate-300 hover:text-white'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        monitoring?.enabled ? 'bg-emerald-400' : 'bg-slate-500'
                      }`}
                    />
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
              </div>

              {monitoring && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
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
                  className="rounded-lg border border-amber-400/35 bg-amber-400/10 px-3 py-2 text-xs text-amber-300"
                >
                  {monitoring.feedStatusMessage}
                </div>
              )}

              {evalResult && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.06] text-xs text-slate-300">
                  <span>
                    Dependencias evaluadas: <strong className="text-slate-100">{evalResult.evaluatedDependencies}</strong> ·{' '}
                    Nuevas alertas: <strong className="text-rose-300">{evalResult.newAlertsCount}</strong> ·{' '}
                    Deduplicadas: <strong className="text-slate-100">{evalResult.deduplicatedCount}</strong>
                  </span>
                  <span className="text-[11px] text-slate-400">{evalResult.feedStatusMessage}</span>
                </div>
              )}
            </div>
          )}

          {/* Lista de Advisories con divulgación progresiva (sin muros de texto) */}
          {loading ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              Cargando catálogo de inteligencia de cadena de suministro...
            </p>
          ) : advisories.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.1] bg-[#141923]/40 p-8 text-center space-y-1.5">
              <p className="text-xs font-medium text-slate-200">
                No se encontraron advisories con los filtros actuales
              </p>
              <p className="text-[11px] text-slate-400">
                Prueba limpiando el filtro de ecosistema o el término de búsqueda.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {advisories.map((adv) => {
                const isExpanded = Boolean(expandedIds[adv.id]);
                const sevMeta = getSeverityMeta(adv.severity);
                const SevIcon = sevMeta.Icon;
                const pkgs = Array.isArray(adv.affectedPackages) ? adv.affectedPackages : [];
                const visiblePkgs = isExpanded ? pkgs : pkgs.slice(0, 4);
                const hiddenPkgCount = Math.max(0, pkgs.length - visiblePkgs.length);

                return (
                  <article key={adv.id} className="py-4 first:pt-1 last:pb-1 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1.5 min-w-0 flex-1">
                        {/* Fila 1: Ecosistema + ID + Badge de impacto */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[#2F6FED]/15 border border-[#2F6FED]/30 px-2.5 py-0.5 text-[10px] font-mono font-medium text-[#60A5FA] uppercase">
                            {adv.ecosystem}
                          </span>
                          <span className="font-mono text-xs font-semibold text-slate-300">
                            {adv.id}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10.5px] font-mono font-medium ${sevMeta.badgeClass}`}
                          >
                            <SevIcon className="h-3 w-3" strokeWidth={1.75} />
                            <span>{sevMeta.label}</span>
                          </span>
                          {adv.affectsSelectedProject && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-medium text-rose-300">
                              <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
                              <span>
                                Afecta al proyecto ({(adv.matchedProjectDependencies || []).join(', ')})
                              </span>
                            </span>
                          )}
                        </div>

                        {/* Fila 2: Título claro y resumen conciso */}
                        <h3 className="text-sm font-semibold text-slate-100 leading-snug">
                          {adv.title}
                        </h3>
                        <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
                          {adv.summary}
                        </p>

                        {/* Fila 3: Píldoras compactas de paquetes vigilados */}
                        {pkgs.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-[11px] text-slate-500 mr-0.5">Paquetes vigilados:</span>
                            {visiblePkgs.map((pkg) => (
                              <code
                                key={`${adv.id}-${pkg}`}
                                className="rounded-md bg-[#141923] border border-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-slate-300"
                              >
                                {pkg}
                              </code>
                            ))}
                            {hiddenPkgCount > 0 && (
                              <span className="text-[11px] text-slate-500">+{hiddenPkgCount} más</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Botón de divulgación progresiva */}
                      <button
                        type="button"
                        onClick={() => toggleAdvisory(adv.id)}
                        className="inline-flex items-center gap-1.5 self-start rounded-lg bg-[#141923]/80 border border-white/[0.07] hover:border-white/[0.16] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors cursor-pointer shrink-0"
                      >
                        <span>{isExpanded ? 'Ocultar detalle' : 'Mitigación y fuente'}</span>
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.75} />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.75} />
                        )}
                      </button>
                    </div>

                    {/* Panel desplegable de mitigación y fuente verificada */}
                    {isExpanded && (
                      <div className="rounded-xl bg-[#141923]/75 border border-white/[0.06] p-4 grid grid-cols-1 md:grid-cols-12 gap-4 text-xs">
                        <div className="md:col-span-8 space-y-1.5">
                          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                            <span>Mitigación recomendada</span>
                          </div>
                          <p className="text-slate-200 leading-relaxed">{adv.mitigation}</p>
                        </div>

                        <div className="md:col-span-4 md:border-l md:border-white/[0.06] md:pl-4 flex flex-col justify-between space-y-2">
                          <div className="space-y-1">
                            <span className="block text-[11px] text-slate-400">Fuente verificada</span>
                            <span className="block font-medium text-slate-200">{adv.sourceName}</span>
                            <span className="inline-block rounded-full bg-[#0F131B] border border-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-slate-400">
                              Licencia: {adv.license}
                            </span>
                          </div>
                          {adv.sourceUrl && (
                            <a
                              href={adv.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#60A5FA] hover:underline"
                            >
                              <span>Abrir referencia oficial</span>
                              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </a>
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
      ) : (
        <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
              <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Asistente Grounded de Cadena de Suministro
              </h2>
              <p className="text-xs text-slate-400">
                Responde citando únicamente advisories y guías del corpus curado (`dev_supply_chain_cti`). Si no hay evidencia verificada, se abstiene explícitamente.
              </p>
            </div>
          </div>

          {/* Sugerencias rápidas en una sola fila */}
          <div className="flex flex-wrap items-center gap-2">
            {SUGGESTED_QUESTIONS.map((qText) => (
              <button
                key={qText}
                type="button"
                onClick={() => void runQuestion(qText)}
                className="rounded-full bg-[#141923]/80 border border-white/[0.07] hover:border-[#2F6FED]/50 px-3 py-1 text-[11px] text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                {qText}
              </button>
            ))}
          </div>

          <form onSubmit={handleAsk} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ej. ¿Cómo mitigar campañas postinstall en npm o secuestro de setup.py en PyPI?"
              aria-label="Consulta al corpus de cadena de suministro"
              className="flex-1 rounded-lg bg-[#141923]/75 border border-white/[0.08] focus:border-[#2F6FED] focus:outline-none px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={asking || !question.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#2558C7] disabled:opacity-50 px-4 py-2.5 text-xs font-medium text-white transition-colors cursor-pointer shrink-0"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>{asking ? 'Consultando...' : 'Consultar con citas'}</span>
            </button>
          </form>

          {ragResponse && (
            <div className="rounded-xl bg-[#141923]/75 border border-white/[0.06] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/[0.06]">
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
      )}
    </div>
  );
}
