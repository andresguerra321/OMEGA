import { useId } from 'react';

const STARFIELD = [
  { x: 96, y: 84, r: 0.9, o: 0.34, c: '#F2F2F4' },
  { x: 162, y: 148, r: 0.65, o: 0.24, c: '#9A9AA2' },
  { x: 288, y: 74, r: 1.05, o: 0.42, c: '#F2F2F4' },
  { x: 356, y: 122, r: 0.7, o: 0.26, c: '#2F6FED' },
  { x: 432, y: 66, r: 0.85, o: 0.36, c: '#F2F2F4' },
  { x: 518, y: 118, r: 0.65, o: 0.22, c: '#9A9AA2' },
  { x: 614, y: 58, r: 1.0, o: 0.44, c: '#F2F2F4' },
  { x: 682, y: 142, r: 0.75, o: 0.28, c: '#9A9AA2' },
  { x: 74, y: 274, r: 0.8, o: 0.32, c: '#F2F2F4' },
  { x: 142, y: 342, r: 1.15, o: 0.45, c: '#F2F2F4' },
  { x: 208, y: 416, r: 0.65, o: 0.22, c: '#9A9AA2' },
  { x: 314, y: 298, r: 0.85, o: 0.36, c: '#2F6FED' },
  { x: 392, y: 382, r: 0.75, o: 0.26, c: '#F2F2F4' },
  { x: 468, y: 244, r: 0.95, o: 0.34, c: '#F2F2F4' },
  { x: 534, y: 316, r: 0.65, o: 0.2, c: '#9A9AA2' },
  { x: 644, y: 228, r: 0.8, o: 0.32, c: '#F2F2F4' },
  { x: 92, y: 532, r: 1.05, o: 0.38, c: '#F2F2F4' },
  { x: 174, y: 618, r: 0.7, o: 0.24, c: '#9A9AA2' },
  { x: 256, y: 564, r: 0.8, o: 0.3, c: '#2F6FED' },
  { x: 342, y: 644, r: 0.95, o: 0.36, c: '#F2F2F4' },
  { x: 418, y: 572, r: 0.6, o: 0.2, c: '#9A9AA2' },
  { x: 486, y: 688, r: 0.85, o: 0.32, c: '#F2F2F4' },
  { x: 118, y: 764, r: 0.8, o: 0.28, c: '#F2F2F4' },
  { x: 228, y: 814, r: 1.05, o: 0.34, c: '#F2F2F4' },
  { x: 388, y: 792, r: 0.7, o: 0.22, c: '#9A9AA2' },
  { x: 562, y: 762, r: 0.9, o: 0.3, c: '#F2F2F4' },
  { x: 684, y: 818, r: 0.75, o: 0.26, c: '#2F6FED' },
  { x: 786, y: 754, r: 1.0, o: 0.35, c: '#F2F2F4' },
  { x: 892, y: 696, r: 0.75, o: 0.28, c: '#9A9AA2' },
  { x: 964, y: 784, r: 1.1, o: 0.42, c: '#F2F2F4' },
  { x: 1048, y: 716, r: 0.85, o: 0.34, c: '#2F6FED' },
  { x: 1124, y: 812, r: 0.75, o: 0.26, c: '#F2F2F4' },
  { x: 1218, y: 684, r: 0.95, o: 0.38, c: '#F2F2F4' },
  { x: 1296, y: 768, r: 0.7, o: 0.24, c: '#9A9AA2' },
  { x: 1364, y: 652, r: 1.1, o: 0.4, c: '#F2F2F4' },
  { x: 1392, y: 794, r: 0.8, o: 0.3, c: '#F2F2F4' },
  { x: 842, y: 626, r: 0.75, o: 0.3, c: '#F2F2F4' },
  { x: 1094, y: 642, r: 0.85, o: 0.32, c: '#9A9AA2' },
  { x: 1246, y: 586, r: 0.9, o: 0.34, c: '#2F6FED' },
  { x: 1338, y: 562, r: 0.75, o: 0.28, c: '#F2F2F4' },
  { x: 46, y: 178, r: 0.7, o: 0.24, c: '#9A9AA2' },
  { x: 54, y: 418, r: 0.9, o: 0.3, c: '#F2F2F4' },
  { x: 48, y: 694, r: 0.65, o: 0.22, c: '#9A9AA2' },
  { x: 598, y: 684, r: 0.65, o: 0.24, c: '#F2F2F4' },
  { x: 746, y: 856, r: 0.75, o: 0.25, c: '#9A9AA2' },
  { x: 924, y: 862, r: 0.85, o: 0.3, c: '#F2F2F4' },
];

