import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileCheck2,
  Lock,
  Play,
  Scale,
  Server,
  Shield,
  ShieldCheck,
  Smartphone,
  Terminal,
  X,
} from 'lucide-react';
import { OmegaBrandMark } from './OmegaBrandMark';
import { OmegaOrb3D } from './OmegaOrb3D';
import {
  DEPLOYMENT_MODES,
  LANDING_FAQ,
  LANDING_METRICS,
  LANDING_PAGES,
  LANDING_PROFILES,
  OMEGA_APP_URL,
  OMEGA_DEMO_VIDEO,
  OPERATIONAL_GUARANTEES,
  PILOT_SUMMARY_TEXT,
  PROFILE_ACCESS_NOTES,
  getPlansForProfile,
} from '../data/catalog';

const EASE_OUT = [0.22, 1, 0.36, 1];
const VALID_PAGE_IDS = new Set(LANDING_PAGES.map((p) => p.id));

const ELEVATION_NAV =
  'shadow-[0_12px_32px_-12px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.08)]';
const ELEVATION_FRAME =
  'shadow-[0_28px_72px_-20px_rgba(0,0,0,0.78),0_8px_24px_-8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.10)]';
const ELEVATION_MODAL =
  'shadow-[0_32px_80px_-16px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.10)]';

const PROFILE_ICONS = {
  GENERAL: Shield,
  DEVELOPER: Code2,
  LEGAL: Scale,
};

const GUARANTEE_ICONS = {
  'zero-retention': Cpu,
  'verifiable-evidence': FileCheck2,
  'sovereign-control': Server,
};

function readPageFromHash() {
  if (typeof window === 'undefined') return 'plataforma';
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  return VALID_PAGE_IDS.has(raw) ? raw : 'plataforma';
}

