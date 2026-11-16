import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { OmegaLogo } from './OmegaLogo';
import { EASE_OUT, SPRING_SOFT } from '../lib/motion';

const DEFAULT_STEPS = [
  'Verificando sesión',
  'Contactando el servicio local',
  'Preparando la interfaz',
];

/**
 * Pantalla de carga OMEGA: escudo glassmórfico con anillos orbitales en #2F6FED,
 * barra de progreso indeterminada y estados rotativos. Respeta reduced-motion
 * (MotionConfig global) y expone role="status" para lectores de pantalla.
 */
export function OmegaLoader({ steps = DEFAULT_STEPS, label = 'Iniciando OMEGA' }) {
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (steps.length < 2) return undefined;
    const timer = setInterval(() => {
      setStepIdx((i) => Math.min(i + 1, steps.length - 1));
    }, 1400);
    return () => clearInterval(timer);
  }, [steps]);

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label={label}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1, transition: SPRING_SOFT }}
      exit={{ opacity: 0, scale: 1.04, transition: { duration: 0.25, ease: EASE_OUT } }}
      className="relative z-10 flex flex-col items-center gap-7"
    >
      <div className="relative h-[148px] w-[148px] flex items-center justify-center">
        {/* Ondas de pulso */}
        {[0, 1].map((i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            className="absolute inset-4 rounded-full border border-[#2F6FED]/50"
            initial={{ opacity: 0.55, scale: 0.7 }}
            animate={{ opacity: 0, scale: 1.45 }}
            transition={{ duration: 2.6, ease: 'easeOut', repeat: Infinity, delay: i * 1.3 }}
          />
        ))}

        {/* Anillo orbital con barrido */}
        <motion.svg
          aria-hidden="true"
          viewBox="0 0 148 148"
          className="absolute inset-0 h-full w-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 3.2, ease: 'linear', repeat: Infinity }}
        >
          <defs>
            <linearGradient id="omegaLoaderArc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#2F6FED" stopOpacity="0" />
              <stop offset="100%" stopColor="#2F6FED" stopOpacity="1" />
            </linearGradient>
          </defs>
          <circle cx="74" cy="74" r="66" stroke="rgba(255,255,255,0.07)" strokeWidth="1" fill="none" />
          <circle
            cx="74"
            cy="74"
            r="66"
            stroke="url(#omegaLoaderArc)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="120 295"
            fill="none"
          />
        </motion.svg>

        {/* Segundo anillo, contrarrotación */}
        <motion.svg
          aria-hidden="true"
          viewBox="0 0 148 148"
          className="absolute inset-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)]"
          animate={{ rotate: -360 }}
          transition={{ duration: 5.5, ease: 'linear', repeat: Infinity }}
        >
          <circle
            cx="74"
            cy="74"
            r="60"
            stroke="rgba(242,242,244,0.28)"
            strokeWidth="1"
            strokeDasharray="2 10"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="74" cy="14" r="2.4" fill="#F2F2F4" />
        </motion.svg>

        {/* Escudo con respiración */}
        <motion.div
          animate={{ scale: [1, 1.05, 1], y: [0, -2, 0] }}
          transition={{ duration: 2.6, ease: 'easeInOut', repeat: Infinity }}
        >
          <OmegaLogo size={78} isThinking />
        </motion.div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <span className="font-display text-[15px] font-semibold tracking-[0.34em] text-[#F2F2F4] pl-[0.34em]">
          OMEGA
        </span>

        {/* Barra indeterminada */}
        <div
          aria-hidden="true"
          className="relative h-[3px] w-[190px] overflow-hidden rounded-full bg-white/[0.08]"
        >
          <motion.span
            className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-[#2F6FED] to-transparent shadow-[0_0_12px_rgba(47,111,237,0.8)]"
            initial={{ left: '-35%' }}
            animate={{ left: '105%' }}
            transition={{ duration: 1.5, ease: 'easeInOut', repeat: Infinity }}
          />
        </div>

        <div className="h-[16px] overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.span
              key={stepIdx}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE_OUT } }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
              className="block font-tech text-[11px] uppercase tracking-[0.14em] text-[#9A9AA2]"
            >
              {steps[stepIdx]}…
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
