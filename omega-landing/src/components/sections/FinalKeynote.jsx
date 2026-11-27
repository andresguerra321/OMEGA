import { useId } from 'react';
import { ArrowRight } from 'lucide-react';
import { OmegaBrandMark } from '../OmegaBrandMark';

/**
 * Capítulo 5B: Cierre de lanzamiento keynote minimalista con arco azul rey.
 */
export function FinalKeynote({ onStartFree, onRequestPilot }) {
  const uid = useId().replace(/:/g, '');
  const strokeId = `finalKeynoteArc-${uid}`;

  return (
    <section className="relative py-32 md:py-44 px-6 bg-[#05070B] border-t border-white/[0.08] overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden select-none"
      >
        <div
          className="absolute left-1/2 -bottom-40 -translate-x-1/2 w-[min(1040px,120vw)] h-[360px]"
          style={{
            background:
              'radial-gradient(ellipse 58% 50% at 50% 50%, rgba(29, 78, 216, 0.22) 0%, rgba(47, 111, 237, 0.10) 44%, rgba(5, 7, 11, 0) 74%)',
          }}
        />
        <svg
          viewBox="0 0 1440 360"
          preserveAspectRatio="xMidYMid slice"
          fill="none"
          className="absolute inset-x-0 bottom-0 w-full h-[360px] rotate-180"
        >
          <defs>
            <linearGradient id={strokeId} x1="280" y1="120" x2="1160" y2="120" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#2F6FED" stopOpacity="0" />
              <stop offset="30%" stopColor="#2F6FED" stopOpacity="0.32" />
              <stop offset="50%" stopColor="#93C5FD" stopOpacity="0.65" />
              <stop offset="70%" stopColor="#2F6FED" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#2F6FED" stopOpacity="0" />
            </linearGradient>
          </defs>
          <circle cx="720" cy="660" r="590" stroke={`url(#${strokeId})`} strokeWidth="1.2" />
        </svg>
      </div>

      <div className="relative z-10 max-w-3xl mx-auto text-center flex flex-col items-center">
        <OmegaBrandMark showText={false} className="scale-125" />

        <h2 className="mt-7 text-4xl sm:text-5xl md:text-6xl font-medium tracking-[-0.04em] text-[#F8FAFC] text-balance">
          Empieza hoy.
        </h2>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={onStartFree}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#2F6FED] hover:bg-[#3B7BF2] text-white h-11 px-6 text-sm font-medium transition-transform active:scale-[0.97]"
          >
            Crear cuenta gratis
            <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onRequestPilot}
            className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.12] text-[#F1F5F9] h-11 px-6 text-sm font-medium transition-transform active:scale-[0.97]"
          >
            Solicitar piloto corporativo
          </button>
        </div>
      </div>
    </section>
  );
}
