/**
 * Fondo atmosférico global de OMEGA basado en imagen WebP optimizada y máscara radial.
 * Se monta una sola vez en el layout raíz sin SVGs ni filtros blur pesados.
 *
 * @param {{ intensity?: 'focused' | 'workspace' | 'dashboard' }} props
 */
export function OmegaAmbientBackdrop({ intensity = 'workspace' }) {
  const isFocused = intensity === 'focused';

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden select-none bg-[#0A0A0C]"
    >
      <img
        src="/bg-omega.webp"
        alt=""
        decoding="async"
        draggable={false}
        className={`fixed inset-0 -z-10 h-full w-full object-cover object-center pointer-events-none select-none transition-opacity duration-500 [mask-image:radial-gradient(ellipse_96%_90%_at_50%_45%,black_52%,transparent_100%)] [-webkit-mask-image:radial-gradient(ellipse_96%_90%_at_50%_45%,black_52%,transparent_100%)] ${
          isFocused ? 'opacity-50' : 'opacity-35'
        }`}
      />
    </div>
  );
}
