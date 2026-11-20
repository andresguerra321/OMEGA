import { BookOpen, MessageSquare, Search, Sparkles } from 'lucide-react';
import { sanitizeSearchInput } from '../lib/validators';

export function CommandPaletteModal({
  isOpen,
  onClose,
  commandQuery,
  onChangeQuery,
  navItems,
  onNavigate,
  onOpenCopilot,
  onOpenOnboarding,
  sessions,
  onSelectSession,
}) {
  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-[#0A0A0C]/72 flex items-start justify-center pt-[14vh] px-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="apple-modal-in omega-glass-panel w-full max-w-[540px] rounded-[16px] overflow-hidden"
      >
        <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3.5">
          <Search strokeWidth={1.7} className="h-[18px] w-[18px] text-[#9A9AA2] shrink-0" />
          <input
            type="text"
            autoFocus
            value={commandQuery}
            onChange={(e) => onChangeQuery(sanitizeSearchInput(e.target.value))}
            maxLength={120}
            placeholder="Ir a módulo, herramienta o conversación reciente..."
            className="flex-1 bg-transparent text-[14.5px] tracking-[-0.01em] text-[#F2F2F4] placeholder-[#9A9AA2] focus:outline-none"
          />
          <span className="font-tech rounded-[5px] bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 text-[10.5px] text-[#9A9AA2]">
            ESC
          </span>
        </div>

        <div className="max-h-[460px] overflow-y-auto p-2 pb-2.5 space-y-1">
          <p className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold tracking-[0.02em] text-[#9A9AA2]">
            Instrumentos y módulos
          </p>
          {navItems
            .filter(
              (item) =>
                item.label.toLowerCase().includes(commandQuery.toLowerCase()) ||
                (item.subtitle || '').toLowerCase().includes(commandQuery.toLowerCase()),
            )
            .map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onNavigate(item.id);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13px] text-[#F2F2F4] hover:bg-[rgba(28,36,56,0.65)] transition-colors duration-150 cursor-pointer"
                >
                  <span className="inline-flex items-center gap-3">
                    <Icon strokeWidth={1.7} className="h-4 w-4 text-[#2F6FED]" />
                    <span className="font-medium tracking-[-0.01em]">{item.label}</span>
                  </span>
                  <span className="text-[11.5px] text-[#9A9AA2]">{item.subtitle}</span>
                </button>
              );
            })}

          <p className="px-2.5 pt-2.5 pb-0.5 text-[11px] font-semibold tracking-[0.02em] text-[#9A9AA2]">
            Acciones rápidas
          </p>
          <button
            type="button"
            onClick={() => {
              onOpenCopilot();
              onClose();
            }}
            className="w-full flex items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13px] text-[#F2F2F4] hover:bg-[rgba(28,36,56,0.65)] transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-3">
              <Sparkles className="h-4 w-4 text-[#2F6FED]" />
              <span>Abrir Copiloto lateral</span>
            </span>
            <span className="font-tech text-[11px] text-[#9A9AA2]">⌘J</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenOnboarding();
            }}
            className="w-full flex items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13px] text-[#F2F2F4] hover:bg-[rgba(28,36,56,0.65)] transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-3">
              <BookOpen className="h-4 w-4 text-[#6FA0FF]" />
              <span>Abrir guía interactiva de primeros pasos</span>
            </span>
            <span className="text-[11.5px] text-[#9A9AA2]">Tutorial</span>
          </button>

          {sessions.length > 0 && (
            <>
              <p className="px-2.5 pt-2.5 pb-0.5 text-[11px] font-semibold tracking-[0.02em] text-[#9A9AA2]">
                Investigaciones recientes
              </p>
              {sessions
                .filter((s) => s.title.toLowerCase().includes(commandQuery.toLowerCase()))
                .slice(0, 5)
                .map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      onSelectSession(s.id);
                      onClose();
                    }}
                    className="w-full flex items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[12.5px] text-[#9A9AA2] hover:bg-[rgba(28,36,56,0.65)] hover:text-[#F2F2F4] transition-colors duration-150 cursor-pointer"
                  >
                    <MessageSquare strokeWidth={1.65} className="h-3.5 w-3.5 text-[#9A9AA2] shrink-0" />
                    <span className="truncate">{s.title}</span>
                  </button>
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
