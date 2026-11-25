import { useId } from 'react';

/**
 * Eclipse azul compacto replicado directamente del fondo del Login (`OmegaAuthBackdrop`)
 * con isotipo vectorial limpio de Ω centrado en su interior.
 * - Diámetro del círculo: 188px (dentro del rango 170px–200px).
 * - Altura del isotipo Ω: 84px (dentro del rango 76px–90px) en #E2E8F0 (opacidad ~0.88).
 * - Animación CSS pura (respiración sutil en la corona y deriva suave en el anillo interior).
 */
export function OmegaCompactEclipse({ focused = false, scanning = false, alert = false }) {
  const uid = useId().replace(/:/g, '');
  const clipId = `omegaHomeOrbClip-${uid}`;
  const bodyGradId = `omegaHomeOrbBody-${uid}`;
  const coronaGradId = `omegaHomeCorona-${uid}`;
  const rimGradId = `omegaHomeRim-${uid}`;
  const limbArcGradId = `omegaHomeLimbArc-${uid}`;
  const limbMaskId = `omegaHomeLimbMask-${uid}`;
  const outerBlurId = `omegaHomeOuterBlur-${uid}`;
  const midBlurId = `omegaHomeMidBlur-${uid}`;
  const innerBlurId = `omegaHomeInnerBlur-${uid}`;

  const primaryBlue = alert ? '#E5484D' : '#2563EB';
  const brightBlue = alert ? '#FCA5A5' : '#60A5FA';
  const active = focused || scanning;

  return (
    <div
      aria-hidden="true"
      className="omega-orb-enter relative flex items-center justify-center w-[188px] h-[188px] overflow-visible select-none pointer-events-none shrink-0"
    >
      {/* Halo exterior difuso con respiración continua (4.5s ease-in-out) */}
      <div
        className={`omega-eclipse-breathe-halo pointer-events-none absolute -inset-6 rounded-full blur-2xl transition-opacity duration-300 ${
          active ? 'opacity-100' : 'opacity-85'
        }`}
        style={{
          background: alert
            ? 'radial-gradient(circle, rgba(229, 72, 77, 0.34) 0%, rgba(153, 27, 27, 0.14) 55%, transparent 76%)'
            : 'radial-gradient(circle, rgba(59, 130, 246, 0.34) 0%, rgba(29, 78, 216, 0.14) 55%, transparent 76%)',
        }}
      />

      {/* Eclipse compacto del Login (círculo de diámetro real 188px con halo extendido sin recortes) */}
      <svg
        viewBox="0 0 280 280"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="pointer-events-none absolute -inset-[46px] h-[280px] w-[280px]"
      >
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <circle cx="140" cy="140" r="94" />
          </clipPath>

          <filter id={outerBlurId} filterUnits="userSpaceOnUse" x="0" y="0" width="280" height="280">
            <feGaussianBlur stdDeviation="12" />
          </filter>

          <filter id={midBlurId} filterUnits="userSpaceOnUse" x="0" y="0" width="280" height="280">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>

          <filter id={innerBlurId} filterUnits="userSpaceOnUse" x="0" y="0" width="280" height="280">
            <feGaussianBlur stdDeviation="8" />
          </filter>

          <radialGradient id={coronaGradId} cx="122" cy="158" r="126" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F2F2F4" stopOpacity={active ? '0.24' : '0.18'} />
            <stop offset="32%" stopColor={primaryBlue} stopOpacity={active ? '0.38' : '0.30'} />
            <stop offset="68%" stopColor="#1C2438" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#070A10" stopOpacity="0" />
          </radialGradient>

          <radialGradient id={bodyGradId} cx="96" cy="182" r="168" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={alert ? '#3B1820' : '#1C2D54'} stopOpacity="1" />
            <stop offset="28%" stopColor="#0E1424" stopOpacity="1" />
            <stop offset="66%" stopColor="#080B12" stopOpacity="1" />
            <stop offset="100%" stopColor="#05070B" stopOpacity="1" />
          </radialGradient>

          <linearGradient id={rimGradId} x1="48" y1="68" x2="220" y2="216" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={primaryBlue} stopOpacity="0.72" />
            <stop offset="28%" stopColor={brightBlue} stopOpacity="0.96" />
            <stop offset="52%" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="76%" stopColor={primaryBlue} stopOpacity="0.88" />
            <stop offset="100%" stopColor={primaryBlue} stopOpacity="0.32" />
          </linearGradient>

          <linearGradient id={limbArcGradId} x1="42" y1="224" x2="232" y2="54" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="48%" stopColor="#FFFFFF" stopOpacity="0.92" />
            <stop offset="76%" stopColor="#FFFFFF" stopOpacity="0.46" />
            <stop offset="94%" stopColor="#FFFFFF" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.04" />
          </linearGradient>

          <mask
            id={limbMaskId}
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="280"
            height="280"
          >
            <rect x="0" y="0" width="280" height="280" fill={`url(#${limbArcGradId})`} />
          </mask>
        </defs>

        {/* Corona luminosa exterior con respiración CSS sutil */}
        <circle
          cx="126"
          cy="154"
          r="122"
          fill={`url(#${coronaGradId})`}
          className="motion-safe:animate-eclipse-breathe"
          style={{ transformOrigin: '140px 140px' }}
        />

        {/* Núcleo oscuro sólido del eclipse (diámetro 188px) */}
        <circle cx="140" cy="140" r="94" fill={`url(#${bodyGradId})`} />

        {/* Volumen iluminado interno + anillo orbital fino */}
        <g clipPath={`url(#${clipId})`}>
          <circle
            cx="140"
            cy="140"
            r="91"
            stroke={primaryBlue}
            strokeWidth="12"
            strokeOpacity={active ? '0.68' : '0.54'}
            mask={`url(#${limbMaskId})`}
            filter={`url(#${innerBlurId})`}
          />
          <circle
            cx="140"
            cy="140"
            r="93"
            stroke={brightBlue}
            strokeWidth="3.5"
            strokeOpacity="0.48"
            mask={`url(#${limbMaskId})`}
            filter={`url(#${midBlurId})`}
          />
          <circle
            cx="140"
            cy="140"
            r="79"
            stroke={primaryBlue}
            strokeOpacity="0.14"
            strokeWidth="0.9"
            strokeDasharray="2.5 7.5"
            className="motion-safe:animate-orbit-drift"
            style={{ transformOrigin: '140px 140px' }}
          />
        </g>

        {/* Limbo incandescente tricapa sobre el contorno real del eclipse */}
        <g
          mask={`url(#${limbMaskId})`}
          className="motion-safe:animate-eclipse-breathe"
          style={{ transformOrigin: '140px 140px' }}
        >
          <circle
            cx="140"
            cy="140"
            r="94"
            stroke={primaryBlue}
            strokeWidth="9"
            strokeOpacity={active ? '0.78' : '0.64'}
            filter={`url(#${outerBlurId})`}
          />
          <circle
            cx="140"
            cy="140"
            r="94"
            stroke={brightBlue}
            strokeWidth="3.2"
            strokeOpacity={active ? '0.82' : '0.68'}
            filter={`url(#${midBlurId})`}
          />
          <circle
            cx="140"
            cy="140"
            r="94"
            stroke={`url(#${rimGradId})`}
            strokeWidth="1.6"
          />
        </g>
      </svg>

      {/* Aro luminoso vivo en conic-gradient enmascarado al borde (9s linear infinite) */}
      <div
        className={`pointer-events-none absolute inset-0 rounded-full transition-opacity duration-300 ${
          active ? 'opacity-100' : 'opacity-85'
        }`}
      >
        <div
          className="omega-eclipse-orbit-glow"
          style={active ? { animationDuration: '6.5s' } : undefined}
        />
        <div
          className="omega-eclipse-orbit-ring"
          style={active ? { animationDuration: '6.5s' } : undefined}
        />
      </div>

      {/* Isotipo vectorial limpio de Ω centrado (76px, blanco frío #E2E8F0) con flotación suave */}
      <svg
        viewBox="0 0 80 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="omega-glyph-float relative z-10 h-[76px] w-[76px]"
      >
        <path
          d="M33.2 55.6H22.2V49.8H29.4C25.5 46.1 23.2 40.9 23.2 35C23.2 25.1 30.6 17.6 40 17.6C49.4 17.6 56.8 25.1 56.8 35C56.8 40.9 54.5 46.1 50.6 49.8H57.8V55.6H46.8V49.2C50 46.2 51.9 41.3 51.9 35.4C51.9 27.9 46.8 22.4 40 22.4C33.2 22.4 28.1 27.9 28.1 35.4C28.1 41.3 30 46.2 33.2 49.2V55.6Z"
          fill="#E2E8F0"
          fillOpacity={active ? '0.92' : '0.86'}
        />
      </svg>
    </div>
  );
}
