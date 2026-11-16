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

      {/* Cajón lateral deslizable vidrio esmerilado */}
      <motion.aside
        variants={drawerVariants}
        className={`relative h-full w-full max-w-[470px] border-l border-white/[0.08] bg-[rgba(20,20,24,0.72)] backdrop-blur-xl shadow-[-18px_0_52px_rgba(0,0,0,0.72)] flex flex-col ${
          typeof window !== 'undefined' && window.omegaDesktop?.isDesktop ? 'pt-9' : ''
        }`}
      >
        {/* Cabecera del copiloto */}
        <div className="h-14 shrink-0 border-b border-white/[0.08] px-4 flex items-center justify-between gap-3">
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
              className="tactile-key h-8 px-2.5 rounded-[8px] text-[12px] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Maximize2 className="h-3 w-3" />
              <span className="hidden sm:inline">Vista completa</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar copiloto"
              className="tactile-key h-8 w-8 rounded-[8px] inline-flex items-center justify-center cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Contexto fijado desde un análisis activo */}
        {pinnedContext && (
          <div className="mx-4 mt-3 rounded-[10px] border border-[#2F6FED]/40 bg-[#2F6FED]/14 px-3 py-2 flex items-center justify-between gap-2 text-[12px]">
            <div className="min-w-0 flex items-center gap-2 text-[#F2F2F4]">
              <Pin className="h-3.5 w-3.5 text-[#2F6FED] shrink-0" />
              <span className="truncate">Contexto adjunto: {pinnedContext}</span>
            </div>
            <button
              type="button"
              onClick={onClearPinnedContext}
              aria-label="Quitar contexto adjunto"
              className="text-[#9A9AA2] hover:text-[#F2F2F4] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Historial del hilo sin destruir la pantalla detrás */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="space-y-4 pt-2">
              <div className="apple-well relative overflow-hidden rounded-[14px] p-4 space-y-2.5 text-center">
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
                    className="animate-fade-up w-full text-left rounded-[11px] border border-white/[0.08] bg-white/[0.03] hover:bg-[rgba(28,36,56,0.65)] hover:border-[#2F6FED]/45 hover:-translate-y-0.5 active:scale-[0.985] px-3.5 py-2.5 text-[12.5px] text-[#F2F2F4] transition-all duration-200 cursor-pointer"
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
                    <div className="max-w-[88%] rounded-[13px] bg-[rgba(28,36,56,0.65)] border border-[#2F6FED]/40 px-3.5 py-2 text-[13px] text-[#F2F2F4] leading-relaxed">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[13px] border border-white/[0.08] bg-white/[0.025] p-3">
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
            <div className="apple-well rounded-[11px] px-3.5 py-3 flex items-center gap-2.5 text-[12.5px] text-[#9A9AA2]">
              <span className="h-2 w-2 rounded-full bg-[#2F6FED] omega-core-pulse" />
              <span>Consultando corpus local y citas verificadas...</span>
            </div>
          )}

          {failedPrompt && !isLoading && (
            <div className="rounded-[11px] border border-[#FF453A]/35 bg-[#FF453A]/10 px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12px] text-[#FFB2AE]">
              <span>No se pudo completar la consulta anterior.</span>
              <button
                type="button"
                onClick={() => guard(async () => onRetryFailedTurn?.())}
                className="inline-flex items-center gap-1 rounded-[7px] bg-white/[0.08] px-2.5 py-1 text-white cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reintentar</span>
              </button>
            </div>
          )}

          <div ref={scrollEndRef} />
        </div>

        {/* Compositor fijado al pie */}
        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-white/[0.08] bg-[#0A0A0C]/80 p-3.5"
        >
          {composerError && (
            <p role="alert" className="mb-2 text-[11.5px] text-[#FFB4AE] px-1">
              {composerError}
            </p>
          )}
          <div className="apple-well rounded-[13px] p-2 flex items-end gap-2 focus-within:border-[#2F6FED] focus-within:shadow-[0_0_24px_rgba(47,111,237,0.25)] transition-all">
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
              className="tactile-key-primary h-8 w-8 rounded-[9px] inline-flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-45"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </form>
      </motion.aside>
    </motion.div>
    )}
    </AnimatePresence>
  );
}
