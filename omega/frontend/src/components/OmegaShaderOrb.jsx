import { OmegaLogo } from './OmegaLogo';

/**
 * Medallón arquitectónico de estado para el copiloto OMEGA.
 * Vidrio esmerilado oscuro (#0A0A0C / rgba(20,20,24,0.58)) con bisel especular,
 * cámara óptica interior y emblema Ω en relieve monocromático + acento #2F6FED.
 */
export function OmegaShaderOrb({
  size = 136,
  isThinking = false,
  className = '',
  label,
}) {
  const isCompact = size < 56;
  const dotSize = Math.max(5, Math.min(9, Math.round(size * 0.075)));
  const logoSize = Math.max(15, Math.round(size * (isCompact ? 0.74 : 0.66)));
  const outerRadius = isCompact
    ? Math.max(7, Math.round(size * 0.28))
    : Math.max(24, Math.round(size * 0.24));
  const innerRadius = Math.max(outerRadius - 6, 6);

  const ariaLabel =
    label ??
    (isThinking
      ? 'OMEGA analizando evidencia y generando respuesta'
      : 'Asistente OMEGA en espera');

  if (isCompact) {
    return (
      <div
        role="status"
        aria-live={isThinking ? 'polite' : 'off'}
        aria-label={ariaLabel}
        style={{
          width: size,
          height: size,
          borderRadius: `${outerRadius}px`,
          background: isThinking
            ? 'radial-gradient(circle at 30% 25%, rgba(47, 111, 237, 0.26) 0%, rgba(28, 36, 56, 0.86) 55%, rgba(10, 10, 12, 0.96) 100%)'
            : 'linear-gradient(155deg, rgba(28, 36, 56, 0.72) 0%, rgba(20, 20, 24, 0.92) 64%, rgba(10, 10, 12, 0.98) 100%)',
        }}
        className={`relative inline-flex items-center justify-center select-none shrink-0 border border-white/[0.12] border-b-black/55 border-r-black/55 transition-[border-color,box-shadow] duration-200 ${
          isThinking
            ? 'border-[#2F6FED]/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_20px_rgba(47,111,237,0.28)]'
            : 'shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_20px_rgba(0,0,0,0.5)]'
        } ${className}`}
      >
        <OmegaLogo size={logoSize} isThinking={isThinking} />
        <span
          aria-hidden="true"
          style={{ width: dotSize, height: dotSize }}
          className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-[#0A0A0C] transition-colors duration-200 ${
            isThinking
              ? 'bg-[#2F6FED] omega-core-pulse motion-reduce:animate-none'
              : 'bg-[#2F6FED]/85'
          }`}
        />
      </div>
    );
  }

  return (
    <div className={`relative inline-flex items-center justify-center select-none shrink-0 ${className}`}>
      {/* Campo óptico trasero para que el vidrio esmerilado refracte profundidad real */}
      <div
        aria-hidden="true"
        style={{
          width: Math.round(size * 1.48),
          height: Math.round(size * 1.48),
          background: isThinking
            ? 'radial-gradient(circle, rgba(47, 111, 237, 0.34) 0%, rgba(47, 111, 237, 0.12) 42%, rgba(10, 10, 12, 0) 72%)'
            : 'radial-gradient(circle, rgba(47, 111, 237, 0.24) 0%, rgba(28, 36, 56, 0.22) 45%, rgba(10, 10, 12, 0) 72%)',
        }}
        className="pointer-events-none absolute rounded-full transition-all duration-500"
      />

      {/* Medallón de vidrio esmerilado */}
      <div
        role="status"
        aria-live={isThinking ? 'polite' : 'off'}
        aria-label={ariaLabel}
        style={{
          width: size,
          height: size,
          borderRadius: `${outerRadius}px`,
          background: isThinking
            ? 'linear-gradient(155deg, rgba(28, 36, 56, 0.68) 0%, rgba(20, 20, 24, 0.62) 55%, rgba(10, 10, 12, 0.84) 100%)'
            : 'linear-gradient(155deg, rgba(255, 255, 255, 0.06) 0%, rgba(20, 20, 24, 0.58) 42%, rgba(12, 16, 28, 0.72) 100%)',
        }}
        className={`relative z-10 inline-flex items-center justify-center backdrop-blur-[16px] border border-white/[0.14] border-b-black/60 border-r-black/60 transition-[border-color,box-shadow] duration-300 ${
          isThinking
            ? 'border-[#2F6FED]/65 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_18px_46px_rgba(0,0,0,0.65),0_0_26px_rgba(47,111,237,0.28)]'
            : 'shadow-[inset_0_1px_1px_rgba(255,255,255,0.16),0_20px_50px_rgba(0,0,0,0.62),0_0_22px_rgba(47,111,237,0.14)]'
        }`}
      >
        {/* Bisel vítreo diagonal superior izquierdo */}
        <span
          aria-hidden="true"
          style={{ borderRadius: `${outerRadius}px` }}
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <span className="absolute -top-[28%] -left-[18%] h-[68%] w-[88%] rotate-[-14deg] bg-gradient-to-b from-white/[0.11] via-white/[0.03] to-transparent" />
        </span>

        {/* Cámara de calibración interior */}
        <span
          aria-hidden="true"
          style={{ borderRadius: `${innerRadius}px` }}
          className={`pointer-events-none absolute inset-[7px] border transition-colors duration-300 ${
            isThinking ? 'border-[#2F6FED]/35' : 'border-white/[0.07]'
          }`}
        />

        {/* Marcas ópticas de precisión en eje cardinal */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-[5px] left-1/2 -translate-x-1/2 h-[2px] w-4 rounded-full bg-white/[0.22]"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[5px] left-1/2 -translate-x-1/2 h-[2px] w-3 rounded-full bg-[#2F6FED]/45"
        />

        {/* Escudo OMEGA glassmórfico integrado */}
        <OmegaLogo
          size={logoSize}
          isThinking={isThinking}
          className="relative z-10"
        />

        {/* Piloto discreto de estado operativo */}
        <span
          aria-hidden="true"
          style={{ width: dotSize, height: dotSize }}
          className={`absolute bottom-[8px] right-[8px] rounded-full ring-2 ring-[#0A0A0C] transition-colors duration-200 ${
            isThinking
              ? 'bg-[#2F6FED] omega-core-pulse motion-reduce:animate-none'
              : 'bg-[#30D158]'
          }`}
        />
      </div>
    </div>
  );
}
