/**
 * ChatAtmosphere — Retícula arquitectónica discreta en plano de estudio (#05070B).
 */
export function ChatAtmosphere({ dimmed = false }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden select-none transition-opacity duration-500 ease-apple ${
        dimmed ? 'opacity-20' : 'opacity-65'
      }`}
    >
      {/* Líneas guía verticales de estudio alineadas al contenedor */}
      <div className="mx-auto h-full max-w-[1320px] border-x border-white/[0.04]" />

      {/* Micro-punteado arquitectónico en tono tenue */}
      <div
        className="absolute inset-0 opacity-45"
        style={{
          backgroundImage: 'radial-gradient(rgba(148, 163, 184, 0.14) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Viñeta sutil hacia negro mate #05070B */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 68% 54% at 50% 42%, transparent 0%, rgba(5, 7, 11, 0.72) 78%, #05070B 100%)',
        }}
      />
    </div>
  );
}
