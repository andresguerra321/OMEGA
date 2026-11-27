import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Code2,
  Copy,
  FileCheck2,
  Lock,
  Scale,
  Shield,
  ShieldCheck,
  X,
} from 'lucide-react';
import { OmegaBrandMark } from './OmegaBrandMark';
import { OmegaProfilePreview } from './OmegaProfilePreview';
import {
  DEPLOYMENT_OPTIONS,
  HERO_DISCRETE_CONCEPTS,
  LANDING_FAQ,
  LANDING_PAGES,
  LANDING_PROFILES,
  OMEGA_APP_URL,
  OMEGA_DEMO_VIDEO,
  PILOT_SUMMARY_TEXT,
  PRIVACY_GUARANTEES,
  PROFILE_ACCESS_NOTES,
  getPlansForProfile,
} from '../data/catalog';

const EASE_OUT = [0.22, 1, 0.36, 1];
const VALID_PAGE_IDS = new Set(LANDING_PAGES.map((p) => p.id));

const PROFILE_ICONS = {
  GENERAL: Shield,
  DEVELOPER: Code2,
  LEGAL: Scale,
};

const GUARANTEE_ICONS = {
  'no-storage': ShieldCheck,
  'tamper-proof': FileCheck2,
  'deployment-choice': Lock,
};

function readPageFromHash() {
  if (typeof window === 'undefined') return 'plataforma';
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  return VALID_PAGE_IDS.has(raw) ? raw : 'plataforma';
}

/**
 * Arco luminoso azul rey muy sutil heredado del Login (sin lavar esquinas).
 */
function ClippedRoyalArc({ position = 'top' }) {
  const uid = useId().replace(/:/g, '');
  const strokeId = `omegaHorizonStroke-${uid}`;
  const isBottom = position === 'bottom';

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
    >
      <div
        className="absolute left-1/2 -translate-x-1/2 w-[min(1040px,120vw)] h-[360px]"
        style={{
          top: isBottom ? 'auto' : '-140px',
          bottom: isBottom ? '-160px' : 'auto',
          background:
            'radial-gradient(ellipse 58% 50% at 50% 50%, rgba(29, 78, 216, 0.20) 0%, rgba(47, 111, 237, 0.10) 44%, rgba(5, 7, 11, 0) 74%)',
        }}
      />
      <svg
        viewBox="0 0 1440 360"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        className={`absolute inset-x-0 w-full h-[360px] ${isBottom ? 'bottom-0 rotate-180' : 'top-0'}`}
      >
        <defs>
          <linearGradient id={strokeId} x1="280" y1="120" x2="1160" y2="120" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#2F6FED" stopOpacity="0" />
            <stop offset="30%" stopColor="#2F6FED" stopOpacity="0.32" />
            <stop offset="50%" stopColor="#93C5FD" stopOpacity="0.65" />
            <stop offset="70%" stopColor="#2F6FED" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#2F6FED" stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle
          cx="720"
          cy="660"
          r="590"
          stroke={`url(#${strokeId})`}
          strokeWidth="1.2"
        />
      </svg>
    </div>
  );
}

