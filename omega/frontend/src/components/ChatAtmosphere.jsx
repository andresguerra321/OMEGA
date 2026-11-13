/**
 * Capa atmosférica volumétrica restringida a la vista de chat.
 * Reproduce haces de luz tenues y diagonales desde la parte superior derecha
 * sobre el lienzo oscuro sin interferir con el contraste de lectura.
 */
export function ChatAtmosphere({ dimmed = false }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden select-none transition-opacity duration-500 ease-kowalski ${
        dimmed ? 'opacity-35' : 'opacity-100'
      }`}
    >
      {/* Bruma ambiental muy contenida en el eje superior */}
      <div
        className="absolute -top-32 left-1/2 h-[440px] w-[780px] -translate-x-1/2 rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(ellipse at 55% 24%, rgba(190, 210, 245, 0.06) 0%, rgba(47, 111, 237, 0.045) 38%, transparent 72%)',
        }}
      />

      {/* Haces diagonales discretos estilo LiLi 3.0 */}
      <div
        className="omega-ray-drift absolute -top-24 right-[-8%] h-[115%] w-[88%] origin-top-right"
        style={{
          maskImage:
            'radial-gradient(ellipse 72% 68% at 62% 14%, black 0%, rgba(0,0,0,0.65) 42%, transparent 82%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 72% 68% at 62% 14%, black 0%, rgba(0,0,0,0.65) 42%, transparent 82%)',
        }}
      >
        <div
          className="h-full w-full -rotate-[24deg] transform-gpu"
          style={{
            background: `repeating-linear-gradient(
              92deg,
              transparent 0px,
              transparent 36px,
              rgba(226, 232, 240, 0.032) 48px,
              rgba(255, 255, 255, 0.055) 62px,
              rgba(147, 197, 253, 0.022) 78px,
              transparent 104px,
              transparent 148px
            )`,
            filter: 'blur(9px)',
          }}
        />
      </div>

      {/* Suavizado inferior hacia el tono sólido del canvas */}
      <div
        className="absolute inset-x-0 bottom-0 h-56"
        style={{
          background: 'linear-gradient(to bottom, transparent, #0A0A0C 92%)',
        }}
      />
    </div>
  );
}

