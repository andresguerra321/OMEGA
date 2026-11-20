/**
 * Esfera óptica de cristal líquido nativa de OMEGA con refracción de luz interna.
 * Acelerada por GPU (transform, opacity, will-change-transform), sin librerías externas.
 *
 * @param {{ size?: number, state?: 'idle' | 'thinking' | 'loading', className?: string, label?: string }} props
 */
export function OmegaCoreOrb({
  size = 76,
  state = 'idle',
  className = '',
  label,
}) {
  const isThinking = state === 'thinking' || state === 'loading';
  const glyphSize = Math.max(18, Math.round(size * 0.37));
  const ariaLabel =
    label ??
    (isThinking
      ? 'OMEGA IA analizando evidencia y generando respuesta'
      : 'OMEGA IA en espera');

  return (
    <div
      role="status"
      aria-live={isThinking ? 'polite' : 'off'}
      aria-label={ariaLabel}
      style={{
        width: size,
        height: size,
        background:
          'radial-gradient(circle at 32% 26%, #0F172A 0%, #080B12 68%, #05070B 100%)',
        animation: isThinking
          ? 'omega-orb-breathe 1.8s ease-in-out infinite'
          : 'omega-orb-breathe 4s ease-in-out infinite',
      }}
      className={`relative inline-flex items-center justify-center rounded-full overflow-hidden select-none shrink-0 border border-white/[0.12] will-change-transform motion-reduce:animate-none transition-shadow duration-500 ${
        isThinking
          ? 'shadow-[inset_0_2px_14px_rgba(255,255,255,0.22),inset_0_-10px_24px_rgba(47,111,237,0.55),0_12px_42px_rgba(47,111,237,0.38)]'
          : 'shadow-[inset_0_2px_12px_rgba(255,255,255,0.18),inset_0_-8px_20px_rgba(47,111,237,0.35),0_12px_32px_rgba(47,111,237,0.18)]'
      } ${className}`}
    >
      {/* Capa 1: Fluido refractado horario (#2F6FED / #1D4ED8) */}
      <div
        aria-hidden="true"
        style={{
          background:
            'conic-gradient(from 0deg at 50% 50%, rgba(47, 111, 237, 0.75) 0deg, rgba(29, 78, 216, 0.25) 110deg, rgba(47, 111, 237, 0.05) 210deg, rgba(29, 78, 216, 0.65) 310deg, rgba(47, 111, 237, 0.75) 360deg)',
          animation: `spin ${isThinking ? '2.5s' : '10s'} linear infinite`,
        }}
        className={`pointer-events-none absolute -inset-2 rounded-full blur-md will-change-transform motion-reduce:animate-none transition-opacity duration-300 ${
          isThinking ? 'opacity-95' : 'opacity-75'
        }`}
      />

      {/* Capa 2: Anillo de luz asimétrico antihorario (#38BDF8 / #2F6FED) */}
      <div
        aria-hidden="true"
        style={{
          background:
            'conic-gradient(from 140deg at 46% 52%, transparent 0deg, rgba(56, 189, 248, 0.7) 55deg, rgba(47, 111, 237, 0.45) 125deg, transparent 200deg, rgba(56, 189, 248, 0.28) 280deg, transparent 360deg)',
          animation: `spin ${isThinking ? '3.5s' : '14s'} linear infinite reverse`,
        }}
        className="pointer-events-none absolute inset-1 rounded-full opacity-70 mix-blend-screen will-change-transform motion-reduce:animate-none"
      />

      {/* Máscara interior oscura para dar profundidad óptica al núcleo */}
      <div
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(circle at 50% 54%, rgba(8, 11, 18, 0.72) 22%, rgba(8, 11, 18, 0.12) 68%, transparent 100%)',
        }}
        className="pointer-events-none absolute inset-0 rounded-full"
      />

      {/* Núcleo Ω suspendido */}
      <svg
        viewBox="0 0 32 32"
        width={glyphSize}
        height={glyphSize}
        fill="none"
        aria-hidden="true"
        className={`relative z-10 text-[#E2E8F0] transition-all duration-300 ${
          isThinking
            ? 'drop-shadow-[0_0_12px_rgba(47,111,237,0.95)] scale-[1.04]'
            : 'drop-shadow-[0_0_8px_rgba(47,111,237,0.8)]'
        }`}
      >
        <path
          d="M10.5 23.5H6.5V21.2C8.3 19.8 9.2 17.6 9.2 15.1C9.2 10.9 12.1 7.8 16 7.8C19.9 7.8 22.8 10.9 22.8 15.1C22.8 17.6 23.7 19.8 25.5 21.2V23.5H21.5V21.4C20.2 19.8 19.7 17.6 19.7 15.1C19.7 12.5 18.2 10.6 16 10.6C13.8 10.6 12.3 12.5 12.3 15.1C12.3 17.6 11.8 19.8 10.5 21.4V23.5Z"
          fill="currentColor"
        />
      </svg>

      {/* Película superior de brillo especular en arco */}
      <div
        aria-hidden="true"
        style={{
          background:
            'linear-gradient(180deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0) 100%)',
        }}
        className="pointer-events-none absolute inset-x-2 top-1 h-[34%] rounded-full z-20"
      />
    </div>
  );
}
