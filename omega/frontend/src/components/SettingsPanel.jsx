import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Database,
  Globe,
  Layers,
  Microscope,
  RotateCcw,
  Scale,
  Shield,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import {
  fetchSystemGovernance,
  getWorkspaceId,
  rotateWorkspaceId,
} from '../lib/api';
import { OmegaWebIntelCard } from './OmegaWebIntelCard';

const CONFIG_SECTIONS = [
  { id: 'cuenta', label: 'Cuenta y sesión', icon: Shield },
  { id: 'rag', label: 'Motor RAG', icon: Layers },
  { id: 'permisos', label: 'Permisos y ética', icon: ShieldCheck },
  { id: 'corpus', label: 'Corpus indexado', icon: Database },
];

const TOPK_OPTIONS = [
  {
    value: 4,
    label: '4 fragmentos',
    caption: 'Respuesta rápida',
    icon: Zap,
  },
  {
    value: 6,
    label: '6 fragmentos',
    caption: 'Balanceado (Recomendado)',
    icon: Scale,
  },
  {
    value: 10,
    label: '10 fragmentos',
    caption: 'Auditoría exhaustiva',
    icon: Microscope,
  },
];

const SOURCE_OPTIONS = [
  {
    value: 'Todas las fuentes',
    title: 'Todas',
    description: 'Cruce global sobre todo el corpus.',
    icon: Layers,
  },
  {
    value: 'Citizen Lab',
    title: 'Citizen Lab',
    description: 'Investigaciones Pegasus, Candiru y QuaDream.',
    icon: Shield,
  },
  {
    value: 'Amnesty Tech',
    title: 'Amnesty Tech',
    description: 'Metodología forense MVT y Predator.',
    icon: ShieldCheck,
  },
  {
    value: 'Google TAG',
    title: 'Google TAG',
    description: 'Análisis de cadenas 0-day y vendedores.',
    icon: Globe,
  },
];

const FALLBACK_GOVERNANCE = {
  corpus_stats: {
    reports: 15,
    chunks: 530,
    iocs: 4855,
    campaigns: 11,
  },
  indexed_sources: [
    {
      title: 'BLASTPASS: NSO Group iPhone Zero-Click Exploit Captured in the Wild',
      organization: 'Citizen Lab',
      publication_date: '2023-09-07',
      ingested_at: '2026-11-12',
    },
    {
      title: 'Predator Files: Technical deep-dive into Intellexa Alliance products',
      organization: 'Amnesty Tech',
      publication_date: '2023-10-09',
      ingested_at: '2026-11-12',
    },
    {
      title: 'Buying Spying: Insights into Commercial Surveillance Vendors',
      organization: 'Google TAG',
      publication_date: '2024-02-06',
      ingested_at: '2026-11-12',
    },
  ],
};

function formatDateTag(rawDate) {
  if (!rawDate) return 'N/D';
  return String(rawDate).slice(0, 10);
}

