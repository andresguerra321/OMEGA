import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Maximize2,
  Pin,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { StructuredResponse } from './StructuredResponse';

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

  if (!isOpen) return null;

  function handleSubmit(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || isLoading) return;
    setDraft('');
    onSendPrompt?.(text);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Copiloto de análisis OMEGA"
    >
      {/* Fondo atenuado sin destruir el estado inferior */}
      <button
        type="button"
        aria-label="Cerrar panel de copiloto"
        onClick={onClose}
        className="flex-1 bg-black/55 backdrop-blur-[4px] cursor-default"
      />

      {/* Cajón lateral deslizable */}
      <aside
        className={`relative h-full w-full max-w-[470px] border-l border-white/[0.1] bg-gradient-to-b from-[#13161E]/98 to-[#0B0D12]/98 backdrop-blur-2xl shadow-[-18px_0_48px_rgba(0,0,0,0.68)] flex flex-col ${
          typeof window !== 'undefined' && window.omegaDesktop?.isDesktop ? 'pt-9' : ''
        }`}
      >
        {/* Cabecera del copiloto */}
        <div className="h-14 shrink-0 border-b border-white/[0.08] px-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2.5">
            <span className="h-7 w-7 rounded-[9px] bg-[#2F6FED]/18 border border-[#5E9BFF]/35 flex items-center justify-center shrink-0">
              <Sparkles className="h-3.5 w-3.5 text-[#8AB4FF]" />
            </span>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-[#F4F6FA] truncate">
                Copiloto OMEGA
              </div>
              <div className="font-tech text-[11px] text-[#9BA2B0] truncate">
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
          <div className="mx-4 mt-3 rounded-[10px] border border-[#2F6FED]/35 bg-[#2F6FED]/12 px-3 py-2 flex items-center justify-between gap-2 text-[12px]">
            <div className="min-w-0 flex items-center gap-2 text-[#D6E4FF]">
              <Pin className="h-3.5 w-3.5 text-[#8AB4FF] shrink-0" />
              <span className="truncate">Contexto adjunto: {pinnedContext}</span>
            </div>
            <button
              type="button"
              onClick={onClearPinnedContext}
              aria-label="Quitar contexto adjunto"
              className="text-[#9BA2B0] hover:text-white cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Historial del hilo sin destruir la pantalla detrás */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="space-y-4 pt-2">
              <div className="apple-well rounded-[13px] p-4 space-y-2">
                <p className="text-[13px] leading-relaxed text-[#D6DAE2]">
                  Puedes consultar cualquier hallazgo, dominio o síntoma técnico mientras mantienes tu escaneo o revisión abierta detrás.
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-[11.5px] font-medium text-[#9BA2B0]">
                  Consultas rápidas
                </div>
                {DRAWER_STARTERS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => onSendPrompt?.(q)}
                    className="w-full text-left rounded-[11px] border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] px-3.5 py-2.5 text-[12.5px] text-[#E4E8F0] transition-colors cursor-pointer"
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
                    <div className="max-w-[88%] rounded-[13px] bg-[#2F6FED]/20 border border-[#5E9BFF]/30 px-3.5 py-2 text-[13px] text-[#F4F6FA] leading-relaxed">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[13px] border border-white/[0.07] bg-white/[0.02] p-3">
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
            <div className="apple-well rounded-[11px] px-3.5 py-3 flex items-center gap-2.5 text-[12.5px] text-[#C4CAD4]">
              <span className="h-2 w-2 rounded-full bg-[#5E9BFF] omega-core-pulse" />
              <span>Consultando corpus local y citas verificadas...</span>
            </div>
          )}

          {failedPrompt && !isLoading && (
            <div className="rounded-[11px] border border-[#FF453A]/35 bg-[#FF453A]/10 px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12px] text-[#FFB2AE]">
              <span>No se pudo completar la consulta anterior.</span>
              <button
                type="button"
                onClick={onRetryFailedTurn}
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
          className="shrink-0 border-t border-white/[0.08] bg-[#0C0E13] p-3.5"
        >
          <div className="apple-well rounded-[13px] p-2 flex items-end gap-2">
            <textarea
              ref={inputRef}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribe tu duda técnica o pega un indicador..."
              aria-label="Mensaje para el copiloto"
              className="flex-1 resize-none bg-transparent px-2 py-1 text-[13px] text-[#F4F6FA] placeholder:text-[#9097A5] focus:outline-none"
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
      </aside>
    </div>
  );
}
