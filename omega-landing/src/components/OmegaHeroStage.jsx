import { useRef } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import { ArrowUpRight, Check } from 'lucide-react';
import { OmegaObsidianOrb } from './OmegaObsidianOrb';

const SPRING_PHYSICS = { stiffness: 420, damping: 36 };

/**
 * Hero Editorial de OMEGA con profundidad en eje Z:
 * tipografía gigante atrás, Orbe + anillos concéntricos en el centro,
 * 3 elementos de glassmorphismo flotando con paralaje por capas y banda monumental.
 */
export function OmegaHeroStage({ onStartFree, onViewPlans }) {
  const heroRef = useRef(null);
  const reducedMotion = useReducedMotion();

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const smoothX = useSpring(pointerX, SPRING_PHYSICS);
  const smoothY = useSpring(pointerY, SPRING_PHYSICS);

  /* Profundidad diferencial por plano en eje Z sin re-renders */
  const orbX = useTransform(smoothX, [-1, 1], [-8, 8]);
  const orbY = useTransform(smoothY, [-1, 1], [-8, 8]);
  const pillsX = useTransform(smoothX, [-1, 1], [-16, 16]);
  const pillsY = useTransform(smoothY, [-1, 1], [-12, 12]);
  const retCardX = useTransform(smoothX, [-1, 1], [18, -18]);
  const retCardY = useTransform(smoothY, [-1, 1], [14, -14]);
  const privCardX = useTransform(smoothX, [-1, 1], [-20, 20]);
  const privCardY = useTransform(smoothY, [-1, 1], [16, -16]);

  function handlePointerMove(event) {
    if (event.pointerType === 'touch' || reducedMotion) return;
    const node = heroRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointerX.set(Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2)));
    pointerY.set(Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2)));
  }

  function handlePointerLeave() {
    pointerX.set(0);
    pointerY.set(0);
  }

  return (
    <section
      ref={heroRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="relative overflow-hidden"
    >
      {/* Grano óptico SVG 2.5% + único foco azul rey concentrado detrás de la orbe */}
      <div aria-hidden="true" className="omega-grain-overlay pointer-events-none fixed inset-0 z-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[8%] top-[14%] h-[480px] w-[480px] rounded-full opacity-[0.26] blur-[110px]"
        style={{
          background: 'radial-gradient(circle, #2F6FED 0%, #1D4ED8 48%, rgba(5, 7, 11, 0) 76%)',
        }}
      />

      {/* Capa trasera (Eje Z -1): Palabra OMEGA gigante */}
      <div
        aria-hidden="true"
        className="pointer-events-none select-none absolute inset-x-0 top-24 md:top-20 flex justify-center z-0 overflow-hidden"
      >
        <span className="text-[16vw] font-semibold tracking-[-0.06em] leading-none bg-gradient-to-b from-white/[0.09] via-[#3B82F6]/[0.06] to-transparent bg-clip-text text-transparent">
          OMEGA
        </span>
      </div>

      {/* Layout principal de 2 columnas asimétricas */}
      <div className="max-w-7xl mx-auto px-6 pt-32 md:pt-40 pb-16 grid grid-cols-1 lg:grid-cols-12 items-center gap-12 relative">
        {/* Columna izquierda */}
        <div className="lg:col-span-5 relative z-20 text-left">
          <p className="text-[11px] font-medium tracking-[0.2em] uppercase text-[#60A5FA]/80">
            SISTEMA DE SEGURIDAD Y PRIVACIDAD
          </p>

          <h1 className="text-5xl md:text-6xl font-medium tracking-[-0.04em] leading-[1.03] text-[#F8FAFC] text-balance mt-4">
            Control total antes de tu próximo paso.
          </h1>

          <p className="text-base text-[#94A3B8] mt-5 max-w-md leading-relaxed">
            Protege tus equipos, tu código y tus expedientes confidenciales con inteligencia privada y cero rastro en disco.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onStartFree}
              className="rounded-full bg-[#F8FAFC] text-[#05070B] hover:bg-white h-12 px-7 text-sm font-medium transition-transform active:scale-[0.97]"
            >
              Comenzar gratis — Sin tarjeta
            </button>
            <button
              type="button"
              onClick={onViewPlans}
              className="rounded-full bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.12] text-[#F1F5F9] h-12 px-6 text-sm font-medium inline-flex items-center gap-1.5 transition-transform active:scale-[0.97]"
            >
              <span>Ver planes</span>
              <ArrowUpRight className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Columna derecha: Escultura + 3 capas flotantes superpuestas */}
        <div className="lg:col-span-7 relative flex items-center justify-center min-h-[420px] md:min-h-[480px] z-10">
          <motion.div
            style={reducedMotion ? undefined : { x: orbX, y: orbY }}
            className="relative flex items-center justify-center"
          >
            <OmegaObsidianOrb />
          </motion.div>

          {/* 1. Arriba-izquierda: Dos píldoras ligeras apiladas */}
          <motion.div
            style={reducedMotion ? undefined : { x: pillsX, y: pillsY }}
            className="hidden sm:flex flex-col items-start gap-2.5 absolute top-6 md:top-10 left-0 md:left-4 z-20 pointer-events-none"
          >
            <div className="rounded-full bg-white/[0.08] backdrop-blur-2xl border border-white/[0.16] px-4 py-2 text-xs text-[#F8FAFC] shadow-[0_12px_32px_rgba(0,0,0,0.5)] inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
              <Check className="w-3.5 h-3.5 text-emerald-400" strokeWidth={2} />
              <span>Equipo y celular sin amenazas</span>
            </div>
            <div className="rounded-full bg-white/[0.08] backdrop-blur-2xl border border-white/[0.16] px-4 py-2 text-xs text-[#F8FAFC] shadow-[0_12px_32px_rgba(0,0,0,0.5)] inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#2F6FED]" aria-hidden="true" />
              <Check className="w-3.5 h-3.5 text-[#60A5FA]" strokeWidth={2} />
              <span>Expediente verificado · Pág. 14</span>
            </div>
          </motion.div>

          {/* 2. Arriba-derecha: Tarjeta flotante translúcida RETENCIÓN 0 B */}
          <motion.div
            style={reducedMotion ? undefined : { x: retCardX, y: retCardY }}
            className="hidden sm:block absolute top-4 md:top-8 right-0 md:right-6 z-20 rounded-2xl p-4 w-[170px] backdrop-blur-2xl bg-white/[0.06] border border-white/[0.14] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_20px_50px_rgba(0,0,0,0.6)] pointer-events-none"
          >
            <p className="text-[11px] font-medium tracking-[0.14em] uppercase text-[#94A3B8]">
              — RETENCIÓN
            </p>
            <p className="mt-1.5 text-3xl font-semibold tabular-nums text-white">0 B</p>
            <p className="mt-1 text-xs text-[#94A3B8] leading-snug">
              Archivos guardados en servidor
            </p>
          </motion.div>

          {/* 3. Abajo-derecha: Tarjeta compacta de cristal elevado */}
          <motion.div
            style={reducedMotion ? undefined : { x: privCardX, y: privCardY }}
            className="hidden sm:block absolute bottom-4 md:bottom-8 right-2 md:right-10 z-20 rounded-2xl p-4 w-[210px] backdrop-blur-2xl bg-white/[0.06] border border-white/[0.14] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_20px_50px_rgba(0,0,0,0.6)] pointer-events-none"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#60A5FA]">Modo Privado</span>
              <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
            </div>
            <p className="mt-1 text-sm font-medium text-[#F8FAFC]">Informe certificado</p>
            <div className="mt-3 h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div className="h-full w-full rounded-full bg-gradient-to-r from-[#2F6FED] to-emerald-400" />
            </div>
          </motion.div>
        </div>
      </div>

      {/* 3. Banda Inferior Monumental */}
      <div className="px-6 pb-20">
        <div className="max-w-5xl mx-auto mt-8 pt-10 border-t border-white/[0.07] grid grid-cols-1 sm:grid-cols-3 gap-10 items-center text-center">
          <div>
            <p className="text-4xl md:text-5xl font-light tracking-[-0.04em] tabular-nums text-white">
              0 B
            </p>
            <p className="text-xs text-[#64748B] mt-1">Rastro en disco</p>
          </div>

          <div className="relative pt-4">
            {/* Arco punteado semicircular estilo dial de precisión */}
            <svg
              aria-hidden="true"
              viewBox="0 0 180 60"
              fill="none"
              className="mx-auto -mb-2 w-36 h-12"
            >
              <path
                d="M16 54 A74 74 0 0 1 164 54"
                stroke="rgba(96, 165, 250, 0.35)"
                strokeWidth="1.25"
                strokeDasharray="2 5"
                strokeLinecap="round"
              />
              <circle cx="90" cy="6" r="2" fill="#60A5FA" />
            </svg>
            <p className="text-4xl md:text-5xl font-light tracking-[-0.04em] tabular-nums text-white">
              100%
            </p>
            <p className="text-xs text-[#64748B] mt-1">Control de tus datos</p>
          </div>

          <div>
            <p className="text-4xl md:text-5xl font-light tracking-[-0.04em] tabular-nums text-white">
              3
            </p>
            <p className="text-xs text-[#64748B] mt-1">Espacios en una sola app</p>
          </div>
        </div>
      </div>
    </section>
  );
}
