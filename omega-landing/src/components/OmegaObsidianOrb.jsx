import { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * Escultura Central de OMEGA:
 * 3 anillos concéntricos en perspectiva (rotateX 68deg) con vidrio ahumado
 * + Orbe de Cristal Obsidiana flotando suavemente (±5px en 6s).
 */
export function OmegaObsidianOrb({ sizeClass = 'w-[260px] h-[260px] md:w-[320px] md:h-[320px]' }) {
  const uid = useId().replace(/:/g, '');
  const omegaGradId = `omegaOrbGlyph-${uid}`;
  const lensArcId = `omegaOrbLens-${uid}`;
  const reducedMotion = useReducedMotion();

  return (
    <div
      aria-label="Orbe de Cristal Obsidiana de OMEGA"
      role="img"
      className="relative flex items-center justify-center select-none pointer-events-none"
    >
      {/* Halo ambiental concentrado detrás de la orbe */}
      <div
        aria-hidden="true"
        className="omega-orb-breathe absolute h-[320px] w-[320px] md:h-[400px] md:w-[400px] rounded-full opacity-[0.34] blur-[76px]"
        style={{
          background:
            'radial-gradient(circle, #2F6FED 0%, #1D4ED8 46%, rgba(5, 7, 11, 0) 76%)',
        }}
      />

      {/* Base escultórica: 3 anillos concéntricos escalonados en perspectiva */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-10 md:-bottom-12 left-1/2 -translate-x-1/2 flex items-center justify-center"
        style={{ perspective: '900px' }}
      >
        <div
          className="relative flex items-center justify-center"
          style={{ transform: 'rotateX(68deg)' }}
        >
          {/* Anillo exterior */}
          <div
            className="h-[310px] w-[310px] md:h-[390px] md:w-[390px] rounded-full"
            style={{
              border: '1px solid rgba(96, 165, 250, 0.25)',
              background:
                'radial-gradient(circle, rgba(15, 23, 42, 0.35) 0%, rgba(11, 16, 27, 0.14) 68%, transparent 100%)',
              boxShadow: 'inset 0 1px 8px rgba(96, 165, 250, 0.16)',
            }}
          />
          {/* Anillo medio */}
          <div
            className="absolute h-[230px] w-[230px] md:h-[290px] md:w-[290px] rounded-full"
            style={{
              border: '1px solid rgba(96, 165, 250, 0.28)',
              background:
                'radial-gradient(circle, rgba(29, 78, 216, 0.16) 0%, rgba(7, 10, 18, 0.28) 72%, transparent 100%)',
              boxShadow: '0 0 24px rgba(47, 111, 237, 0.14)',
            }}
          />
          {/* Anillo interior */}
          <div
            className="absolute h-[155px] w-[155px] md:h-[195px] md:w-[195px] rounded-full"
            style={{
              border: '1px solid rgba(147, 197, 253, 0.32)',
              background:
                'radial-gradient(circle, rgba(47, 111, 237, 0.22) 0%, rgba(5, 7, 11, 0.45) 75%)',
            }}
          />
        </div>
      </div>

      {/* Orbe principal flotando suavemente (±5px en 6s) */}
      <motion.div
        animate={reducedMotion ? undefined : { y: [-5, 5, -5] }}
        transition={
          reducedMotion
            ? undefined
            : { duration: 6, repeat: Infinity, ease: 'easeInOut' }
        }
        className={`relative ${sizeClass} rounded-full`}
      >
        {/* Cuerpo de Cristal Obsidiana */}
        <div
          className="relative w-full h-full rounded-full overflow-hidden"
          style={{
            background:
              'radial-gradient(circle at 32% 28%, #161E31 0%, #070A12 52%, #030407 100%)',
            border: '1px solid rgba(255, 255, 255, 0.10)',
            boxShadow:
              'inset 0 -24px 48px rgba(0, 0, 0, 0.92), inset 0 2px 10px rgba(255, 255, 255, 0.14), 0 36px 90px rgba(0, 0, 0, 0.85)',
          }}
        >
          {/* Reflejo curvo de lente óptica */}
          <svg
            viewBox="0 0 380 380"
            fill="none"
            className="absolute inset-0 w-full h-full"
            style={{ filter: 'blur(1px)' }}
          >
            <defs>
              <linearGradient id={lensArcId} x1="68" y1="34" x2="292" y2="176" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.24" />
                <stop offset="48%" stopColor="#E2E8F0" stopOpacity="0.11" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M72 152C82 78 148 30 226 36C274 40 314 66 336 106C306 72 260 54 210 56C140 59 92 98 72 152Z"
              fill={`url(#${lensArcId})`}
            />
            <ellipse
              cx="126"
              cy="76"
              rx="56"
              ry="18"
              transform="rotate(-26 126 76)"
              fill="rgba(255, 255, 255, 0.08)"
            />
          </svg>
        </div>

        {/* Arco de luz azul rey orbitando el borde */}
        <div
          aria-hidden="true"
          className="omega-orb-spin omega-orb-ring-mask-glow pointer-events-none absolute -inset-[2px] rounded-full opacity-90"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, rgba(96, 165, 250, 0.9) 45deg, rgba(37, 99, 235, 0.85) 95deg, transparent 150deg)',
            filter: 'blur(8px)',
          }}
        />
        <div
          aria-hidden="true"
          className="omega-orb-spin omega-orb-ring-mask pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, rgba(96, 165, 250, 0.9) 45deg, rgba(37, 99, 235, 0.85) 95deg, transparent 150deg)',
          }}
        />

        {/* Isotipo Ω centrado */}
        <div className="absolute inset-0 flex items-center justify-center">
          <svg
            viewBox="0 0 120 120"
            fill="none"
            className="w-[96px] md:w-[118px] h-auto"
            style={{
              filter: 'drop-shadow(0 0 18px rgba(96, 165, 250, 0.28))',
            }}
          >
            <defs>
              <linearGradient id={omegaGradId} x1="60" y1="22" x2="60" y2="96" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#F8FAFC" />
                <stop offset="100%" stopColor="#CBD5E1" />
              </linearGradient>
            </defs>
            <path
              d="M49.2 92H32.4V83.1H43.5C37.5 77.4 33.9 69.5 33.9 60.5C33.9 45.3 45.3 33.8 60 33.8C74.7 33.8 86.1 45.3 86.1 60.5C86.1 69.5 82.5 77.4 76.5 83.1H87.6V92H70.8V82.2C75.6 77.6 78.4 70.2 78.4 61.1C78.4 49.6 70.6 41.2 60 41.2C49.4 41.2 41.6 49.6 41.6 61.1C41.6 70.2 44.4 77.6 49.2 82.2V92Z"
              fill={`url(#${omegaGradId})`}
            />
          </svg>
        </div>
      </motion.div>
    </div>
  );
}
