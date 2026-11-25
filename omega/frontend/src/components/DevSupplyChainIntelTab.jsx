import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Check,
  ChevronRight,
  Copy,
  MessageSquare,
  Play,
  Search,
  Send,
  ShieldAlert,
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
      textClass: 'text-[#E5484D]',
      dotClass: 'bg-[#E5484D]',
    };
  }
  if (sev === 'HIGH') {
    return {
      label: 'HIGH',
      textClass: 'text-[#E5A93C]',
      dotClass: 'bg-[#E5A93C]',
    };
  }
  return {
    label: sev,
    textClass: 'text-[#7E8691]',
    dotClass: 'bg-[#7E8691]',
  };
}

/**
 * Extrae taxonomía técnica compacta (Vector / Hook / Objetivo) a partir de título y resumen
 * para lectura rápida por palabras clave sin muros de prosa.
 */
function extractTaxonomy(adv) {
  const text = `${adv?.title || ''} ${adv?.summary || ''} ${adv?.mitigation || ''}`.toLowerCase();
  const tags = [];

  if (/typosquat|suplant|homogl|confusi/.test(text)) tags.push('Vector: Typosquatting');
  else if (/pull_request_target|workflow|github actions|ci\/cd|pipeline/.test(text)) tags.push('Vector: CI/CD Poisoning');
  else if (/dependency confusion|privad|internal/.test(text)) tags.push('Vector: Dependency Confusion');
  else if (/hijack|secuestro|compromet|maintainer/.test(text)) tags.push('Vector: Account Takeover');
  else tags.push('Vector: Supply Chain');

  if (/preinstall|postinstall/.test(text)) tags.push('Hook: preinstall/postinstall');
  else if (/setup\.py/.test(text)) tags.push('Hook: setup.py');
  else if (/pull_request_target/.test(text)) tags.push('Trigger: pull_request_target');
  else if (/build\.rs|proc-macro/.test(text)) tags.push('Hook: build.rs');
  else if (/maven|pom\.xml|plugin/.test(text)) tags.push('Hook: Maven Plugin');

  if (/token|credencial|secret|env|npmrc|ssh|ci/.test(text)) tags.push('Objetivo: CI/Env Tokens');
  else if (/exfiltr|robo|steal/.test(text)) tags.push('Objetivo: Exfiltración');
  else if (/rce|ejecuci|remota|shell/.test(text)) tags.push('Objetivo: RCE Local');

  return tags.join(' · ');
}

/**
 * Extrae un comando CLI copiable de la mitigación si existe.
 */
function extractPrimaryCommand(mitigationText) {
  const raw = String(mitigationText || '');
  const backtick = raw.match(/`([^`]+)`/);
  if (backtick) return backtick[1].trim();
  const cli = raw.match(
    /\b(?:npm|pnpm|yarn|pip|python|mvn|cargo|git)\s+[a-z0-9_.:/-]+(?:\s+(?:--?[a-z0-9-]+|[a-z0-9_./:-]+))*/i,
  );
  return cli ? cli[0].trim() : '';
}

function renderInlineMonospace(text) {
  const raw = String(text || '');
  if (!raw) return null;
  const pattern =
    /(`[^`]+`|\b(?:npm|pnpm|yarn|pip|python|mvn|cargo)\s+[a-z0-9_.:/-]+(?:\s+--?[a-z0-9-]+)*|\b[a-z0-9_.-]+\.(?:json|ya?ml|py|lock|toml|xml|sh|npmrc|pypirc)\b|--[a-z0-9-]+|\bpull_request_target\b|\bpostinstall\b|\bpreinstall\b)/gi;
  return raw.split(pattern).map((part, idx) => {
    if (!part) return null;
    if (idx % 2 === 0) return <span key={idx}>{part}</span>;
    const clean = part.startsWith('`') && part.endsWith('`') ? part.slice(1, -1) : part;
    return (
      <code
        key={idx}
        className="bg-white/[0.04] text-zinc-200 px-1.5 py-0.5 rounded font-mono text-xs"
      >
        {clean}
      </code>
    );
  });
}

