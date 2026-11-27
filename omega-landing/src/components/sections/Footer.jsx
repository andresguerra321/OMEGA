import { OmegaBrandMark } from '../OmegaBrandMark';

/**
 * Pie de página ultra limpio de 1 sola fila estructurada.
 */
export function Footer({ onOpenLegalApp }) {
  return (
    <footer className="border-t border-white/[0.08] px-6 py-8 bg-[#05070B]">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <OmegaBrandMark />
          <span className="text-xs text-[#64748B]">
            © {new Date().getFullYear()} OMEGA · Seguridad y Privacidad Corporativa
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-5 text-xs text-[#94A3B8]">
          <button
            type="button"
            onClick={() => onOpenLegalApp('login')}
            className="hover:text-[#F8FAFC] transition-colors"
          >
            Términos y condiciones
          </button>
          <button
            type="button"
            onClick={() => onOpenLegalApp('login')}
            className="hover:text-[#F8FAFC] transition-colors"
          >
            Privacidad y tratamiento de datos
          </button>
        </div>
      </div>
    </footer>
  );
}
