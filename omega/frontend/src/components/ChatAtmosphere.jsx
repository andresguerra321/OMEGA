/**
 * ChatAtmosphere — Campo nocturno estructural OMEGA (#0A0A0C).
 * Provee cuadrícula punteada de 24px, ruido orgánico film-grain (2.5%) y
 * focos atmosféricos monocromáticos en #2F6FED para que los paneles de vidrio
 * esmerilado tengan textura real detrás sin sobrecargar la GPU.
 */
export function ChatAtmosphere({
  variant = 'workspace',
  showWaves = true,
  dimmed = false,
}) {
  const isStage = variant === 'stage';

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden z-0 select-none transform-gpu"
      style={{ backgroundColor: '#0A0A0C', contain: 'strict' }}
    >
      {/* Textura micro-punteada de 24px (visible bajo los paneles translúcidos) */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255, 255, 255, 0.05) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: dimmed ? 0.55 : isStage ? 0.92 : 0.78,
        }}
      />

      {/* Iluminación focal contenida en #2F6FED + profundidad cenital */}
      <div
        className="absolute inset-0"
        style={{
          background: isStage
            ? 'radial-gradient(ellipse 68% 48% at 50% 42%, rgba(47, 111, 237, 0.14) 0%, rgba(28, 36, 56, 0.12) 45%, rgba(10, 10, 12, 0.94) 86%)'
            : 'radial-gradient(ellipse 64% 42% at 50% 10%, rgba(47, 111, 237, 0.08) 0%, rgba(10, 10, 12, 0.92) 78%)',
        }}
      />

      {/* Focos laterales monocromáticos discretos detrás del vidrio esmerilado */}
      {!dimmed && (
        <>
          <div className="omega-fold-left" />
          <div className="omega-fold-right" />
        </>
      )}

      {/* Onda arquitectónica sutil para aportar contraste horizontal tras el vidrio */}
      {showWaves && (
        <svg
          viewBox="0 0 1440 480"
          preserveAspectRatio="none"
          className={`absolute left-0 right-0 bottom-0 w-full ${isStage
            ? 'h-[36vh] sm:h-[40vh] opacity-40'
            : 'h-[26vh] sm:h-[30vh] opacity-25'
            }`}
          fill="none"
        >
          <path
            d="M0 320 C 320 265, 620 355, 960 285 C 1220 230, 1340 265, 1440 245"
            stroke="rgba(47, 111, 237, 0.16)"
            strokeWidth="1"
          />
          <path
            d="M0 375 C 360 325, 720 405, 1080 340 C 1280 305, 1370 330, 1440 315"
            stroke="rgba(255, 255, 255, 0.05)"
            strokeWidth="1"
          />
        </svg>
      )}

      {/* Textura orgánica film-grain 2.5% para realismo táctil en vidrio esmerilado */}
      <div className="omega-film-grain absolute inset-0" />

      {/* Raíles arquitectónicos verticales discretos */}
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-full max-w-[1320px] border-x border-white/[0.035]" />
    </div>
  );
}
