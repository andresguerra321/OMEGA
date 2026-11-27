import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  X,
} from 'lucide-react';
import { OmegaBrandMark } from './OmegaBrandMark';
import { OmegaHeroStage } from './OmegaHeroStage';
import { SpecularCard } from './SpecularCard';
import {
  EDITORIAL_SPACES,
  LANDING_FAQ,
  LANDING_PAGES,
  OMEGA_APP_URL,
  PILOT_SUMMARY_TEXT,
  PRIVACY_BANNER_MODES,
  PRIVACY_MANIFESTO,
  PROFILE_ACCESS_NOTES,
  getPlansForProfile,
} from '../data/catalog';

const EASE_OUT = [0.22, 1, 0.36, 1];
const SPRING_KOWALSKI = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 };
const VALID_PAGE_IDS = new Set(LANDING_PAGES.map((p) => p.id));

function readPageFromHash() {
  if (typeof window === 'undefined') return 'plataforma';
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  return VALID_PAGE_IDS.has(raw) ? raw : 'plataforma';
}

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
        transition={SPRING_KOWALSKI}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl omega-glass p-6 sm:p-7"
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
            className="rounded-full p-1.5 text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/[0.06] transition-transform active:scale-[0.97]"
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
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium h-11 px-5 transition-transform active:scale-[0.97]"
            >
              Crear espacio empresarial
              <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={copyPilotSummary}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.12] text-[#F8FAFC] text-sm font-medium h-11 px-5 transition-transform active:scale-[0.97]"
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
  const grainUri =
    "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

  const [activePage, setActivePage] = useState(readPageFromHash);
  const [pricingProfile, setPricingProfile] = useState('GENERAL');
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [privacyDeployMode, setPrivacyDeployMode] = useState('cloud');
  const [openFaq, setOpenFaq] = useState(0);
  const [pilotModalOpen, setPilotModalOpen] = useState(false);

  const plans = getPlansForProfile(pricingProfile, billingCycle);
  const activePrivacyBanner =
    PRIVACY_BANNER_MODES.find((mode) => mode.id === privacyDeployMode) || PRIVACY_BANNER_MODES[0];

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

  function openProfileFromHero() {
    navigatePage('perfiles');
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
    <div className="min-h-screen w-full bg-[#05070B] text-[#F8FAFC] antialiased flex flex-col overflow-x-hidden">
      {/* Grano óptico SVG global */}
      <div
        aria-hidden="true"
        className="opacity-[0.028] mix-blend-overlay pointer-events-none fixed inset-0 z-50"
        style={{ backgroundImage: grainUri, backgroundSize: '180px 180px' }}
      />

      {/* Navbar flotante */}
      <header className="fixed top-0 inset-x-0 z-40 px-4 sm:px-6 pt-4">
        <nav
          aria-label="Navegación principal"
          className="max-w-6xl mx-auto rounded-2xl px-4 sm:px-5 h-14 flex items-center justify-between omega-glass"
        >
          <button
            type="button"
            onClick={() => navigatePage('plataforma')}
            className="rounded-xl text-left transition-transform active:scale-[0.97]"
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
                  className={`relative rounded-xl px-4 py-1.5 text-[13.5px] font-medium transition-transform active:scale-[0.97] ${
                    isCurrent ? 'text-[#F8FAFC]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                  }`}
                >
                  {isCurrent && (
                    <motion.div
                      layoutId="omega-nav-active"
                      transition={SPRING_KOWALSKI}
                      className="omega-sculpted absolute inset-0 rounded-xl"
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
              className="rounded-xl px-3.5 py-2 text-[13.5px] font-medium text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/[0.05] transition-transform active:scale-[0.97]"
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => setPilotModalOpen(true)}
              className="rounded-xl bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-[13.5px] font-medium px-4 py-2 transition-transform active:scale-[0.97]"
            >
              Solicitar piloto
            </button>
          </div>
        </nav>

        {/* Navegación móvil */}
        <div className="md:hidden max-w-6xl mx-auto mt-2 flex items-center gap-1 overflow-x-auto pb-1">
          {LANDING_PAGES.map((page) => {
            const isCurrent = activePage === page.id;
            return (
              <button
                key={page.id}
                type="button"
                aria-current={isCurrent ? 'page' : undefined}
                onClick={() => navigatePage(page.id)}
                className={`shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-medium transition-transform active:scale-[0.97] ${
                  isCurrent
                    ? 'omega-sculpted text-[#F8FAFC]'
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
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
          className="w-full"
        >
          {/* HERO MINIMALISTA ESPEJO DEL HOME DE OMEGA */}
          {activePage === 'plataforma' && (
            <OmegaHeroStage
              onStartFree={() => navigateToApp('register')}
              onViewPlans={() => navigatePage('planes')}
              onSelectProfile={openProfileFromHero}
            />
          )}

          {/* GALERÍA EDITORIAL DE 3 TARJETAS VERTICALES ESTILO APPLE */}
          {activePage === 'perfiles' && (
            <section id="perfiles" className="relative px-4 sm:px-6 pt-32 md:pt-36 pb-24 overflow-hidden">
              <div className="max-w-6xl mx-auto">
                <h1 className="text-3xl md:text-5xl font-medium tracking-[-0.03em] text-[#F8FAFC] mb-12 text-balance">
                  Un solo estándar. Tres frentes.
                </h1>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-6xl mx-auto">
                  {EDITORIAL_SPACES.map((space) => (
                    <article
                      key={space.id}
                      className="aspect-[4/5] rounded-2xl overflow-hidden relative group border border-white/[0.08] bg-[#070A10]"
                    >
                      <img
                        src={space.image}
                        alt={space.imageAlt}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
                      />
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#05070B] via-[#05070B]/70 to-transparent"
                      />
                      <div className="relative z-10 p-7 flex flex-col justify-end h-full">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-[#60A5FA]/80 mb-2">
                          {space.eyebrow}
                        </p>
                        <h2 className="text-xl md:text-2xl font-medium tracking-[-0.02em] text-[#F8FAFC] text-balance">
                          {space.title}
                        </h2>
                        <p className="text-sm text-[#94A3B8] mt-2 leading-relaxed">
                          {space.description}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* PRIVACIDAD */}
          {activePage === 'seguridad' && (
            <section id="seguridad" className="max-w-6xl mx-auto px-6 pt-32 md:pt-36 pb-28">
              {/* Bloque 1: Manifiesto Tipográfico en 3 Columnas (Cero cajas, cero iconos) */}
              <div className="max-w-2xl mb-16">
                <h2 className="text-3xl md:text-5xl font-medium tracking-[-0.035em] text-[#F8FAFC] text-balance">
                  Privacidad por arquitectura.
                </h2>
                <p className="text-base text-[#94A3B8] mt-4">
                  Sin promesas vagas ni almacenamiento oculto.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 border-t border-white/[0.08]">
                {PRIVACY_MANIFESTO.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`pt-8 md:pr-8 ${
                      idx > 0 ? 'md:pl-8 md:border-l md:border-white/[0.08]' : ''
                    }`}
                  >
                    <p className="text-2xl md:text-3xl font-medium tracking-[-0.03em] text-[#F8FAFC]">
                      {item.metric}
                    </p>
                    <h3 className="text-sm font-medium text-[#E2E8F0] mt-3">{item.title}</h3>
                    <p className="text-sm text-[#94A3B8] mt-2 leading-relaxed">{item.description}</p>
                  </div>
                ))}
              </div>

              {/* Bloque 2: Banner Editorial Panorámico (Nube vs. Modo Privado) */}
              <div className="mt-20 relative rounded-2xl overflow-hidden border border-white/[0.08] min-h-[380px] md:min-h-[420px] flex items-end bg-[#070A10]">
                <img
                  src="/media/privacy-sovereign.jpg"
                  alt="Bóveda arquitectónica de privacidad OMEGA"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#05070B]/95 via-[#05070B]/70 to-transparent"
                />

                <div className="relative z-10 p-8 md:p-12 max-w-xl">
                  <div
                    role="tablist"
                    aria-label="Modo de despliegue"
                    className="inline-flex p-1 rounded-full bg-white/[0.06] backdrop-blur-xl border border-white/[0.10] mb-8"
                  >
                    {PRIVACY_BANNER_MODES.map((mode) => {
                      const active = privacyDeployMode === mode.id;
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setPrivacyDeployMode(mode.id)}
                          className={`relative px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                            active ? 'text-[#F8FAFC]' : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="privacy-deploy-pill"
                              transition={SPRING_KOWALSKI}
                              className="absolute inset-0 rounded-full bg-white/[0.12] border border-white/[0.12]"
                            />
                          )}
                          <span className="relative z-10">{mode.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <AnimatePresence initial={false}>
                    <motion.div
                      key={activePrivacyBanner.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, ease: EASE_OUT }}
                    >
                      <h3 className="text-2xl md:text-3xl font-medium tracking-[-0.025em] text-[#F8FAFC] text-balance">
                        {activePrivacyBanner.headline}
                      </h3>
                      <p className="text-sm md:text-base text-[#94A3B8] mt-3 leading-relaxed">
                        {activePrivacyBanner.description}
                      </p>
                    </motion.div>
                  </AnimatePresence>

                  <div className="mt-7 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setPilotModalOpen(true)}
                      className="bg-[#2F6FED] hover:bg-[#3B7BF2] text-white h-11 px-6 rounded-xl text-sm font-medium active:scale-[0.97] transition-transform"
                    >
                      Solicitar piloto
                    </button>
                    <button
                      type="button"
                      onClick={() => navigatePage('planes')}
                      className="text-sm text-[#E2E8F0] hover:text-white px-3 transition-colors"
                    >
                      Ver planes →
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* PLANES SIMPLES */}
          {activePage === 'planes' && (
            <section className="relative px-4 sm:px-6 pt-32 md:pt-36 pb-20 overflow-hidden">
              <ClippedRoyalArc position="top" />

              <div className="relative z-10 max-w-6xl mx-auto">
                <div className="text-center max-w-2xl mx-auto mb-12">
                  <h1 className="text-4xl md:text-5xl font-medium tracking-[-0.03em] text-[#F8FAFC] text-balance">
                    Planes simples.
                  </h1>
                  <p className="text-base text-[#94A3B8] mt-3">
                    Empieza gratis y escala cuando tu equipo lo necesite. Precios en COP.
                  </p>

                  <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                    <div
                      role="group"
                      aria-label="Filtrar planes por perfil"
                      className="omega-debossed inline-flex rounded-full p-1"
                    >
                      {EDITORIAL_SPACES.map((p) => {
                        const active = pricingProfile === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setPricingProfile(p.id)}
                            className={`relative rounded-full px-3.5 py-1.5 text-xs font-medium transition-transform active:scale-[0.97] ${
                              active ? 'text-white' : 'text-[#94A3B8] hover:text-white'
                            }`}
                          >
                            {active && (
                              <motion.div
                                layoutId="pricing-space-pill"
                                transition={SPRING_KOWALSKI}
                                className="omega-sculpted absolute inset-0 rounded-full"
                              />
                            )}
                            <span className="relative z-10">{p.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div
                      role="group"
                      aria-label="Frecuencia de facturación"
                      className="omega-debossed inline-flex rounded-full p-1"
                    >
                      <button
                        type="button"
                        onClick={() => setBillingCycle('monthly')}
                        className={`relative rounded-full px-3.5 py-1.5 text-xs font-medium transition-transform active:scale-[0.97] ${
                          billingCycle === 'monthly'
                            ? 'text-white'
                            : 'text-[#94A3B8] hover:text-white'
                        }`}
                      >
                        {billingCycle === 'monthly' && (
                          <motion.div
                            layoutId="pricing-cycle-pill"
                            transition={SPRING_KOWALSKI}
                            className="omega-sculpted absolute inset-0 rounded-full"
                          />
                        )}
                        <span className="relative z-10">Mensual</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setBillingCycle('annual')}
                        className={`relative rounded-full px-3.5 py-1.5 text-xs font-medium transition-transform active:scale-[0.97] inline-flex items-center gap-1.5 ${
                          billingCycle === 'annual'
                            ? 'text-white'
                            : 'text-[#94A3B8] hover:text-white'
                        }`}
                      >
                        {billingCycle === 'annual' && (
                          <motion.div
                            layoutId="pricing-cycle-pill"
                            transition={SPRING_KOWALSKI}
                            className="omega-sculpted absolute inset-0 rounded-full"
                          />
                        )}
                        <span className="relative z-10">Anual</span>
                        <span className="relative z-10 text-[#60A5FA] bg-[#2F6FED]/15 px-2 py-0.5 rounded-full text-[11px] tabular-nums">
                          -17%
                        </span>
                      </button>
                    </div>
                  </div>

                  <p className="mt-3 text-xs text-[#64748B]">
                    {PROFILE_ACCESS_NOTES[pricingProfile]}
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                  {plans.map((plan) => {
                    const isFeatured = plan.featured;
                    const ctaClass =
                      plan.ctaVariant === 'primary'
                        ? 'bg-[#2F6FED] hover:bg-[#3B7BF2] text-white shadow-[0_0_24px_rgba(47,111,237,0.35)]'
                        : plan.ctaVariant === 'light'
                          ? 'bg-[#F8FAFC] text-[#05070B] hover:bg-white'
                          : 'bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.12] text-white';

                    const CardWrapper = isFeatured ? SpecularCard : 'article';
                    const cardProps = isFeatured
                      ? {
                          as: 'article',
                          className:
                            'rounded-2xl p-7 flex flex-col !bg-[#0B1222]/85 !border-[#2F6FED]/45',
                        }
                      : {
                          className:
                            'relative rounded-2xl p-7 flex flex-col omega-glass',
                        };

                    return (
                      <CardWrapper key={plan.id} {...cardProps}>
                        {isFeatured && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-[0.18]"
                            style={{
                              background:
                                'radial-gradient(ellipse 75% 85% at 50% 0%, #2F6FED 0%, rgba(47, 111, 237, 0) 75%)',
                            }}
                          />
                        )}

                        <div className="relative z-10 flex items-center justify-between gap-2">
                          <h2 className="text-lg font-medium text-white text-balance">{plan.name}</h2>
                          {plan.badge && (
                            <span className="bg-[#2F6FED]/15 text-[#60A5FA] border border-[#2F6FED]/30 text-[11px] font-medium px-2.5 py-0.5 rounded-full">
                              {plan.badge}
                            </span>
                          )}
                        </div>

                        <p className="relative z-10 mt-2 text-sm text-[#94A3B8]">
                          {plan.tagline}
                        </p>

                        <div className="relative z-10 mt-6 flex items-baseline gap-1.5">
                          <span className="text-4xl md:text-[42px] font-semibold tracking-[-0.03em] tabular-nums text-white">
                            {plan.displayPrice}
                          </span>
                          <span className="text-sm text-[#94A3B8]">{plan.unitLabel}</span>
                        </div>
                        <p className="relative z-10 mt-1.5 text-xs text-[#64748B] tabular-nums">
                          {plan.subtext}
                        </p>

                        <button
                          type="button"
                          onClick={() => {
                            if (plan.ctaAction === 'pilot') {
                              setPilotModalOpen(true);
                            } else {
                              navigateToApp('register');
                            }
                          }}
                          className={`relative z-10 mt-6 w-full h-11 rounded-xl font-medium text-sm inline-flex items-center justify-center transition-transform active:scale-[0.97] ${ctaClass}`}
                        >
                          {plan.ctaLabel}
                        </button>

                        <div className="relative z-10 my-6 border-t border-white/[0.08]" />

                        <ul className="relative z-10 space-y-3 text-sm text-[#CBD5E1]">
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
                      </CardWrapper>
                    );
                  })}
                </div>

                <p className="mt-8 text-center text-xs text-[#64748B]">
                  Pagos seguros con Mercado Pago · Cancela cuando quieras · Sin cobros sorpresa
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

      {/* Cierre Ejecutivo */}
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
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#2F6FED] hover:bg-[#3B7BF2] text-white h-11 px-6 text-sm font-medium transition-transform active:scale-[0.97]"
            >
              Comenzar gratis
              <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => setPilotModalOpen(true)}
              className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.12] text-[#F1F5F9] h-11 px-6 text-sm font-medium transition-transform active:scale-[0.97]"
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