function RadioDot({ selected }) {
  return (
    <span
      className={`h-4 w-4 rounded-full inline-flex items-center justify-center shrink-0 transition-all duration-150 ${
        selected
          ? 'bg-[#2F6FED] shadow-[0_0_0_2px_rgba(47,111,237,0.22)]'
          : 'border border-white/20 bg-black/30'
      }`}
    >
      {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
    </span>
  );
}

function TogglePill({ checked, disabled = false, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (!disabled && onChange) onChange(!checked);
      }}
      className={`w-10 h-[22px] rounded-full p-0.5 transition-colors duration-200 flex items-center shrink-0 ${
        checked
          ? 'bg-[#2F6FED] justify-end shadow-[inset_0_1px_1px_rgba(0,0,0,0.18)]'
          : 'bg-white/[0.14] justify-start'
      } ${disabled ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className="h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.45)] transition-transform duration-200" />
    </button>
  );
}

export function SettingsPanel({
  topK = 6,
  onChangeTopK,
  sourceScope = 'Todas las fuentes',
  onChangeSourceScope,
}) {
  const [activeSection, setActiveSection] = useState('cuenta');
  const [gov, setGov] = useState(null);
  const [workspaceId, setWorkspaceId] = useState(() => getWorkspaceId());

  const [savedTopK, setSavedTopK] = useState(topK);
  const [savedScope, setSavedScope] = useState(sourceScope);
  const [savedPassiveLinks, setSavedPassiveLinks] = useState(true);
  const [savedExplicitConsent, setSavedExplicitConsent] = useState(true);

  const [passiveLinks, setPassiveLinks] = useState(true);
  const [explicitConsent, setExplicitConsent] = useState(true);

  const [copiedId, setCopiedId] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const cuentaRef = useRef(null);
  const ragRef = useRef(null);
  const permisosRef = useRef(null);
  const corpusRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetchSystemGovernance()
      .then((data) => {
        if (!cancelled && data) {
          setGov(data);
          if (data.workspace_id) setWorkspaceId(data.workspace_id);
        }
      })
      .catch(() => {
        if (!cancelled) setGov(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function scrollToSection(id) {
    setActiveSection(id);
    const map = {
      cuenta: cuentaRef.current,
      rag: ragRef.current,
      permisos: permisosRef.current,
      corpus: corpusRef.current,
    };
    map[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleCopyWorkspaceId() {
    try {
      await navigator.clipboard.writeText(workspaceId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1600);
    } catch {
      // Clipboard API unavailable
    }
  }

  async function handleRotateId() {
    const nextId = rotateWorkspaceId();
    setWorkspaceId(nextId);
    setRotated(true);
    try {
      const refreshed = await fetchSystemGovernance();
      if (refreshed) setGov(refreshed);
    } catch {
      // Offline fallback keeps new workspaceId locally
    } finally {
      setTimeout(() => setRotated(false), 1600);
    }
  }

  function handleSaveChanges() {
    setSavedTopK(topK);
    setSavedScope(sourceScope);
    setSavedPassiveLinks(passiveLinks);
    setSavedExplicitConsent(explicitConsent);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 1800);
  }

  function handleDiscardChanges() {
    onChangeTopK?.(savedTopK);
    onChangeSourceScope?.(savedScope);
    setPassiveLinks(savedPassiveLinks);
    setExplicitConsent(savedExplicitConsent);
    setSavedFeedback(false);
  }

  const effectiveGov = gov || FALLBACK_GOVERNANCE;
  const stats = effectiveGov.corpus_stats || FALLBACK_GOVERNANCE.corpus_stats;
  const sources = effectiveGov.indexed_sources || FALLBACK_GOVERNANCE.indexed_sources;

  return (
    <div className="h-full flex">
      {/* Columna Izquierda: macOS System Settings Sidebar */}
      <aside className="w-[228px] shrink-0 apple-vibrancy border-r border-white/[0.07] p-3 hidden md:block">
        <nav className="space-y-1">
          {CONFIG_SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => scrollToSection(sec.id)}
                className={`w-full flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] transition-all duration-150 cursor-pointer ${
                  isActive
                    ? 'bg-[#2F6FED]/18 text-[#F5F5F7] font-medium ring-1 ring-inset ring-[#2F6FED]/35'
                    : 'text-[#8E8E93] hover:bg-white/[0.055] hover:text-[#F5F5F7]'
                }`}
              >
                <span
                  className={`h-6 w-6 rounded-[7px] inline-flex items-center justify-center shrink-0 transition-colors ${
                    isActive
                      ? 'bg-[#2F6FED] text-white shadow-[0_2px_8px_rgba(47,111,237,0.35)]'
                      : 'bg-white/[0.06] text-[#8E8E93]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate tracking-[-0.01em]">{sec.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Columna Derecha: Lienzo de Ajustes */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Barra Superior de Acción */}
        <div className="h-12 shrink-0 border-b border-white/[0.06] bg-[#08080A]/60 backdrop-blur-xl px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="text-[#8E8E93]">Ajustes</span>
            <span className="text-white/25">›</span>
            <span className="text-[#F5F5F7] font-medium">Cuenta y permisos</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleDiscardChanges}
              className="text-[12.5px] text-[#8E8E93] hover:text-[#F5F5F7] transition-colors cursor-pointer"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={handleSaveChanges}
              className="rounded-[9px] bg-[#2F6FED] shadow-[0_4px_14px_rgba(47,111,237,0.35),inset_0_1px_0_rgba(255,255,255,0.24)] hover:bg-[#3B7BF2] px-3.5 py-1.5 text-[12.5px] font-medium text-white inline-flex items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer"
            >
              {savedFeedback ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Guardado</span>
                </>
              ) : (
                <span>Guardar cambios</span>
              )}
            </button>
          </div>
        </div>

        {/* Área Scrollable */}
        <div className="flex-1 overflow-y-auto px-8 py-7">
          <div className="omega-fade-up max-w-[780px] space-y-8 pb-8">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em] text-[#F5F5F7]">
              Configuración del espacio de trabajo
            </h1>

            {/* Bloque 1 — Identidad de Sesión Local */}
            <section ref={cuentaRef} className="space-y-3 scroll-mt-6">
              <div>
                <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">
                  Cuenta y espacio de trabajo
                </h2>
                <p className="mt-1 text-[12.5px] text-[#8E8E93]">
                  Identificador local utilizado para aislar tus activos OSINT autorizados sin requerir cuentas en la nube.
                </p>
              </div>

              <div className="apple-group rounded-[13px] p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] text-[#8E8E93]">
                    ID de sesión activo
                  </div>
                  <div className="font-tech mt-1 text-[13px] text-[#F5F5F7] break-all">
                    {workspaceId}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyWorkspaceId}
                    className="inline-flex items-center gap-1.5 rounded-[8px] bg-white/[0.045] border border-white/[0.08] hover:bg-white/[0.09] px-3 py-1.5 text-[12px] text-[#F5F5F7] active:scale-[0.97] transition-all cursor-pointer"
                  >
                    {copiedId ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#5E9BFF]" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-[#8E8E93]" />
                        <span>Copiar ID</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleRotateId}
                    className="inline-flex items-center gap-1.5 rounded-[8px] bg-white/[0.045] border border-white/[0.08] hover:bg-white/[0.09] px-3 py-1.5 text-[12px] text-[#F5F5F7] active:scale-[0.97] transition-all cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-[#8E8E93]" />
                    <span>{rotated ? 'Rotado' : 'Rotar ID'}</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Bloque 2 — Profundidad de Recuperación RAG */}
            <section ref={ragRef} className="space-y-3 scroll-mt-6">
              <div>
                <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">
                  Alcance de evidencia (<span className="font-tech">Top-K</span>)
                </h2>
                <p className="mt-1 text-[12.5px] text-[#8E8E93]">
                  Define cuántos fragmentos documentales evalúa el motor híbrido RRF antes de redactar cada respuesta.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TOPK_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const selected = topK === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onChangeTopK?.(opt.value)}
                      className={`relative rounded-[13px] border p-4 text-left active:scale-[0.985] transition-all duration-150 cursor-pointer ${
                        selected
                          ? 'bg-[#2F6FED]/15 border-[#2F6FED]/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]'
                          : 'apple-group hover:border-white/[0.15]'
                      }`}
                    >
                      <div className="absolute top-3.5 left-3.5">
                        <RadioDot selected={selected} />
                      </div>

                      <div className="pt-4 pb-1 flex flex-col items-center text-center">
                        <Icon
                          className={`h-[19px] w-[19px] mb-2 ${
                            selected ? 'text-[#5E9BFF]' : 'text-[#8E8E93]'
                          }`}
                        />
                        <div className="font-tech text-[12.5px] font-medium text-[#F5F5F7]">
                          {opt.label}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-[#8E8E93]">
                          {opt.caption}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Bloque 3 — Prioridad de Corpus CTI */}
            <section className="space-y-3">
              <div>
                <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">
                  Fuentes documentales prioritarias
                </h2>
                <p className="mt-1 text-[12.5px] text-[#8E8E93]">
                  Selecciona qué investigaciones públicas tienen prioridad por defecto en tus consultas.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {SOURCE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const selected = sourceScope === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onChangeSourceScope?.(opt.value)}
                      className={`relative rounded-[13px] border p-3.5 text-left active:scale-[0.985] transition-all duration-150 cursor-pointer ${
                        selected
                          ? 'bg-[#2F6FED]/15 border-[#2F6FED]/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]'
                          : 'apple-group hover:border-white/[0.15]'
                      }`}
                    >
                      <div className="absolute top-3 left-3">
                        <RadioDot selected={selected} />
                      </div>

                      <div className="pt-4 flex flex-col items-center text-center">
                        <Icon
                          className={`h-[18px] w-[18px] mb-1.5 ${
                            selected ? 'text-[#5E9BFF]' : 'text-[#8E8E93]'
                          }`}
                        />
                        <div className="text-[13px] font-semibold text-[#F5F5F7]">
                          {opt.title}
                        </div>
                        <p className="mt-1 text-[11.5px] text-[#8E8E93] leading-snug line-clamp-2">
                          {opt.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Bloque 4 — Permisos y Garantías Éticas */}
            <section ref={permisosRef} className="space-y-3 scroll-mt-6">
              <div>
                <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">
                  Permisos y límites operativos
                </h2>
                <p className="mt-1 text-[12.5px] text-[#8E8E93]">
                  Controles de privacidad y cumplimiento ético aplicados automáticamente en todos los módulos.
                </p>
              </div>

              <div className="apple-group rounded-[13px] divide-y divide-white/[0.06] overflow-hidden">
                <div className="p-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium text-[#F5F5F7]">
                        Procesamiento forense volátil (<span className="font-tech">RNF4</span>)
                      </span>
                      <span className="rounded-full bg-[#2F6FED]/15 border border-[#2F6FED]/35 px-2.5 py-0.5 text-[10.5px] font-medium text-[#8AB4FF]">
                        Obligatorio
                      </span>
                    </div>
                    <p className="text-[12px] text-[#8E8E93] leading-relaxed">
                      Analiza respaldos MVT y SQLite exclusivamente en RAM; descarta los buffers al finalizar sin escribir en disco.
                    </p>
                  </div>

                  <TogglePill
                    checked={true}
                    disabled={true}
                    label="Procesamiento forense volátil obligatorio"
                  />
                </div>

                <div className="p-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[13.5px] font-medium text-[#F5F5F7]">
                      Inspección pasiva de enlaces (<span className="font-tech">RNF7</span>)
                    </div>
                    <p className="text-[12px] text-[#8E8E93] leading-relaxed">
                      Verifica URLs sospechosas contra IOCs y crt.sh sin emitir peticiones HTTP hacia el servidor destino.
                    </p>
                  </div>

                  <TogglePill
                    checked={passiveLinks}
                    onChange={setPassiveLinks}
                    label="Inspección pasiva de enlaces"
                  />
                </div>

                <div className="p-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[13.5px] font-medium text-[#F5F5F7]">
                      Consentimiento explícito OSINT (<span className="font-tech">RNF8</span>)
                    </div>
                    <p className="text-[12px] text-[#8E8E93] leading-relaxed">
                      Exige confirmación de titularidad antes de auditar dominios o correos institucionales.
                    </p>
                  </div>

                  <TogglePill
                    checked={explicitConsent}
                    onChange={setExplicitConsent}
                    label="Consentimiento explícito OSINT"
                  />
                </div>
              </div>
            </section>

            {/* Bloque 5 — Trazabilidad del Corpus Indexado (RF7) */}
            <section ref={corpusRef} className="space-y-3 scroll-mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-[#8E8E93]" />
                  <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[#F5F5F7]">
                    Trazabilidad del Corpus Indexado (<span className="font-tech">RF7</span>)
                  </h2>
                </div>

                <span className="font-tech rounded-full bg-[#2F6FED]/15 border border-[#2F6FED]/35 px-3 py-1 text-[11px] text-[#8AB4FF]">
                  {stats.reports} Reportes · {stats.chunks} Fragmentos ·{' '}
                  {Number(stats.iocs || 0).toLocaleString('en-US')} IOCs
                </span>
              </div>

              <div className="apple-group rounded-[13px] divide-y divide-white/[0.06] max-h-56 overflow-y-auto">
                {sources.map((rep, idx) => (
                  <div
                    key={`${rep.title}-${idx}`}
                    className="px-4 py-3 flex items-center justify-between gap-4"
                  >
                    <span className="text-[12.5px] text-[#F5F5F7] truncate">
                      {rep.title}
                    </span>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[12px] text-[#8E8E93]">
                        {rep.organization}
                      </span>
                      <span className="font-tech text-[11px] text-[#8E8E93]">
                        {formatDateTag(rep.ingested_at || rep.publication_date)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <OmegaWebIntelCard
                compact
                title="Ingesta volátil de fuente web CTI (WebBaseLoader RNF4)"
                subtitle="Analiza un reporte técnico externo directamente en memoria para extraer IPv4 (net4), dominios y CVEs y cruzarlos con el catálogo."
              />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
