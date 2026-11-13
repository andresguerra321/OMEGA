import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { fetchSystemGovernance } from '../lib/api';

const PRIVACY_GUARANTEES = [
  'Procesamiento forense volátil en RAM (sin escritura en disco)',
  'Inspección pasiva de enlaces (cero peticiones salientes)',
  'Consentimiento explícito obligatorio para auditorías OSINT',
];

const RAG_DEPTH_OPTIONS = [4, 6, 10];

export function SettingsPanel({ topK, onChangeTopK }) {
  const [gov, setGov] = useState(null);
  const [loadingGov, setLoadingGov] = useState(true);
  const [rotated, setRotated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSystemGovernance()
      .then((data) => {
        if (!cancelled) setGov(data);
      })
      .catch(() => {
        if (!cancelled) setGov(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingGov(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRotateWorkspace() {
    const nextId = `analyst_${crypto.randomUUID()}`;
    localStorage.setItem('omega_workspace_id', nextId);
    setRotated(true);
    setLoadingGov(true);
    try {
      const data = await fetchSystemGovernance();
      setGov(data);
    } catch {
      setGov(null);
    } finally {
      setLoadingGov(false);
      setTimeout(() => setRotated(false), 1800);
    }
  }

  const workspaceId =
    gov?.workspace_id ||
    localStorage.getItem('omega_workspace_id') ||
    'default_analyst';

  const stats = gov?.corpus_stats;
  const sources = gov?.indexed_sources || [];

  return (
    <div className="mx-auto w-full max-w-[660px] py-8 space-y-6">
      {/* Encabezado */}
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-[#F2F2F4]">
          Ajustes
        </h1>
        <p className="mt-1 text-[13px] text-[#8E8E96]">
          Sesión local, garantías de privacidad y fuentes indexadas.
        </p>
      </header>

      {/* Bloque 1 — Sesión Local */}
      <section className="rounded-[6px] bg-[#141418] border border-[#232329] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[#F2F2F4]">
              Espacio de trabajo local
            </div>
            <div className="font-tech mt-1 text-[12px] text-[#8E8E96] break-all">
              {workspaceId}
            </div>
          </div>

          <button
            type="button"
            onClick={handleRotateWorkspace}
            className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#232329] bg-[#141418] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED] transition-colors cursor-pointer shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5 text-[#8E8E96]" />
            <span>{rotated ? 'ID rotado' : 'Rotar ID'}</span>
          </button>
        </div>

        <div className="pt-4 border-t border-[#232329] flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-[#F2F2F4]">
              Profundidad RAG
            </div>
            <div className="text-[12px] text-[#8E8E96]">
              Fuentes documentales recuperadas por consulta
            </div>
          </div>

          <div className="inline-flex rounded-[4px] border border-[#232329] bg-[#0A0A0C] p-0.5">
            {RAG_DEPTH_OPTIONS.map((count) => {
              const isSelected = topK === count;
              return (
                <button
                  key={count}
                  type="button"
                  onClick={() => onChangeTopK(count)}
                  className={`rounded-[4px] px-3 py-1 text-[12px] font-medium transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#15223D] text-[#F2F2F4]'
                      : 'text-[#8E8E96] hover:text-[#F2F2F4]'
                  }`}
                >
                  {count} fuentes
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Bloque 2 — Permisos y Privacidad Activos */}
      <section className="space-y-2.5">
        <h2 className="text-[12.5px] font-medium text-[#8E8E96]">
          Permisos y Privacidad Activos
        </h2>

        <div className="rounded-[6px] bg-[#141418] border border-[#232329] divide-y divide-[#232329]">
          {PRIVACY_GUARANTEES.map((label) => (
            <div
              key={label}
              className="px-4 py-3 flex items-center justify-between gap-4"
            >
              <span className="text-[13px] text-[#F2F2F4]">{label}</span>
              <span className="shrink-0 rounded-[4px] bg-[#15223D] border border-[#2F6FED]/40 px-2 py-0.5 text-[11px] font-medium text-[#7AA7FF]">
                Activo
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Bloque 3 — Corpus Indexado */}
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[12.5px] font-medium text-[#8E8E96]">
            Corpus Indexado
          </h2>
          <span className="font-tech text-[11px] text-[#8E8E96]">
            {stats
              ? `${stats.reports} Reportes · ${stats.campaigns} Campañas · ${stats.iocs} IOCs`
              : loadingGov
                ? 'Cargando métricas...'
                : 'Sin conexión al corpus'}
          </span>
        </div>

        <div className="rounded-[6px] bg-[#141418] border border-[#232329] divide-y divide-[#232329]">
          {sources.length === 0 ? (
            <div className="px-4 py-4 text-[12.5px] text-[#8E8E96]">
              {loadingGov
                ? 'Consultando fuentes públicas cargadas...'
                : 'No se pudieron recuperar los reportes indexados.'}
            </div>
          ) : (
            sources.map((rep, idx) => (
              <div
                key={`${rep.title}-${idx}`}
                className="px-4 py-3 flex items-center justify-between gap-4"
              >
                <span className="text-[13px] text-[#F2F2F4] truncate">
                  {rep.title}
                </span>
                <span className="shrink-0 text-[12px] text-[#8E8E96]">
                  {rep.organization}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
