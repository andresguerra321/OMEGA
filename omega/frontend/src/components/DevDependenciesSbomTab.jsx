import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Download,
  FileJson,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { exportDevSbom, listDevDependencies, listDevProjects } from '../lib/api';
import { OmegaSelect } from './OmegaSelect';

export function DevDependenciesSbomTab() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [ecosystem, setEcosystem] = useState('');
  const [query, setQuery] = useState('');
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');

  async function loadProjects() {
    setLoading(true);
    setError('');
    try {
      const list = await listDevProjects();
      const arr = Array.isArray(list) ? list : [];
      setProjects(arr);
      if (arr.length > 0 && !selectedProjectId) {
        setSelectedProjectId(arr[0].id);
      }
    } catch (err) {
      setError(err?.message || 'No se pudieron cargar los proyectos.');
    } finally {
      setLoading(false);
    }
  }

  async function loadDependencies(projectId = selectedProjectId, eco = ecosystem, q = query) {
    if (!projectId) {
      setInventory(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await listDevDependencies(projectId, { ecosystem: eco, q });
      setInventory(res || null);
    } catch (err) {
      setError(err?.message || 'No se pudo cargar el inventario de dependencias.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      void loadDependencies(selectedProjectId, ecosystem, query);
    }
  }, [selectedProjectId, ecosystem]);

  async function handleExport(format) {
    if (!selectedProjectId) return;
    setExporting(format);
    setError('');
    try {
      const sbom = await exportDevSbom(selectedProjectId, format);
      const blob = new Blob([JSON.stringify(sbom, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = (inventory?.projectName || 'proyecto').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      a.href = url;
      a.download = `${slug}-sbom-${format}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err?.message || 'No se pudo exportar el SBOM.');
    } finally {
      setExporting('');
    }
  }

  const dependencies = Array.isArray(inventory?.dependencies) ? inventory.dependencies : [];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-[#0F131B]/85 backdrop-blur-md border border-white/[0.07] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F6FED]/15 border border-[#2F6FED]/30 text-[#2F6FED]">
              <Boxes className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Inventario de Dependencias y SBOM
              </h2>
              <p className="text-xs text-slate-400">
                Inspecciona paquetes por ecosistema, señales asociadas y exporta SBOM estándar CycloneDX 1.5 o SPDX 2.3.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!selectedProjectId || Boolean(exporting)}
              onClick={() => handleExport('cyclonedx')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F6FED] hover:bg-[#2558C7] disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>{exporting === 'cyclonedx' ? 'Exportando...' : 'Exportar CycloneDX 1.5'}</span>
            </button>
            <button
              type="button"
              disabled={!selectedProjectId || Boolean(exporting)}
              onClick={() => handleExport('spdx')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#141923] border border-white/[0.08] hover:border-white/[0.16] disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
            >
              <FileJson className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>{exporting === 'spdx' ? 'Exportando...' : 'Exportar SPDX 2.3'}</span>
            </button>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void loadDependencies(selectedProjectId, ecosystem, query);
          }}
          className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-white/[0.06]"
        >
          <div>
            <label htmlFor="sbom-project-select" className="block text-[11px] text-slate-400 mb-1">
              Proyecto
            </label>
            <OmegaSelect
              id="sbom-project-select"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              {projects.length === 0 && <option value="">Sin proyectos</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </OmegaSelect>
          </div>

          <div>
            <label htmlFor="sbom-eco-select" className="block text-[11px] text-slate-400 mb-1">
              Ecosistema
            </label>
            <OmegaSelect
              id="sbom-eco-select"
              value={ecosystem}
              onChange={(e) => setEcosystem(e.target.value)}
            >
              <option value="">Todos los ecosistemas</option>
              <option value="npm">npm</option>
              <option value="pypi">pypi</option>
              <option value="maven">maven</option>
              <option value="cargo">cargo</option>
              <option value="go">go</option>
            </OmegaSelect>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="sbom-query-input" className="block text-[11px] text-slate-400 mb-1">
              Buscar paquete o PURL
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                  strokeWidth={1.75}
                />
                <input
                  id="sbom-query-input"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ej. lodash, fastapi, pkg:npm/..."
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
            Cargando inventario de dependencias...
          </p>
        ) : dependencies.length === 0 ? (
          <div className="rounded-xl bg-[#141923]/55 border border-white/[0.05] p-6 text-center space-y-2">
            <p className="text-xs font-medium text-slate-200">
              No hay dependencias registradas para los filtros seleccionados
            </p>
            <p className="text-[11px] text-slate-400">
              Analiza un repositorio con package.json, requirements.txt, pom.xml, Cargo.toml o go.mod para poblar el SBOM.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>
                Total paquetes: <strong className="text-slate-100">{inventory?.totalDependencies || 0}</strong>
              </span>
              <span>
                Con señales activas:{' '}
                <strong className={inventory?.dependenciesWithSignals > 0 ? 'text-amber-300' : 'text-emerald-400'}>
                  {inventory?.dependenciesWithSignals || 0}
                </strong>
              </span>
            </div>

            <div className="divide-y divide-white/[0.06] rounded-xl bg-[#141923]/60 border border-white/[0.05]">
              {dependencies.map((dep) => {
                const signals = Array.isArray(dep.signals) ? dep.signals : [];
                return (
                  <div
                    key={dep.id}
                    className="p-4 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[#2F6FED]/15 border border-[#2F6FED]/30 px-2 py-0.5 text-[10px] font-mono text-[#60A5FA] uppercase">
                          {dep.ecosystem}
                        </span>
                        <span className="text-xs font-semibold text-slate-100">
                          {dep.name}
                        </span>
                        {dep.version && (
                          <span className="text-xs font-mono text-slate-400">
                            @{dep.version}
                          </span>
                        )}
                        <span className="rounded-full bg-white/[0.04] border border-white/[0.07] px-2 py-0.5 text-[10px] text-slate-400">
                          {dep.direct ? 'Directa' : 'Transitiva'}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-slate-400 truncate">
                        {dep.purl}
                        {dep.manifestPath ? ` · ${dep.manifestPath}` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {signals.length === 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] text-emerald-300">
                          <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
                          <span>Sin señales</span>
                        </span>
                      ) : (
                        signals.map((sig) => (
                          <span
                            key={sig.findingId}
                            className="inline-flex items-center gap-1 rounded-full border border-rose-500/35 bg-rose-500/10 px-2.5 py-0.5 text-[11px] text-rose-300"
                          >
                            <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
                            <span>
                              {sig.ruleId} ({sig.severity})
                            </span>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
