import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { backdropVariants, drawerVariants } from '../lib/motion';
import {
  ArrowUp,
  Maximize2,
  Pin,
  RotateCcw,
  X,
} from 'lucide-react';
import { StructuredResponse } from './StructuredResponse';
import { OmegaShaderOrb } from './OmegaShaderOrb';
import { stripUnsafeChars, validateChatMessage } from '../lib/validators';
import { useSingleFlight } from '../lib/useSingleFlight';

const DRAWER_STARTERS = [
  '¿Qué señales visibles indican posible infección con Pegasus?',
  'Resume los CVEs móviles explotados recientemente en Android e iOS',
  'Cómo endurecer el teléfono tras recibir un enlace sospechoso',
];

export function CopilotDrawer({
  isOpen,
  onClose,
  onOpenFullWorkspace,
  activeSession,
  isLoading,
  failedPrompt,
  onRetryFailedTurn,
  activeCitation,
  onSelectCitation,
  onSendPrompt,
  pinnedContext,
  onClearPinnedContext,
  reportsCount = 26,
}) {
  const [draft, setDraft] = useState('');
  const [composerError, setComposerError] = useState('');
  const guard = useSingleFlight();
  const scrollEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const focusTimer = setTimeout(() => {
      inputRef.current?.focus();
    }, 80);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(focusTimer);
    };
  }, [isOpen, onClose]);

  const messages = activeSession?.messages || [];

  useEffect(() => {
    if (isOpen) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages.length, isLoading]);

  function handleSubmit(e) {
    e?.preventDefault();
    if (isLoading) return;
    const check = validateChatMessage(draft, { maxLength: 2000 });
    if (!check.valid) {
      setComposerError(check.error);
      return;
    }
    guard(async () => {
      setComposerError('');
      setDraft('');
      await onSendPrompt?.(check.value);
    });
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.repeat) return;
      handleSubmit();
    }
  }

  return (
    <AnimatePresence>
    {isOpen && (
    <motion.div
      key="copilot-drawer"
      initial="initial"
      animate="animate"
      exit="exit"
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Copiloto de análisis OMEGA"
    >
      {/* Fondo atenuado sin destruir el estado inferior */}
      <motion.button
        type="button"
        aria-label="Cerrar panel de copiloto"
        onClick={onClose}
        variants={backdropVariants}
        className="flex-1 bg-black/55 cursor-default"
      />

      {/* Cajón lateral deslizable */}
      <motion.aside
        variants={drawerVariants}
        className="relative h-full w-full max-w-[470px] border-l border-white/[0.07] bg-[#0F131B]/85 backdrop-blur-md shadow-[-18px_0_52px_rgba(0,0,0,0.72)] flex flex-col"
      >
        {/* Cabecera del copiloto */}
        <div className="h-14 shrink-0 border-b border-white/[0.06] px-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2.5">
            <OmegaShaderOrb size={24} isThinking={isLoading} />
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-[#F2F2F4] truncate">
                Copiloto OMEGA
              </div>
              <div className="font-tech text-[11px] text-[#9A9AA2] truncate">
                {reportsCount} reportes citables · memoria local
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                onClose?.();
                onOpenFullWorkspace?.();
              }}
              title="Abrir vista completa de asistente"
              className="h-8 px-2.5 rounded-lg bg-[#141923]/75 border border-white/[0.05] hover:border-white/[0.12] text-[12px] text-[#9A9AA2] hover:text-[#F2F2F4] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">Vista completa</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar copiloto"
              className="h-8 w-8 rounded-lg bg-[#141923]/75 border border-white/[0.05] hover:border-white/[0.12] text-[#9A9AA2] hover:text-[#F2F2F4] inline-flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Contexto fijado desde un análisis activo */}
        {pinnedContext && (
          <div className="mx-4 mt-3 rounded-xl border border-[#2F6FED]/35 bg-[#141923]/75 px-3 py-2 flex items-center justify-between gap-2 text-[12px]">
            <div className="min-w-0 flex items-center gap-2 text-[#F2F2F4]">
              <Pin className="h-3.5 w-3.5 text-[#2F6FED] shrink-0" strokeWidth={1.75} />
              <span className="truncate">Contexto adjunto: {pinnedContext}</span>
            </div>
            <button
              type="button"
              onClick={onClearPinnedContext}
              aria-label="Quitar contexto adjunto"
              className="text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        )}

        {/* Historial del hilo sin destruir la pantalla detrás */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="space-y-4 pt-2">
              <div className="relative overflow-hidden rounded-xl bg-[#141923]/75 border border-white/[0.05] p-4 space-y-2.5 text-center">
                <div className="flex justify-center py-1">
                  <OmegaShaderOrb size={48} isThinking={isLoading} />
                </div>
                <p className="text-[13px] leading-relaxed text-[#F2F2F4]">
                  Consulta hallazgos o CVEs sin salir de tu vista actual.
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-[11.5px] font-medium text-[#9A9AA2]">
                  Consultas rápidas
                </div>
                {DRAWER_STARTERS.map((q, idx) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => onSendPrompt?.(q)}
                    style={{ animationDelay: `${Math.min(idx * 50, 180)}ms` }}
                    className="animate-fade-up w-full text-left rounded-xl border border-white/[0.05] bg-[#141923]/75 hover:bg-[#141923] hover:border-[#2F6FED]/45 px-3.5 py-2.5 text-[12.5px] text-[#F2F2F4] transition-colors duration-150 cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={msg.id || idx} className="space-y-2">
                {msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="max-w-[88%] rounded-xl bg-[#2F6FED]/15 border border-[#2F6FED]/35 px-3.5 py-2 text-[13px] text-[#F2F2F4] leading-relaxed">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/[0.05] bg-[#141923]/75 p-3">
                    <StructuredResponse
                      message={msg}
                      activeCitation={activeCitation}
                      onSelectCitation={onSelectCitation}
                      onToggleSources={() => {
                        onClose?.();
                        onOpenFullWorkspace?.();
                      }}
                      isSourcesOpen={false}
                    />
                  </div>
                )}
              </div>
            ))
          )}

          {isLoading && (
            <div className="rounded-xl bg-[#141923]/75 border border-white/[0.05] px-3.5 py-3 flex items-center gap-2.5 text-[12.5px] text-[#9A9AA2]">
              <span className="h-2 w-2 rounded-full bg-[#2F6FED] animate-pulse" />
              <span>Consultando corpus local y citas verificadas...</span>
            </div>
          )}

          {failedPrompt && !isLoading && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12px] text-rose-300">
              <span>No se pudo completar la consulta anterior.</span>
              <button
                type="button"
                onClick={() => guard(async () => onRetryFailedTurn?.())}
                className="inline-flex items-center gap-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] px-2.5 py-1 text-white transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Reintentar</span>
              </button>
            </div>
          )}

          <div ref={scrollEndRef} />
        </div>

        {/* Compositor fijado al pie */}
        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-white/[0.06] bg-[#0A0A0C]/75 p-3.5"
        >
          {composerError && (
            <p role="alert" className="mb-2 text-[11.5px] text-rose-400 px-1">
              {composerError}
            </p>
          )}
          <div className="rounded-xl bg-[#141923]/75 border border-white/[0.05] p-2 flex items-end gap-2 focus-within:border-[#2F6FED]/60 transition-colors">
            <textarea
              ref={inputRef}
              rows={2}
              maxLength={2000}
              value={draft}
              onChange={(e) => {
                setDraft(stripUnsafeChars(e.target.value, 2000));
                if (composerError) setComposerError('');
              }}
              onKeyDown={handleKeyDown}
              aria-invalid={Boolean(composerError)}
              placeholder="Escribe tu duda técnica o pega un indicador..."
              aria-label="Mensaje para el copiloto"
              className="flex-1 resize-none bg-transparent px-2 py-1 text-[13px] text-[#F2F2F4] placeholder:text-[#9A9AA2] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim() || isLoading}
              aria-label="Enviar consulta al copiloto"
              className="h-8 w-8 rounded-lg bg-[#2F6FED] text-white hover:bg-[#2F6FED]/90 disabled:bg-white/[0.06] disabled:text-[#9A9AA2] inline-flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </form>
      </motion.aside>
    </motion.div>
    )}
    </AnimatePresence>
  );
}
