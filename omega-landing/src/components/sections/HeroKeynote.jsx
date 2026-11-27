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
import { CheckCircle2, FileText, ShieldCheck } from 'lucide-react';
import { HERO_CONTENT } from '../../data/catalog';
import { OMEGA_VECTOR_PATH, OmegaSculptedOrb } from '../OmegaSculptedOrb';

const HERO_EASE = [0.22, 1, 0.36, 1];
const POINTER_SPRING = { stiffness: 120, damping: 24, mass: 0.6 };

/**
 * Capítulo 1: Hero insignia conservando el eclipse Ω + arco azul + obsidiana #05070B,
 * con píldora de novedad, CTA único "Comenzar gratis", enlace "Ver planes" y captura inferior.
 */
export function HeroKeynote({ onStartFree, onViewPlans }) {
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

  const orbScale = useTransform(scrollYProgress, [0, 0.75], [1, 0.9]);
  const orbOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0.3]);
  const orbY = useTransform(scrollYProgress, [0, 0.75], [0, 28]);

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
      className="relative min-h-screen flex flex-col justify-between pt-24 md:pt-28 bg-[#05070B] overflow-hidden"
    >
      {/* Arco atmosférico azul rey superior (intacto) */}
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

      {/* Escenario central limpio */}
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, ease: HERO_EASE }}
        className="relative z-10 px-6 max-w-5xl mx-auto w-full flex flex-col items-center text-center pt-2"
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
              sizeClass="w-[128px] h-[128px] md:w-[144px] md:h-[144px]"
              glyphNode={
                <motion.svg
                  style={reducedMotion ? undefined : { x: glyphX, y: glyphY }}
                  viewBox="0 0 80 80"
                  fill="none"
                  className="omega-glyph-float relative z-10 h-14 w-14"
                >
                  <path d={OMEGA_VECTOR_PATH} fill="#E2E8F0" fillOpacity="0.94" />
                </motion.svg>
              }
            />
          </motion.div>
        </motion.div>

        {/* Píldora superior de novedad */}
        <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/[0.04] border border-white/[0.10] px-3.5 py-1 text-xs font-medium text-[#CBD5E1]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#2F6FED]" aria-hidden="true" />
          <span>{HERO_CONTENT.pill}</span>
        </div>

        {/* H1 en Sora display con tracking cerrado */}
        <h1 className="mt-4 font-display text-4xl sm:text-6xl md:text-7xl lg:text-[76px] font-semibold tracking-[-0.04em] leading-[1.02] text-[#F8FAFC] text-balance max-w-4xl">
          {HERO_CONTENT.headline}
        </h1>

        <p className="mt-4 text-sm sm:text-base text-[#94A3B8] max-w-3xl leading-relaxed">
          {HERO_CONTENT.subtitle}
        </p>

        {/* CTA único prominente + enlace secundario */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-5">
          <button
            type="button"
            onClick={onStartFree}
            className="bg-[#2F6FED] hover:bg-[#3B7BF2] text-white h-11 px-7 rounded-xl text-sm font-medium shadow-[0_0_28px_rgba(47,111,237,0.35),inset_0_1px_0_rgba(255,255,255,0.2)] transition-all duration-150 active:scale-[0.97]"
          >
            {HERO_CONTENT.ctaPrimary}
          </button>
          <a
            href="#planes"
            onClick={(event) => {
              event.preventDefault();
              onViewPlans();
            }}
            className="text-sm font-medium text-[#CBD5E1] hover:text-white underline-offset-4 hover:underline transition-colors"
          >
            {HERO_CONTENT.ctaSecondary}
          </a>
        </div>

        <p className="mt-3 text-xs text-[#64748B] font-mono tabular-nums">
          {HERO_CONTENT.microtext}
        </p>
      </motion.div>

      {/* Captura del producto asomando en la parte inferior con fade al fondo */}
      <div className="relative z-10 mt-10 px-4 sm:px-6 w-full max-w-4xl mx-auto min-w-0">
        <div className="relative rounded-t-2xl omega-glass border-b-0 overflow-hidden pt-4 px-4 sm:px-6 pb-8">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/[0.08] min-w-0">
            <div className="flex items-center gap-2 text-xs text-[#94A3B8] min-w-0">
              <ShieldCheck className="w-4 h-4 text-[#2F6FED] shrink-0" strokeWidth={1.75} />
              <span className="font-medium text-[#F8FAFC] truncate">Cabina de Evidencia</span>
              <span className="hidden sm:inline text-[#64748B]">·</span>
              <span className="hidden sm:inline text-[#64748B]">General · Desarrollo · Legal</span>
            </div>
            <span className="font-mono text-[11px] text-[#60A5FA] tabular-nums shrink-0">
              {HERO_CONTENT.preview.sealCode}
              <span className="hidden sm:inline"> · {HERO_CONTENT.preview.statusLabel}</span>
            </span>
          </div>

          <div className="mt-3 divide-y divide-white/[0.06]">
            {HERO_CONTENT.preview.rows.map((row) => (
              <div
                key={row.space}
                className="py-2.5 flex items-center justify-between gap-3 text-xs sm:text-[13px] min-w-0"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <FileText className="w-3.5 h-3.5 text-[#64748B] shrink-0" strokeWidth={1.75} />
                  <span className="font-medium text-[#F8FAFC] shrink-0">{row.space}</span>
                  <span className="text-[#94A3B8] truncate">{row.subject}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="hidden md:inline text-[#64748B]">{row.evidence}</span>
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-400">
                    <CheckCircle2 className="w-3 h-3 shrink-0" strokeWidth={1.75} />
                    <span>{row.badge}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Fade suave hacia #05070B */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#05070B] via-[#05070B]/85 to-transparent"
          />
        </div>
      </div>
    </section>
  );
}
