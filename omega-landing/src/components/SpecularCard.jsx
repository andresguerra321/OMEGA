/**
 * Contenedor de vidrio óptico con reflejo radial azul rey que sigue el cursor
 * actualizando variables CSS directo en el DOM (0 re-renders en React).
 */
export function SpecularCard({ children, className = '', as: Component = 'div', ...props }) {
  function handlePointerMove(event) {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    el.style.setProperty('--mx', `${(event.clientX - rect.left).toFixed(1)}px`);
    el.style.setProperty('--my', `${(event.clientY - rect.top).toFixed(1)}px`);
  }

  return (
    <Component
      onPointerMove={handlePointerMove}
      className={`omega-glass group/spec relative overflow-hidden ${className}`}
      {...props}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 group-hover/spec:opacity-100 transition-opacity duration-300"
        style={{
          background:
            'radial-gradient(380px circle at var(--mx, 50%) var(--my, 50%), rgba(47, 111, 237, 0.14), transparent 70%)',
        }}
      />
      {children}
    </Component>
  );
}
