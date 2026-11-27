import { useId } from 'react';
import { CheckCircle2, FileText, GitBranch, Lock, ShieldAlert, ShieldCheck, Smartphone, Laptop, Globe } from 'lucide-react';

function CompactRoyalEclipse() {
  const uid = useId().replace(/:/g, '');
  const rimId = `previewEclipseRim-${uid}`;

  return (
    <div
      aria-hidden="true"
      className="relative flex h-24 w-24 items-center justify-center rounded-full bg-[#05070B]"
      style={{
        boxShadow: '0 0 36px rgba(47, 111, 237, 0.24)',
      }}
    >
      <svg viewBox="0 0 120 120" fill="none" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id={rimId} x1="18" y1="22" x2="102" y2="98" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1D4ED8" stopOpacity="0.6" />
            <stop offset="40%" stopColor="#93C5FD" stopOpacity="0.95" />
            <stop offset="65%" stopColor="#FFFFFF" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#2F6FED" stopOpacity="0.45" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r="46" fill="#070C17" />
        <circle cx="60" cy="60" r="46" stroke={`url(#${rimId})`} strokeWidth="1.75" />
        <path
          d="M52.8 76.2H41.6V70.3H49C45 66.5 42.6 61.2 42.6 55.2C42.6 45.1 50.2 37.5 60 37.5C69.8 37.5 77.4 45.1 77.4 55.2C77.4 61.2 75 66.5 71 70.3H78.4V76.2H67.2V69.7C70.4 66.6 72.3 61.7 72.3 55.6C72.3 48 67.1 42.4 60 42.4C52.9 42.4 47.7 48 47.7 55.6C47.7 61.7 49.6 66.6 52.8 69.7V76.2Z"
          fill="#F8FAFC"
          fillOpacity="0.94"
        />
      </svg>
    </div>
  );
}

const GENERAL_MODULE_ICONS = {
  'Equipo Local': Laptop,
  'iPhone por USB': Smartphone,
  'Escudo Web': Globe,
};

export function OmegaProfilePreview({ profile }) {
  const { id, preview } = profile;

  if (id === 'GENERAL') {
    return (
      <div className="rounded-2xl bg-[#090D16]/90 border border-white/[0.10] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_24px_60px_rgba(0,0,0,0.6)] p-6 md:p-8 min-h-[380px] flex flex-col justify-between gap-6">
        <div className="flex flex-1 flex-col items-center justify-center text-center gap-3 pt-2">
          <span className="text-sm font-medium text-[#94A3B8]">{preview.greeting}</span>
          <CompactRoyalEclipse />
          <span className="text-lg font-medium tracking-[-0.02em] text-[#F8FAFC]">
            {preview.roleLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {preview.modules.map((item) => {
            const Icon = GENERAL_MODULE_ICONS[item.name] || ShieldCheck;
            return (
              <div
                key={item.name}
                className="rounded-xl bg-[#0E1422] border border-white/[0.08] p-3.5 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <Icon className="w-4 h-4 text-[#94A3B8]" strokeWidth={1.75} />
                  <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
                </div>
                <p className="text-sm font-medium text-[#F8FAFC]">{item.name}</p>
                <p className="text-xs font-medium text-emerald-400">{item.status}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (id === 'DEVELOPER') {
    return (
      <div className="rounded-2xl bg-[#090D16]/90 border border-white/[0.10] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_24px_60px_rgba(0,0,0,0.6)] p-6 md:p-8 min-h-[380px] flex flex-col justify-between gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-[#CBD5E1]">
            <GitBranch className="w-4 h-4 text-[#94A3B8]" strokeWidth={1.75} />
            <span>{preview.repoLabel}</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 border border-emerald-400/25 px-3 py-1 text-xs font-medium text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
            {preview.repoBadge}
          </span>
        </div>

        <div className="rounded-xl bg-[#0E1422] border border-white/[0.08] p-5 space-y-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/12 border border-rose-500/25 px-3 py-1 text-xs font-medium text-rose-400">
            <ShieldAlert className="w-3.5 h-3.5" strokeWidth={1.75} />
            {preview.alertBadge}
          </span>
          <h3 className="text-lg font-medium tracking-[-0.02em] text-[#F8FAFC]">
            {preview.alertTitle}
          </h3>
          <p className="text-sm text-[#94A3B8] leading-relaxed">{preview.alertStatus}</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-4 text-xs">
          <span className="inline-flex items-center gap-2 text-[#CBD5E1] font-medium">
            <ShieldCheck className="w-4 h-4 text-emerald-400" strokeWidth={1.75} />
            {preview.footerLeft}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#93C5FD] font-medium">
            <FileText className="w-4 h-4" strokeWidth={1.75} />
            {preview.footerRight}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[#090D16]/90 border border-white/[0.10] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_24px_60px_rgba(0,0,0,0.6)] p-6 md:p-8 min-h-[380px] flex flex-col justify-between gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-[#CBD5E1]">
          <Lock className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
          <span>{preview.caseLabel}</span>
        </div>
      </div>

      <div className="rounded-xl bg-[#0E1422] border border-white/[0.08] p-5 space-y-4">
        <p className="text-sm font-medium text-[#94A3B8]">{preview.question}</p>
        <p className="text-base text-[#F8FAFC] leading-relaxed">{preview.answer}</p>
        <div className="pt-1">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#2F6FED]/15 border border-[#2F6FED]/35 px-3.5 py-1.5 text-xs font-medium text-[#93C5FD]">
            <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
            <span>{preview.citation}</span>
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-4 text-xs text-[#94A3B8]">
        <span className="inline-flex items-center gap-2 font-medium text-[#CBD5E1]">
          <ShieldCheck className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
          {preview.verifiedNote}
        </span>
      </div>
    </div>
  );
}
