import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Copy, X } from 'lucide-react';
import { PILOT_SUMMARY_TEXT } from '../../data/catalog';

const MODAL_SPRING = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 };

/**
 * Modal limpio para solicitar piloto corporativo Enterprise o Modo Privado.
 */
export function PilotRequestModal({ open, onClose, onEnterApp }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function copyPilotSummary() {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(PILOT_SUMMARY_TEXT);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pilot-modal-title"
      data-lenis-prevent
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070B]/82 backdrop-blur-md p-4"
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={MODAL_SPRING}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-2xl omega-glass p-6 sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3
              id="pilot-modal-title"
              className="text-xl font-medium tracking-[-0.025em] text-[#F8FAFC]"
            >
              Piloto corporativo OMEGA
            </h3>
            <p className="mt-1.5 text-sm text-[#94A3B8]">
              Activa tu organización en minutos o solicita instalación privada dentro de tu red.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana"
            className="rounded-lg p-1.5 text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div className="omega-debossed rounded-xl p-4 text-xs text-[#CBD5E1] space-y-1.5 leading-relaxed">
            <p className="font-medium text-[#F8FAFC]">
              Enterprise · $299.900 COP/mes (o $2.999.000 COP/año)
            </p>
            <p>5 puestos de equipo · 25 dispositivos vinculados · 3.000 créditos mensuales.</p>
            <p>Disponible en nube aislada o en tus propios servidores con control absoluto.</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => onEnterApp('register')}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#2F6FED] hover:bg-[#3B7BF2] text-white text-sm font-medium h-11 px-5 transition-transform active:scale-[0.97]"
            >
              Crear espacio empresarial
              <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={copyPilotSummary}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.12] text-[#F8FAFC] text-sm font-medium h-11 px-5 transition-transform active:scale-[0.97]"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" strokeWidth={1.75} />
                  Resumen copiado
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-[#94A3B8]" strokeWidth={1.75} />
                  Copiar resumen
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