function PilotRequestModal({ open, onClose, onEnterApp }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  if (!open) return null;

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
        className="w-full max-w-lg rounded-2xl omega-glass p-6 sm:p-7 shadow-[0_32px_80px_rgba(0,0,0,0.85)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3
              id="landing-modal-title"
              className="text-xl font-medium tracking-[-0.025em] text-[#F8FAFC]"
            >
              Agendar demostración o piloto empresarial
            </h3>
            <p className="mt-1 text-xs text-[#94A3B8]">
              Configuración guiada para empresas, equipos de tecnología y firmas jurídicas
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

        <div className="mt-5 space-y-5">
          <p className="text-sm text-[#94A3B8] leading-relaxed">
            Activa espacios separados para tu equipo, define permisos claros y elige entre nuestra nube aislada o instalación privada dentro de tu empresa.
          </p>
          <div className="divide-y divide-white/[0.08] border-y border-white/[0.08] text-sm">
            <div className="py-3 flex items-center justify-between gap-4">
              <span className="text-[#94A3B8]">Plan Enterprise</span>
              <span className="font-mono text-[#F8FAFC] tabular-nums">$299.900 COP/mes</span>
            </div>
            <div className="py-3 flex items-center justify-between gap-4">
              <span className="text-[#94A3B8]">Capacidad inicial</span>
              <span className="font-mono text-[#F8FAFC] tabular-nums">5 puestos · 25 dispositivos · 3.000 créditos</span>
            </div>
            <div className="py-3 flex items-center justify-between gap-4">
              <span className="text-[#94A3B8]">Modalidad</span>
              <span className="text-[#F8FAFC]">Nube aislada o en tu empresa</span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={() => onEnterApp('register')}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium px-4 py-2.5 transition-colors"
            >
              Crear espacio empresarial
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
                  Copiar resumen
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export function OmegaLandingPage({ onEnterApp }) {
  const [activePage, setActivePage] = useState(readPageFromHash);
  const [activeProfile, setActiveProfile] = useState('GENERAL');
  const [pricingProfile, setPricingProfile] = useState('GENERAL');
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [openFaq, setOpenFaq] = useState(0);
  const [pilotModalOpen, setPilotModalOpen] = useState(false);

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

  function focusHeroVideo() {
    const target = document.getElementById('hero-video');
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div className="min-h-screen w-full bg-[#05070B] text-[#F8FAFC] flex flex-col overflow-x-hidden">
      {/* Navbar fija minimalista en vidrio real */}
      <header className="fixed top-0 inset-x-0 z-40 px-4 sm:px-6 pt-4">
        <nav
          aria-label="Navegación principal"
          className="max-w-6xl mx-auto rounded-2xl px-4 sm:px-5 h-14 flex items-center justify-between omega-glass shadow-[0_12px_32px_-12px_rgba(0,0,0,0.65)]"
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
                      className="absolute inset-0 rounded-lg bg-white/[0.08] border border-white/[0.09]"
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
              onClick={() => setPilotModalOpen(true)}
              className="rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-[13.5px] font-medium px-4 py-2 transition-colors"
            >
              Solicitar piloto
            </button>
          </div>
        </nav>

        {/* Navegación compacta móvil */}
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

      <main className="flex-1">
        <motion.div
          key={activePage}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: EASE_OUT }}
          className="w-full"
        >
          {/* 1. HERO CENTRADO DE UNA SOLA COLUMNA + VIDEO PROTAGONISTA */}
          {activePage === 'plataforma' && (
            <section className="relative overflow-hidden">
              <ClippedRoyalArc position="top" />

              <div className="relative z-10 max-w-4xl mx-auto text-center pt-28 md:pt-36 pb-16 px-6">
                <h1 className="text-5xl md:text-7xl font-medium tracking-[-0.04em] leading-[1.05] text-[#F8FAFC]">
                  Seguridad real.
                  <br />
                  Privacidad absoluta.
                </h1>

                <p className="max-w-xl mx-auto mt-5 text-base md:text-lg text-[#94A3B8] font-normal leading-relaxed">
                  Protege tus equipos, tu código y tus documentos confidenciales sin guardar ni exponer tus datos.
                </p>

                <div className="mt-8 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => navigateToApp('register')}
                    className="inline-flex items-center justify-center gap-2 bg-[#2F6FED] hover:bg-[#3B7BF2] text-white h-11 px-6 rounded-xl text-sm font-medium transition-colors"
                  >
                    Comenzar gratis
                    <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={focusHeroVideo}
                    className="inline-flex items-center justify-center bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.12] text-[#F1F5F9] h-11 px-6 rounded-xl text-sm font-medium transition-colors"
                  >
                    Ver demostración
                  </button>
                </div>
              </div>

              <div className="relative z-10 px-6 pb-16">
                <div
                  id="hero-video"
                  className="mt-2 max-w-5xl mx-auto rounded-2xl overflow-hidden border border-white/[0.10] bg-[#0B101B] shadow-[0_32px_90px_rgba(0,0,0,0.75)]"
                >
                  <video
                    src={OMEGA_DEMO_VIDEO.src}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                    aria-label="Demostración de la plataforma OMEGA"
                    className="block w-full aspect-video object-cover"
                  />
                </div>

                <p className="max-w-4xl mx-auto mt-10 text-center text-xs tracking-wide text-[#64748B]">
                  {HERO_DISCRETE_CONCEPTS.join('  ·  ')}
                </p>
              </div>
            </section>
          )}

          {/* 2. LOS 3 ESPACIOS DE TRABAJO (COPY RECORTADO + UI PREVIEWS NÍTIDAS HTML/TAILWIND) */}
          {activePage === 'perfiles' && (
            <section className="relative px-4 sm:px-6 pt-28 md:pt-36 pb-20 overflow-hidden">
              <ClippedRoyalArc position="top" />

              <div className="relative z-10 max-w-6xl mx-auto">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                  <h1 className="text-3xl md:text-5xl font-medium tracking-[-0.03em] text-[#F8FAFC]">
                    Tres espacios. Un solo control.
                  </h1>

                  <div
                    role="tablist"
                    aria-label="Espacios de trabajo"
                    className="inline-flex self-start md:self-auto rounded-full omega-glass p-1 shrink-0"
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

                <div className="mt-12">
                  <motion.div
                    key={selectedProfile.id}
                    id={`profile-panel-${selectedProfile.id}`}
                    role="tabpanel"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: EASE_OUT }}
                    className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center"
                  >
                    <div className="lg:col-span-5 space-y-6">
                      <div>
                        <p className="text-sm font-medium text-[#2F6FED]">{selectedProfile.domain}</p>
                        <h2 className="mt-2 text-2xl md:text-3xl font-medium tracking-[-0.025em] text-[#F8FAFC]">
                          {selectedProfile.headline}
                        </h2>
                        <p className="mt-3 text-sm md:text-base text-[#94A3B8] leading-relaxed">
                          {selectedProfile.summary}
                        </p>
                      </div>

                      <ul className="divide-y divide-white/[0.08] border-t border-white/[0.08]">
                        {selectedProfile.capabilities.map((cap) => (
                          <li key={cap} className="py-3.5 flex items-center gap-3 text-sm text-[#E2E8F0]">
                            <Check className="w-4 h-4 text-[#2F6FED] shrink-0" strokeWidth={1.75} />
                            <span>{cap}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="lg:col-span-7">
                      <OmegaProfilePreview profile={selectedProfile} />
                    </div>
                  </motion.div>
                </div>
              </div>
            </section>
          )}

          {/* 3. PRIVACIDAD Y DESPLIEGUE */}
          {activePage === 'seguridad' && (
            <section className="relative px-4 sm:px-6 pt-28 md:pt-36 pb-20 overflow-hidden">
              <ClippedRoyalArc position="top" />

              <div className="relative z-10 max-w-6xl mx-auto">
                <div className="max-w-2xl">
                  <h1 className="text-3xl sm:text-5xl font-medium tracking-[-0.03em] leading-[1.08] text-[#F8FAFC] text-balance">
                    Tu información nunca sale de tu control.
                  </h1>
                  <p className="mt-4 text-base text-[#94A3B8] leading-relaxed">
                    Diseñado desde cero para organizaciones donde la confidencialidad no es negociable.
                  </p>
                </div>

                <div className="mt-12 border-y border-white/[0.08]">
                  <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.08]">
                    {PRIVACY_GUARANTEES.map((item) => {
                      const Icon = GUARANTEE_ICONS[item.id] || ShieldCheck;
                      return (
                        <article key={item.id} className="py-8 md:px-7 first:md:pl-0 last:md:pr-0">
                          <Icon className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
                          <h2 className="mt-4 text-lg font-medium tracking-[-0.02em] text-[#F8FAFC]">
                            {item.title}
                          </h2>
                          <p className="mt-2.5 text-sm text-[#94A3B8] leading-relaxed">
                            {item.detail}
                          </p>
                        </article>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
                  {DEPLOYMENT_OPTIONS.map((option) => (
                    <div key={option.id} className="rounded-2xl omega-glass p-7">
                      <h3 className="text-lg font-medium text-[#F8FAFC]">{option.title}</h3>
                      <ul className="mt-5 space-y-3 text-sm text-[#CBD5E1]">
                        {option.points.map((point) => (
                          <li key={point} className="flex items-start gap-2.5">
                            <Check
                              className="mt-0.5 w-4 h-4 text-[#2F6FED] shrink-0"
                              strokeWidth={1.75}
                            />
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="mt-10 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setPilotModalOpen(true)}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium h-11 px-6 transition-colors"
                  >
                    <Building2 className="w-4 h-4" strokeWidth={1.75} />
                    Solicitar piloto empresarial
                  </button>
                  <button
                    type="button"
                    onClick={() => navigatePage('planes')}
                    className="inline-flex items-center gap-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.12] text-sm font-medium text-[#F1F5F9] h-11 px-6 transition-colors"
                  >
                    Ver planes
                    <ArrowRight className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* 4. PLANES Y PRECIOS EN COP */}
          {activePage === 'planes' && (
            <section className="relative px-4 sm:px-6 pt-28 md:pt-36 pb-20 overflow-hidden">
              <ClippedRoyalArc position="top" />

              <div className="relative z-10 max-w-6xl mx-auto">
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                  <div className="max-w-2xl">
                    <h1 className="text-3xl sm:text-5xl font-medium tracking-[-0.03em] leading-[1.08] text-[#F8FAFC] text-balance">
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
                      className="inline-flex rounded-lg omega-glass p-1"
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
                      className="inline-flex rounded-lg omega-glass p-1"
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
                        <span className="font-mono tabular-nums text-xs opacity-90">-17%</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                  {plans.map((plan) => (
                    <article
                      key={plan.id}
                      className={`relative h-full rounded-2xl omega-glass p-7 flex flex-col justify-between overflow-hidden ${
                        plan.featured ? '!border-[#2F6FED]/55' : ''
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
                          <span className="font-mono text-xs text-[#94A3B8] tabular-nums">
                            {plan.creditsLabel}
                          </span>
                        </div>

                        <p className="mt-2 text-xs text-[#94A3B8] leading-relaxed">
                          {plan.creditsEquivalence}
                        </p>

                        <p className="mt-3 text-sm text-[#CBD5E1] leading-relaxed">{plan.tagline}</p>

                        <div className="mt-6 flex items-baseline gap-2">
                          <span className="text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC] font-mono tabular-nums">
                            {plan.displayPrice}
                          </span>
                          <span className="font-mono text-xs text-[#64748B] tabular-nums">
                            {plan.periodLabel}
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs text-[#94A3B8] tabular-nums">
                          {plan.annualSubtext}
                        </p>

                        <p className="mt-5 py-3 border-y border-white/[0.08] font-mono text-xs text-[#CBD5E1] tabular-nums">
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
                              setPilotModalOpen(true);
                            } else {
                              navigateToApp('register');
                            }
                          }}
                          className={`w-full inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium h-11 px-4 transition-colors ${
                            plan.featured
                              ? 'bg-[#2F6FED] hover:bg-[#3B7BF2] text-white'
                              : 'bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.12] text-[#F1F5F9]'
                          }`}
                        >
                          {plan.ctaLabel}
                          <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                <p className="mt-7 text-center text-xs text-[#94A3B8]">
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

      {/* Cierre Ejecutivo con arco azul rey contenido */}
      <section className="relative border-t border-white/[0.08] px-4 sm:px-6 py-16 sm:py-20 overflow-hidden">
        <ClippedRoyalArc position="bottom" />

        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-medium tracking-[-0.03em] text-[#F8FAFC] text-balance">
            ¿Listo para proteger lo más valioso de tu operación?
          </h2>
          <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => navigateToApp('register')}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#2F6FED] hover:bg-[#3B7BF2] text-white h-11 px-6 text-sm font-medium transition-colors"
            >
              Comenzar gratis
              <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => setPilotModalOpen(true)}
              className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.12] text-[#F1F5F9] h-11 px-6 text-sm font-medium transition-colors"
            >
              Agendar demostración
            </button>
          </div>
        </div>
      </section>

      {/* Footer limpio */}
      <footer className="border-t border-white/[0.08] px-4 sm:px-6 py-8 bg-[#05070B]">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <OmegaBrandMark compact />
            <span className="text-xs text-[#64748B]">
              © {new Date().getFullYear()} OMEGA · Seguridad y Privacidad Corporativa
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
          </div>
        </div>
      </footer>

      <AnimatePresence>
        {pilotModalOpen && (
          <PilotRequestModal
            open={pilotModalOpen}
            onClose={() => setPilotModalOpen(false)}
            onEnterApp={(intent) => {
              setPilotModalOpen(false);
              navigateToApp(intent);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
