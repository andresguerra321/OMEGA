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

const CONFIG_SECTIONS = [
  { id: 'cuenta', number: 1, label: 'Cuenta y sesión' },
  { id: 'rag', number: 2, label: 'Motor RAG' },
  { id: 'permisos', number: 3, label: 'Permisos y ética' },
  { id: 'corpus', number: 4, label: 'Corpus indexado' },
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
      className={`h-3.5 w-3.5 rounded-full inline-flex items-center justify-center shrink-0 transition-colors ${
        selected
          ? 'bg-[#2F6FED]'
          : 'border border-[#232329] bg-[#0A0A0C]'
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
      className={`w-9 h-5 rounded-full p-0.5 transition-colors flex items-center shrink-0 ${
        checked ? 'bg-[#2F6FED] justify-end' : 'bg-[#232329] justify-start'
      } ${disabled ? 'opacity-85 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className="h-4 w-4 rounded-full bg-[#F2F2F4]" />
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
    <div className="h-full flex bg-[#0A0A0C]">
      {/* Columna Izquierda: Índice de Configuración (210px fijo) */}
      <aside className="w-[210px] shrink-0 bg-[#141418]/50 border-r border-[#232329] p-4 hidden md:block">
        <nav className="space-y-1">
          {CONFIG_SECTIONS.map((sec) => {
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => scrollToSection(sec.id)}
                className={`w-full flex items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left text-[12.5px] transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#15223D]/45 text-[#F2F2F4] font-medium'
                    : 'text-[#8E8E96] hover:bg-[#141418] hover:text-[#F2F2F4]'
                }`}
              >
                <span
                  className={`font-tech h-5 w-5 rounded-full inline-flex items-center justify-center text-[11px] shrink-0 ${
                    isActive
                      ? 'bg-[#2F6FED] text-[#F2F2F4]'
                      : 'border border-[#232329] text-[#8E8E96]'
                  }`}
                >
                  {sec.number}
                </span>
                <span className="truncate">{sec.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Columna Derecha: Lienzo de Configuración */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Barra Superior de Acción */}
        <div className="h-12 shrink-0 border-b border-[#232329] px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-[#8E8E96]">Ajustes</span>
            <span className="text-[#232329]">&gt;</span>
            <span className="text-[#F2F2F4] font-medium">Cuenta y permisos</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleDiscardChanges}
              className="text-[12px] text-[#8E8E96] hover:text-[#F2F2F4] transition-colors cursor-pointer"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={handleSaveChanges}
              className="rounded-[4px] bg-[#2F6FED] hover:bg-[#255ED4] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
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
          <div className="max-w-[780px] space-y-8 pb-8">
            <h1 className="text-[20px] font-semibold tracking-tight text-[#F2F2F4]">
              Configuración del espacio de trabajo
            </h1>

            {/* Bloque 1 — Identidad de Sesión Local */}
            <section ref={cuentaRef} className="space-y-3 scroll-mt-6">
              <div>
                <h2 className="text-[14px] font-semibold text-[#F2F2F4]">
                  Cuenta y espacio de trabajo
                </h2>
                <p className="mt-1 text-[12.5px] text-[#8E8E96]">
                  Identificador local utilizado para aislar tus activos OSINT autorizados sin requerir cuentas en la nube.
                </p>
              </div>

              <div className="rounded-[6px] bg-[#141418] border border-[#232329] p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] text-[#8E8E96]">
                    ID de sesión activo
                  </div>
                  <div className="font-tech mt-1 text-[13px] text-[#F2F2F4] break-all">
                    {workspaceId}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyWorkspaceId}
                    className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#0A0A0C] border border-[#232329] hover:border-[#2F6FED] px-2.5 py-1.5 text-[12px] text-[#F2F2F4] transition-colors cursor-pointer"
                  >
                    {copiedId ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#7AA7FF]" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-[#8E8E96]" />
                        <span>Copiar ID</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleRotateId}
                    className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#0A0A0C] border border-[#232329] hover:border-[#2F6FED] px-2.5 py-1.5 text-[12px] text-[#F2F2F4] transition-colors cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-[#8E8E96]" />
                    <span>{rotated ? 'Rotado' : 'Rotar ID'}</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Bloque 2 — Profundidad de Recuperación RAG */}
            <section ref={ragRef} className="space-y-3 scroll-mt-6">
              <div>
                <h2 className="text-[14px] font-semibold text-[#F2F2F4]">
                  Alcance de evidencia (<span className="font-tech">Top-K</span>)
                </h2>
                <p className="mt-1 text-[12.5px] text-[#8E8E96]">
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
                      className={`relative rounded-[6px] border p-3.5 text-left transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[#15223D]/45 border-[#2F6FED]'
                          : 'bg-[#141418] border-[#232329] hover:border-[#2F6FED]/50'
                      }`}
                    >
                      <div className="absolute top-3 left-3">
                        <RadioDot selected={selected} />
                      </div>

                      <div className="pt-4 pb-1 flex flex-col items-center text-center">
                        <Icon
                          className={`h-[18px] w-[18px] mb-2 ${
                            selected ? 'text-[#2F6FED]' : 'text-[#8E8E96]'
                          }`}
                        />
                        <div className="font-tech text-[12px] font-medium text-[#F2F2F4]">
                          {opt.label}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-[#8E8E96]">
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
                <h2 className="text-[14px] font-semibold text-[#F2F2F4]">
                  Fuentes documentales prioritarias
                </h2>
                <p className="mt-1 text-[12.5px] text-[#8E8E96]">
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
                      className={`relative rounded-[6px] border p-3.5 text-left transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[#15223D]/45 border-[#2F6FED]'
                          : 'bg-[#141418] border-[#232329] hover:border-[#2F6FED]/50'
                      }`}
                    >
                      <div className="absolute top-3 left-3">
                        <RadioDot selected={selected} />
                      </div>

                      <div className="pt-4 flex flex-col items-center text-center">
                        <Icon
                          className={`h-[18px] w-[18px] mb-1.5 ${
                            selected ? 'text-[#2F6FED]' : 'text-[#8E8E96]'
                          }`}
                        />
                        <div className="text-[13px] font-semibold text-[#F2F2F4]">
                          {opt.title}
                        </div>
                        <p className="mt-1 text-[11.5px] text-[#8E8E96] leading-snug line-clamp-2">
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
                <h2 className="text-[14px] font-semibold text-[#F2F2F4]">
                  Permisos y límites operativos
                </h2>
                <p className="mt-1 text-[12.5px] text-[#8E8E96]">
                  Controles de privacidad y cumplimiento ético aplicados automáticamente en todos los módulos.
                </p>
              </div>

              <div className="rounded-[6px] bg-[#141418] border border-[#232329] divide-y divide-[#232329]">
                {/* Fila 1: Obligatorio */}
                <div className="p-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-[#F2F2F4]">
                        Procesamiento forense volátil (<span className="font-tech">RNF4</span>)
                      </span>
                      <span className="rounded-[4px] bg-[#15223D] border border-[#2F6FED]/40 px-2 py-0.5 text-[10.5px] font-medium text-[#7AA7FF]">
                        Obligatorio
                      </span>
                    </div>
                    <p className="text-[12px] text-[#8E8E96] leading-relaxed">
                      Analiza respaldos MVT y SQLite exclusivamente en RAM; descarta los buffers al finalizar sin escribir en disco.
                    </p>
                  </div>

                  <TogglePill
                    checked={true}
                    disabled={true}
                    label="Procesamiento forense volátil obligatorio"
                  />
                </div>

                {/* Fila 2 */}
                <div className="p-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[13px] font-medium text-[#F2F2F4]">
                      Inspección pasiva de enlaces (<span className="font-tech">RNF7</span>)
                    </div>
                    <p className="text-[12px] text-[#8E8E96] leading-relaxed">
                      Verifica URLs sospechosas contra IOCs y crt.sh sin emitir peticiones HTTP hacia el servidor destino.
                    </p>
                  </div>

                  <TogglePill
                    checked={passiveLinks}
                    onChange={setPassiveLinks}
                    label="Inspección pasiva de enlaces"
                  />
                </div>

                {/* Fila 3 */}
                <div className="p-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[13px] font-medium text-[#F2F2F4]">
                      Consentimiento explícito OSINT (<span className="font-tech">RNF8</span>)
                    </div>
                    <p className="text-[12px] text-[#8E8E96] leading-relaxed">
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
                  <Database className="h-4 w-4 text-[#8E8E96]" />
                  <h2 className="text-[14px] font-semibold text-[#F2F2F4]">
                    Trazabilidad del Corpus Indexado (<span className="font-tech">RF7</span>)
                  </h2>
                </div>

                <span className="font-tech rounded-[4px] bg-[#15223D] border border-[#2F6FED]/40 px-2.5 py-1 text-[11px] text-[#7AA7FF]">
                  {stats.reports} Reportes · {stats.chunks} Fragmentos ·{' '}
                  {Number(stats.iocs || 0).toLocaleString('en-US')} IOCs
                </span>
              </div>

              <div className="rounded-[6px] bg-[#141418] border border-[#232329] divide-y divide-[#232329] max-h-56 overflow-y-auto">
                {sources.map((rep, idx) => (
                  <div
                    key={`${rep.title}-${idx}`}
                    className="px-4 py-3 flex items-center justify-between gap-4"
                  >
                    <span className="text-[12.5px] text-[#F2F2F4] truncate">
                      {rep.title}
                    </span>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[12px] text-[#8E8E96]">
                        {rep.organization}
                      </span>
                      <span className="font-tech text-[11px] text-[#8E8E96]">
                        {formatDateTag(rep.ingested_at || rep.publication_date)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