export function DevSupplyChainIntelTab() {
  const searchInputRef = useRef(null);
  const [activeSubView, setActiveSubView] = useState('catalog');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [ecosystem, setEcosystem] = useState('');
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [ecosystemCounts, setEcosystemCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedIds, setExpandedIds] = useState({});
  const [copiedCmdKey, setCopiedCmdKey] = useState('');

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [ragResponse, setRagResponse] = useState(null);

  const [monitoring, setMonitoring] = useState(null);
  const [evalResult, setEvalResult] = useState(null);
  const [monitoringBusy, setMonitoringBusy] = useState(false);

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && activeSubView === 'catalog') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSubView]);

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
      if (!eco && !String(q || '').trim()) {
        const counts = { '': list.length };
        for (const item of list) {
          const key = String(item?.ecosystem || '').toLowerCase();
          if (key) counts[key] = (counts[key] || 0) + 1;
        }
        setEcosystemCounts(counts);
      }
      if (list.length > 0 && Object.keys(expandedIds).length === 0) {
        const firstAffected = list.find((a) => a.affectsSelectedProject);
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

  async function handleCopyCommand(key, command) {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCmdKey(key);
      setTimeout(() => setCopiedCmdKey((prev) => (prev === key ? '' : prev)), 1500);
    } catch {
      // Clipboard API unavailable
    }
  }

  const advisories = Array.isArray(catalog?.advisories) ? catalog.advisories : [];
  const criticalCount = advisories.filter((a) => String(a.severity).toUpperCase() === 'CRITICAL').length;
  const matchedInProjectCount = advisories.filter((a) => a.affectsSelectedProject).length;
  const selectedProjectName = projects.find((p) => String(p.id) === String(projectId))?.name || '';

  const fallbackCounts = useMemo(() => {
    const map = { '': advisories.length };
    for (const item of advisories) {
      const key = String(item?.ecosystem || '').toLowerCase();
      if (key) map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [advisories]);

  const countsSource = ecosystemCounts || fallbackCounts;

  return (
    <div className="rounded-xl bg-[#09090B] border border-white/[0.06] overflow-hidden">
      {/* Cabecera superior monocroma y compacta */}
      <header className="px-5 py-4 border-b border-white/[0.06] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex flex-wrap items-baseline gap-2.5">
            <h1 className="text-[14px] font-medium tracking-[-0.015em] text-[#EDEDEF]">
              Inteligencia de Cadena de Suministro
            </h1>
            <span className="font-mono text-[11px] text-[#7E8691] tabular-nums">
              {advisories.length} advisories
              {criticalCount > 0 ? ` · ${criticalCount} críticos` : ''}
              {projectId
                ? ` · ${matchedInProjectCount} en ${selectedProjectName || 'proyecto'}`
                : ''}
            </span>
          </div>

          <div className="inline-flex items-center gap-4 text-xs">
            <button
              type="button"
              onClick={() => setActiveSubView('catalog')}
              className={`transition-colors duration-150 cursor-pointer ${
                activeSubView === 'catalog'
                  ? 'text-[#EDEDEF] font-medium'
                  : 'text-[#7E8691] hover:text-zinc-300'
              }`}
            >
              Catálogo SBOM
            </button>
            <span className="text-white/[0.12]">/</span>
            <button
              type="button"
              onClick={() => setActiveSubView('assistant')}
              className={`inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer ${
                activeSubView === 'assistant'
                  ? 'text-[#EDEDEF] font-medium'
                  : 'text-[#7E8691] hover:text-zinc-300'
              }`}
            >
              <MessageSquare className="h-3 w-3" strokeWidth={1.75} />
              <span>Asistente CTI</span>
            </button>
          </div>
        </div>

        {activeSubView === 'catalog' && (
          <div className="space-y-3 pt-1">
            {/* Pestañas de ecosistema con conteos tabulares + selector de proyecto */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06]">
              <div className="flex flex-wrap items-center gap-4" role="group" aria-label="Filtrar por ecosistema">
                {ECOSYSTEM_FILTERS.map((ecoItem) => {
                  const active = ecosystem === ecoItem.id;
                  const countVal = countsSource?.[ecoItem.id] ?? 0;
                  return (
                    <button
                      key={ecoItem.id || 'all'}
                      type="button"
                      onClick={() => setEcosystem(ecoItem.id)}
                      className={`inline-flex items-center gap-1.5 pb-2.5 -mb-px border-b-[1.5px] text-xs transition-colors duration-150 cursor-pointer ${
                        active
                          ? 'border-[#EDEDEF] text-[#EDEDEF] font-medium'
                          : 'border-transparent text-[#7E8691] hover:text-zinc-200'
                      }`}
                    >
                      <span>{ecoItem.label}</span>
                      <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                        {countVal}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 pb-2 min-w-[210px] sm:min-w-[240px]">
                <label htmlFor="sc-project-select" className="text-[11px] text-[#7E8691] shrink-0">
                  SBOM
                </label>
                <OmegaSelect
                  id="sc-project-select"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="flex-1"
                >
                  <option value="">Todos los proyectos</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </OmegaSelect>
              </div>
            </div>

            {/* Buscador unificado: icono izquierdo + kbd ⌘K, sin botón lupa redundante */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void loadCatalog(projectId, ecosystem, query);
              }}
              className="relative flex items-center"
            >
              <Search
                className="h-3.5 w-3.5 text-[#7E8691] absolute left-3 pointer-events-none"
                strokeWidth={1.75}
              />
              <input
                ref={searchInputRef}
                id="sc-search-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrar por ID, paquete o vector (presiona Enter)..."
                className="w-full h-9 rounded-md bg-white/[0.02] border border-white/[0.08] focus:border-white/[0.2] focus:outline-none pl-9 pr-12 text-xs text-[#EDEDEF] placeholder:text-[#7E8691] transition-colors"
              />
              <kbd className="hidden sm:inline-flex items-center absolute right-2.5 rounded border border-white/[0.08] px-1.5 py-0.5 font-mono text-[11px] text-zinc-500 pointer-events-none">
                ⌘K
              </kbd>
            </form>
          </div>
        )}
      </header>

      {error && (
        <div
          role="alert"
          className="px-5 py-2.5 border-b border-white/[0.06] bg-[#E5484D]/[0.06] text-xs text-[#E5484D] flex items-center gap-2"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      {activeSubView === 'catalog' ? (
        <div>
          {/* Monitoreo continuo (fila plana sin caja anidada) */}
          {projectId && (
            <div className="px-5 py-3 border-b border-white/[0.06] bg-white/[0.015] space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-[#EDEDEF]">
                  <Bell className="h-3.5 w-3.5 text-[#7E8691] shrink-0" strokeWidth={1.75} />
                  <span className="font-medium">Monitoreo continuo · {selectedProjectName || 'proyecto'}</span>
                  {monitoring && (
                    <span className="font-mono text-[11px] text-[#7E8691] tabular-nums">
                      cada {monitoring.frequencyHours || 24}h
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={monitoringBusy}
                    onClick={() => handleToggleMonitoring(!monitoring?.enabled)}
                    className="h-7 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] px-2.5 text-xs text-[#EDEDEF] transition-colors cursor-pointer"
                  >
                    <span
                      className={`h-[5px] w-[5px] rounded-full ${
                        monitoring?.enabled ? 'bg-emerald-500' : 'bg-[#7E8691]'
                      }`}
                    />
                    <span>{monitoring?.enabled ? 'Activo' : 'Activar'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={monitoringBusy}
                    onClick={handleEvaluateNow}
                    className="h-7 inline-flex items-center gap-1.5 rounded-md border border-white/[0.1] bg-white/[0.05] hover:bg-white/[0.09] disabled:opacity-45 px-2.5 text-xs font-medium text-[#EDEDEF] transition-colors cursor-pointer"
                  >
                    <Play className="h-3 w-3" strokeWidth={1.75} />
                    <span>{monitoringBusy ? 'Evaluando...' : 'Reevaluar'}</span>
                  </button>
                </div>
              </div>

              {evalResult && (
                <div className="font-mono text-[11px] text-[#7E8691] tabular-nums">
                  {evalResult.evaluatedDependencies} deps · {evalResult.newAlertsCount} alertas nuevas ·{' '}
                  {evalResult.deduplicatedCount} deduplicadas
                </div>
              )}
            </div>
          )}

          {/* Lista continua plana con filas interactivas y divisores hairline de 1px */}
          {loading ? (
            <p className="text-xs text-[#7E8691] py-10 text-center">
              Cargando advisories...
            </p>
          ) : advisories.length === 0 ? (
            <div className="py-10 px-5 text-center space-y-1">
              <p className="text-xs font-medium text-[#EDEDEF]">
                Sin coincidencias para los filtros actuales
              </p>
              <p className="text-xs text-[#7E8691]">
                Limpia el ecosistema o el término de búsqueda.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {advisories.map((adv, idx) => {
                const isExpanded = Boolean(expandedIds[adv.id]);
                const sevMeta = getSeverityMeta(adv.severity);
                const pkgs = Array.isArray(adv.affectedPackages) ? adv.affectedPackages : [];
                const visiblePkgs = isExpanded ? pkgs : pkgs.slice(0, 6);
                const hiddenPkgCount = Math.max(0, pkgs.length - visiblePkgs.length);
                const taxonomy = extractTaxonomy(adv);
                const primaryCmd = extractPrimaryCommand(adv.mitigation);

                return (
                  <motion.article
                    key={adv.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.16, delay: Math.min(idx * 0.025, 0.2), ease: [0.23, 1, 0.32, 1] }}
                    className="transition-colors duration-150 hover:bg-white/[0.02]"
                  >
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => toggleAdvisory(adv.id)}
                      className="group w-full text-left px-5 py-3 flex items-center justify-between gap-4 cursor-pointer focus:outline-none active:bg-white/[0.03] transition-colors duration-150"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        {/* Micro-cabecera tabular: ECOSISTEMA · ID · • SEVERIDAD */}
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] uppercase tracking-[0.04em] tabular-nums leading-none">
                          <span className="text-[#7E8691]">{adv.ecosystem}</span>
                          <span className="text-zinc-500">{adv.id}</span>
                          <span className={`inline-flex items-center gap-1.5 font-medium ${sevMeta.textClass}`}>
                            <span className={`h-[5px] w-[5px] rounded-full ${sevMeta.dotClass}`} />
                            <span>{sevMeta.label}</span>
                          </span>
                          {adv.affectsSelectedProject && (
                            <span className="text-[#E5484D] normal-case tracking-normal">
                              · Impacta: {(adv.matchedProjectDependencies || []).join(', ')}
                            </span>
                          )}
                        </div>

                        {/* Título 14px font-medium #EDEDEF */}
                        <h3 className="text-[14px] font-medium tracking-[-0.015em] text-[#EDEDEF] group-hover:text-white leading-snug truncate transition-colors duration-150">
                          {adv.title}
                        </h3>
                      </div>

                      <ChevronRight
                        className={`h-4 w-4 text-zinc-600 group-hover:text-zinc-400 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                          isExpanded ? 'rotate-90 text-zinc-400' : ''
                        }`}
                        strokeWidth={1.75}
                      />
                    </button>

                    {/* Todo el detalle técnico se despliega suavemente al hacer clic */}
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          key={`${adv.id}-body`}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="px-5 pb-4">
                            <div className="border-l border-white/[0.12] pl-3.5 mt-0.5 space-y-2.5">
                              <div className="space-y-1">
                                <div className="font-mono text-[11px] text-zinc-400">{taxonomy}</div>
                                {adv.summary && (
                                  <p className="text-xs text-[#7E8691] leading-relaxed">
                                    {adv.summary}
                                  </p>
                                )}
                                {pkgs.length > 0 && (
                                  <div className="font-mono text-[11.5px] text-zinc-300 tabular-nums pt-0.5">
                                    {visiblePkgs.join(' · ')}
                                    {hiddenPkgCount > 0 ? ` · +${hiddenPkgCount}` : ''}
                                  </div>
                                )}
                              </div>

                              <div className="space-y-1.5 pt-1 border-t border-white/[0.05]">
                                <p className="text-xs text-zinc-300 leading-relaxed">
                                  {renderInlineMonospace(adv.mitigation)}
                                </p>
                                {primaryCmd && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleCopyCommand(adv.id, primaryCmd);
                                    }}
                                    title="Copiar comando"
                                    className="inline-flex items-center gap-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 px-2 py-1 rounded font-mono text-[11px] transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] cursor-pointer"
                                  >
                                    {copiedCmdKey === adv.id ? (
                                      <>
                                        <Check className="h-3 w-3 text-emerald-400 transition-transform duration-150 scale-110" strokeWidth={1.75} />
                                        <span className="text-emerald-400">Copiado</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="h-3 w-3 text-[#7E8691]" strokeWidth={1.75} />
                                        <span>{primaryCmd}</span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono text-[#7E8691]">
                                <span>{adv.sourceName}</span>
                                <span>·</span>
                                <span>{adv.license}</span>
                                {adv.sourceUrl && (
                                  <>
                                    <span>·</span>
                                    <a
                                      href={adv.sourceUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="group/link inline-flex items-center gap-0.5 text-zinc-300 hover:text-[#EDEDEF] transition-colors"
                                    >
                                      <span>Referencia</span>
                                      <ArrowUpRight className="h-3 w-3 transition-transform duration-150 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5" strokeWidth={1.75} />
                                    </a>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="p-5 space-y-4">
          <div className="space-y-0.5">
            <h2 className="text-[14px] font-medium tracking-[-0.015em] text-[#EDEDEF]">
              Asistente Grounded de Cadena de Suministro
            </h2>
            <p className="text-xs text-[#7E8691]">
              Cita únicamente advisories verificados del corpus{' '}
              <code className="font-mono text-[11px] text-zinc-300">dev_supply_chain_cti</code>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            {SUGGESTED_QUESTIONS.map((qText) => (
              <button
                key={qText}
                type="button"
                onClick={() => void runQuestion(qText)}
                className="text-left text-[#7E8691] hover:text-[#EDEDEF] underline decoration-white/[0.12] underline-offset-4 transition-colors cursor-pointer"
              >
                {qText}
              </button>
            ))}
          </div>

          <form onSubmit={handleAsk} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Consulta sobre postinstall, setup.py o workflows CI/CD..."
              aria-label="Consulta al corpus de cadena de suministro"
              className="flex-1 h-9 rounded-md bg-white/[0.02] border border-white/[0.08] focus:border-white/[0.2] focus:outline-none px-3 text-xs text-[#EDEDEF] placeholder:text-[#7E8691]"
            />
            <button
              type="submit"
              disabled={asking || !question.trim()}
              className="h-9 inline-flex items-center justify-center gap-1.5 rounded-md bg-[#2F6FED] hover:bg-[#2558C7] disabled:opacity-45 px-3.5 text-xs font-medium text-white transition-all duration-150 active:scale-[0.98] cursor-pointer shrink-0"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>{asking ? 'Consultando...' : 'Consultar'}</span>
            </button>
          </form>

          {ragResponse && (
            <div className="border-l border-white/[0.12] pl-3.5 mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                <span
                  className={`inline-flex items-center gap-1.5 font-medium ${
                    ragResponse.status === 'GROUNDED' ? 'text-emerald-400' : 'text-[#E5A93C]'
                  }`}
                >
                  <ShieldAlert className="h-3 w-3" strokeWidth={1.75} />
                  <span>
                    {ragResponse.status === 'GROUNDED'
                      ? 'Con citas verificadas'
                      : 'Sin evidencia suficiente'}
                  </span>
                </span>
                <span className="text-[#7E8691]">· {ragResponse.notice}</span>
              </div>

              <p className="text-xs text-zinc-300 whitespace-pre-line leading-relaxed">
                {renderInlineMonospace(ragResponse.answer)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
