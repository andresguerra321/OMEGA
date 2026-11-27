import { useCallback, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { useReducedMotion } from 'framer-motion';
import { ArrowRight, X } from 'lucide-react';
import { OmegaSculptedOrb } from '../OmegaSculptedOrb';

/**
 * Modal arquitectónico compartido con Orbe realista Ω (cero wireframes genéricos).
 */
export function SpaceModal({ space, onClose, onSelectPlanForSpace }) {
  const backdropRef = useRef(null);
  const panelRef = useRef(null);
  const sheenRef = useRef(null);
  const closingRef = useRef(false);
  const reducedMotion = useReducedMotion();

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    if (
      reducedMotion ||
      typeof requestAnimationFrame !== 'function' ||
      !panelRef.current ||
      !backdropRef.current
    ) {
      onClose();
      return;
    }

    closingRef.current = true;
    const tl = gsap.timeline({
      onComplete: () => {
        closingRef.current = false;
        onClose();
      },
    });
    tl.to(panelRef.current, {
      opacity: 0,
      scale: 0.97,
      y: 8,
      duration: 0.16,
      ease: 'power2.in',
    }).to(
      backdropRef.current,
      {
        opacity: 0,
        duration: 0.14,
        ease: 'power2.in',
      },
      '<',
    );
  }, [onClose, reducedMotion]);

  useEffect(() => {
    closingRef.current = false;
    if (!space || typeof window === 'undefined') return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [space, handleClose]);

  useEffect(() => {
    if (
      !space ||
      reducedMotion ||
      typeof requestAnimationFrame !== 'function' ||
      !backdropRef.current ||
      !panelRef.current
    ) {
      return undefined;
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        backdropRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.2, ease: 'power2.out' },
      );

      gsap.fromTo(
        panelRef.current,
        { opacity: 0, scale: 0.97, y: 10 },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.26,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
        },
      );

      if (sheenRef.current) {
        gsap.fromTo(
          sheenRef.current,
          { xPercent: -120, opacity: 0 },
          { xPercent: 180, opacity: 0.9, duration: 0.6, ease: 'power2.out' },
        );
      }

      gsap.fromTo(
        '[data-modal-step]',
        { opacity: 0, y: 6 },
        {
          opacity: 1,
          y: 0,
          duration: 0.24,
          stagger: 0.035,
          delay: 0.05,
          ease: 'power2.out',
          clearProps: 'transform,opacity',
        },
      );
    }, backdropRef);

    return () => ctx.revert();
  }, [space, reducedMotion]);

  if (!space) return null;

  return (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="space-modal-title"
      data-lenis-prevent
      onClick={handleClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-md p-4 sm:p-6 overflow-y-auto"
    >
      <div
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-2xl rounded-2xl overflow-hidden bg-[#06080F] border border-white/[0.09] shadow-[0_32px_90px_rgba(0,0,0,0.88)] my-auto"
      >
        {/* Iluminación radial sutil superior en azul rey */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-[420px] h-[200px] rounded-full blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(47, 111, 237, 0.16) 0%, rgba(6, 8, 15, 0) 72%)',
          }}
        />

        {/* Botón de cierre alineado a la retícula derecha */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Cerrar detalle"
          className="absolute top-7 right-8 z-20 w-8 h-8 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white active:scale-[0.98] transition-all duration-150 cursor-pointer"
        >
          <X className="w-4 h-4" strokeWidth={1.5} />
        </button>

        {/* Cabecera arquitectónica con fotografía sutil de estudio del espacio y Orbe Ω realista */}
        <div className="relative overflow-hidden bg-[#080C17] border-b border-white/[0.07] px-8 pt-7 pb-6">
          <img
            src={space.image}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 w-full h-full object-cover opacity-25"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#06080F] via-[#06080F]/85 to-[#06080F]/55"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#60A5FA]/45 to-transparent"
          />
          <div
            ref={sheenRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[#60A5FA]/15 to-transparent -skew-x-12 opacity-0"
          />

          <div className="relative z-10 flex items-center gap-4 pr-14">
            <div data-modal-orb={space.id} className="shrink-0">
              <OmegaSculptedOrb
                sizeClass="w-12 h-12"
                glyphSizeClass="h-5 w-5"
                compact
                decorative
              />
            </div>

            <div>
              <p className="text-[11px] font-mono tracking-[0.18em] uppercase text-[#60A5FA]/90">
                {space.indexLabel}
              </p>
              <h3
                id="space-modal-title"
                className="mt-1 text-2xl sm:text-[26px] font-medium tracking-[-0.03em] leading-[1.1] text-[#F8FAFC] text-balance"
              >
                {space.title}
              </h3>
            </div>
          </div>
        </div>

        <div className="relative z-10 px-8 pt-5 pb-7 space-y-5">
          {/* Qué protege + línea única de metadatos */}
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-400">Qué protege</p>
            <p className="mt-1 text-xs text-zinc-400">{space.modal.targetsLine}</p>
            <p className="mt-2 text-sm font-normal text-zinc-300 leading-relaxed">
              {space.modal.whatProtects}
            </p>
          </div>

          {/* Qué hace en la práctica: numeración tabular-nums con entrada escalonada */}
          <div className="border-t border-white/[0.08] pt-5">
            <p className="text-xs uppercase tracking-wider text-zinc-400">
              Qué hace en la práctica
            </p>
            <div className="mt-3.5 space-y-3">
              {space.modal.practices.map((item, idx) => (
                <div
                  key={item.title}
                  data-modal-step
                  className="flex items-baseline gap-3.5"
                >
                  <span className="font-mono text-xs text-zinc-500 tabular-nums shrink-0">
                    0{idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-medium text-[#F8FAFC]">{item.title}</h4>
                    <p className="mt-0.5 text-xs sm:text-[13px] font-normal text-zinc-400 leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Entregable verificado tangible sin cajas anidadas */}
          <div className="border-t border-white/[0.08] pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-wider text-zinc-400">
                Entregable verificado
              </p>
              <span className="font-mono tabular-nums text-[11px] text-[#60A5FA]/80">
                PDF VERIFICADO · SELLO SHA-256
              </span>
            </div>
            <p className="mt-2 border-l-2 border-[#2F6FED]/50 pl-3.5 text-sm font-normal text-zinc-300 leading-relaxed">
              {space.modal.deliverable}
            </p>
          </div>

          {/* Footer limpio con CTA azul rey OMEGA y nota contextual */}
          <div className="border-t border-white/[0.08] pt-5 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onSelectPlanForSpace(space.id)}
              className="group inline-flex items-center gap-2 rounded-xl bg-[#2F6FED] hover:bg-[#3B82F6] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] h-10 px-5 text-sm font-medium active:scale-[0.98] transition-all duration-150"
            >
              <span>Ver plan para este espacio</span>
              <ArrowRight
                className="w-4 h-4 transition-transform duration-150 ease-out group-hover:translate-x-[3px]"
                strokeWidth={1.75}
              />
            </button>

            <span className="text-xs text-zinc-500">{space.modal.trustNote}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
