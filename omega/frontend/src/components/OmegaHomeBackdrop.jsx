import { useId } from 'react';

const HOME_STARFIELD = [
  { x: 118, y: 92, r: 0.85, o: 0.28, c: '#F8FAFC' },
  { x: 244, y: 164, r: 0.65, o: 0.2, c: '#8B95A5' },
  { x: 372, y: 84, r: 0.9, o: 0.26, c: '#2F6FED' },
  { x: 528, y: 138, r: 0.7, o: 0.22, c: '#F8FAFC' },
  { x: 696, y: 72, r: 0.8, o: 0.24, c: '#8B95A5' },
  { x: 164, y: 540, r: 0.75, o: 0.2, c: '#8B95A5' },
  { x: 292, y: 692, r: 0.85, o: 0.24, c: '#2F6FED' },
  { x: 1186, y: 586, r: 0.8, o: 0.24, c: '#2F6FED' },
  { x: 1312, y: 668, r: 0.75, o: 0.22, c: '#F8FAFC' },
  { x: 1034, y: 744, r: 0.7, o: 0.2, c: '#8B95A5' },
];

/**
 * Atmósfera ambiental de inicio OMEGA alineada con la identidad visual del Login:
 * - Lienzo obsidiana profundo #070A10 (sin agujero negro central ni formas circulares cerradas).
 * - Arco luminoso de gran escala recortado en la esquina superior derecha (#1D4ED8 / #2F6FED).
 * - Brillo radial contenido y casi imperceptible detrás del Command Center central.
 */
export function OmegaHomeBackdrop({ alert = false }) {
  const uid = useId().replace(/:/g, '');
  const arcGlowId = `omegaHomeArcGlow-${uid}`;
  const arcStrokeId = `omegaHomeArcStroke-${uid}`;
  const arcBlurId = `omegaHomeArcBlur-${uid}`;
  const arcFadeMaskId = `omegaHomeArcFade-${uid}`;
  const arcMaskGradId = `omegaHomeArcMaskGrad-${uid}`;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none bg-[#070A10]"
      style={{ contain: 'strict' }}
    >
      {/* Textura punteada técnica muy sutil atenuada hacia los bordes */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255, 255, 255, 0.04) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: 0.34,
          WebkitMaskImage:
            'radial-gradient(ellipse 72% 64% at 50% 42%, rgba(0,0,0,0.9) 0%, transparent 86%)',
          maskImage:
            'radial-gradient(ellipse 72% 64% at 50% 42%, rgba(0,0,0,0.9) 0%, transparent 86%)',
        }}
      />

      {/* Brillo ambiental casi imperceptible detrás del bloque central */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          background: alert
            ? 'radial-gradient(ellipse 46% 34% at 50% 42%, rgba(229, 72, 77, 0.08) 0%, rgba(47, 111, 237, 0.05) 42%, rgba(7, 10, 16, 0) 76%)'
            : 'radial-gradient(ellipse 48% 36% at 50% 42%, rgba(47, 111, 237, 0.09) 0%, rgba(29, 78, 216, 0.04) 44%, rgba(7, 10, 16, 0) 76%)',
        }}
      />

      {/* Curva luminosa de gran escala recortada en la esquina superior derecha (opacity: 0.22) */}
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <filter
            id={arcBlurId}
            filterUnits="userSpaceOnUse"
            x="420"
            y="-480"
            width="1400"
            height="1200"
          >
            <feGaussianBlur stdDeviation="28" />
          </filter>

          <radialGradient
            id={arcGlowId}
            cx="1160"
            cy="120"
            r="640"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor={alert ? '#E5484D' : '#2F6FED'} stopOpacity="0.22" />
            <stop offset="38%" stopColor={alert ? '#991B1B' : '#1D4ED8'} stopOpacity="0.14" />
            <stop offset="72%" stopColor="#1E293B" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#070A10" stopOpacity="0" />
          </radialGradient>

          <linearGradient
            id={arcStrokeId}
            x1="820"
            y1="120"
            x2="1380"
            y2="460"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#1D4ED8" stopOpacity="0" />
            <stop offset="32%" stopColor="#2F6FED" stopOpacity="0.72" />
            <stop offset="56%" stopColor="#93C5FD" stopOpacity="0.88" />
            <stop offset="82%" stopColor="#1D4ED8" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#1D4ED8" stopOpacity="0" />
          </linearGradient>

          <linearGradient
            id={arcMaskGradId}
            x1="780"
            y1="480"
            x2="1420"
            y2="-40"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.15" />
            <stop offset="48%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="88%" stopColor="#FFFFFF" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>

          <mask
            id={arcFadeMaskId}
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
            x="400"
            y="-480"
            width="1400"
            height="1200"
          >
            <rect x="400" y="-480" width="1400" height="1200" fill={`url(#${arcMaskGradId})`} />
          </mask>
        </defs>

        {/* Puntos estelares mínimos para continuidad atmosférica */}
        <g>
          {HOME_STARFIELD.map((star, idx) => (
            <circle
              key={idx}
              cx={star.x}
              cy={star.y}
              r={star.r}
              fill={star.c}
              fillOpacity={star.o}
            />
          ))}
        </g>

        {/* Resplandor difuso superior derecho (opacity máx 0.22) */}
        <circle cx="1160" cy="120" r="620" fill={`url(#${arcGlowId})`} />

        {/* Arco ambiental recortado fuera del lienzo (cero círculo cerrado en pantalla) */}
        <g mask={`url(#${arcFadeMaskId})`} opacity="0.22">
          <path
            d="M 800 -60 A 660 660 0 0 0 1520 510"
            stroke="#1D4ED8"
            strokeWidth="44"
            strokeLinecap="round"
            filter={`url(#${arcBlurId})`}
          />
          <path
            d="M 800 -60 A 660 660 0 0 0 1520 510"
            stroke={`url(#${arcStrokeId})`}
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </g>
      </svg>

      {/* Grano fino para suavizar gradientes oscuros */}
      <div className="omega-film-grain absolute inset-0 opacity-70" />
    </div>
  );
}
