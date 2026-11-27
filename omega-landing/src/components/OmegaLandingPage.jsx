import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Code2,
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
  PROFILE_ACCESS_NOTES,
  TRUST_PILLARS,
  getPlansForProfile,
} from '../data/catalog';

/* Easing expo-out (skill animation-systems + top-design) */
const EASE_EXPO_OUT = [0.16, 1, 0.3, 1];

/* Sombras neutras multicapa (skill beautiful-shadows) */
const SHADOW_SM =
  'shadow-[0px_2px_3px_-1px_rgba(0,0,0,0.28),0px_1px_0px_0px_rgba(255,255,255,0.06),0px_0px_0px_1px_rgba(255,255,255,0.08)]';
const SHADOW_MD =
  'shadow-[0px_0px_0px_1px_rgba(255,255,255,0.06),0px_1px_1px_-0.5px_rgba(0,0,0,0.35),0px_3px_3px_-1.5px_rgba(0,0,0,0.35),0px_6px_6px_-3px_rgba(0,0,0,0.35),0px_12px_12px_-6px_rgba(0,0,0,0.4),0px_24px_24px_-12px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.12)]';
const SHADOW_LG =
  'shadow-[0_2.8px_2.2px_rgba(0,0,0,0.18),0_6.7px_5.3px_rgba(0,0,0,0.24),0_12.5px_10px_rgba(0,0,0,0.30),0_22.3px_17.9px_rgba(0,0,0,0.38),0_41.8px_33.4px_rgba(0,0,0,0.48),0_80px_70px_rgba(0,0,0,0.62),inset_0_1px_0_rgba(255,255,255,0.12)]';

const PROFILE_ICONS = {
  GENERAL: Shield,
  DEVELOPER: Code2,
  LEGAL: Scale,
};

