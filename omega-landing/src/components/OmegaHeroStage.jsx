import { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const ENTRANCE_TRANSITION = { duration: 0.5, ease: [0.22, 1, 0.36, 1] };

const HOME_DOCK_CARDS = [
  {
    profileId: 'GENERAL',
    tag: 'General',
    title: 'Personal y Directivo',
    description:
      'Revisión de computadores, celulares por USB y enlaces sin copiar archivos.',
  },
  {
    profileId: 'DEVELOPER',
    tag: 'Desarrollo',
    title: 'Equipos de Tecnología',
    description:
      'Auditoría continua de repositorios y librerías externas antes de publicar.',
  },
  {
    profileId: 'LEGAL',
    tag: 'Legal',
    title: 'Firmas y Despachos',
    description:
      'Análisis de expedientes confidenciales con citas exactas y cero filtraciones.',
  },
];

/**
 * Eclipse Ω compacto idéntico al módulo Home de OMEGA.
 */
function HomeEclipseMark() {
  const uid = useId().replace(/:/g, '');
  const bodyGradId = `homeEclipseBody-${uid}`;
  const rimGradId = `homeEclipseRim-${uid}`;

  return (
    <div
      aria-label="Eclipse OMEGA"
      role="img"
      className="relative flex items-center justify-center w-[156px] h-[156px] md:w-[172px] md:h-[172px] mx-auto select-none pointer-events-none"
    >
      {/* Halo respiratorio contenido del Home */}
      <div
        aria-hidden="true"
        className="omega-eclipse-breathe pointer-events-none absolute -inset-5 rounded-full blur-2xl"
        style={{
          background:
            'radial-gradient(circle, rgba(37, 99, 235, 0.28) 0%, rgba(29, 78, 216, 0.12) 55%, transparent 76%)',
        }}
      />

      {/* Interior oscuro limpio del eclipse */}
      <svg viewBox="0 0 180 180" fill="none" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id={bodyGradId} cx="62" cy="116" r="110" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#172547" />
            <stop offset="34%" stopColor="#0C1220" />
            <stop offset="72%" stopColor="#070A12" />
            <stop offset="100%" stopColor="#05070B" />
          </radialGradient>
          <linearGradient id={rimGradId} x1="24" y1="36" x2="152" y2="144" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#2563EB" stopOpacity="0.65" />
            <stop offset="45%" stopColor="#60A5FA" stopOpacity="0.88" />
            <stop offset="100%" stopColor="#2563EB" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        <circle cx="90" cy="90" r="88" fill={`url(#${bodyGradId})`} />
        <circle cx="90" cy="90" r="88" stroke={`url(#${rimGradId})`} strokeWidth="1" strokeOpacity="0.55" />
      </svg>

      {/* Aro fino azul rey rotando suavemente (9s linear infinite) */}
      <div
        aria-hidden="true"
        className="omega-orb-spin omega-orb-ring-mask-glow pointer-events-none absolute -inset-[2px] rounded-full opacity-80"
        style={{
          background:
            'conic-gradient(from 0deg, transparent 0deg, rgba(96, 165, 250, 0.55) 55deg, rgba(37, 99, 235, 0.7) 110deg, transparent 180deg)',
          filter: 'blur(8px)',
        }}
      />
      <div
        aria-hidden="true"
        className="omega-orb-spin omega-orb-ring-mask pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            'conic-gradient(from 0deg, transparent 0deg, rgba(96, 165, 250, 0.78) 55deg, rgba(37, 99, 235, 0.9) 110deg, transparent 180deg)',
        }}
      />

      {/* Isotipo vectorial Ω nítido centrado (~64px) */}
      <svg
        viewBox="0 0 80 80"
        fill="none"
        className="omega-glyph-float relative z-10 h-16 w-16"
      >
        <path
          d="M33.2 55.6H22.2V49.8H29.4C25.5 46.1 23.2 40.9 23.2 35C23.2 25.1 30.6 17.6 40 17.6C49.4 17.6 56.8 25.1 56.8 35C56.8 40.9 54.5 46.1 50.6 49.8H57.8V55.6H46.8V49.2C50 46.2 51.9 41.3 51.9 35.4C51.9 27.9 46.8 22.4 40 22.4C33.2 22.4 28.1 27.9 28.1 35.4C28.1 41.3 30 46.2 33.2 49.2V55.6Z"
          fill="#E2E8F0"
          fillOpacity="0.92"
        />
      </svg>
    </div>
  );
}

