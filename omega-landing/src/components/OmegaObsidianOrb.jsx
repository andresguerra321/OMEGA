import { useId } from 'react';

/**
 * Orbe de Cristal Obsidiana de OMEGA en CSS/SVG puro (60fps):
 * vidrio negro pulido, reflejo curvo de lente óptica, arco orbital azul rey,
 * isotipo Ω centrado con degradado sutil y micro-paralaje al cursor.
 */
export function OmegaObsidianOrb({ parallax = { x: 0, y: 0 } }) {
  const uid = useId().replace(/:/g, '');
  const omegaGradId = `omegaOrbGlyph-${uid}`;
  const lensArcId = `omegaOrbLens-${uid}`;

  const orbTx = parallax.x * 6;
  const orbTy = parallax.y * 6;
  const lensTx = parallax.x * -4;
  const lensTy = parallax.y * -4;

  return (
    <div
      aria-label="Orbe de Cristal Obsidiana de OMEGA"
      role="img"
      className="relative flex items-center justify-center w-[300px] h-[300px] md:w-[380px] md:h-[380px] select-none pointer-events-none"
    >
      {/* 1. Halo ambiental contenido detrás */}
      <div
        aria-hidden="true"
        className="omega-orb-breathe absolute -inset-8 rounded-full opacity-[0.28]"
        style={{
          background:
            'radial-gradient(circle, rgba(37, 99, 235, 0.92) 0%, rgba(29, 78, 216, 0.55) 45%, rgba(5, 7, 11, 0) 74%)',
          filter: 'blur(64px)',
        }}
      />

      {/* Contenedor físico de la esfera con micro-paralaje suave */}
      <div
        className="relative w-full h-full rounded-full transition-transform duration-300 ease-out"
        style={{
          transform: `translate3d(${orbTx.toFixed(2)}px, ${orbTy.toFixed(2)}px, 0)`,
        }}
      >
        {/* 2. Cuerpo de la esfera (Cristal Obsidiana) */}
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
          {/* 3. Reflejo curvo de lente de vidrio óptico (con leve contramovimiento al cursor) */}
          <svg
            viewBox="0 0 380 380"
            fill="none"
            className="absolute inset-0 w-full h-full transition-transform duration-300 ease-out"
            style={{
              transform: `translate3d(${lensTx.toFixed(2)}px, ${lensTy.toFixed(2)}px, 0)`,
              filter: 'blur(1px)',
            }}
          >
            <defs>
              <linearGradient id={lensArcId} x1="68" y1="34" x2="292" y2="176" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
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

        {/* 4. Arco de luz azul rey orbitando el borde (anillo nítido + halo difuso sincronizado) */}
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

        {/* 5. Isotipo Ω centrado adentro */}
        <div className="absolute inset-0 flex items-center justify-center">
          <svg
            viewBox="0 0 120 120"
            fill="none"
            className="w-[100px] md:w-[125px] h-auto"
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
      </div>
    </div>
  );
}