function ActionSheetModal({ mode, onClose, onEnterApp }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!mode) setCopied(false);
  }, [mode]);

  if (!mode) return null;
  const isDownload = mode === 'download';

  async function copyPilotSummary() {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(PILOT_SUMMARY_TEXT);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="landing-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070B]/82 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.99 }}
        transition={{ duration: 0.22, ease: EASE_OUT }}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-lg rounded-2xl bg-[#0B101B] border border-white/[0.10] ${ELEVATION_MODAL} p-6 sm:p-7`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3
              id="landing-modal-title"
              className="font-[var(--font-display)] text-xl font-medium tracking-[-0.025em] text-[#F8FAFC]"
            >
              {isDownload
                ? 'OMEGA Desktop v2.2'
                : 'Piloto corporativo y despliegue soberano'}
            </h3>
            <p className="mt-1 text-xs font-mono text-[#64748B]">
              {isDownload
                ? 'Cliente nativo Tauri · Sensor local Rust + Conector USB'
                : 'Enterprise · 5 puestos · 25 dispositivos · 3.000 créditos/mes'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana"
            className="rounded-lg p-1.5 text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {isDownload ? (
          <div className="mt-5 space-y-5">
            <p className="text-sm text-[#94A3B8] leading-relaxed">
              Instala el cliente de escritorio para auditar Windows/macOS en RAM y conectar teléfonos Android o iOS por USB, o entra directamente a la cabina web.
            </p>
            <div className="divide-y divide-white/[0.07] border-y border-white/[0.07]">
              <div className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Terminal className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
                  <div>
                    <p className="text-sm font-medium text-[#F8FAFC]">Windows 10 / 11 (x64)</p>
                    <p className="text-xs font-mono text-[#64748B]">Instalador MSI / NSIS · sensor de solo lectura</p>
                  </div>
                </div>
                <span className="font-mono text-xs text-[#94A3B8]">v2.2.0</span>
              </div>
              <div className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Smartphone className="w-4 h-4 text-[#94A3B8]" strokeWidth={1.75} />
                  <div>
                    <p className="text-sm font-medium text-[#F8FAFC]">Triaje USB Android (ADB) e iOS (MVT)</p>
                    <p className="text-xs font-mono text-[#64748B]">Conector portátil incluido en 1 clic</p>
                  </div>
                </div>
                <span className="text-xs text-[#94A3B8]">Incluido</span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => onEnterApp('register')}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium px-4 py-2.5 transition-colors"
              >
                Crear cuenta y abrir OMEGA
                <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => onEnterApp('login')}
                className="inline-flex items-center justify-center rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.09] text-[#F8FAFC] text-sm font-medium px-4 py-2.5 transition-colors"
              >
                Iniciar sesión
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <p className="text-sm text-[#94A3B8] leading-relaxed">
              Configura espacios aislados para General, Desarrollo o Legal con MFA organizacional, despliegue administrado o Modo Soberano Local con Ollama.
            </p>
            <div className="divide-y divide-white/[0.07] border-y border-white/[0.07] text-sm">
              <div className="py-3 flex items-center justify-between gap-4">
                <span className="text-[#94A3B8]">Plan Enterprise</span>
                <span className="font-mono text-[#F8FAFC] tabular-nums">$299.900 COP/mes · $2.999.000/año</span>
              </div>
              <div className="py-3 flex items-center justify-between gap-4">
                <span className="text-[#94A3B8]">Capacidad base</span>
                <span className="font-mono text-[#F8FAFC] tabular-nums">5 puestos · 25 dispositivos · 3.000 créditos</span>
              </div>
              <div className="py-3 flex items-center justify-between gap-4">
                <span className="text-[#94A3B8]">Modo Soberano</span>
                <span className="font-mono text-[#F8FAFC]">SELF_HOSTED + Ollama (0 créditos IA)</span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => onEnterApp('register')}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium px-4 py-2.5 transition-colors"
              >
                Crear espacio de organización
                <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={copyPilotSummary}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.09] text-[#F8FAFC] text-sm font-medium px-4 py-2.5 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" strokeWidth={1.75} />
                    Resumen copiado
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-[#94A3B8]" strokeWidth={1.75} />
                    Copiar ficha técnica
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export function OmegaLandingPage({ onEnterApp }) {
  const [activePage, setActivePage] = useState(readPageFromHash);
  const [activeProfile, setActiveProfile] = useState('GENERAL');
  const [pricingProfile, setPricingProfile] = useState('GENERAL');
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [demoStarted, setDemoStarted] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [modalMode, setModalMode] = useState(null);

  const selectedProfile =
    LANDING_PROFILES.find((item) => item.id === activeProfile) || LANDING_PROFILES[0];
  const plans = getPlansForProfile(pricingProfile, billingCycle);

  useEffect(() => {
    const onHashChange = () => setActivePage(readPageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function navigatePage(pageId) {
    if (!VALID_PAGE_IDS.has(pageId)) return;
    setActivePage(pageId);
    if (typeof window !== 'undefined') {
      const targetHash = `#/${pageId}`;
      if (window.location.hash !== targetHash) {
        window.history.pushState(null, '', targetHash);
      }
      window.scrollTo?.({ top: 0, behavior: 'smooth' });
    }
  }

  function navigateToApp(intent = 'login') {
    if (typeof onEnterApp === 'function') {
      onEnterApp(intent);
      return;
    }
    if (typeof window !== 'undefined') {
      const base = OMEGA_APP_URL.replace(/\/+$/, '');
      window.open(intent === 'register' ? `${base}/?auth=register` : base, '_self');
    }
  }

  return (
    <div className="min-h-screen w-full bg-[#05070B] text-[#F8FAFC] flex flex-col overflow-x-hidden">
      {/* Navbar fija minimalista con navegación por vistas separadas */}
      <header className="sticky top-0 z-40 px-4 sm:px-6 pt-4 pb-2 bg-[#05070B]/88 backdrop-blur-md">
        <nav
          aria-label="Navegación principal"
          className={`max-w-6xl mx-auto rounded-2xl px-4 sm:px-5 h-14 flex items-center justify-between omega-surface border border-white/[0.09] ${ELEVATION_NAV}`}
        >
          <button
            type="button"
            onClick={() => navigatePage('plataforma')}
            className="rounded-lg text-left"
          >
            <OmegaBrandMark />
          </button>

          <div className="hidden md:flex items-center gap-1" role="navigation" aria-label="Secciones">
            {LANDING_PAGES.map((page) => {
              const isCurrent = activePage === page.id;
              return (
                <button
                  key={page.id}
                  type="button"
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={() => navigatePage(page.id)}
                  className={`relative rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium transition-colors ${
                    isCurrent ? 'text-[#F8FAFC]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                  }`}
                >
                  {isCurrent && (
                    <motion.span
                      layoutId="omega-nav-active"
                      transition={{ duration: 0.22, ease: EASE_OUT }}
                      className="absolute inset-0 rounded-lg bg-white/[0.07] border border-white/[0.08]"
                    />
                  )}
                  <span className="relative z-10">{page.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5">
            <button
              type="button"
              onClick={() => navigateToApp('login')}
              className="rounded-lg px-3.5 py-2 text-[13.5px] font-medium text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/[0.05] transition-colors"
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => setModalMode('pilot')}
              className="rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-[13.5px] font-medium px-4 py-2 transition-colors"
            >
              Solicitar piloto
            </button>
          </div>
        </nav>

        {/* Selector móvil compacto */}
        <div className="md:hidden max-w-6xl mx-auto mt-2 flex items-center gap-1 overflow-x-auto pb-1">
          {LANDING_PAGES.map((page) => {
            const isCurrent = activePage === page.id;
            return (
              <button
                key={page.id}
                type="button"
                aria-current={isCurrent ? 'page' : undefined}
                onClick={() => navigatePage(page.id)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  isCurrent
                    ? 'bg-white/[0.09] text-[#F8FAFC] border border-white/[0.10]'
                    : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                {page.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Contenido de la vista activa */}
      <main className="flex-1 flex flex-col justify-center">
        <motion.div
          key={activePage}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: EASE_OUT }}
          className="w-full"
        >
          {/* VISTA 1: PLATAFORMA (Hero + Orbe 3D WebGL + Credenciales) */}
          {activePage === 'plataforma' && (
            <section className="px-4 sm:px-6 pt-10 sm:pt-14 pb-16">
              <div className="max-w-6xl mx-auto">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
                  <div className="lg:col-span-7">
                    <div className="inline-flex items-center gap-2 rounded-full bg-[#0B101B] border border-white/[0.09] px-3.5 py-1.5 text-[11.5px] font-mono text-[#94A3B8]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#2F6FED]" aria-hidden="true" />
                      OMEGA v2.2 · Zero-Retention &amp; Soberanía de Datos
                    </div>

                    <h1 className="mt-6 font-[var(--font-display)] text-4xl sm:text-5xl lg:text-[3.5rem] font-medium tracking-[-0.03em] leading-[1.05] text-[#F8FAFC] text-balance">
                      Inteligencia forense, AppSec y análisis documental sin exponer tus datos.
                    </h1>

                    <p className="mt-5 text-base sm:text-lg text-[#94A3B8] max-w-xl leading-relaxed">
                      Inspección volátil en RAM para equipos y teléfonos por USB, auditoría de repositorios y expedientes confidenciales con citas verificables en una sola aplicación nativa.
                    </p>

                    <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      <button
                        type="button"
                        onClick={() => navigateToApp('register')}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium px-6 py-3 transition-colors"
                      >
                        Comenzar gratis
                        <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigatePage('demo')}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0B101B] hover:bg-[#12192A] border border-white/[0.10] text-[#F8FAFC] text-sm font-medium px-6 py-3 transition-colors"
                      >
                        <Play className="w-3.5 h-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                        Ver demostración
                      </button>
                      <button
                        type="button"
                        onClick={() => setModalMode('download')}
                        className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-[#94A3B8] hover:text-[#F8FAFC] transition-colors"
                      >
                        <Download className="w-4 h-4" strokeWidth={1.75} />
                        Desktop v2.2
                      </button>
                    </div>
                  </div>

                  {/* Orbe 3D WebGL interactivo */}
                  <div className="lg:col-span-5 flex flex-col items-center">
                    <OmegaOrb3D />
                    <p className="mt-2 font-mono text-[11px] text-[#64748B]">
                      Núcleo OMEGA · WebGL 3D interactivo · 0 B persistidos en disco
                    </p>
                  </div>
                </div>

                {/* Banda de 4 credenciales técnicas con líneas hairline */}
                <div className="mt-14 border-y border-white/[0.08]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.08]">
                    {LANDING_METRICS.map((metric) => (
                      <div key={metric.value} className="px-5 py-6 first:lg:pl-0 last:lg:pr-0">
                        <p className="font-mono text-lg font-medium tracking-[-0.02em] text-[#F8FAFC] tabular-nums">
                          {metric.value}
                        </p>
                        <p className="mt-1 text-sm font-medium text-[#CBD5E1]">{metric.label}</p>
                        <p className="mt-1 text-xs text-[#64748B] leading-relaxed">{metric.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Accesos directos a las vistas dedicadas */}
                <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    {
                      page: 'perfiles',
                      title: 'Espacios General, Desarrollo y Legal',
                      detail: 'Explora la superficie auditada y límites operativos de cada perfil.',
                    },
                    {
                      page: 'seguridad',
                      title: 'Arquitectura Zero-Retention y Ollama',
                      detail: 'Revisa cómo opera en RAM y cómo desplegar en Modo Soberano Local.',
                    },
                    {
                      page: 'planes',
                      title: 'Planes y créditos en COP',
                      detail: 'Desde Gratis ($0) hasta Pro ($59.900) y Enterprise ($299.900).',
                    },
                  ].map((item) => (
                    <button
                      key={item.page}
                      type="button"
                      onClick={() => navigatePage(item.page)}
                      className="group text-left rounded-2xl omega-surface-flat border border-white/[0.08] hover:border-white/[0.16] p-5 transition-colors flex flex-col justify-between"
                    >
                      <div>
                        <p className="text-sm font-medium text-[#F8FAFC] flex items-center justify-between gap-2">
                          <span>{item.title}</span>
                          <ArrowRight
                            className="w-4 h-4 text-[#64748B] group-hover:text-[#2F6FED] transition-colors shrink-0"
                            strokeWidth={1.75}
                          />
                        </p>
                        <p className="mt-1.5 text-xs text-[#94A3B8] leading-relaxed">
                          {item.detail}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* VISTA 2: DEMOSTRACIÓN (Video real de YouTube https://youtu.be/h8RutTVyJzY) */}
          {activePage === 'demo' && (
            <section className="px-4 sm:px-6 pt-10 sm:pt-14 pb-16">
              <div className="max-w-5xl mx-auto">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div className="max-w-2xl">
                    <h1 className="font-[var(--font-display)] text-3xl sm:text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC] text-balance">
                      Demostración ejecutiva de OMEGA en operación.
                    </h1>
                    <p className="mt-2.5 text-sm sm:text-base text-[#94A3B8] leading-relaxed">
                      Recorrido real por la cabina nativa, inspección en RAM, análisis AppSec y verificación documental con citas.
                    </p>
                  </div>

                  <a
                    href={OMEGA_DEMO_VIDEO.watchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex self-start md:self-auto items-center gap-2 rounded-lg bg-[#0B101B] hover:bg-[#12192A] border border-white/[0.10] px-4 py-2 text-xs font-mono text-[#CBD5E1] transition-colors"
                  >
                    Abrir en YouTube
                    <ExternalLink className="w-3.5 h-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                  </a>
                </div>

                {/* Marco de reproducción 16:9 */}
                <div
                  className={`mt-8 rounded-2xl bg-[#0B101B] border border-white/[0.10] ${ELEVATION_FRAME} overflow-hidden`}
                >
                  <div className="h-10 px-4 flex items-center justify-between border-b border-white/[0.08] bg-[#080C14]">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-white/[0.14]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-white/[0.14]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-white/[0.14]" />
                      <span className="ml-2 font-mono text-[11px] text-[#64748B]">
                        omega-demo · youtu.be/{OMEGA_DEMO_VIDEO.youtubeId}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-[#94A3B8]">
                      {demoStarted ? 'Reproduciendo' : 'Listo para reproducir'}
                    </span>
                  </div>

                  <div className="relative aspect-[16/9] bg-[#05070B]">
                    {demoStarted ? (
                      <iframe
                        src={OMEGA_DEMO_VIDEO.embedUrl}
                        title={OMEGA_DEMO_VIDEO.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        className="h-full w-full border-0"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDemoStarted(true)}
                        aria-label="Reproducir demostración oficial de OMEGA"
                        className="group relative h-full w-full block text-left"
                      >
                        <img
                          src={OMEGA_DEMO_VIDEO.poster}
                          alt={OMEGA_DEMO_VIDEO.title}
                          className="h-full w-full object-cover opacity-80 group-hover:opacity-90 transition-opacity"
                        />
                        <div className="absolute inset-0 bg-[#05070B]/45 flex flex-col items-center justify-center gap-3 p-6">
                          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#2F6FED] group-hover:bg-[#3B7BF2] text-white transition-transform duration-150 group-hover:scale-105">
                            <Play className="w-6 h-6 ml-0.5" strokeWidth={1.75} />
                          </span>
                          <span className="font-mono text-xs text-[#F8FAFC] bg-[#05070B]/75 border border-white/[0.12] rounded-full px-3.5 py-1">
                            Reproducir demo oficial (YouTube)
                          </span>
                        </div>
                      </button>
                    )}
                  </div>
                </div>

                {/* Resumen de lo cubierto en la demo */}
                <div className="mt-8 border-y border-white/[0.08] grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.08]">
                  {OMEGA_DEMO_VIDEO.highlights.map((item) => (
                    <div key={item.label} className="py-5 md:px-6 first:md:pl-0 last:md:pr-0">
                      <p className="text-sm font-medium text-[#F8FAFC]">{item.label}</p>
                      <p className="mt-1 text-xs text-[#94A3B8] leading-relaxed">{item.detail}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => navigatePage('perfiles')}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#0B101B] hover:bg-[#12192A] border border-white/[0.10] text-sm font-medium text-[#F8FAFC] px-5 py-2.5 transition-colors"
                    >
                      Explorar perfiles
                      <ArrowRight className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigatePage('planes')}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-sm font-medium text-white px-5 py-2.5 transition-colors"
                    >
                      Ver planes en COP
                      <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModalMode('download')}
                    className="inline-flex items-center gap-2 text-xs font-mono text-[#94A3B8] hover:text-[#F8FAFC] transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" strokeWidth={1.75} />
                    Descargar OMEGA Desktop v2.2
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* VISTA 3: PERFILES (Tabs interactivos General / Desarrollo / Legal) */}
          {activePage === 'perfiles' && (
            <section className="px-4 sm:px-6 pt-10 sm:pt-14 pb-16">
              <div className="max-w-6xl mx-auto">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                  <div className="max-w-2xl">
                    <h1 className="font-[var(--font-display)] text-3xl sm:text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC] text-balance">
                      Una sola plataforma. Tres espacios de trabajo especializados.
                    </h1>
                  </div>

                  <div
                    role="tablist"
                    aria-label="Perfiles de espacio de trabajo"
                    className="inline-flex self-start md:self-auto rounded-full bg-[#0B101B] border border-white/[0.09] p-1"
                  >
                    {LANDING_PROFILES.map((profile) => {
                      const isActive = profile.id === activeProfile;
                      const Icon = PROFILE_ICONS[profile.id];
                      return (
                        <button
                          key={profile.id}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          aria-controls={`profile-panel-${profile.id}`}
                          onClick={() => setActiveProfile(profile.id)}
                          className={`relative rounded-full px-4 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2 ${
                            isActive ? 'text-white' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                          }`}
                        >
                          {isActive && (
                            <motion.span
                              layoutId="landing-profile-pill"
                              transition={{ duration: 0.22, ease: EASE_OUT }}
                              className="absolute inset-0 rounded-full bg-[#2F6FED]"
                            />
                          )}
                          <Icon className="relative z-10 w-4 h-4" strokeWidth={1.75} />
                          <span className="relative z-10">{profile.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-10">
                  <motion.div
                    key={selectedProfile.id}
                    id={`profile-panel-${selectedProfile.id}`}
                    role="tabpanel"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: EASE_OUT }}
                    className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start"
                  >
                    <div className="lg:col-span-6 space-y-6">
                      <div>
                        <p className="text-sm font-medium text-[#2F6FED]">{selectedProfile.domain}</p>
                        <h2 className="mt-2 font-[var(--font-display)] text-2xl sm:text-3xl font-medium tracking-[-0.025em] text-[#F8FAFC]">
                          {selectedProfile.headline}
                        </h2>
                        <p className="mt-3 text-sm sm:text-base text-[#94A3B8] leading-relaxed">
                          {selectedProfile.summary}
                        </p>
                      </div>

                      <div className="divide-y divide-white/[0.07] border-t border-white/[0.07]">
                        {selectedProfile.capabilities.map((cap) => (
                          <div key={cap.title} className="py-4 flex items-start gap-3">
                            <Check className="mt-0.5 w-4 h-4 text-[#2F6FED] shrink-0" strokeWidth={1.75} />
                            <div>
                              <h3 className="text-sm font-medium text-[#F8FAFC]">{cap.title}</h3>
                              <p className="mt-1 text-sm text-[#94A3B8] leading-relaxed">{cap.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="lg:col-span-6">
                      <div className="rounded-2xl omega-surface-flat border border-white/[0.09] overflow-hidden">
                        <div className="h-9 px-4 flex items-center justify-between border-b border-white/[0.07] bg-[#080C14]">
                          <span className="font-mono text-[11px] text-[#64748B]">
                            {selectedProfile.surfaceLabel}
                          </span>
                          <span className="font-mono text-[10.5px] text-[#94A3B8]">
                            {selectedProfile.label}
                          </span>
                        </div>

                        <div className="relative aspect-[16/9] bg-[#080C14] overflow-hidden border-b border-white/[0.07]">
                          <img
                            src={selectedProfile.image}
                            alt={selectedProfile.imageAlt}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        </div>

                        <dl className="divide-y divide-white/[0.07] px-5">
                          {selectedProfile.operationalSpec.map((row) => (
                            <div key={row.label} className="py-3.5 space-y-1">
                              <dt className="font-mono text-[11px] text-[#64748B]">{row.label}</dt>
                              <dd className="text-sm text-[#E2E8F0] leading-relaxed">{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    </div>
                  </motion.div>
                </div>
              </div>
            </section>
          )}

          {/* VISTA 4: SEGURIDAD Y LÍMITES OPERATIVOS */}
          {activePage === 'seguridad' && (
            <section className="px-4 sm:px-6 pt-10 sm:pt-14 pb-16">
              <div className="max-w-6xl mx-auto">
                <div className="max-w-2xl">
                  <h1 className="font-[var(--font-display)] text-3xl sm:text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC] text-balance">
                    Qué protege OMEGA y dónde fija sus límites.
                  </h1>
                  <p className="mt-3 text-sm sm:text-base text-[#94A3B8] leading-relaxed">
                    Cada garantía técnica declara su alcance exacto, sin promesas opacas ni retención oculta de archivos fuente.
                  </p>
                </div>

                <div className="mt-10 border-y border-white/[0.08]">
                  <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.08]">
                    {OPERATIONAL_GUARANTEES.map((item) => {
                      const Icon = GUARANTEE_ICONS[item.id] || ShieldCheck;
                      return (
                        <article
                          key={item.id}
                          className="py-8 md:px-7 first:md:pl-0 last:md:pr-0 flex flex-col justify-between"
                        >
                          <div>
                            <Icon className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
                            <h2 className="mt-4 text-lg font-medium tracking-[-0.02em] text-[#F8FAFC]">
                              {item.title}
                            </h2>
                            <p className="mt-2.5 text-sm text-[#94A3B8] leading-relaxed">
                              {item.whatItDoes}
                            </p>
                          </div>
                          <p className="mt-6 pt-4 border-t border-white/[0.07] font-mono text-xs text-[#94A3B8] leading-relaxed">
                            {item.boundary}
                          </p>
                        </article>
                      );
                    })}
                  </div>
                </div>

                {/* Comparativa concisa de despliegue */}
                <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
                  {DEPLOYMENT_MODES.map((dep) => (
                    <div
                      key={dep.mode}
                      className="rounded-2xl omega-surface-flat border border-white/[0.09] p-6"
                    >
                      <h3 className="text-base font-medium text-[#F8FAFC]">{dep.mode}</h3>
                      <dl className="mt-4 divide-y divide-white/[0.07] text-sm">
                        <div className="py-3">
                          <dt className="font-mono text-[11px] text-[#64748B]">Infraestructura</dt>
                          <dd className="mt-1 text-[#CBD5E1]">{dep.infra}</dd>
                        </div>
                        <div className="py-3">
                          <dt className="font-mono text-[11px] text-[#64748B]">Consumo de IA</dt>
                          <dd className="mt-1 text-[#CBD5E1]">{dep.aiCost}</dd>
                        </div>
                        <div className="pt-3">
                          <dt className="font-mono text-[11px] text-[#64748B]">Retención</dt>
                          <dd className="mt-1 text-[#CBD5E1]">{dep.retention}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>

                <div className="mt-10 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setModalMode('pilot')}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium px-5 py-2.5 transition-colors"
                  >
                    <Building2 className="w-4 h-4" strokeWidth={1.75} />
                    Configurar piloto soberano
                  </button>
                  <button
                    type="button"
                    onClick={() => navigatePage('planes')}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#0B101B] hover:bg-[#12192A] border border-white/[0.10] text-sm font-medium text-[#F8FAFC] px-5 py-2.5 transition-colors"
                  >
                    Ver planes en COP
                    <ArrowRight className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* VISTA 5: PLANES Y FAQ */}
          {activePage === 'planes' && (
            <section className="px-4 sm:px-6 pt-10 sm:pt-14 pb-16">
              <div className="max-w-6xl mx-auto">
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                  <div className="max-w-2xl">
                    <h1 className="font-[var(--font-display)] text-3xl sm:text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC] text-balance">
                      Planes y créditos en pesos colombianos.
                    </h1>
                    <p className="mt-3 text-sm text-[#94A3B8]">
                      {PROFILE_ACCESS_NOTES[pricingProfile]}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div
                      role="group"
                      aria-label="Filtrar planes por perfil"
                      className="inline-flex rounded-lg bg-[#0B101B] border border-white/[0.09] p-1"
                    >
                      {LANDING_PROFILES.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPricingProfile(p.id)}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            pricingProfile === p.id
                              ? 'bg-white/[0.10] text-[#F8FAFC]'
                              : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    <div
                      role="group"
                      aria-label="Frecuencia de facturación"
                      className="inline-flex rounded-lg bg-[#0B101B] border border-white/[0.09] p-1"
                    >
                      <button
                        type="button"
                        onClick={() => setBillingCycle('monthly')}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          billingCycle === 'monthly'
                            ? 'bg-[#2F6FED] text-white'
                            : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                        }`}
                      >
                        Mensual
                      </button>
                      <button
                        type="button"
                        onClick={() => setBillingCycle('annual')}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
                          billingCycle === 'annual'
                            ? 'bg-[#2F6FED] text-white'
                            : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                        }`}
                      >
                        Anual
                        <span className="font-mono text-[10px] opacity-90">-17%</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                  {plans.map((plan) => (
                    <article
                      key={plan.id}
                      className={`relative h-full rounded-2xl omega-surface-flat p-7 flex flex-col justify-between overflow-hidden ${
                        plan.featured
                          ? 'border border-[#2F6FED]/55'
                          : 'border border-white/[0.09]'
                      }`}
                    >
                      {plan.featured && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[#2F6FED]"
                        />
                      )}

                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <h2 className="text-lg font-medium text-[#F8FAFC]">{plan.name}</h2>
                          <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                            {plan.creditsLabel}
                          </span>
                        </div>

                        <p className="mt-2 text-sm text-[#94A3B8] leading-relaxed">{plan.tagline}</p>

                        <div className="mt-6 flex items-baseline gap-2">
                          <span className="font-[var(--font-display)] text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC] tabular-nums">
                            {plan.displayPrice}
                          </span>
                          <span className="font-mono text-xs text-[#64748B]">{plan.periodLabel}</span>
                        </div>
                        <p className="mt-1.5 text-xs text-[#64748B] tabular-nums">
                          {plan.annualSubtext}
                        </p>

                        <p className="mt-5 py-3 border-y border-white/[0.07] font-mono text-xs text-[#CBD5E1] tabular-nums">
                          {plan.seatsLabel}
                        </p>

                        <ul className="mt-5 space-y-3 text-sm text-[#CBD5E1]">
                          {plan.features.map((feature) => (
                            <li key={feature} className="flex items-start gap-2.5">
                              <Check
                                className="mt-0.5 w-4 h-4 text-[#2F6FED] shrink-0"
                                strokeWidth={1.75}
                              />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="mt-8 pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (plan.ctaAction === 'pilot') {
                              setModalMode('pilot');
                            } else {
                              navigateToApp('register');
                            }
                          }}
                          className={`w-full inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium px-4 py-2.5 transition-colors ${
                            plan.featured
                              ? 'bg-[#2F6FED] hover:bg-[#3B7BF2] text-white'
                              : 'bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.09] text-[#F8FAFC]'
                          }`}
                        >
                          {plan.ctaLabel}
                          <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                <p className="mt-7 text-center text-xs font-mono text-[#64748B]">
                  Pagos procesados de forma segura con Mercado Pago · Cancela cuando quieras · Facturación corporativa disponible
                </p>

                <div className="mt-14 max-w-3xl mx-auto">
                  <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
                    {LANDING_FAQ.map((item, idx) => {
                      const isOpen = openFaq === idx;
                      return (
                        <div key={item.q}>
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => setOpenFaq(isOpen ? -1 : idx)}
                            className="w-full py-4 flex items-center justify-between gap-4 text-left text-sm font-medium text-[#F8FAFC] hover:text-white transition-colors"
                          >
                            <span>{item.q}</span>
                            <ChevronDown
                              className={`w-4 h-4 text-[#64748B] shrink-0 transition-transform duration-200 ${
                                isOpen ? 'rotate-180 text-[#F8FAFC]' : ''
                              }`}
                              strokeWidth={1.75}
                            />
                          </button>
                          {isOpen && (
                            <p className="pb-4 text-sm text-[#94A3B8] leading-relaxed">{item.a}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          )}
        </motion.div>
      </main>

      {/* Footer corporativo compacto */}
      <footer className="border-t border-white/[0.08] px-4 sm:px-6 py-8 bg-[#05070B]">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <OmegaBrandMark compact />
            <span className="text-xs text-[#64748B]">
              © {new Date().getFullYear()} OMEGA · Zero-Retention · STIX 2.1 · YARA · SHA-256
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-5 text-xs text-[#94A3B8]">
            <button
              type="button"
              onClick={() => navigateToApp('login')}
              className="hover:text-[#F8FAFC] transition-colors"
            >
              Términos y condiciones
            </button>
            <button
              type="button"
              onClick={() => navigateToApp('login')}
              className="hover:text-[#F8FAFC] transition-colors"
            >
              Privacidad y tratamiento de datos
            </button>
            <span className="inline-flex items-center gap-1.5 text-[#64748B]">
              <Lock className="w-3.5 h-3.5" strokeWidth={1.75} />
              MFA y auditoría por espacio
            </span>
          </div>
        </div>
      </footer>

      <AnimatePresence>
        {modalMode && (
          <ActionSheetModal
            mode={modalMode}
            onClose={() => setModalMode(null)}
            onEnterApp={(intent) => {
              setModalMode(null);
              navigateToApp(intent);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
