import { useId } from 'react';

export const OMEGA_VECTOR_PATH =
  'M33.2 55.6H22.2V49.8H29.4C25.5 46.1 23.2 40.9 23.2 35C23.2 25.1 30.6 17.6 40 17.6C49.4 17.6 56.8 25.1 56.8 35C56.8 40.9 54.5 46.1 50.6 49.8H57.8V55.6H46.8V49.2C50 46.2 51.9 41.3 51.9 35.4C51.9 27.9 46.8 22.4 40 22.4C33.2 22.4 28.1 27.9 28.1 35.4C28.1 41.3 30 46.2 33.2 49.2V55.6Z';

/**
 * Orbe de cristal obsidiana Ω compartida entre Hero, Showcase y Modal.
 * Reproduce profundidad radial real, bisel especular azul rey y glifo vectorial Ω.
 */
export function OmegaSculptedOrb({
  sizeClass = 'w-[164px] h-[164px]',
  glyphSizeClass = 'h-16 w-16',
  haloStyle,
  ringAngleRef,
  glyphNode,
  compact = false,
  className = '',
  ariaLabel = 'Eclipse OMEGA',
  decorative = false,
}) {
  const uid = useId().replace(/:/g, '');
  const bodyGradId = `omegaOrbBody-${uid}`;
  const rimGradId = `omegaOrbRim-${uid}`;
  const lensGradId = `omegaOrbLens-${uid}`;
  const glyphGradId = `omegaOrbGlyph-${uid}`;

  return (
    <div
      aria-label={decorative ? undefined : ariaLabel}
      aria-hidden={decorative ? 'true' : undefined}
      role={decorative ? undefined : 'img'}
      className={`relative flex items-center justify-center select-none pointer-events-none ${sizeClass} ${className}`}
    >
      {/* Halo atmosférico contenido */}
      <div
        aria-hidden="true"
        className="omega-eclipse-breathe pointer-events-none absolute -inset-6 rounded-full blur-2xl"
        style={
          haloStyle || {
            background:
              'radial-gradient(circle, rgba(37, 99, 235, 0.34) 0%, rgba(29, 78, 216, 0.14) 54%, transparent 76%)',
          }
        }
      />

      {/* Cuerpo esférico en obsidiana + bisel especular */}
      <svg viewBox="0 0 180 180" fill="none" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id={bodyGradId} cx="62" cy="118" r="114" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1A2B56" />
            <stop offset="34%" stopColor="#0C1322" />
            <stop offset="72%" stopColor="#070A12" />
            <stop offset="100%" stopColor="#05070B" />
          </radialGradient>
          <linearGradient id={rimGradId} x1="24" y1="36" x2="152" y2="144" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#2563EB" stopOpacity="0.68" />
            <stop offset="45%" stopColor="#60A5FA" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#2563EB" stopOpacity="0.25" />
          </linearGradient>
          <radialGradient id={lensGradId} cx="64" cy="48" r="76" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.14" />
            <stop offset="55%" stopColor="#93C5FD" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#05070B" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="90" cy="90" r="88" fill={`url(#${bodyGradId})`} />
        {!compact && <circle cx="90" cy="90" r="87" fill={`url(#${lensGradId})`} />}
        <circle
          cx="90"
          cy="90"
          r="88"
          stroke={`url(#${rimGradId})`}
          strokeWidth={compact ? '1.5' : '1'}
          strokeOpacity="0.6"
        />
      </svg>

      {/* Aros refractivos cónicos giratorios */}
      <div
        ref={ringAngleRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full"
      >
        <div
          className="omega-orb-spin omega-orb-ring-mask-glow pointer-events-none absolute -inset-[2px] rounded-full opacity-80"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, rgba(96, 165, 250, 0.55) 55deg, rgba(37, 99, 235, 0.72) 110deg, transparent 180deg)',
            filter: 'blur(8px)',
          }}
        />
        <div
          className="omega-orb-spin omega-orb-ring-mask pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, rgba(96, 165, 250, 0.82) 55deg, rgba(37, 99, 235, 0.94) 110deg, transparent 180deg)',
          }}
        />
      </div>

      {/* Glifo vectorial Ω tallado con gradiente metálico frío */}
      {glyphNode || (
        <svg viewBox="0 0 80 80" fill="none" className={`omega-glyph-float relative z-10 ${glyphSizeClass}`}>
          <defs>
            <linearGradient id={glyphGradId} x1="22" y1="18" x2="58" y2="58" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.98" />
              <stop offset="65%" stopColor="#E2E8F0" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#93C5FD" stopOpacity="0.85" />
            </linearGradient>
          </defs>
          <path d={OMEGA_VECTOR_PATH} fill={`url(#${glyphGradId})`} />
        </svg>
      )}
    </div>
  );
}
