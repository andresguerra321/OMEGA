import { useId, useRef, useState } from 'react';
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'framer-motion';
import { ArrowDown } from 'lucide-react';
import { HERO_SPECS } from '../../data/catalog';
import { OMEGA_VECTOR_PATH, OmegaSculptedOrb } from '../OmegaSculptedOrb';

const HERO_EASE = [0.22, 1, 0.36, 1];
const POINTER_SPRING = { stiffness: 120, damping: 24, mass: 0.6 };

/**
 * Capítulo 1: Hero insignia estilo Tesla + Home de OMEGA con orbe esculpida.
 */
export function HeroKeynote({ onStartFree, onLearnMore, onViewPlans }) {
  const sectionRef = useRef(null);
  const [heroOffscreen, setHeroOffscreen] = useState(false);
  const reducedMotion = useReducedMotion();
  const uid = useId().replace(/:/g, '');
  const arcStrokeId = `heroKeynoteArc-${uid}`;

  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const pointerX = useSpring(useTransform(rawX, [-1, 1], [-7, 7]), POINTER_SPRING);
  const pointerY = useSpring(useTransform(rawY, [-1, 1], [-7, 7]), POINTER_SPRING);
  const glyphX = useSpring(useTransform(rawX, [-1, 1], [-12, 12]), POINTER_SPRING);
  const glyphY = useSpring(useTransform(rawY, [-1, 1], [-12, 12]), POINTER_SPRING);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });
  useMotionValueEvent(scrollYProgress, 'change', (latest) => {
    const offscreen = latest >= 0.99;
    if (offscreen !== heroOffscreen) setHeroOffscreen(offscreen);
  });

  const orbScale = useTransform(scrollYProgress, [0, 0.75], [1, 0.88]);
  const orbOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0.25]);
  const orbY = useTransform(scrollYProgress, [0, 0.75], [0, 36]);
  const copyY = useTransform(scrollYProgress, [0, 0.7], [0, -28]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.65], [1, 0.3]);
  const specsOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0.2]);

  function handlePointerMove(event) {
    if (reducedMotion || event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    rawX.set(((event.clientX - rect.left) / rect.width) * 2 - 1);
    rawY.set(((event.clientY - rect.top) / rect.height) * 2 - 1);
  }

  function handlePointerLeave() {
    rawX.set(0);
    rawY.set(0);
  }

  return (
    <section
      id="plataforma"
      ref={sectionRef}
      data-hero-paused={heroOffscreen ? 'true' : 'false'}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="relative min-h-screen flex flex-col justify-between pt-20 md:pt-24 bg-[#05070B] overflow-hidden"
    >
      {/* Arco atmosférico azul rey superior */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden select-none"
      >
        <div
          className="absolute left-1/2 -top-36 -translate-x-1/2 w-[min(1040px,120vw)] h-[360px]"
          style={{
            background:
              'radial-gradient(ellipse 56% 48% at 50% 45%, rgba(29, 78, 216, 0.22) 0%, rgba(47, 111, 237, 0.09) 46%, rgba(5, 7, 11, 0) 74%)',
          }}
        />
        <svg
          viewBox="0 0 1440 340"
          preserveAspectRatio="xMidYMin slice"
          fill="none"
          className="absolute inset-x-0 top-0 w-full h-[340px]"
        >
          <defs>
            <linearGradient id={arcStrokeId} x1="300" y1="110" x2="1140" y2="110" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#2F6FED" stopOpacity="0" />
              <stop offset="30%" stopColor="#2F6FED" stopOpacity="0.28" />
              <stop offset="50%" stopColor="#93C5FD" stopOpacity="0.6" />
              <stop offset="70%" stopColor="#2F6FED" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#2F6FED" stopOpacity="0" />
            </linearGradient>
          </defs>
          <circle cx="720" cy="650" r="590" stroke={`url(#${arcStrokeId})`} strokeWidth="1.15" />
        </svg>
      </div>

      {/* Escenario central 100% limpio */}
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, ease: HERO_EASE }}
        className="relative z-10 my-auto px-6 max-w-5xl mx-auto w-full flex flex-col items-center text-center py-5"
      >
        <motion.div
          style={
            reducedMotion
              ? undefined
              : { scale: orbScale, opacity: orbOpacity, y: orbY, x: pointerX }
          }
          className="mx-auto"
        >
          <motion.div style={reducedMotion ? undefined : { y: pointerY }}>
            <OmegaSculptedOrb
              sizeClass="w-[156px] h-[156px] md:w-[164px] md:h-[164px]"
              glyphNode={
                <motion.svg
                  style={reducedMotion ? undefined : { x: glyphX, y: glyphY }}
                  viewBox="0 0 80 80"
                  fill="none"
                  className="omega-glyph-float relative z-10 h-16 w-16"
                >
                  <path d={OMEGA_VECTOR_PATH} fill="#E2E8F0" fillOpacity="0.94" />
                </motion.svg>
              }
            />
          </motion.div>
        </motion.div>

        <motion.div
          style={reducedMotion ? undefined : { y: copyY, opacity: copyOpacity }}
          className="flex flex-col items-center"
        >
          <h1 className="mt-6 md:mt-7 text-5xl md:text-7xl lg:text-[84px] font-medium tracking-[-0.045em] leading-[1.02] text-balance">
            <span className="text-[#F8FAFC] block">OMEGA.</span>
            <span className="bg-gradient-to-b from-[#F8FAFC] to-[#94A3B8] bg-clip-text text-transparent block mt-1">
              Control total. Cero rastro.
            </span>
          </h1>

          <p className="mt-4 text-sm sm:text-base text-[#94A3B8] max-w-xl leading-relaxed">
            Protege tus equipos, teléfonos, código y expedientes confidenciales desde una sola cabina privada.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onStartFree}
              className="bg-[#2F6FED] hover:bg-[#3B7BF2] text-white h-11 px-6 rounded-xl text-sm font-medium transition-transform duration-150 active:scale-[0.97]"
            >
              Comenzar gratis
            </button>
            <button
              type="button"
              onClick={onLearnMore}
              className="inline-flex items-center gap-2 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.12] text-[#E2E8F0] hover:text-white h-11 px-6 rounded-xl text-sm font-medium transition-transform duration-150 active:scale-[0.97]"
            >
              Ver más
              <ArrowDown className="w-3.5 h-3.5 text-[#94A3B8]" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={onViewPlans}
              className="text-sm font-medium text-[#94A3B8] hover:text-[#F8FAFC] h-11 px-3 transition-colors"
            >
              Ver planes
            </button>
          </div>
        </motion.div>
      </motion.div>

      {/* Barra de especificaciones estilo Tesla al pie del viewport */}
      <motion.div
        style={reducedMotion ? undefined : { opacity: specsOpacity }}
        className="relative z-10 px-6 w-full"
      >
        <div className="max-w-4xl mx-auto w-full grid grid-cols-3 border-t border-white/[0.08] pt-6 pb-7 text-center">
          {HERO_SPECS.map((spec) => (
            <div key={spec.label} className="px-2">
              <p className="text-xl sm:text-2xl md:text-3xl font-medium tracking-[-0.03em] text-[#F8FAFC] tabular-nums">
                {spec.value}
              </p>
              <p className="mt-1 text-xs sm:text-[13px] text-[#94A3B8]">{spec.label}</p>
            </div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
