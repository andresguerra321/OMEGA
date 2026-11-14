import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react';

/**
 * Esqueleto uniforme de carga para módulos OMEGA.
 */
export function PanelSkeleton({
  label = 'Cargando datos...',
  lines = 3,
  className = '',
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`apple-group rounded-[13px] p-4 space-y-3 ${className}`}
    >
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-[#F2F2F4]">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2F6FED] shrink-0 motion-reduce:animate-none" />
        <span>{label}</span>
      </div>
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: lines }).map((_, idx) => (
          <div
            key={idx}
            style={{ width: `${92 - idx * 14}%` }}
            className="h-3 rounded-full bg-white/[0.08] animate-pulse motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Banner uniforme de error recuperable con acción de reintento.
 */
export function PanelErrorBanner({
  message,
  onRetry,
  retryLabel = 'Reintentar',
  onDismiss,
  className = '',
}) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className={`rounded-[12px] border border-[#FF453A]/35 bg-[#FF453A]/10 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-[12.5px] text-[#FFB2AE] ${className}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-4 w-4 text-[#FF453A] shrink-0" />
        <span className="break-words">{message}</span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-[8px] border border-[#FF453A]/35 bg-white/[0.06] hover:bg-white/[0.12] px-2.5 py-1 text-[11.5px] font-medium text-white transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            <span>{retryLabel}</span>
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Cerrar aviso de error"
            className="h-6 w-6 inline-flex items-center justify-center rounded-full text-[#FFB2AE]/80 hover:text-white hover:bg-white/[0.08] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Estado vacío arquitectónico con explicación breve y llamada a la acción.
 */
export function PanelEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondaryAction,
  className = '',
}) {
  return (
    <div
      className={`apple-group rounded-[14px] px-5 py-6 text-center flex flex-col items-center gap-3 ${className}`}
    >
      {Icon && (
        <div className="h-10 w-10 rounded-[11px] border border-[#2F6FED]/40 bg-[#2F6FED]/15 flex items-center justify-center text-[#2F6FED]">
          <Icon className="h-4.5 w-4.5" />
        </div>
      )}

      <div className="space-y-1 max-w-[440px]">
        <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-[#F2F2F4]">
          {title}
        </p>
        {description && (
          <p className="text-[12.5px] text-[#9A9AA2] leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {(actionLabel || secondaryLabel) && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#2F6FED] hover:brightness-110 px-3.5 py-1.5 text-[12px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_0_24px_rgba(47,111,237,0.25)] active:scale-[0.97] transition-all cursor-pointer"
            >
              <span>{actionLabel}</span>
            </button>
          )}
          {secondaryLabel && onSecondaryAction && (
            <button
              type="button"
              onClick={onSecondaryAction}
              className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.1] bg-white/[0.04] hover:bg-[rgba(28,36,56,0.65)] px-3 py-1.5 text-[12px] font-medium text-[#F2F2F4] active:scale-[0.97] transition-all cursor-pointer"
            >
              <span>{secondaryLabel}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Confirmación explícita post-acción ("Listo, esto es lo que encontramos").
 */
export function ActionConfirmationBanner({
  message,
  tone = 'clean',
  actionLabel,
  onAction,
  onDismiss,
  className = '',
}) {
  if (!message) return null;

  const toneStyles =
    tone === 'alert'
      ? 'border-[#FF453A]/35 bg-[#FF453A]/10 text-[#FCA5A5]'
      : tone === 'info'
        ? 'border-[#2F6FED]/45 bg-[#2F6FED]/14 text-[#F2F2F4]'
        : 'border-[#30D158]/35 bg-[#30D158]/10 text-[#86EFAC]';

  const Icon =
    tone === 'alert'
      ? AlertTriangle
      : tone === 'info'
        ? Check
        : CheckCircle2;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`animate-fade-up rounded-[12px] border px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[12px] ${toneStyles} ${className}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium break-words">{message}</span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="font-semibold underline underline-offset-2 hover:text-white cursor-pointer"
          >
            {actionLabel}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Cerrar confirmación"
            className="h-5 w-5 inline-flex items-center justify-center rounded-full opacity-75 hover:opacity-100 hover:bg-white/[0.08] cursor-pointer"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
