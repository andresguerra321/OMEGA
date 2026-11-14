/**
 * Indicador minimalista de estado para el copiloto OMEGA.
 * Orbe de vidrio esmerilado monocromático (reflejo blanco sutil + tinte #2F6FED).
 * Cero gradientes cónicos en loop infinito y cero consumo WebGL ocioso.
 */
export function OmegaShaderOrb({
  size = 136,
  isThinking = false,
  className = '',
  label,
}) {
  const isCompact = size < 56;
  const glyphSize = Math.max(11, Math.round(size * 0.44));
  const dotSize = Math.max(5, Math.min(10, Math.round(size * 0.085)));
  const ariaLabel =
    label ??
    (isThinking
      ? 'OMEGA analizando evidencia y generando respuesta'
      : 'Asistente OMEGA en espera');

  return (
    <div
      role="status"
      aria-live={isThinking ? 'polite' : 'off'}
      aria-label={ariaLabel}
      style={{
        width: size,
        height: size,
        background: isThinking
          ? 'radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.14) 0%, rgba(47, 111, 237, 0.28) 44%, rgba(20, 20, 24, 0.90) 82%, #0A0A0C 100%)'
          : 'radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.11) 0%, rgba(47, 111, 237, 0.16) 44%, rgba(20, 20, 24, 0.92) 84%, #0A0A0C 100%)',
      }}
      className={`relative inline-flex items-center justify-center rounded-full select-none shrink-0 border border-white/[0.12] border-b-black/50 border-r-black/50 transition-[border-color,box-shadow] duration-200 ${
        isThinking
          ? 'border-[#2F6FED]/65 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_0_24px_rgba(47,111,237,0.25)]'
          : 'shadow-[inset_0_1px_1px_rgba(255,255,255,0.14),0_10px_28px_rgba(0,0,0,0.55)]'
      } ${className}`}
    >
      {/* Reflejo vítreo estático superior izquierdo */}
      {!isCompact && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-[10%] left-[16%] h-[22%] w-[46%] rounded-full bg-white/[0.08] -rotate-12"
        />
      )}

      {/* Anillo interior técnico estático */}
      {!isCompact && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-[9%] rounded-full border transition-colors duration-200 ${
            isThinking ? 'border-[#2F6FED]/35' : 'border-white/[0.07]'
          }`}
        />
      )}

      {/* Glifo Omega plano de alto contraste */}
      <svg
        width={glyphSize}
        height={glyphSize}
        viewBox="0 0 80 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="relative z-10 text-[#F2F2F4]"
      >
        <path
          d="M34.2 55.2H22.8V47.6H29.1C25.5 44.1 23.4 39.3 23.4 33.9C23.4 24.3 30.7 17.2 40 17.2C49.3 17.2 56.6 24.3 56.6 33.9C56.6 39.3 54.5 44.1 50.9 47.6H57.2V55.2H45.8V47.2C48.9 44.3 50.6 39.9 50.6 34.4C50.6 27.4 45.9 22.4 40 22.4C34.1 22.4 29.4 27.4 29.4 34.4C29.4 39.9 31.1 44.3 34.2 47.2V55.2Z"
          fill="currentColor"
        />
      </svg>

      {/* Punto discreto de actividad: estático en reposo, pulso sutil únicamente en procesamiento */}
      <span
        aria-hidden="true"
        style={{ width: dotSize, height: dotSize }}
        className={`absolute bottom-[6%] right-[6%] rounded-full ring-2 ring-[#0A0A0C] transition-colors duration-200 ${
          isThinking
            ? 'bg-[#2F6FED] omega-core-pulse motion-reduce:animate-none'
            : 'bg-[#2F6FED]/85'
        }`}
      />
    </div>
  );
}
