/**
 * Indicador minimalista de estado para el copiloto OMEGA.
 * Sello arquitectónico mate en obsidiana con glifo Ω plano y punto de telemetría
 * que solo pulsa cuando el motor está procesando (`isThinking === true`).
 * Cero gradientes cónicos, cero blurs en loop infinito y cero consumo WebGL ocioso.
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
      style={{ width: size, height: size }}
      className={`relative inline-flex items-center justify-center rounded-full select-none shrink-0 bg-[#060C1A] border transition-colors duration-200 ${
        isThinking
          ? 'border-[#3B82F6]/65 shadow-[inset_0_1px_0_rgba(147,197,253,0.22),0_0_0_1px_rgba(59,130,246,0.18)]'
          : 'border-[#93C5FD]/20 shadow-[inset_0_1px_0_rgba(147,197,253,0.10)]'
      } ${className}`}
    >
      {/* Anillo interior técnico estático (solo en formatos medianos/grandes) */}
      {!isCompact && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-[9%] rounded-full border transition-colors duration-200 ${
            isThinking ? 'border-[#3B82F6]/30' : 'border-[#93C5FD]/10'
          }`}
        />
      )}

      {/* Glifo Omega plano y de alto contraste */}
      <svg
        width={glyphSize}
        height={glyphSize}
        viewBox="0 0 80 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className={`relative z-10 transition-colors duration-200 ${
          isThinking ? 'text-[#F8FAFC]' : 'text-[#E2E8F0]'
        }`}
      >
        <path
          d="M34.2 55.2H22.8V47.6H29.1C25.5 44.1 23.4 39.3 23.4 33.9C23.4 24.3 30.7 17.2 40 17.2C49.3 17.2 56.6 24.3 56.6 33.9C56.6 39.3 54.5 44.1 50.9 47.6H57.2V55.2H45.8V47.2C48.9 44.3 50.6 39.9 50.6 34.4C50.6 27.4 45.9 22.4 40 22.4C34.1 22.4 29.4 27.4 29.4 34.4C29.4 39.9 31.1 44.3 34.2 47.2V55.2Z"
          fill="currentColor"
        />
      </svg>

      {/* Punto discreto de actividad: estático en reposo, pulso sutil únicamente en carga */}
      <span
        aria-hidden="true"
        style={{ width: dotSize, height: dotSize }}
        className={`absolute bottom-[6%] right-[6%] rounded-full ring-2 ring-[#060C1A] transition-colors duration-200 ${
          isThinking
            ? 'bg-[#3B82F6] omega-core-pulse motion-reduce:animate-none'
            : 'bg-[#1D4ED8]/80'
        }`}
      />
    </div>
  );
}