/**
 * Hero minimalista espejo del módulo Home de OMEGA:
 * Eclipse Ω centrado + Titular + Subtítulo + 2 botones + Dock inferior de 3 cards.
 */
export function OmegaHeroStage({ onStartFree, onViewPlans, onSelectProfile }) {
  const uid = useId().replace(/:/g, '');
  const arcStrokeId = `heroHomeArc-${uid}`;
  const reducedMotion = useReducedMotion();

  return (
    <section className="relative overflow-hidden bg-[#05070B]">
      {/* Arco atmosférico azul rey sutil del Login/Home */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden select-none"
      >
        <div
          className="absolute left-1/2 -top-36 -translate-x-1/2 w-[min(980px,115vw)] h-[340px]"
          style={{
            background:
              'radial-gradient(ellipse 56% 48% at 50% 45%, rgba(29, 78, 216, 0.18) 0%, rgba(47, 111, 237, 0.08) 46%, rgba(5, 7, 11, 0) 74%)',
          }}
        />
        <svg
          viewBox="0 0 1440 340"
          preserveAspectRatio="xMidYMin slice"
          fill="none"
          className="absolute inset-x-0 top-0 w-full h-[340px]"
        >
          <defs>
            <linearGradient id={arcStrokeId} x1="320" y1="110" x2="1120" y2="110" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#2F6FED" stopOpacity="0" />
              <stop offset="30%" stopColor="#2F6FED" stopOpacity="0.28" />
              <stop offset="50%" stopColor="#93C5FD" stopOpacity="0.58" />
              <stop offset="70%" stopColor="#2F6FED" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#2F6FED" stopOpacity="0" />
            </linearGradient>
          </defs>
          <circle cx="720" cy="650" r="590" stroke={`url(#${arcStrokeId})`} strokeWidth="1.1" />
        </svg>
      </div>

      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={ENTRANCE_TRANSITION}
        className="min-h-screen flex flex-col justify-between pt-28 md:pt-32 pb-8 px-6 max-w-6xl mx-auto relative z-10"
      >
        {/* Bloque Central: una sola columna centrada */}
        <div className="my-auto flex flex-col items-center text-center">
          <HomeEclipseMark />

          <h1 className="mt-8 md:mt-9 text-4xl md:text-6xl font-medium tracking-[-0.035em] leading-[1.06] text-[#F8FAFC] text-balance text-center">
            Control total. Cero rastro.
          </h1>

          <p className="mt-4 text-base md:text-[17px] text-[#94A3B8] max-w-xl mx-auto text-center leading-relaxed font-normal">
            Protege tus equipos, tu código y tus expedientes confidenciales sin guardar ni exponer tus datos.
          </p>

          <div className="mt-7 md:mt-8 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onStartFree}
              className="bg-[#2F6FED] hover:bg-[#3B7BF2] text-white h-11 px-6 rounded-xl text-sm font-medium transition-transform duration-150 active:scale-[0.97]"
            >
              Comenzar gratis
            </button>
            <button
              type="button"
              onClick={onViewPlans}
              className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.10] text-[#E2E8F0] h-11 px-6 rounded-xl text-sm font-medium transition-transform duration-150 active:scale-[0.97]"
            >
              Ver planes
            </button>
          </div>
        </div>

        {/* Dock inferior minimalista: eco de las 3 cards del Home */}
        <div className="mt-10 md:mt-14 grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
          {HOME_DOCK_CARDS.map((card) => (
            <button
              key={card.profileId}
              type="button"
              onClick={() => onSelectProfile(card.profileId)}
              className="bg-[#0B101B]/65 backdrop-blur-xl border border-white/[0.08] hover:border-white/[0.15] rounded-2xl p-5 transition-colors text-left cursor-pointer h-full flex flex-col justify-between"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[15px] font-medium text-[#F8FAFC]">{card.title}</span>
                <span className="text-[11px] text-[#64748B] shrink-0">{card.tag}</span>
              </div>
              <p className="text-[13px] text-[#94A3B8] mt-2 leading-relaxed">
                {card.description}
              </p>
            </button>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
