import { useState } from 'react';
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from 'framer-motion';
import { LANDING_SECTIONS } from '../../data/catalog';
import { OmegaBrandMark } from '../OmegaBrandMark';

/**
 * Nav flotante de vidrio que se condensa al salir del hero y muestra el CTA "Comenzar gratis".
 */
export function Navbar({ activeSection, onNavigateSection, onLogin, onStartFree }) {
  const [condensed, setCondensed] = useState(false);
  const { scrollY, scrollYProgress } = useScroll();
  const reducedMotion = useReducedMotion();

  useMotionValueEvent(scrollY, 'change', (latest) => {
    if (typeof window === 'undefined') return;
    const threshold = Math.max(420, (window.innerHeight || 900) * 0.72);
    const shouldCondense = latest > threshold;
    if (shouldCondense !== condensed) {
      setCondensed(shouldCondense);
    }
  });

  return (
    <header
      data-condensed={condensed ? 'true' : 'false'}
      className={`fixed top-0 inset-x-0 z-40 px-4 sm:px-6 transition-all duration-300 ${
        condensed ? 'pt-3' : 'pt-4'
      }`}
    >
      <nav
        aria-label="Navegación principal"
        className={`relative mx-auto rounded-2xl backdrop-blur-xl border border-white/[0.08] bg-[#05070B]/75 shadow-[0_16px_44px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.12)] flex items-center justify-between gap-4 transition-all duration-300 ${
          condensed ? 'max-w-4xl h-12 px-4' : 'max-w-6xl h-14 px-4 sm:px-5'
        }`}
      >
        <a
          href="#plataforma"
          onClick={(event) => {
            event.preventDefault();
            onNavigateSection('plataforma');
          }}
          className="rounded-lg text-left transition-transform active:scale-[0.97]"
        >
          <OmegaBrandMark />
        </a>

        <div
          role="navigation"
          aria-label="Secciones"
          className="hidden md:flex items-center gap-1"
        >
          {LANDING_SECTIONS.map((section) => {
            const isCurrent = activeSection === section.id;
            return (
              <a
                key={section.id}
                href={`#${section.id}`}
                aria-current={isCurrent ? 'location' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigateSection(section.id);
                }}
                className={`rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors ${
                  isCurrent ? 'text-[#F8FAFC]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                {section.label}
              </a>
            );
          })}
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            onClick={onLogin}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-[#94A3B8] hover:text-[#F8FAFC] transition-colors active:scale-[0.97]"
          >
            Iniciar sesión
          </button>

          {condensed && (
            <button
              type="button"
              onClick={onStartFree}
              className="rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-[13px] font-medium px-3.5 py-1.5 transition-all duration-150 active:scale-[0.97]"
            >
              Comenzar gratis
            </button>
          )}
        </div>

        {!reducedMotion && (
          <motion.div
            aria-hidden="true"
            style={{ scaleX: scrollYProgress, transformOrigin: '0% 50%' }}
            className="pointer-events-none absolute bottom-0 inset-x-4 h-[1px] bg-gradient-to-r from-[#2F6FED]/30 via-[#2F6FED] to-white/40"
          />
        )}
      </nav>
    </header>
  );
}
