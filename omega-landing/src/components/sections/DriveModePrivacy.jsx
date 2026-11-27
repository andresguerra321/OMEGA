import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion, useReducedMotion } from 'framer-motion';
import { DRIVE_PRIVACY_MODES, PRIVACY_SPECS } from '../../data/catalog';

const useSafeLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const PILL_SPRING = { type: 'spring', stiffness: 450, damping: 35 };
const CONTENT_TRANSITION = { duration: 0.18, ease: [0.23, 1, 0.32, 1] };

/**
 * Capítulo 4: Arquitectura de Privacidad con fotografía real en bóveda obsidiana + parallax en 3 planos.
 * Cero íconos SVG ni pegatinas sobre la fotografía.
 */
export function DriveModePrivacy() {
  const [driveMode, setDriveMode] = useState('cloud');
  const sectionRef = useRef(null);
  const layerBgRef = useRef(null);
  const layerVaultRef = useRef(null);
  const layerLightRef = useRef(null);
  const reducedMotion = useReducedMotion();

  const activeMode =
    DRIVE_PRIVACY_MODES.find((item) => item.id === driveMode) || DRIVE_PRIVACY_MODES[0];
  const isPrivate = driveMode === 'private';

  useSafeLayoutEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof requestAnimationFrame !== 'function' ||
      reducedMotion
    ) {
      return undefined;
    }

    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      const scrubConfig = {
        trigger: sectionRef.current,
        start: 'top bottom',
        end: 'bottom top',
        scrub: 1,
      };

      // Plano 1: Atmósfera radial azul medianoche
      gsap.fromTo(
        layerBgRef.current,
        { yPercent: -6 },
        { yPercent: 6, ease: 'none', scrollTrigger: scrubConfig },
      );

      // Plano 2: Haz especular diagonal barriendo la bóveda al scrollear
      gsap.fromTo(
        layerLightRef.current,
        { xPercent: -35, opacity: 0.35 },
        { xPercent: 35, opacity: 0.8, ease: 'none', scrollTrigger: scrubConfig },
      );

      // Plano 3: Bóveda fotográfica real de titanio y obsidiana con zoom-out sutil
      gsap.fromTo(
        layerVaultRef.current,
        { yPercent: -12, scale: 1.1 },
        { yPercent: 12, scale: 1.0, ease: 'none', scrollTrigger: scrubConfig },
      );

      // Entrada escalonada con máscara en las 3 métricas editoriales
      gsap.from('[data-privacy-metric]', {
        yPercent: 100,
        opacity: 0,
        duration: 0.6,
        stagger: 0.08,
        ease: 'power3.out',
        clearProps: 'transform,opacity',
        scrollTrigger: {
          trigger: '[data-privacy-metrics]',
          start: 'top 88%',
          once: true,
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, [reducedMotion]);

  return (
    <section
      id="privacidad"
      ref={sectionRef}
      data-drive-mode={driveMode}
      className="relative min-h-[90vh] flex items-center overflow-hidden bg-[#060912] border-t border-white/[0.08]"
    >
      {/* Plano 1: Atmósfera radial en azul medianoche */}
      <div
        ref={layerBgRef}
        aria-hidden="true"
        className="pointer-events-none absolute -inset-16 will-change-transform"
      >
        <div
          className={`absolute inset-0 transition-opacity duration-500 ${
            isPrivate ? 'opacity-55' : 'opacity-100'
          }`}
          style={{
            background:
              'radial-gradient(ellipse 52% 56% at 76% 50%, rgba(47, 111, 237, 0.22) 0%, rgba(19, 33, 61, 0.12) 48%, rgba(6, 9, 18, 0) 76%)',
          }}
        />
      </div>

      {/* Plano 3: Fotografía real de estudio de bóveda arquitectónica */}
      <div
        ref={layerVaultRef}
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 right-0 w-full lg:w-[66%] will-change-transform transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isPrivate ? 'translate-x-0 brightness-95' : 'translate-x-4 brightness-105'
        }`}
      >
        <img
          src="/media/privacy-sovereign.jpg"
          alt="Bóveda arquitectónica de privacidad OMEGA"
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover object-right"
        />
      </div>

      {/* Plano 2: Haz especular orgánico azul rey que acompaña al desplazamiento */}
      <div
        ref={layerLightRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-[55%] will-change-transform"
        style={{
          background:
            'radial-gradient(ellipse 48% 58% at 62% 46%, rgba(96, 165, 250, 0.12) 0%, transparent 70%)',
        }}
      />

      {/* Máscara de degradado horizontal suave hacia #060912 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, #060912 42%, rgba(6,9,18,0.68) 70%, transparent 100%)',
        }}
      />

      <div className="relative z-10 max-w-6xl mx-auto w-full px-6 py-28">
        <div className="max-w-2xl">
          <h2 className="text-4xl md:text-6xl font-semibold tracking-[-0.03em] leading-[1.06] text-white text-balance">
            Privacidad sin concesiones.
          </h2>

          {/* Segmented Control con cápsula de vidrio azulado oscura */}
          <div
            role="tablist"
            aria-label="Modo de operación y privacidad"
            className="mt-8 inline-flex p-1 rounded-full bg-white/[0.04] border border-white/[0.08]"
          >
            {DRIVE_PRIVACY_MODES.map((mode) => {
              const active = driveMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setDriveMode(mode.id)}
                  className={`relative px-5 py-2 rounded-full text-xs sm:text-[13px] font-medium transition-transform duration-150 active:scale-[0.98] ${
                    active ? 'text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="drive-mode-pill"
                      transition={PILL_SPRING}
                      className="absolute inset-0 rounded-full bg-[#13213D]/90 border border-[#3B82F6]/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
                    />
                  )}
                  <span className="relative z-10">{mode.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bloque dinámico animado */}
        <motion.div
          key={activeMode.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={CONTENT_TRANSITION}
          className="mt-8"
        >
          <div className="max-w-xl min-h-[88px]">
            <h3 className="text-xl font-medium tracking-[-0.02em] text-white">
              {activeMode.headline}
            </h3>
            <p className="mt-2.5 text-sm sm:text-base text-zinc-400 leading-relaxed line-clamp-2">
              {activeMode.description}
            </p>
          </div>
        </motion.div>

        {/* Cierre editorial de métricas con divisor superior e entrada escalonada */}
        <div
          data-privacy-metrics
          className="mt-12 max-w-3xl grid grid-cols-1 sm:grid-cols-3 border-t border-white/[0.08] pt-6"
        >
          {PRIVACY_SPECS.map((spec, idx) => (
            <div
              key={spec.label}
              className={
                idx === 0
                  ? 'sm:pr-8 overflow-hidden'
                  : idx === 1
                    ? 'pt-6 sm:pt-0 sm:px-8 sm:border-l sm:border-white/[0.08] overflow-hidden'
                    : 'pt-6 sm:pt-0 sm:pl-8 sm:border-l sm:border-white/[0.08] overflow-hidden'
              }
            >
              <div data-privacy-metric>
                <p className="text-lg font-medium text-white tabular-nums whitespace-nowrap">
                  {spec.value}
                </p>
                <p className="mt-1 text-xs text-zinc-500 whitespace-nowrap">{spec.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
