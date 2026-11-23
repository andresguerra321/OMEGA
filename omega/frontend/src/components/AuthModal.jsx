import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { AuthAccessForm } from './AuthModulePanel';
import { OmegaBrandMark } from './OmegaBrandMark';
import { PilotTrustAndSupportDialog } from './PilotOpsPanel';
import { backdropVariants, popVariants } from '../lib/motion';

export function AuthModal({
  isOpen,
  onClose,
  onAuthenticated,
  reasonMessage = '',
  onOpenCuenta,
}) {
  const [trustDialog, setTrustDialog] = useState({ open: false, mode: 'trust' });
  return (
    <AnimatePresence>
    {isOpen && (
    <motion.div
      key="auth-modal"
      variants={backdropVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A0A0C]/78 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Acceso a cuenta OMEGA"
    >
      <motion.div variants={popVariants} initial="initial" animate="animate" exit="exit" className="omega-glass-panel w-full max-w-[440px] rounded-[20px] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <OmegaBrandMark showText={false} />
            <div>
              <h2 className="text-[15px] font-semibold text-[#F2F2F4] tracking-[-0.015em]">
                Cuenta OMEGA
              </h2>
              <p className="text-[11.5px] text-[#9A9AA2]">
                PDFs privados · OSINT
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="h-7 w-7 rounded-[8px] flex items-center justify-center text-[#9A9AA2] hover:text-[#F2F2F4] hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <AuthAccessForm
            compact
            defaultTab="login"
            reasonMessage={reasonMessage}
            onAuthenticated={(session) => {
              onAuthenticated?.(session);
              onClose?.();
            }}
          />

          <div className="pt-2 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
            <button
              type="button"
              onClick={() => setTrustDialog({ open: true, mode: 'invite' })}
              className="text-[#2F6FED] hover:underline cursor-pointer"
            >
              Unirme con código de invitación
            </button>
            <button
              type="button"
              onClick={() => setTrustDialog({ open: true, mode: 'trust' })}
              className="text-[#9A9AA2] hover:text-[#F2F2F4] transition-colors cursor-pointer"
            >
              Zero-Retention, Planes y Términos
            </button>
          </div>

          {onOpenCuenta && (
            <div className="pt-2 border-t border-white/[0.07] text-center">
              <button
                type="button"
                onClick={() => {
                  onClose?.();
                  onOpenCuenta();
                }}
                className="text-[11.5px] text-[#9A9AA2] hover:text-[#F2F2F4] transition-colors cursor-pointer"
              >
                Abrir vista completa de Cuenta y Biblioteca →
              </button>
            </div>
          )}
        </div>
        <PilotTrustAndSupportDialog
          isOpen={trustDialog.open}
          initialMode={trustDialog.mode}
          currentView="auth-modal"
          onClose={() => setTrustDialog((prev) => ({ ...prev, open: false }))}
          onInvitationAccepted={(session) => {
            if (session) onAuthenticated?.(session);
            onClose?.();
          }}
        />
      </motion.div>
    </motion.div>
    )}
    </AnimatePresence>
  );
}