const PILLAR_ICONS = {
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
      transition={{ duration: 0.5, delay, ease: EASE_EXPO_OUT }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Arco luminoso azul rey recortado en el horizonte superior.
 * Mantiene el negro obsidiana #05070B intacto en las esquinas.
 */
function LandingEclipseArc({ variant = 'hero' }) {
  const uid = useId().replace(/:/g, '');
  const arcGrad = `omegaLandingArc-${uid}`;
  const haloGrad = `omegaLandingHalo-${uid}`;
  const isCta = variant === 'cta';

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
    >
      <div className="omega-film-grain absolute inset-0" />
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-full"
        style={{
          top: isCta ? '-140px' : '-210px',
          width: isCta ? 'min(920px, 120vw)' : 'min(1320px, 145vw)',
          height: isCta ? '420px' : '640px',
          background:
            'radial-gradient(ellipse 62% 52% at 50% 44%, rgba(47, 111, 237, 0.28) 0%, rgba(37, 99, 235, 0.12) 42%, rgba(5, 7, 11, 0) 76%)',
        }}
      />
      <svg
        viewBox="0 0 1440 480"
        preserveAspectRatio="xMidYMin slice"
        fill="none"
        className="absolute inset-x-0 top-0 h-full w-full"
      >
        <defs>
          <linearGradient id={arcGrad} x1="200" y1="220" x2="1240" y2="220" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#2F6FED" stopOpacity="0" />
            <stop offset="22%" stopColor="#2F6FED" stopOpacity="0.48" />
            <stop offset="50%" stopColor="#93C5FD" stopOpacity="0.95" />
            <stop offset="78%" stopColor="#2F6FED" stopOpacity="0.48" />
            <stop offset="100%" stopColor="#2F6FED" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={haloGrad} cx="720" cy={isCta ? '560' : '640'} r="560" gradientUnits="userSpaceOnUse">
            <stop offset="78%" stopColor="#05070B" stopOpacity="1" />
            <stop offset="93%" stopColor="#0B1326" stopOpacity="0.94" />
            <stop offset="100%" stopColor="#2F6FED" stopOpacity="0.16" />
          </radialGradient>
        </defs>
        <circle
          cx="720"
          cy={isCta ? '690' : '740'}
          r="590"
          fill={`url(#${haloGrad})`}
          stroke={`url(#${arcGrad})`}
          strokeWidth={isCta ? '1.5' : '2'}
        />
      </svg>
    </div>
  );
}

function ActionSheetModal({ mode, onClose, onEnterApp }) {
  if (!mode) return null;
  const isDownload = mode === 'download';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="landing-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070B]/80 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.24, ease: EASE_EXPO_OUT }}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-lg rounded-2xl omega-glass-surface omega-border-gradient ${SHADOW_LG} p-6 sm:p-7`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#64748B]">
              {isDownload ? 'OMEGA DESKTOP · v2.2' : 'PILOTO CORPORATIVO & VENTAS'}
            </p>
            <h3
              id="landing-modal-title"
              className="mt-1.5 font-[var(--font-display)] text-xl font-medium tracking-[-0.02em] text-[#F8FAFC]"
            >
              {isDownload
                ? 'Instala OMEGA Desktop en tu equipo'
                : 'Activa un piloto guiado con tu equipo'}
            </h3>
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
          <div className="mt-5 space-y-4">
            <p className="text-sm text-[#94A3B8] leading-relaxed">
              Aplicación nativa en Tauri con sensor local de PC en RAM y conector USB Android/iOS.
              También puedes iniciar sesión inmediatamente en la aplicación web.
            </p>
            <div className="divide-y divide-white/[0.07] border-y border-white/[0.07]">
              <div className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Terminal className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
                  <div>
                    <p className="text-sm font-medium text-[#F8FAFC]">Windows 10 / 11 (x64)</p>
                    <p className="text-xs text-[#64748B] font-mono">Instalador MSI / NSIS + sensor local Rust</p>
                  </div>
                </div>
                <span className="rounded-full bg-[#2F6FED]/15 border border-[#2F6FED]/30 px-2.5 py-0.5 text-[11px] font-mono text-[#93C5FD]">
                  v2.2.0
                </span>
              </div>
              <div className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Smartphone className="w-4 h-4 text-[#94A3B8]" strokeWidth={1.75} />
                  <div>
                    <p className="text-sm font-medium text-[#F8FAFC]">Triaje móvil Android / iOS por USB</p>
                    <p className="text-xs text-[#64748B] font-mono">Conector portátil integrado en 1 clic</p>
                  </div>
                </div>
                <span className="text-xs text-[#94A3B8]">Incluido</span>
              </div>
            </div>
            <div className="pt-1 flex flex-col sm:flex-row gap-2.5">
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
          <div className="mt-5 space-y-4">
            <p className="text-sm text-[#94A3B8] leading-relaxed">
              Preparamos tu organización con espacios separados (General, Desarrollo o Legal),
              despliegue soberano con Ollama local y facturación corporativa.
            </p>
            <div className="divide-y divide-white/[0.07] border-y border-white/[0.07] text-sm">
              <div className="py-3 flex items-center justify-between">
                <span className="text-[#94A3B8]">Plan Enterprise base</span>
                <span className="font-mono text-[#F8FAFC] tabular-nums">$299.900 COP/mes</span>
              </div>
              <div className="py-3 flex items-center justify-between">
                <span className="text-[#94A3B8]">Capacidad inicial</span>
                <span className="font-mono text-[#F8FAFC] tabular-nums">5 puestos · 25 dispositivos · 3.000 créditos</span>
              </div>
              <div className="py-3 flex items-center justify-between">
                <span className="text-[#94A3B8]">Despliegue</span>
                <span className="text-[#F8FAFC]">Nube administrada o Soberano local</span>
              </div>
            </div>
            <div className="pt-1 flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => onEnterApp('register')}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium px-4 py-2.5 transition-colors"
              >
                Crear espacio de organización
                <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
              </button>
              <a
                href="mailto:ventas@omega-sec.local?subject=Piloto%20OMEGA%20Enterprise"
                className="inline-flex items-center justify-center rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.09] text-[#F8FAFC] text-sm font-medium px-4 py-2.5 transition-colors"
              >
                Escribir a ventas
              </a>
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
      {/* Progressive Blur óptico superior (skill progressive-blur) */}
      <div aria-hidden="true" className="omega-progressive-blur-top">
        <div />
        <div />
      </div>

      {/* 1. Navbar fija minimalista */}
      <header className="fixed top-0 inset-x-0 z-40 px-4 sm:px-6 pt-4">
        <nav
          aria-label="Navegación principal"
          className={`max-w-6xl mx-auto rounded-2xl px-4 sm:px-5 h-14 flex items-center justify-between transition-all duration-300 ${
            scrolled
              ? `omega-glass-surface border border-white/[0.09] ${SHADOW_MD}`
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
              className="rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-[13.5px] font-medium px-4 py-2 transition-colors shadow-[0_0_24px_rgba(47,111,237,0.28)]"
            >
              Solicitar piloto
            </button>
          </div>
        </nav>
      </header>

      <main>
        {/* 2. Hero cinematográfico */}
        <section id="plataforma" className="relative pt-32 sm:pt-36 pb-20 sm:pb-28 px-4 sm:px-6 overflow-hidden">
          <LandingEclipseArc variant="hero" />

          <div className="relative z-10 max-w-6xl mx-auto">
            <div className="max-w-3xl mx-auto text-center">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: EASE_EXPO_OUT }}
                className={`inline-flex items-center gap-2 rounded-full bg-[#0B101B]/80 border border-white/[0.09] px-3.5 py-1.5 text-[11.5px] font-mono text-[#94A3B8] ${SHADOW_SM}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#2F6FED]" aria-hidden="true" />
                OMEGA v2.2 · Zero-Retention &amp; Soberanía de Datos
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.06, ease: EASE_EXPO_OUT }}
                className="mt-6 font-[var(--font-display)] text-4xl sm:text-5xl md:text-6xl font-medium tracking-[-0.03em] leading-[1.06] text-[#F8FAFC]"
              >
                Inteligencia forense, AppSec y análisis documental sin exponer tus datos.
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.12, ease: EASE_EXPO_OUT }}
                className="mt-5 text-base sm:text-lg text-[#94A3B8] max-w-2xl mx-auto leading-relaxed"
              >
                Auditoría volátil en RAM para equipos y móviles, seguridad de repositorios y expedientes confidenciales con IA citada en una sola plataforma nativa.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.18, ease: EASE_EXPO_OUT }}
                className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
              >
                <button
                  type="button"
                  onClick={() => navigateToApp('register')}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium px-6 py-3 transition-all duration-150 hover:-translate-y-0.5 shadow-[0_0_28px_rgba(47,111,237,0.34)]"
                >
                  Comenzar gratis
                  <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => scrollToSection('showcase')}
                  className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg omega-glass-surface hover:bg-[#141923]/90 border border-white/[0.09] text-[#F8FAFC] text-sm font-medium px-6 py-3 transition-all duration-150 hover:-translate-y-0.5 ${SHADOW_SM}`}
                >
                  <Play className="w-3.5 h-3.5 text-[#2F6FED]" strokeWidth={1.75} />
                  Ver demostración
                </button>
              </motion.div>
            </div>

            {/* Product Showcase real con borde gradiente especular + sombra multicapa */}
            <motion.div
              id="showcase"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.24, ease: EASE_EXPO_OUT }}
              className="relative mt-14 sm:mt-16 max-w-5xl mx-auto"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-x-10 -top-12 h-48 rounded-full blur-3xl opacity-75"
                style={{
                  background:
                    'radial-gradient(ellipse at 50% 50%, rgba(47, 111, 237, 0.26) 0%, rgba(5, 7, 11, 0) 72%)',
                }}
              />

              <div
                className={`relative rounded-2xl omega-glass-surface omega-border-gradient ${SHADOW_LG} overflow-hidden`}
              >
                <div className="h-10 px-4 flex items-center justify-between border-b border-white/[0.07] bg-[#080C15]/85">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.14]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.14]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.14]" />
                    <span className="ml-2 font-mono text-[11px] text-[#64748B]">
                      omega-desktop · cabina-seguridad-v2.2
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

        {/* 3. Banda de credenciales técnicas (4 métricas con hairline) */}
        <section aria-label="Credenciales técnicas" className="px-4 sm:px-6 py-4">
          <Reveal className="max-w-6xl mx-auto border-y border-white/[0.08]">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.08]">
              {LANDING_METRICS.map((metric) => (
                <div key={metric.value} className="px-6 py-7">
                  <p className="font-mono text-[10.5px] tracking-[0.16em] text-[#64748B]">
                    {metric.code}
                  </p>
                  <p className="mt-2 font-mono text-xl font-medium tracking-[-0.02em] text-[#F8FAFC] tabular-nums">
                    {metric.value}
                  </p>
                  <p className="mt-1.5 text-sm font-medium text-[#CBD5E1]">{metric.label}</p>
                  <p className="mt-1.5 text-xs text-[#64748B] leading-relaxed">{metric.detail}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* 4. Sección de Perfiles (Tabs interactivos estilo Aovix) */}
        <section id="perfiles" className="px-4 sm:px-6 py-24 sm:py-28">
          <div className="max-w-6xl mx-auto">
            <Reveal className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="max-w-2xl">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#64748B]">
                  ESPACIOS ESPECIALIZADOS
                </p>
                <h2 className="mt-2.5 font-[var(--font-display)] text-3xl sm:text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC]">
                  Una sola plataforma. Tres espacios de trabajo especializados.
                </h2>
              </div>

              <div
                role="tablist"
                aria-label="Perfiles de espacio de trabajo"
                className={`inline-flex self-start md:self-auto rounded-full bg-[#0B101B]/85 border border-white/[0.09] p-1 ${SHADOW_SM}`}
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
                          transition={{ duration: 0.24, ease: EASE_EXPO_OUT }}
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
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: EASE_EXPO_OUT }}
                className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center"
              >
                <div className="lg:col-span-6 space-y-6">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.14em] text-[#2F6FED]">
                      {selectedProfile.badge}
                    </p>
                    <h3 className="mt-2 font-[var(--font-display)] text-2xl sm:text-3xl font-medium tracking-[-0.025em] text-[#F8FAFC]">
                      {selectedProfile.headline}
                    </h3>
                    <p className="mt-3 text-sm sm:text-base text-[#94A3B8] leading-relaxed">
                      {selectedProfile.summary}
                    </p>
                  </div>

                  <div className="divide-y divide-white/[0.07] border-t border-white/[0.07]">
                    {selectedProfile.capabilities.map((cap) => (
                      <div key={cap.title} className="py-4 flex items-start gap-3.5">
                        <span className="mt-0.5 rounded-full bg-[#2F6FED]/15 text-[#2F6FED] p-1 shrink-0">
                          <Check className="w-3.5 h-3.5" strokeWidth={2} />
                        </span>
                        <div>
                          <h4 className="text-sm font-medium text-[#F8FAFC]">{cap.title}</h4>
                          <p className="mt-1 text-sm text-[#94A3B8] leading-relaxed">{cap.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-6">
                  <div
                    className={`rounded-2xl omega-glass-surface border border-white/[0.09] ${SHADOW_MD} overflow-hidden`}
                  >
                    <div className="relative aspect-[16/10] bg-[#080C15] overflow-hidden border-b border-white/[0.07]">
                      <img
                        src={selectedProfile.image}
                        alt={selectedProfile.imageAlt}
                        loading="lazy"
                        className="h-full w-full object-cover opacity-90"
                      />
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 bg-gradient-to-t from-[#0B101B] via-transparent to-transparent"
                      />
                      <div className="absolute bottom-4 left-5 right-5">
                        <p className="font-mono text-[10.5px] tracking-[0.14em] text-[#93C5FD]">
                          {selectedProfile.previewTag}
                        </p>
                        <p className="mt-0.5 text-base font-medium text-[#F8FAFC]">
                          {selectedProfile.previewTitle}
                        </p>
                      </div>
                    </div>

                    <div className="divide-y divide-white/[0.06] px-5">
                      {selectedProfile.previewStats.map((stat) => (
                        <div
                          key={stat.k}
                          className="py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-sm"
                        >
                          <span className="font-mono text-xs text-[#64748B]">{stat.k}</span>
                          <span className="text-[#E2E8F0]">{stat.v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* 5. Arquitectura de Confianza (3 pilares en Bento limpio) */}
        <section id="seguridad" className="px-4 sm:px-6 py-24 sm:py-28 border-t border-white/[0.06]">
          <div className="max-w-6xl mx-auto">
            <Reveal className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#64748B]">
                ARQUITECTURA DE CONFIANZA
              </p>
              <h2 className="mt-2.5 font-[var(--font-display)] text-3xl sm:text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC]">
                Diseñada para secretos corporativos y evidencia sensible.
              </h2>
            </Reveal>

            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
              {TRUST_PILLARS.map((pillar, idx) => {
                const Icon = PILLAR_ICONS[pillar.id] || ShieldCheck;
                return (
                  <Reveal key={pillar.id} delay={idx * 0.06}>
                    <article
                      className={`h-full rounded-2xl omega-glass-surface border border-white/[0.09] ${SHADOW_MD} p-7 flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[11px] tracking-[0.14em] text-[#64748B]">
                            {pillar.eyebrow}
                          </span>
                          <Icon className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
                        </div>
                        <h3 className="mt-5 text-lg font-medium tracking-[-0.02em] text-[#F8FAFC]">
                          {pillar.title}
                        </h3>
                        <p className="mt-2.5 text-sm text-[#94A3B8] leading-relaxed">
                          {pillar.description}
                        </p>
                      </div>
                      <p className="mt-6 pt-4 border-t border-white/[0.07] font-mono text-xs text-[#93C5FD]">
                        {pillar.meta}
                      </p>
                    </article>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* 6. Planes y Suscripciones (Inspiración Avenna — Conversión B2B) */}
        <section id="planes" className="px-4 sm:px-6 py-24 sm:py-28 border-t border-white/[0.06]">
          <div className="max-w-6xl mx-auto">
            <Reveal className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
              <div className="max-w-2xl">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#64748B]">
                  PLANES Y CRÉDITOS EN COP
                </p>
                <h2 className="mt-2.5 font-[var(--font-display)] text-3xl sm:text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC]">
                  Precios transparentes para personas, equipos y despachos.
                </h2>
                <p className="mt-3 text-sm text-[#94A3B8]">
                  {PROFILE_ACCESS_NOTES[pricingProfile]}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div
                  role="group"
                  aria-label="Filtrar planes por perfil"
                  className={`inline-flex rounded-lg bg-[#0B101B]/85 border border-white/[0.09] p-1 ${SHADOW_SM}`}
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
                  className={`inline-flex rounded-lg bg-[#0B101B]/85 border border-white/[0.09] p-1 ${SHADOW_SM}`}
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
                <Reveal key={plan.id} delay={idx * 0.06} className="h-full">
                  <article
                    className={`relative h-full rounded-2xl omega-glass-surface p-7 flex flex-col justify-between overflow-hidden transition-transform duration-200 hover:-translate-y-0.5 ${
                      plan.featured
                        ? `omega-border-gradient-pro ${SHADOW_MD}`
                        : `border border-white/[0.09] ${SHADOW_MD}`
                    }`}
                  >
                    {plan.featured && (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#2F6FED] to-transparent"
                      />
                    )}

                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-lg font-medium text-[#F8FAFC]">{plan.name}</h3>
                        {plan.badge && (
                          <span className="rounded-full bg-[#2F6FED]/15 border border-[#2F6FED]/40 px-2.5 py-0.5 font-mono text-[11px] text-[#93C5FD]">
                            {plan.badge}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-[#94A3B8] min-h-[2.5rem]">{plan.tagline}</p>

                      <div className="mt-6 pb-6 border-b border-white/[0.08]">
                        <div className="flex items-baseline gap-2">
                          <span className="font-[var(--font-display)] text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC] tabular-nums">
                            {plan.displayPrice}
                          </span>
                          <span className="text-xs font-mono text-[#64748B]">{plan.periodLabel}</span>
                        </div>
                        <p className="mt-2 text-xs text-[#94A3B8] tabular-nums">{plan.annualSubtext}</p>
                        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-[#CBD5E1] tabular-nums">
                          <span>{plan.creditsLabel}</span>
                          <span className="text-[#64748B]">·</span>
                          <span>{plan.seatsLabel}</span>
                        </div>
                      </div>

                      <ul className="mt-6 space-y-3">
                        {plan.features.map((feat) => (
                          <li key={feat} className="flex items-start gap-2.5 text-sm text-[#CBD5E1]">
                            <Check
                              className="w-4 h-4 text-[#2F6FED] shrink-0 mt-0.5"
                              strokeWidth={1.75}
                            />
                            <span>{feat}</span>
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
                        className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors inline-flex items-center justify-center gap-2 ${
                          plan.featured
                            ? 'bg-[#2F6FED] hover:bg-[#3B7BF2] text-white shadow-[0_0_24px_rgba(47,111,237,0.28)]'
                            : 'bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.09] text-[#F8FAFC]'
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

            <p className="mt-8 text-center text-xs font-mono text-[#64748B]">
              Pagos procesados de forma segura con Mercado Pago · Cancela cuando quieras · Facturación corporativa disponible · Recarga opcional de 200 créditos por $29.900 COP
            </p>

            {/* Preguntas clave de objeción B2B (skill pricing-page & landing-page) */}
            <Reveal className="mt-16 max-w-3xl mx-auto">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#64748B]">
                PREGUNTAS FRECUENTES
              </p>
              <div className="mt-4 divide-y divide-white/[0.08] border-y border-white/[0.08]">
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
                            isOpen ? 'rotate-180 text-[#2F6FED]' : ''
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

        {/* 7. CTA Final */}
        <section className="px-4 sm:px-6 py-20 sm:py-24">
          <Reveal className="max-w-6xl mx-auto">
            <div
              className={`relative rounded-2xl omega-glass-surface omega-border-gradient ${SHADOW_LG} px-6 sm:px-12 py-16 sm:py-20 text-center overflow-hidden`}
            >
              <LandingEclipseArc variant="cta" />
              <div className="relative z-10 max-w-2xl mx-auto">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#93C5FD]">
                  LISTO PARA PRODUCCIÓN Y PILOTOS
                </p>
                <h2 className="mt-3 font-[var(--font-display)] text-3xl sm:text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC]">
                  Lleva seguridad de grado forense a tu equipo.
                </h2>
                <p className="mt-4 text-sm sm:text-base text-[#94A3B8]">
                  Comienza gratis en tu equipo o coordina un piloto guiado con despliegue soberano local para tu organización.
                </p>
                <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setModalMode('download')}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium px-6 py-3 transition-all duration-150 hover:-translate-y-0.5 shadow-[0_0_28px_rgba(47,111,237,0.32)]"
                  >
                    <Download className="w-4 h-4" strokeWidth={1.75} />
                    Descargar OMEGA Desktop
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalMode('pilot')}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.10] text-[#F8FAFC] text-sm font-medium px-6 py-3 transition-all duration-150 hover:-translate-y-0.5"
                  >
                    <Building2 className="w-4 h-4 text-[#94A3B8]" strokeWidth={1.75} />
                    Agendar demo
                  </button>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      {/* Footer corporativo sobrio */}
      <footer className="border-t border-white/[0.08] px-4 sm:px-6 py-14">
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          <div className="space-y-3">
            <OmegaBrandMark />
            <p className="text-xs text-[#64748B] leading-relaxed max-w-xs">
              Plataforma defensiva de análisis forense en RAM, AppSec y revisión documental con soberanía de datos.
            </p>
          </div>

          <div>
            <h4 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#64748B]">Producto</h4>
            <ul className="mt-3 space-y-2.5 text-sm text-[#94A3B8]">
              <li>
                <a href="#plataforma" onClick={(e) => { e.preventDefault(); scrollToSection('plataforma'); }} className="hover:text-[#F8FAFC] transition-colors">
                  Plataforma
                </a>
              </li>
              <li>
                <a href="#perfiles" onClick={(e) => { e.preventDefault(); scrollToSection('perfiles'); }} className="hover:text-[#F8FAFC] transition-colors">
                  Perfiles de trabajo
                </a>
              </li>
              <li>
                <a href="#planes" onClick={(e) => { e.preventDefault(); scrollToSection('planes'); }} className="hover:text-[#F8FAFC] transition-colors">
                  Planes y créditos
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#64748B]">Seguridad</h4>
            <ul className="mt-3 space-y-2.5 text-sm text-[#94A3B8]">
              <li>
                <a href="#seguridad" onClick={(e) => { e.preventDefault(); scrollToSection('seguridad'); }} className="hover:text-[#F8FAFC] transition-colors">
                  Zero-Retention en RAM
                </a>
              </li>
              <li>
                <button type="button" onClick={() => setModalMode('download')} className="hover:text-[#F8FAFC] transition-colors">
                  OMEGA Desktop
                </button>
              </li>
              <li>
                <button type="button" onClick={() => setModalMode('pilot')} className="hover:text-[#F8FAFC] transition-colors">
                  Modo Soberano Local
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#64748B]">Legal</h4>
            <ul className="mt-3 space-y-2.5 text-sm text-[#94A3B8]">
              <li>
                <button type="button" onClick={() => navigateToApp('login')} className="hover:text-[#F8FAFC] transition-colors">
                  Términos y condiciones
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigateToApp('login')} className="hover:text-[#F8FAFC] transition-colors">
                  Privacidad y tratamiento de datos
                </button>
              </li>
              <li className="inline-flex items-center gap-1.5 text-xs font-mono text-[#64748B] pt-1">
                <Lock className="w-3.5 h-3.5" strokeWidth={1.75} />
                Aislamiento multi-tenant verificado
              </li>
            </ul>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-12 pt-6 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono text-[#64748B]">
          <span>© {new Date().getFullYear()} OMEGA. Todos los derechos reservados.</span>
          <span>v2.2 · Zero-Retention &amp; Soberanía de Datos</span>
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

export default OmegaLandingPage;
