import { motion, useReducedMotion, useScroll } from 'framer-motion';
import { LANDING_SECTIONS } from '../../data/catalog';
import { OmegaBrandMark } from '../OmegaBrandMark';

/**
 * Barra superior fija de perfil ultra delgado con progreso sutil de scroll.
 */
export function Navbar({ activeSection, onNavigateSection, onLogin, onRequestPilot }) {
  const { scrollYProgress } = useScroll();
  const reducedMotion = useReducedMotion();

  return (
    <header className="fixed top-0 inset-x-0 z-40 h-14 backdrop-blur-xl bg-[#05070B]/70 border-b border-white/[0.06]">
      <nav
        aria-label="Navegación principal"
        className="max-w-6xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4"
      >
        <button
          type="button"
          onClick={() => onNavigateSection('plataforma')}
          className="rounded-lg text-left transition-transform active:scale-[0.97]"
        >
          <OmegaBrandMark />
        </button>

        <div
          role="navigation"
          aria-label="Capítulos"
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
                className={`rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium transition-colors ${
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
          <button
            type="button"
            onClick={onRequestPilot}
            className="rounded-lg bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-[13px] font-medium px-3.5 py-1.5 transition-transform active:scale-[0.97]"
          >
            Solicitar piloto
          </button>
        </div>
      </nav>

      {!reducedMotion && (
        <motion.div
          aria-hidden="true"
          style={{ scaleX: scrollYProgress, transformOrigin: '0% 50%' }}
          className="pointer-events-none absolute bottom-0 inset-x-0 h-[1px] bg-gradient-to-r from-[#2F6FED]/30 via-[#2F6FED] to-white/50"
        />
      )}
    </header>
  );
}
