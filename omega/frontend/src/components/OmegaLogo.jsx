import { useId } from 'react';

/**
 * Emblema óptico reactivo de OMEGA en SVG multicapa.
 * Reproduce el escudo glassmórfico con cresta superior, faceta interna
 * y glifo Ω metálico pulido sobre núcleo refractado en #2F6FED.
 */
export function OmegaLogo({ size = 64, isThinking = false, className = '' }) {
  const uid = useId().replace(/:/g, '');
  const glassBodyId = `omegaGlassBody-${uid}`;
  const glassFacetId = `omegaGlassFacet-${uid}`;
  const rimLightId = `omegaRimLight-${uid}`;
  const innerRimId = `omegaInnerRim-${uid}`;
  const coreGlowId = `omegaCoreGlow-${uid}`;
  const metalGlyphId = `omegaMetalGlyph-${uid}`;
  const glyphStrokeId = `omegaGlyphStroke-${uid}`;

  return (
    <div
      style={{ width: size, height: size }}
      className={`relative inline-flex items-center justify-center select-none shrink-0 ${className}`}
      aria-hidden="true"
    >
      {/* Resplandor ambiental azul cobalto contenido (#2F6FED) */}
      <div
        className={`absolute inset-1 rounded-[14px] bg-[#2F6FED] blur-lg transition-all duration-500 ease-kowalski ${
          isThinking
            ? 'omega-core-pulse opacity-55 scale-110'
            : 'opacity-25 scale-95'
        }`}
      />

      <svg
        viewBox="0 0 80 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10 w-full h-full drop-shadow-[0_6px_16px_rgba(0,0,0,0.65)]"
      >
        <defs>
          {/* Cuerpo translúcido oscuro del escudo */}
          <linearGradient
            id={glassBodyId}
            x1="16"
            y1="8"
            x2="64"
            y2="74"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#354361" stopOpacity="0.92" />
            <stop offset="45%" stopColor="#171C28" stopOpacity="0.94" />
            <stop offset="100%" stopColor="#132242" stopOpacity="0.98" />
          </linearGradient>

          {/* Faceta vertical sutil para profundidad cristalina 3D */}
          <linearGradient
            id={glassFacetId}
            x1="16"
            y1="14"
            x2="42"
            y2="68"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.18" />
            <stop offset="65%" stopColor="#8CA8E8" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#2F6FED" stopOpacity="0" />
          </linearGradient>

          {/* Bisel especular exterior de 1.25px */}
          <linearGradient
            id={rimLightId}
            x1="22"
            y1="6"
            x2="60"
            y2="74"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.72" />
            <stop offset="32%" stopColor="#99BAFF" stopOpacity="0.45" />
            <stop offset="72%" stopColor="#2F6FED" stopOpacity="0.58" />
            <stop offset="100%" stopColor="#7AA7FF" stopOpacity="0.42" />
          </linearGradient>

          {/* Bisel interior de refracción */}
          <linearGradient
            id={innerRimId}
            x1="40"
            y1="10"
            x2="40"
            y2="70"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.28" />
            <stop offset="50%" stopColor="#7AA7FF" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#2F6FED" stopOpacity="0.32" />
          </linearGradient>

          {/* Núcleo interno azul cobalto reactivo */}
          <radialGradient
            id={coreGlowId}
            cx="50%"
            cy="43%"
            r="44%"
          >
            <stop
              offset="0%"
              stopColor="#2F6FED"
              stopOpacity={isThinking ? '0.82' : '0.48'}
            />
            <stop
              offset="55%"
              stopColor="#2F6FED"
              stopOpacity={isThinking ? '0.32' : '0.16'}
            />
            <stop offset="100%" stopColor="#2F6FED" stopOpacity="0" />
          </radialGradient>

          {/* Acabado titanio/hielo metálico para la letra Omega */}
          <linearGradient
            id={metalGlyphId}
            x1="24"
            y1="18"
            x2="58"
            y2="60"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="42%" stopColor="#DCE3F0" />
            <stop offset="78%" stopColor="#9EB6E8" />
            <stop offset="100%" stopColor="#6D93E3" />
          </linearGradient>

          {/* Contorno especular sutil del glifo */}
          <linearGradient
            id={glyphStrokeId}
            x1="24"
            y1="20"
            x2="56"
            y2="56"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#1B2A4A" stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {/* Silueta exterior del escudo crestado glassmórfico */}
        <path
          d="M40 5.8C45.8 9.6 54.2 12.1 65.5 13.6V37.2C65.5 53.8 54.6 66.5 40 73.6C25.4 66.5 14.5 53.8 14.5 37.2V13.6C25.8 12.1 34.2 9.6 40 5.8Z"
          fill={`url(#${glassBodyId})`}
          stroke={`url(#${rimLightId})`}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* Faceta izquierda iluminada */}
        <path
          d="M40 7.4C34.6 10.9 26.8 13.3 16.5 14.7V37.1C16.5 52.4 26.4 64.2 40 71.1V7.4Z"
          fill={`url(#${glassFacetId})`}
        />

        {/* Cavidad interior con núcleo azul #2F6FED */}
        <path
          d="M40 10.2C45.2 13.3 52.4 15.4 61.5 16.8V37C61.5 51.3 52.2 62.3 40 68.4C27.8 62.3 18.5 51.3 18.5 37V16.8C27.6 15.4 34.8 13.3 40 10.2Z"
          fill={`url(#${coreGlowId})`}
          stroke={`url(#${innerRimId})`}
          strokeWidth="1"
          strokeLinejoin="round"
        />

        {/* Sombra de relieve bajo la Omega */}
        <path
          d="M34.2 54.6H23.6V47.6H29.4C26.1 44.3 24.2 39.8 24.2 34.7C24.2 25.5 31.1 18.6 40 18.6C48.9 18.6 55.8 25.5 55.8 34.7C55.8 39.8 53.9 44.3 50.6 47.6H56.4V54.6H45.8V47.2C48.7 44.5 50.3 40.3 50.3 35.1C50.3 28.4 45.8 23.6 40 23.6C34.2 23.6 29.7 28.4 29.7 35.1C29.7 40.3 31.3 44.5 34.2 47.2V54.6Z"
          fill="#070A12"
          fillOpacity="0.65"
          transform="translate(0, 1.2)"
        />

        {/* Letra Omega (Ω) esculpida en acabado titanio */}
        <path
          d="M34.2 54.2H23.6V47.2H29.4C26.1 43.9 24.2 39.4 24.2 34.3C24.2 25.1 31.1 18.2 40 18.2C48.9 18.2 55.8 25.1 55.8 34.3C55.8 39.4 53.9 43.9 50.6 47.2H56.4V54.2H45.8V46.8C48.7 44.1 50.3 39.9 50.3 34.7C50.3 28 45.8 23.2 40 23.2C34.2 23.2 29.7 28 29.7 34.7C29.7 39.9 31.3 44.1 34.2 46.8V54.2Z"
          fill={`url(#${metalGlyphId})`}
          stroke={`url(#${glyphStrokeId})`}
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

