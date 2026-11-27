import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from 'framer-motion';
import { ArrowRight, Code2, Globe, Laptop, Scale } from 'lucide-react';
import { PRODUCT_OVERVIEW } from '../../data/catalog';
import { OmegaSculptedOrb } from '../OmegaSculptedOrb';

const useSafeLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const SCENE_ICONS = {
  laptop: Laptop,
  globe: Globe,
  code: Code2,
  scale: Scale,
};

/**
 * Capítulo 2A: Showcase editorial minimalista guiado por Lenis + GSAP.
 * Combina índice tipo acordeón con la Orbe realista de OMEGA y tarjetas translúcidas flotantes.
 */
export function ProductOverviewSection({ onScrollToOffset, onExploreSpaces }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const sectionRef = useRef(null);
  const pinStageRef = useRef(null);
  const progressBarRef = useRef(null);
  const orbStageRef = useRef(null);
  const orbRingAngleRef = useRef(null);
  const floatTopRef = useRef(null);
  const floatBottomRef = useRef(null);
  const pinTriggerRef = useRef(null);
  const tabRefs = useRef([]);
  const hasMountedRef = useRef(false);
  const reducedMotion = useReducedMotion();

  const pillars = PRODUCT_OVERVIEW.pillars;
  const activePillar = pillars[activeIndex] || pillars[0];
  const SceneIcon = SCENE_ICONS[activePillar.icon] || Laptop;

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
      // Revelado tipográfico editorial con máscara de recorte
      gsap.from('[data-editorial-line]', {
        yPercent: 100,
        duration: 0.78,
        stagger: 0.08,
        ease: 'power4.out',
        clearProps: 'transform',
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 78%',
          once: true,
        },
      });

      // Pin + Scrub en desktop (>= 1024px) sobre la Orbe óptica Ω
      const mm = gsap.matchMedia();
      mm.add('(min-width: 1024px)', () => {
        const tl = gsap.timeline({
          scrollTrigger: {
            id: 'omega-product-pin',
            trigger: sectionRef.current,
            start: 'top top',
            end: '+=240%',
            pin: pinStageRef.current,
            scrub: 0.6,
            anticipatePin: 1,
            onUpdate: (self) => {
              pinTriggerRef.current = self;
              if (progressBarRef.current) {
                progressBarRef.current.style.transform = `scaleY(${self.progress.toFixed(4)})`;
              }
              const nextIdx = Math.min(
                pillars.length - 1,
                Math.max(0, Math.floor(self.progress * pillars.length)),
              );
              setActiveIndex((prev) => (prev !== nextIdx ? nextIdx : prev));
            },
          },
        });

        tl.fromTo(
          orbStageRef.current,
          { scale: 0.94, yPercent: 4 },
          { scale: 1.03, yPercent: -4, ease: 'none' },
          0,
        );

        if (orbRingAngleRef.current) {
          tl.fromTo(
            orbRingAngleRef.current,
            { rotation: 0 },
            { rotation: 160, ease: 'none' },
            0,
          );
        }
      });

      return () => mm.revert();
    }, sectionRef);

    return () => ctx.revert();
  }, [pillars.length, reducedMotion]);

  // Transición suave de las 2 tarjetas flotantes al cambiar de frente
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return undefined;
    }
    if (reducedMotion || !floatTopRef.current || !floatBottomRef.current) return undefined;

    const tween = gsap.fromTo(
      [floatTopRef.current, floatBottomRef.current],
      { opacity: 0.25, y: 6 },
      {
        opacity: 1,
        y: 0,
        duration: 0.24,
        stagger: 0.04,
        ease: 'power2.out',
        clearProps: 'transform,opacity',
      },
    );
    return () => tween.kill();
  }, [activeIndex, reducedMotion]);

  function handleSelectIndex(idx) {
    setActiveIndex(idx);
    if (
      !reducedMotion &&
      typeof window !== 'undefined' &&
      window.innerWidth >= 1024 &&
      pinTriggerRef.current &&
      typeof onScrollToOffset === 'function'
    ) {
      const trigger = pinTriggerRef.current;
      const targetProgress = (idx + 0.32) / pillars.length;
      const targetY = trigger.start + (trigger.end - trigger.start) * targetProgress;
      onScrollToOffset(targetY);
    }
  }

  function handleTabListKeyDown(event) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const total = pillars.length;
    const nextIdx =
      event.key === 'ArrowDown'
        ? (activeIndex + 1) % total
        : (activeIndex - 1 + total) % total;
    handleSelectIndex(nextIdx);
    tabRefs.current[nextIdx]?.focus();
  }

  return (
    <section
      id="producto"
      ref={sectionRef}
      className="relative bg-[#06080F] border-t border-white/[0.08]"
    >
      <div
        ref={pinStageRef}
        className="min-h-screen flex flex-col justify-center py-24 lg:py-20"
      >
        <div className="max-w-6xl mx-auto px-6 w-full">
          {/* Encabezado limpio sin kickers técnicos */}
          <div className="max-w-3xl mb-14 lg:mb-16">
            <h2
              aria-label={PRODUCT_OVERVIEW.headline}
              className="text-3xl sm:text-5xl font-medium tracking-[-0.035em] leading-[1.06] text-[#F8FAFC] text-balance"
            >
              <span className="block overflow-hidden">
                <span data-editorial-line className="block">
                  Defensa preventiva e inteligencia{' '}
                </span>
              </span>
              <span className="block overflow-hidden">
                <span data-editorial-line className="block">
                  privada en un solo lugar.
                </span>
              </span>
            </h2>
            <p className="mt-4 max-w-2xl text-base text-[#94A3B8] leading-relaxed">
              {PRODUCT_OVERVIEW.description}
            </p>
          </div>

          {/* Grid asimétrico abierto: acordeón editorial izquierda + escena orbe flotante derecha */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-14 items-center">
            {/* Columna izquierda */}
            <div className="lg:col-span-5 relative pl-6">
              <div
                aria-hidden="true"
                className="absolute left-0 top-1 bottom-1 w-px bg-white/[0.08]"
              >
                <div
                  ref={progressBarRef}
                  style={{
                    transformOrigin: '50% 0%',
                    transform: reducedMotion
                      ? 'scaleY(1)'
                      : `scaleY(${(activeIndex + 1) / pillars.length})`,
                  }}
                  className="w-full h-full bg-[#2F6FED] transition-transform duration-150 ease-out"
                />
              </div>

              <div
                role="tablist"
                aria-label="Capacidades principales de OMEGA"
                onKeyDown={handleTabListKeyDown}
                className="space-y-6"
              >
                {pillars.map((pillar, idx) => {
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={pillar.id}
                      ref={(el) => {
                        tabRefs.current[idx] = el;
                      }}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => handleSelectIndex(idx)}
                      className={`w-full text-left transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-40 hover:opacity-75'
                        }`}
                    >
                      <div className="flex items-baseline gap-3">
                        <span
                          className={`font-mono text-xs tabular-nums ${isActive ? 'text-[#60A5FA]' : 'text-zinc-500'
                            }`}
                        >
                          0{idx + 1}
                        </span>
                        <span className="text-lg sm:text-xl font-medium tracking-[-0.02em] text-[#F8FAFC]">
                          {pillar.shortLabel}
                        </span>
                      </div>

                      {isActive && (
                        <div className="mt-3 pl-7 space-y-4">
                          <p className="text-sm text-[#94A3B8] leading-relaxed">
                            {pillar.detail}
                          </p>
                          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-white/[0.08]">
                            {pillar.metrics.map((m) => (
                              <div key={m.label}>
                                <p className="text-[13px] font-medium text-[#F8FAFC] tabular-nums whitespace-nowrap">
                                  {m.value}
                                </p>
                                <p className="mt-0.5 text-[11px] text-zinc-500">{m.label}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-10 pt-5 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={onExploreSpaces}
                  className="group inline-flex items-center gap-2 text-sm font-medium text-[#E2E8F0] hover:text-white transition-colors"
                >
                  <span>Ver arquitectura completa</span>
                  <ArrowRight
                    className="w-4 h-4 text-[#2F6FED] transition-transform duration-150 ease-out group-hover:translate-x-[3px]"
                    strokeWidth={1.5}
                  />
                </button>
              </div>
            </div>

            {/* Columna derecha: Orbe realista Ω + 2 tarjetas flotantes de vidrio ahumado */}
            <div className="lg:col-span-7 relative min-h-[380px] sm:min-h-[430px] flex items-center justify-center py-6">
              <div
                ref={orbStageRef}
                className="relative flex items-center justify-center will-change-transform"
              >
                <OmegaSculptedOrb
                  sizeClass="w-[250px] h-[250px] sm:w-[310px] sm:h-[310px] lg:w-[330px] lg:h-[330px]"
                  glyphSizeClass="h-24 w-24 sm:h-28 sm:w-28"
                  ringAngleRef={orbRingAngleRef}
                  decorative
                />
              </div>

              {/* Tarjeta flotante superior izquierda */}
              <div
                ref={floatTopRef}
                className="absolute top-4 left-0 sm:left-4 z-20 max-w-[235px] rounded-2xl bg-[#0B111F]/72 backdrop-blur-xl border border-white/[0.12] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.14)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-[#94A3B8]">
                    {activePillar.scene.topTag}
                  </span>
                  <span className="w-6 h-6 rounded-full bg-white/[0.08] border border-white/[0.12] flex items-center justify-center text-[#F8FAFC] shrink-0">
                    <SceneIcon className="w-3.5 h-3.5" strokeWidth={1.6} />
                  </span>
                </div>
                <p className="mt-2.5 text-sm font-medium text-[#F8FAFC] leading-snug">
                  {activePillar.scene.topTitle}
                </p>
                <p className="mt-1 text-xs text-[#94A3B8]">{activePillar.scene.topMeta}</p>
              </div>

              {/* Tarjeta flotante inferior derecha */}
              <div
                ref={floatBottomRef}
                className="absolute bottom-4 right-0 sm:right-4 z-20 min-w-[195px] sm:min-w-[215px] rounded-2xl bg-[#0B111F]/72 backdrop-blur-xl border border-white/[0.12] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.14)]"
              >
                <p className="text-[11px] text-[#94A3B8]">{activePillar.scene.bottomTag}</p>
                <p className="mt-1.5 text-2xl font-medium tracking-[-0.03em] text-[#F8FAFC] tabular-nums">
                  {activePillar.scene.bottomValue}
                </p>
                <div className="mt-3 h-1 w-full rounded-full bg-white/[0.10] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#2F6FED] to-[#93C5FD] transition-all duration-300"
                    style={{ width: `${activePillar.scene.bottomBarPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