/**
 * Escena orbital monocromática de fondo para la pantalla de acceso OMEGA.
 * Combina cielo nocturno #0A0A0C, campo estelar determinista, satélite lejano y
 * una esfera de eclipse monumental cuyo limbo luminoso #FFFFFF -> #2F6FED
 * pasa directamente detrás del cuadrante superior derecho de la tarjeta de vidrio.
 */
export function OmegaAuthBackdrop() {
  const uid = useId().replace(/:/g, '');
  const planetClipId = `omegaOrbClip-${uid}`;
  const planetBodyId = `omegaOrbBody-${uid}`;
  const limbArcGradId = `omegaLimbArc-${uid}`;
  const limbGlowMaskId = `omegaLimbGlowMask-${uid}`;
  const coronaGlowId = `omegaCoronaGlow-${uid}`;
  const flareGlowId = `omegaFlareGlow-${uid}`;
  const moonFillId = `omegaMoonFill-${uid}`;
  const rimGradId = `omegaRimGrad-${uid}`;
  const moonBlurId = `omegaMoonBlur-${uid}`;
  const limbBlurId = `omegaLimbBlur-${uid}`;
  const midBlurId = `omegaMidBlur-${uid}`;
  const innerRimBlurId = `omegaInnerRimBlur-${uid}`;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
      style={{ backgroundColor: '#0A0A0C' }}
    >
      {/* Textura punteada estructural atenuada radialmente hacia los bordes */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255, 255, 255, 0.045) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: 0.42,
          WebkitMaskImage:
            'radial-gradient(ellipse 74% 68% at 52% 48%, rgba(0,0,0,0.95) 0%, transparent 88%)',
          maskImage:
            'radial-gradient(ellipse 74% 68% at 52% 48%, rgba(0,0,0,0.95) 0%, transparent 88%)',
        }}
      />

      {/* Dispersión atmosférica azul cobalto orientada hacia el vidrio esmerilado */}
      <div
        className="absolute inset-0 motion-safe:animate-eclipse-breathe"
        style={{
          transformOrigin: '64% 38%',
          background:
            'radial-gradient(circle 48vmax at 64% 38%, rgba(47, 111, 237, 0.24) 0%, rgba(28, 36, 56, 0.18) 38%, rgba(10, 10, 12, 0) 74%)',
        }}
      />

      {/* Escena celeste e identidad orbital OMEGA en SVG de alta precisión */}
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <clipPath id={planetClipId} clipPathUnits="userSpaceOnUse">
            <circle cx="1152" cy="180" r="432" />
          </clipPath>

          <filter
            id={moonBlurId}
            filterUnits="userSpaceOnUse"
            x="100"
            y="80"
            width="260"
            height="260"
          >
            <feGaussianBlur stdDeviation="12" />
          </filter>

          <filter
            id={limbBlurId}
            filterUnits="userSpaceOnUse"
            x="540"
            y="-400"
            width="1200"
            height="1220"
          >
            <feGaussianBlur stdDeviation="22" />
          </filter>

          <filter
            id={midBlurId}
            filterUnits="userSpaceOnUse"
            x="540"
            y="-400"
            width="1200"
            height="1220"
          >
            <feGaussianBlur stdDeviation="5.5" />
          </filter>

          <filter
            id={innerRimBlurId}
            filterUnits="userSpaceOnUse"
            x="540"
            y="-400"
            width="1200"
            height="1220"
          >
            <feGaussianBlur stdDeviation="16" />
          </filter>

          <radialGradient id={moonFillId} cx="68%" cy="68%" r="72%">
            <stop offset="0%" stopColor="#F2F2F4" stopOpacity="0.22" />
            <stop offset="48%" stopColor="#2F6FED" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#0A0A0C" stopOpacity="0" />
          </radialGradient>

          <radialGradient
            id={coronaGlowId}
            cx="815"
            cy="390"
            r="520"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#F2F2F4" stopOpacity="0.30" />
            <stop offset="22%" stopColor="#2F6FED" stopOpacity="0.44" />
            <stop offset="56%" stopColor="#1C2438" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0A0A0C" stopOpacity="0" />
          </radialGradient>

          <radialGradient
            id={flareGlowId}
            cx="776"
            cy="364"
            r="176"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.32" />
            <stop offset="34%" stopColor="#9BC0FF" stopOpacity="0.22" />
            <stop offset="70%" stopColor="#2F6FED" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#2F6FED" stopOpacity="0" />
          </radialGradient>

          <radialGradient
            id={planetBodyId}
            cx="770"
            cy="392"
            r="740"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#1C2D54" stopOpacity="1" />
            <stop offset="24%" stopColor="#0E1424" stopOpacity="1" />
            <stop offset="62%" stopColor="#0A0A0C" stopOpacity="1" />
            <stop offset="100%" stopColor="#070709" stopOpacity="1" />
          </radialGradient>

          {/* Limbo luminoso nítido con foco incandescente tras la esquina superior derecha */}
          <linearGradient
            id={rimGradId}
            x1="740"
            y1="20"
            x2="1320"
            y2="560"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#2F6FED" stopOpacity="0.72" />
            <stop offset="28%" stopColor="#8DB8FF" stopOpacity="0.96" />
            <stop offset="52%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="76%" stopColor="#2F6FED" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#2F6FED" stopOpacity="0.42" />
          </linearGradient>

          {/* Máscara diagonal continua de hemisferio suroeste iluminado -> sombra noreste */}
          <linearGradient
            id={limbArcGradId}
            x1="680"
            y1="560"
            x2="1320"
            y2="40"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="46%" stopColor="#FFFFFF" stopOpacity="0.94" />
            <stop offset="76%" stopColor="#FFFFFF" stopOpacity="0.52" />
            <stop offset="94%" stopColor="#FFFFFF" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>

          <mask
            id={limbGlowMaskId}
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
            x="400"
            y="-400"
            width="1360"
            height="1400"
          >
            <rect
              x="400"
              y="-400"
              width="1360"
              height="1400"
              fill={`url(#${limbArcGradId})`}
            />
          </mask>
        </defs>

        {/* Campo estelar distante (queda ocluido tras la esfera sólida) */}
        <g>
          {STARFIELD.map((star, idx) => (
            <circle
              key={idx}
              cx={star.x}
              cy={star.y}
              r={star.r}
              fill={star.c}
              fillOpacity={star.o}
              className={idx % 3 === 0 ? 'motion-safe:animate-star-twinkle' : undefined}
              style={
                idx % 3 === 0
                  ? { animationDelay: `${((idx % 7) * 0.65).toFixed(2)}s` }
                  : undefined
              }
            />
          ))}
        </g>

        {/* Satélite lejano desenfocado para equilibrar la diagonal superior izquierda */}
        <circle
          cx="228"
          cy="214"
          r="42"
          fill={`url(#${moonFillId})`}
          filter={`url(#${moonBlurId})`}
          className="motion-safe:animate-satellite-drift"
        />

        {/* Corona luminosa exterior detrás del eclipse */}
        <circle
          cx="815"
          cy="390"
          r="500"
          fill={`url(#${coronaGlowId})`}
          className="motion-safe:animate-eclipse-breathe"
          style={{ transformOrigin: '815px 390px' }}
        />

        {/* Núcleo sólido de la esfera orbital OMEGA */}
        <circle cx="1152" cy="180" r="432" fill={`url(#${planetBodyId})`} />

        {/* Volumen iluminado interno + identidad orbital OMEGA recortada al hemisferio */}
        <g clipPath={`url(#${planetClipId})`}>
          <circle
            cx="1152"
            cy="180"
            r="424"
            stroke="#2F6FED"
            strokeWidth="42"
            strokeOpacity="0.62"
            mask={`url(#${limbGlowMaskId})`}
            filter={`url(#${innerRimBlurId})`}
          />
          <circle
            cx="1152"
            cy="180"
            r="429"
            stroke="#A5C7FF"
            strokeWidth="12"
            strokeOpacity="0.48"
            mask={`url(#${limbGlowMaskId})`}
            filter={`url(#${innerRimBlurId})`}
          />

          {/* Meridianos telemétricos y monograma Ω grabado en baja intensidad */}
          <ellipse
            cx="1090"
            cy="204"
            rx="288"
            ry="396"
            transform="rotate(-18 1090 204)"
            stroke="#F2F2F4"
            strokeOpacity="0.048"
            strokeWidth="1"
          />
          <circle
            cx="1152"
            cy="180"
            r="356"
            stroke="#2F6FED"
            strokeOpacity="0.11"
            strokeWidth="1"
            strokeDasharray="3 9"
            className="motion-safe:animate-orbit-drift"
            style={{ transformOrigin: '1152px 180px' }}
          />
          <path
            d="M1018 326H982V301.8H1002.2C990.8 290.8 983.8 275.5 983.8 258.1C983.8 227.6 1007 204.8 1042.6 204.8C1078.2 204.8 1101.4 227.6 1101.4 258.1C1101.4 275.5 1094.4 290.8 1083 301.8H1103.2V326H1067.4V300.5C1077.1 291.1 1082.6 277.3 1082.6 259.7C1082.6 237.3 1067.6 221.3 1042.6 221.3C1017.6 221.3 1002.6 237.3 1002.6 259.7C1002.6 277.3 1008.1 291.1 1017.8 300.5V326Z"
            stroke="#F2F2F4"
            strokeOpacity="0.065"
            strokeWidth="1.25"
            fill="#2F6FED"
            fillOpacity="0.02"
          />
        </g>

        {/* Limbo incandescente tricapa sobre el contorno real de la esfera */}
        <g mask={`url(#${limbGlowMaskId})`}>
          <circle
            cx="1152"
            cy="180"
            r="432"
            stroke="#2F6FED"
            strokeWidth="28"
            strokeOpacity="0.68"
            filter={`url(#${limbBlurId})`}
          />
          <circle
            cx="1152"
            cy="180"
            r="432"
            stroke="#8DB8FF"
            strokeWidth="9"
            strokeOpacity="0.72"
            filter={`url(#${midBlurId})`}
          />
          <circle
            cx="1152"
            cy="180"
            r="432"
            stroke={`url(#${rimGradId})`}
            strokeWidth="2.8"
          />
        </g>

        {/* Destello focal suave detrás de la esquina superior derecha del panel de vidrio */}
        <circle
          cx="776"
          cy="364"
          r="176"
          fill={`url(#${flareGlowId})`}
          className="motion-safe:animate-eclipse-breathe"
          style={{ transformOrigin: '776px 364px', animationDelay: '1.2s' }}
        />
      </svg>

      {/* Textura orgánica film-grain 2.5% para suavizar degradados */}
      <div className="omega-film-grain absolute inset-0" />
    </div>
  );
}
