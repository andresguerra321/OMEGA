/**
 * ChatAtmosphere — Campo atmosférico unificado en azul noche (#03050B)
 * con pliegues de luz diagonales superiores contenidos, trazas curvas de horizonte y rieles de estudio.
 */
export function ChatAtmosphere({ dimmed = false, variant = 'workspace' }) {
  const isStage = variant === 'stage';
  const layerOpacity = isStage
    ? 'opacity-100'
    : dimmed
      ? 'opacity-65'
      : 'opacity-90';

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
    >
      {/* Retícula punteada ultrafina de calibración + viñeta hacia #03050B por debajo de la luz */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          isStage ? 'opacity-26' : dimmed ? 'opacity-16' : 'opacity-22'
        }`}
        style={{
          backgroundImage: 'radial-gradient(rgba(147, 197, 253, 0.14) 1px, transparent 1px)',
          backgroundSize: '30px 30px',
        }}
      />

      <div
        className="absolute inset-0"
        style={{
          background: isStage
            ? 'radial-gradient(ellipse 78% 70% at 50% 44%, transparent 28%, rgba(3, 5, 11, 0.52) 80%, #03050B 100%)'
            : 'radial-gradient(ellipse 76% 64% at 50% 42%, transparent 22%, rgba(3, 5, 11, 0.62) 80%, #03050B 100%)',
        }}
      />

      {/* Pliegues diagonales de luz superior y foco cobalto contenido por encima de la viñeta */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ease-kowalski ${layerOpacity}`}
      >
        <div className="omega-fold-left" />
        <div className="omega-fold-right" />

        {isStage ? (
          <div
            className="absolute inset-x-0 bottom-[6%] mx-auto h-[30vh] w-[min(82vw,940px)] rounded-full blur-[58px]"
            style={{
              background:
                'radial-gradient(ellipse 68% 58% at 50% 58%, rgba(29, 78, 216, 0.22) 0%, rgba(16, 48, 116, 0.11) 46%, transparent 74%)',
            }}
          />
        ) : (
          <div
            className="absolute inset-x-0 top-0 mx-auto h-[24vh] w-[min(78vw,900px)] blur-[52px]"
            style={{
              background:
                'radial-gradient(ellipse 64% 72% at 50% 0%, rgba(29, 78, 216, 0.14) 0%, rgba(12, 34, 78, 0.06) 54%, transparent 78%)',
            }}
          />
        )}
      </div>

      {/* Trazas curvas de horizonte y ondas vectoriales en azul acero */}
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        className={`absolute inset-0 h-full w-full transition-opacity duration-500 ease-kowalski ${
          isStage ? 'opacity-90' : dimmed ? 'opacity-52' : 'opacity-78'
        }`}
      >
        <defs>
          <linearGradient id="omegaWaveTop" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(59, 130, 246, 0)" />
            <stop offset="20%" stopColor="rgba(59, 130, 246, 0.11)" />
            <stop offset="50%" stopColor="rgba(147, 197, 253, 0.24)" />
            <stop offset="80%" stopColor="rgba(59, 130, 246, 0.11)" />
            <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
          </linearGradient>
          <linearGradient id="omegaWaveHorizon" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(37, 99, 235, 0)" />
            <stop offset="24%" stopColor="rgba(37, 99, 235, 0.1)" />
            <stop offset="50%" stopColor="rgba(96, 165, 250, 0.22)" />
            <stop offset="76%" stopColor="rgba(37, 99, 235, 0.1)" />
            <stop offset="100%" stopColor="rgba(37, 99, 235, 0)" />
          </linearGradient>
        </defs>

        <path
          d="M -60 248 C 210 206, 390 318, 720 276 C 1050 234, 1230 308, 1500 244"
          fill="none"
          stroke="url(#omegaWaveTop)"
          strokeWidth="1.05"
        />
        <path
          d="M -60 292 C 260 326, 480 222, 720 274 C 980 330, 1180 236, 1500 284"
          fill="none"
          stroke="url(#omegaWaveHorizon)"
          strokeWidth="0.95"
          opacity="0.76"
        />
        <path
          d="M -60 668 C 250 714, 490 618, 720 668 C 960 720, 1190 634, 1500 678"
          fill="none"
          stroke="url(#omegaWaveHorizon)"
          strokeWidth="1.05"
          opacity={isStage ? '0.92' : '0.62'}
        />
        <path
          d="M -60 698 C 290 646, 480 738, 720 688 C 960 638, 1170 724, 1500 666"
          fill="none"
          stroke="url(#omegaWaveTop)"
          strokeWidth="0.9"
          opacity={isStage ? '0.68' : '0.45'}
        />
      </svg>

      {/* Líneas guía verticales de estudio alineadas al contenedor */}
      <div className="relative mx-auto h-full max-w-[1320px] border-x border-[#93C5FD]/[0.055]">
        <span className="absolute -left-px top-6 h-3 w-px bg-[#3B82F6]/45" />
        <span className="absolute -right-px top-6 h-3 w-px bg-[#3B82F6]/45" />
        <span className="absolute -left-px bottom-6 h-3 w-px bg-[#3B82F6]/45" />
        <span className="absolute -right-px bottom-6 h-3 w-px bg-[#3B82F6]/45" />
      </div>
    </div>
  );
}
