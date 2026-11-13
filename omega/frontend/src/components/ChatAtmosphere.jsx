/**
 * ChatAtmosphere — Luz atmosférica silenciosa de fondo (estilo Apple Obsidian).
 * Iluminación radial profunda en cobalto tenue con transición suave al modo de lectura.
 */
export function ChatAtmosphere({ dimmed = false }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden select-none transition-opacity duration-700 ease-apple ${
        dimmed ? 'opacity-25' : 'opacity-100'
      }`}
    >
      {/* Halo óptico superior central muy suave */}
      <div
        className="absolute -top-44 left-1/2 -translate-x-1/2 h-[420px] w-[760px]"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(47, 111, 237, 0.14) 0%, rgba(47, 111, 237, 0.045) 45%, rgba(8, 8, 10, 0) 76%)',
        }}
      />

      {/* Haz diagonal volumétrico sutil */}
      <div className="omega-ray-drift absolute -top-28 right-[-8%] h-[112%] w-[86%] origin-top-right">
        <div
          className="h-full w-full"
          style={{
            background:
              'radial-gradient(ellipse 68% 58% at 78% 12%, rgba(74, 134, 247, 0.105) 0%, rgba(47, 111, 237, 0.04) 44%, rgba(8, 8, 10, 0) 76%)',
          }}
        />
      </div>

      {/* Difusión inferior hacia el lienzo obsidiana #08080A */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(8, 8, 10, 0) 0%, rgba(8, 8, 10, 0.25) 62%, #08080A 100%)',
        }}
      />
    </div>
  );
}
