import { useEffect, useId, useRef, useState } from 'react';
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
  FileCheck2,
  Lock,
  Pause,
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
import {
  LANDING_FAQ,
  LANDING_METRICS,
  LANDING_PROFILES,
  OMEGA_APP_URL,
  OPERATIONAL_GUARANTEES,
  PILOT_SUMMARY_TEXT,
  PROFILE_ACCESS_NOTES,
  getPlansForProfile,
} from '../data/catalog';

const EASE_OUT = [0.22, 1, 0.36, 1];

/* Sombras neutras con desplazamiento real (sin halos de color con offset 0) */
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

function Reveal({ children, className = '', delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.48, delay, ease: EASE_OUT }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Horizonte azul rey recortado únicamente en el Hero.
 * Mantiene el negro obsidiana #05070B intacto en esquinas y resto del documento.
 */
function HeroHorizonArc() {
  const uid = useId().replace(/:/g, '');
  const strokeId = `omegaArcStroke-${uid}`;
  const fillId = `omegaArcFill-${uid}`;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-[520px] overflow-hidden select-none"
    >
      <div
        className="absolute left-1/2 -translate-x-1/2 -top-40 h-[360px] w-[min(980px,115vw)]"
        style={{
          background:
            'radial-gradient(ellipse 58% 50% at 50% 42%, rgba(47, 111, 237, 0.16) 0%, rgba(37, 99, 235, 0.05) 48%, rgba(5, 7, 11, 0) 76%)',
        }}
      />
      <svg
        viewBox="0 0 1440 420"
        preserveAspectRatio="xMidYMin slice"
        fill="none"
        className="absolute inset-x-0 top-0 h-full w-full"
      >
        <defs>
          <linearGradient id={strokeId} x1="260" y1="160" x2="1180" y2="160" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#2F6FED" stopOpacity="0" />
            <stop offset="28%" stopColor="#2F6FED" stopOpacity="0.42" />
            <stop offset="50%" stopColor="#93C5FD" stopOpacity="0.82" />
            <stop offset="72%" stopColor="#2F6FED" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#2F6FED" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={fillId} cx="720" cy="640" r="560" gradientUnits="userSpaceOnUse">
            <stop offset="84%" stopColor="#05070B" stopOpacity="1" />
            <stop offset="96%" stopColor="#091122" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#2F6FED" stopOpacity="0.08" />
          </radialGradient>
        </defs>
        <circle
          cx="720"
          cy="710"
          r="590"
          fill={`url(#${fillId})`}
          stroke={`url(#${strokeId})`}
          strokeWidth="1.25"
        />
      </svg>
    </div>
  );
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
  const videoRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [activeProfile, setActiveProfile] = useState('GENERAL');
  const [pricingProfile, setPricingProfile] = useState('GENERAL');
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [videoPlaying, setVideoPlaying] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [modalMode, setModalMode] = useState(null);

  const selectedProfile =
    LANDING_PROFILES.find((item) => item.id === activeProfile) || LANDING_PROFILES[0];
  const plans = getPlansForProfile(pricingProfile, billingCycle);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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

  function scrollToSection(sectionId) {
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggleVideoPlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setVideoPlaying(true);
    } else {
      video.pause();
      setVideoPlaying(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full bg-[#05070B] text-[#F8FAFC] overflow-x-hidden">
      {/* 1. Navbar fija minimalista */}
      <header className="fixed top-0 inset-x-0 z-40 px-4 sm:px-6 pt-4">
        <nav
          aria-label="Navegación principal"
          className={`max-w-6xl mx-auto rounded-2xl px-4 sm:px-5 h-14 flex items-center justify-between transition-all duration-300 ${
            scrolled
              ? `omega-surface border border-white/[0.09] ${ELEVATION_NAV}`
              : 'bg-transparent border border-transparent'
          }`}
        >
          <a
            href="#plataforma"
            onClick={(e) => {
              e.preventDefault();
              scrollToSection('plataforma');
            }}
            className="rounded-lg"
          >
            <OmegaBrandMark />
          </a>

          <div className="hidden md:flex items-center gap-7 text-[13.5px] text-[#94A3B8]">
            {[
              { id: 'plataforma', label: 'Plataforma' },
              { id: 'perfiles', label: 'Perfiles' },
              { id: 'seguridad', label: 'Seguridad' },
              { id: 'planes', label: 'Planes' },
            ].map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection(item.id);
                }}
                className="hover:text-[#F8FAFC] transition-colors"
              >
                {item.label}
              </a>
            ))}
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
      </header>

      <main>
        {/* 2. Hero cinematográfico sobrio */}
        <section id="plataforma" className="relative pt-32 sm:pt-36 pb-20 sm:pb-24 px-4 sm:px-6 overflow-hidden">
          <HeroHorizonArc />

          <div className="relative z-10 max-w-6xl mx-auto">
            <div className="max-w-3xl mx-auto text-center">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.42, ease: EASE_OUT }}
                className="inline-flex items-center gap-2 rounded-full bg-[#0B101B] border border-white/[0.09] px-3.5 py-1.5 text-[11.5px] font-mono text-[#94A3B8]"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#2F6FED]" aria-hidden="true" />
                OMEGA v2.2 · Zero-Retention &amp; Soberanía de Datos
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05, ease: EASE_OUT }}
                className="mt-6 font-[var(--font-display)] text-4xl sm:text-5xl md:text-6xl font-medium tracking-[-0.03em] leading-[1.06] text-[#F8FAFC] text-balance"
              >
                Inteligencia forense, AppSec y análisis documental sin exponer tus datos.
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1, ease: EASE_OUT }}
                className="mt-5 text-base sm:text-lg text-[#94A3B8] max-w-2xl mx-auto leading-relaxed"
              >
                Inspección volátil en RAM para equipos y teléfonos por USB, auditoría de repositorios y expedientes confidenciales con citas verificables en una sola aplicación nativa.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15, ease: EASE_OUT }}
                className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
              >
                <button
                  type="button"
                  onClick={() => navigateToApp('register')}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium px-6 py-3 transition-colors"
                >
                  Comenzar gratis
                  <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => scrollToSection('showcase')}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-[#0B101B] hover:bg-[#12192A] border border-white/[0.10] text-[#F8FAFC] text-sm font-medium px-6 py-3 transition-colors"
                >
                  <Play className="w-3.5 h-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                  Ver demostración
                </button>
              </motion.div>
            </div>

            {/* Product Showcase real dentro de marco de escritorio sobrio */}
            <motion.div
              id="showcase"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.2, ease: EASE_OUT }}
              className="relative mt-14 sm:mt-16 max-w-5xl mx-auto"
            >
              <div
                className={`relative rounded-2xl bg-[#0B101B] border border-white/[0.10] ${ELEVATION_FRAME} overflow-hidden`}
              >
                <div className="h-10 px-4 flex items-center justify-between border-b border-white/[0.08] bg-[#080C14]">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.14]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.14]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.14]" />
                    <span className="ml-2 font-mono text-[11px] text-[#64748B]">
                      omega-desktop · cabina-v2.2
                    </span>
                  </div>
                  {!videoError && (
                    <button
                      type="button"
                      onClick={toggleVideoPlayback}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-mono text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/[0.06] transition-colors"
                    >
                      {videoPlaying ? (
                        <>
                          <Pause className="w-3 h-3" strokeWidth={1.75} />
                          Pausar
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3" strokeWidth={1.75} />
                          Reproducir
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="relative aspect-[16/9] bg-[#05070B]">
                  {videoError ? (
                    <img
                      src="/landing/omega-v2-0-1-showcase.jpg"
                      alt="Demostración de la interfaz de OMEGA"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <video
                      ref={videoRef}
                      src="/landing/omega-master-silent.mp4"
                      poster="/landing/omega-v2-0-1-showcase.jpg"
                      autoPlay
                      loop
                      muted
                      playsInline
                      preload="metadata"
                      onError={() => setVideoError(true)}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* 3. Banda de credenciales técnicas (4 métricas con líneas hairline) */}
        <section aria-label="Credenciales técnicas" className="px-4 sm:px-6 py-4">
          <Reveal className="max-w-6xl mx-auto border-y border-white/[0.08]">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.08]">
              {LANDING_METRICS.map((metric) => (
                <div key={metric.value} className="px-6 py-7">
                  <p className="font-mono text-xl font-medium tracking-[-0.02em] text-[#F8FAFC] tabular-nums">
                    {metric.value}
                  </p>
                  <p className="mt-1.5 text-sm font-medium text-[#CBD5E1]">{metric.label}</p>
                  <p className="mt-1.5 text-xs text-[#64748B] leading-relaxed">{metric.detail}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* 4. Sección de Perfiles (Tabs interactivos con ficha operativa real) */}
        <section id="perfiles" className="px-4 sm:px-6 py-24 sm:py-28">
          <div className="max-w-6xl mx-auto">
            <Reveal className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="max-w-2xl">
                <h2 className="font-[var(--font-display)] text-3xl sm:text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC] text-balance">
                  Una sola plataforma. Tres espacios de trabajo especializados.
                </h2>
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
            </Reveal>

            <div className="mt-12">
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
                    <h3 className="mt-2 font-[var(--font-display)] text-2xl sm:text-3xl font-medium tracking-[-0.025em] text-[#F8FAFC]">
                      {selectedProfile.headline}
                    </h3>
                    <p className="mt-3 text-sm sm:text-base text-[#94A3B8] leading-relaxed">
                      {selectedProfile.summary}
                    </p>
                  </div>

                  <div className="divide-y divide-white/[0.07] border-t border-white/[0.07]">
                    {selectedProfile.capabilities.map((cap) => (
                      <div key={cap.title} className="py-4 flex items-start gap-3">
                        <Check className="mt-0.5 w-4 h-4 text-[#2F6FED] shrink-0" strokeWidth={1.75} />
                        <div>
                          <h4 className="text-sm font-medium text-[#F8FAFC]">{cap.title}</h4>
                          <p className="mt-1 text-sm text-[#94A3B8] leading-relaxed">{cap.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Ficha técnica operativa + vista real del producto */}
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

        {/* 5. Garantías y límites operativos (grid arquitectónico hairline, sin tarjetas genéricas) */}
        <section id="seguridad" className="px-4 sm:px-6 py-24 sm:py-28 border-t border-white/[0.07]">
          <div className="max-w-6xl mx-auto">
            <Reveal className="max-w-2xl">
              <h2 className="font-[var(--font-display)] text-3xl sm:text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC] text-balance">
                Qué protege OMEGA y dónde fija sus límites.
              </h2>
              <p className="mt-3 text-sm sm:text-base text-[#94A3B8] leading-relaxed">
                Cada garantía técnica viene acompañada de su alcance exacto, sin promesas opacas ni retención oculta.
              </p>
            </Reveal>

            <Reveal className="mt-12 border-y border-white/[0.08]">
              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.08]">
                {OPERATIONAL_GUARANTEES.map((item) => {
                  const Icon = GUARANTEE_ICONS[item.id] || ShieldCheck;
                  return (
                    <article key={item.id} className="py-8 md:px-7 first:md:pl-0 last:md:pr-0 flex flex-col justify-between">
                      <div>
                        <Icon className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
                        <h3 className="mt-4 text-lg font-medium tracking-[-0.02em] text-[#F8FAFC]">
                          {item.title}
                        </h3>
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
            </Reveal>
          </div>
        </section>

        {/* 6. Planes y Suscripciones en COP */}
        <section id="planes" className="px-4 sm:px-6 py-24 sm:py-28 border-t border-white/[0.07]">
          <div className="max-w-6xl mx-auto">
            <Reveal className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
              <div className="max-w-2xl">
                <h2 className="font-[var(--font-display)] text-3xl sm:text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC] text-balance">
                  Planes y créditos en pesos colombianos.
                </h2>
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
            </Reveal>

            <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
              {plans.map((plan, idx) => (
                <Reveal key={plan.id} delay={idx * 0.05} className="h-full">
                  <article
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
                        <h3 className="text-lg font-medium text-[#F8FAFC]">{plan.name}</h3>
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
                </Reveal>
              ))}
            </div>

            <p className="mt-7 text-center text-xs font-mono text-[#64748B]">
              Pagos procesados de forma segura con Mercado Pago · Cancela cuando quieras · Facturación corporativa disponible
            </p>

            {/* Preguntas operativas frecuentes */}
            <Reveal className="mt-16 max-w-3xl mx-auto">
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
            </Reveal>
          </div>
        </section>

        {/* 7. CTA Final sobrio */}
        <section className="px-4 sm:px-6 py-24 sm:py-28 border-t border-white/[0.07]">
          <Reveal className="max-w-3xl mx-auto text-center">
            <h2 className="font-[var(--font-display)] text-3xl sm:text-5xl font-medium tracking-[-0.03em] text-[#F8FAFC] text-balance">
              Lleva seguridad de grado forense a tu equipo.
            </h2>
            <p className="mt-4 text-base text-[#94A3B8] max-w-xl mx-auto leading-relaxed">
              Evalúa OMEGA en tu equipo con 30 créditos de bienvenida o configura un piloto Enterprise con despliegue soberano local.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setModalMode('download')}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium px-6 py-3 transition-colors"
              >
                <Download className="w-4 h-4" strokeWidth={1.75} />
                Descargar OMEGA Desktop
              </button>
              <button
                type="button"
                onClick={() => setModalMode('pilot')}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-[#0B101B] hover:bg-[#12192A] border border-white/[0.10] text-[#F8FAFC] text-sm font-medium px-6 py-3 transition-colors"
              >
                <Building2 className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
                Solicitar piloto
              </button>
            </div>
          </Reveal>
        </section>
      </main>

      {/* Footer corporativo */}
      <footer className="border-t border-white/[0.08] px-4 sm:px-6 py-14 bg-[#05070B]">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="space-y-3">
            <OmegaBrandMark />
            <p className="text-xs text-[#64748B] leading-relaxed">
              Plataforma de inspección preventiva en RAM, seguridad AppSec y gestión confidencial de expedientes jurídicos.
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-[#F8FAFC]">Producto</p>
            <ul className="mt-3 space-y-2 text-xs text-[#94A3B8]">
              <li>
                <a href="#plataforma" className="hover:text-[#F8FAFC] transition-colors">
                  Plataforma
                </a>
              </li>
              <li>
                <a href="#perfiles" className="hover:text-[#F8FAFC] transition-colors">
                  Perfiles General, Desarrollo y Legal
                </a>
              </li>
              <li>
                <a href="#planes" className="hover:text-[#F8FAFC] transition-colors">
                  Planes y créditos
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium text-[#F8FAFC]">Seguridad</p>
            <ul className="mt-3 space-y-2 text-xs text-[#94A3B8]">
              <li>
                <a href="#seguridad" className="hover:text-[#F8FAFC] transition-colors">
                  Política Zero-Retention en RAM
                </a>
              </li>
              <li>
                <a href="#seguridad" className="hover:text-[#F8FAFC] transition-colors">
                  Integridad SHA-256
                </a>
              </li>
              <li>
                <a href="#seguridad" className="hover:text-[#F8FAFC] transition-colors">
                  Modo Soberano Local (Ollama)
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium text-[#F8FAFC]">Legal</p>
            <ul className="mt-3 space-y-2 text-xs text-[#94A3B8]">
              <li>
                <button
                  type="button"
                  onClick={() => navigateToApp('login')}
                  className="hover:text-[#F8FAFC] transition-colors"
                >
                  Términos y condiciones
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => navigateToApp('login')}
                  className="hover:text-[#F8FAFC] transition-colors"
                >
                  Privacidad y tratamiento de datos
                </button>
              </li>
              <li className="inline-flex items-center gap-1.5 text-[#64748B]">
                <Lock className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>MFA y auditoría por espacio</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-12 pt-6 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#64748B]">
          <span>© {new Date().getFullYear()} OMEGA. Todos los derechos reservados.</span>
          <span className="font-mono">Zero-Retention · STIX 2.1 · YARA · SHA-256</span>
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
