import { useId } from 'react';

/**
 * Emblema de OMEGA: esfera de cristal oscuro con Ω sólida en azul #2F6FED.
 * Misma geometría que build/icon.svg (ícono de la app). `isThinking` intensifica
 * el núcleo y el halo. `framed` se conserva por compatibilidad: la esfera ya es
 * un contenedor en sí misma.
 */
export function OmegaLogo({
  size = 64,
  isThinking = false,
  // eslint-disable-next-line no-unused-vars
  framed = false,
  className = '',
}) {
  const uid = useId().replace(/:/g, '');
  const id = (name) => `omega-${name}-${uid}`;

  return (
    <div
      style={{ width: size, height: size }}
      className={`relative inline-flex items-center justify-center select-none shrink-0 ${className}`}
      aria-hidden="true"
    >
      {/* Halo atmosférico sin blur CSS para conservar presupuesto GPU */}
      <div
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(circle, rgba(47, 111, 237, 0.36) 0%, rgba(47, 111, 237, 0.08) 54%, transparent 74%)',
        }}
        className={`pointer-events-none absolute -inset-1.5 rounded-full transition-all duration-500 ease-kowalski ${
          isThinking ? 'omega-core-pulse opacity-90 scale-110' : 'opacity-45 scale-95'
        }`}
      />

      <svg
        viewBox="100 90 824 824"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10 w-full h-full drop-shadow-[0_5px_12px_rgba(0,0,0,0.6)]"
      >
        <defs>
          <radialGradient id={id('body')} cx="38%" cy="28%" r="85%">
            <stop offset="0%" stopColor="#3A4766" />
            <stop offset="38%" stopColor="#1B2236" />
            <stop offset="78%" stopColor="#0D111C" />
            <stop offset="100%" stopColor="#07090F" />
          </radialGradient>
          <radialGradient id={id('bounce')} cx="50%" cy="100%" r="62%">
            <stop offset="0%" stopColor="#2F6FED" stopOpacity={isThinking ? '0.6' : '0.38'} />
            <stop offset="100%" stopColor="#2F6FED" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id('rim')} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
            <stop offset="45%" stopColor="#9DB8F5" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#2F6FED" stopOpacity="0.75" />
          </linearGradient>
          <linearGradient id={id('spec')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={id('glyph')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9CC0FF" />
            <stop offset="50%" stopColor="#4F8BFF" />
            <stop offset="100%" stopColor="#2F6FED" />
          </linearGradient>
          <filter id={id('glow')} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
          <clipPath id={id('clip')}>
            <circle cx="512" cy="500" r="400" />
          </clipPath>
          <path
            id={id('omega')}
            d="M34.2 54.2H23.6V47.2H29.4C26.1 43.9 24.2 39.4 24.2 34.3C24.2 25.1 31.1 18.2 40 18.2C48.9 18.2 55.8 25.1 55.8 34.3C55.8 39.4 53.9 43.9 50.6 47.2H56.4V54.2H45.8V46.8C48.7 44.1 50.3 39.9 50.3 34.7C50.3 28 45.8 23.2 40 23.2C34.2 23.2 29.7 28 29.7 34.7C29.7 39.9 31.3 44.1 34.2 46.8V54.2Z"
          />
        </defs>

        <circle cx="512" cy="500" r="400" fill={`url(#${id('body')})`} />
        <g clipPath={`url(#${id('clip')})`}>
          <rect x="112" y="100" width="800" height="800" fill={`url(#${id('bounce')})`} />
        </g>
        <circle cx="512" cy="500" r="398" stroke={`url(#${id('rim')})`} strokeWidth="5" />
        <ellipse
          cx="410"
          cy="268"
          rx="230"
          ry="110"
          fill={`url(#${id('spec')})`}
          transform="rotate(-18 410 268)"
          opacity="0.8"
        />

        <g
          transform="translate(512 500) scale(10.4) translate(-40 -36.2)"
          fill="#2F6FED"
          filter={`url(#${id('glow')})`}
          opacity={isThinking ? '1' : '0.85'}
        >
          <use href={`#${id('omega')}`} />
        </g>
        <g transform="translate(512 500) scale(10.4) translate(-40 -36.2)">
          <use
            href={`#${id('omega')}`}
            fill={`url(#${id('glyph')})`}
            stroke="#CFE0FF"
            strokeOpacity="0.75"
            strokeWidth="0.35"
          />
        </g>
      </svg>
    </div>
  );
}
