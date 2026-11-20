/**
 * Marca vectorial minimalista de OMEGA.
 * Isotipo geométrico 28×28px + wordmark tipográfico opcional.
 *
 * @param {{ showText?: boolean, className?: string }} props
 */
export function OmegaBrandMark({ showText = true, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <span
        aria-hidden="true"
        className="w-7 h-7 rounded-lg bg-[#0F131B] border border-white/[0.12] relative flex items-center justify-center overflow-hidden shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_0_16px_rgba(47,111,237,0.2)]"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(47,111,237,0.45),transparent_70%)]"
        />
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative z-10 w-4 h-4 text-[#F8FAFC]"
        >
          <path
            d="M5 18.5H9.2V16.2C7.4 14.9 6.3 12.9 6.3 10.6C6.3 7.3 8.85 4.8 12 4.8C15.15 4.8 17.7 7.3 17.7 10.6C17.7 12.9 16.6 14.9 14.8 16.2V18.5H19"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      {showText && (
        <span className="font-semibold text-[13px] tracking-[0.2em] text-slate-100 uppercase select-none">
          OMEGA
        </span>
      )}
    </span>
  );
}
