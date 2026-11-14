import { formatCenterpieceStatus } from '../lib/centerpieceStatus';

/**
 * Fallback arquitectónico ligero (cero WebGL) para `SecurityCenterpiece3D`.
 * Se muestra instantáneamente mientras se difiere Three.js tras el primer pintado
 * interactivo (TTI) y actúa como respaldo ante pérdida de contexto WebGL o baja GPU.
 */
export function SecurityCenterpieceFallback({
  surfaceId = 'windows',
  healthy = false,
  alert = false,
  withAria = true,
}) {
  const { palette, statusText } = formatCenterpieceStatus(surfaceId, healthy, alert);

  return (
    <div
      role={withAria ? 'region' : undefined}
      aria-label={withAria ? statusText : undefined}
      className="relative flex h-full w-full items-center justify-center overflow-hidden select-none"
    >
      {withAria && (
        <span className="sr-only" role="status" aria-live="polite">
          {statusText}
        </span>
      )}

      {/* Retícula mínima en perspectiva — sin gradientes pesados */}
      <svg
        viewBox="0 0 640 420"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="h-[340px] w-[520px] max-w-[90vw] opacity-90"
      >
        {/* Anillo de calibración exterior */}
        <circle
          cx="320"
          cy="196"
          r="116"
          stroke={palette.ring}
          strokeOpacity="0.22"
          strokeWidth="1"
          strokeDasharray="4 6"
        />
        <circle
          cx="320"
          cy="196"
          r="84"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1"
        />
        {/* Núcleo vidrio oscuro */}
        <circle
          cx="320"
          cy="196"
          r="62"
          fill="#141418"
          fillOpacity="0.82"
          stroke={palette.ring}
          strokeOpacity="0.55"
          strokeWidth="1.25"
        />
        {/* Ejes cardinales discretos */}
        <line x1="176" y1="196" x2="216" y2="196" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        <line x1="424" y1="196" x2="464" y2="196" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        <line x1="320" y1="54" x2="320" y2="94" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        <line x1="320" y1="298" x2="320" y2="338" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />

        {/* Glifo Omega vectorial de precisión */}
        <path
          d="M306.5 227H287V213.8H298C291.8 207.8 288 199.5 288 190C288 173.4 300.6 161 320 161C339.4 161 352 173.4 352 190C352 199.5 348.2 207.8 342 213.8H353V227H333.5V213.1C338.8 208 341.8 200.5 341.8 190.9C341.8 178.7 333.6 170 320 170C306.4 170 298.2 178.7 298.2 190.9C298.2 200.5 301.2 208 306.5 213.1V227Z"
          fill={palette.glyph}
          fillOpacity="0.92"
        />
      </svg>
    </div>
  );
}
