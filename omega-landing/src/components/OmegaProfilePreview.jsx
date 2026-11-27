import { useId } from 'react';
import {
  CheckCircle2,
  FileCheck2,
  FileText,
  GitBranch,
  Globe,
  Laptop,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { SpecularCard } from './SpecularCard';

function TactileOmegaOrb() {
  const uid = useId().replace(/:/g, '');
  const glyphId = `tactileOrbGlyph-${uid}`;

  return (
    <div className="relative flex h-24 w-24 items-center justify-center rounded-full">
      <div
        className="relative flex h-full w-full items-center justify-center rounded-full omega-sculpted"
        style={{
          background:
            'radial-gradient(circle at 34% 28%, #182238 0%, #090E19 56%, #04060B 100%)',
        }}
      >
        <div
          aria-hidden="true"
          className="omega-orb-spin omega-orb-ring-mask-glow pointer-events-none absolute -inset-[2px] rounded-full opacity-85"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, rgba(96, 165, 250, 0.9) 45deg, rgba(37, 99, 235, 0.85) 95deg, transparent 150deg)',
            filter: 'blur(6px)',
          }}
        />
        <div
          aria-hidden="true"
          className="omega-orb-spin omega-orb-ring-mask pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, rgba(96, 165, 250, 0.9) 45deg, rgba(37, 99, 235, 0.85) 95deg, transparent 150deg)',
          }}
        />

        <svg viewBox="0 0 80 80" fill="none" className="relative z-10 h-11 w-11">
          <defs>
            <linearGradient id={glyphId} x1="40" y1="16" x2="40" y2="62" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#F8FAFC" />
              <stop offset="100%" stopColor="#CBD5E1" />
            </linearGradient>
          </defs>
          <path
            d="M32.8 59.8H21.6V53.9H29C25 50.1 22.6 44.8 22.6 38.8C22.6 28.7 30.2 21.1 40 21.1C49.8 21.1 57.4 28.7 57.4 38.8C57.4 44.8 55 50.1 51 53.9H58.4V59.8H47.2V53.3C50.4 50.2 52.3 45.3 52.3 39.2C52.3 31.6 47.1 26 40 26C32.9 26 27.7 31.6 27.7 39.2C27.7 45.3 29.6 50.2 32.8 53.3V59.8Z"
            fill={`url(#${glyphId})`}
          />
        </svg>
      </div>
    </div>
  );
}

const GENERAL_MODULE_ICONS = {
  'Equipo Local': Laptop,
  'Celular USB': Smartphone,
  'Escudo Web': Globe,
};

export function OmegaProfilePreview({ profile }) {
  const { id, preview } = profile;

  return (
    <SpecularCard className="rounded-[24px] p-6 md:p-8 min-h-[400px] flex flex-col justify-between gap-6">
      {id === 'GENERAL' && (
        <>
          <div className="relative z-10 flex flex-1 items-center justify-center py-4">
            <div className="grid w-full max-w-md grid-cols-[1fr_auto_1fr] items-center gap-4 sm:gap-6">
              <span className="text-right text-lg md:text-xl font-medium tracking-[-0.02em] text-[#94A3B8]">
                {preview.greeting}
              </span>
              <TactileOmegaOrb />
              <span className="text-left text-lg md:text-xl font-medium tracking-[-0.02em] text-[#F8FAFC]">
                {preview.roleLabel}
              </span>
            </div>
          </div>

          <div className="relative z-10 grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {preview.modules.map((item) => {
              const Icon = GENERAL_MODULE_ICONS[item.name] || ShieldCheck;
              return (
                <div
                  key={item.name}
                  className="omega-sculpted rounded-2xl p-4 flex flex-col gap-3 transition-transform duration-300 hover:-translate-y-0.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="omega-debossed rounded-xl h-9 w-9 flex items-center justify-center">
                      <Icon className="w-4 h-4 text-[#CBD5E1]" strokeWidth={1.75} />
                    </span>
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]"
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#F8FAFC]">{item.name}</p>
                    <p className="mt-0.5 text-xs font-medium text-emerald-400">{item.status}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {id === 'DEVELOPER' && (
        <>
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.10] pb-4">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-[#E2E8F0]">
              <GitBranch className="w-4 h-4 text-[#94A3B8]" strokeWidth={1.75} />
              <span>{preview.repoLabel}</span>
            </div>
            <span className="omega-debossed rounded-full inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
              {preview.repoBadge}
            </span>
          </div>

          <div className="relative z-10 omega-sculpted rounded-2xl p-5 md:p-6 space-y-4 overflow-hidden transition-transform duration-300 hover:-translate-y-0.5">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-3 left-0 w-[2px] rounded-r-full bg-gradient-to-b from-rose-400/90 via-rose-500/80 to-rose-400/20 shadow-[0_0_14px_rgba(244,63,94,0.55)]"
            />

            <div className="pl-2 space-y-2.5">
              <span className="omega-debossed rounded-full inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-rose-400">
                <ShieldAlert className="w-3.5 h-3.5" strokeWidth={1.75} />
                {preview.alertBadge}
              </span>

              <h3 className="text-lg font-medium tracking-[-0.02em] text-[#F8FAFC]">
                {preview.alertTitle}
              </h3>
              <p className="text-sm text-[#94A3B8]">{preview.alertSubtitle}</p>
            </div>

            <div className="pl-2 pt-1 space-y-2">
              <div className="flex items-center justify-between text-xs text-[#94A3B8]">
                <span>{preview.progressLabel}</span>
                <span className="font-mono tabular-nums text-emerald-400">100%</span>
              </div>
              <div className="omega-debossed rounded-full h-2.5 w-full p-[2px] overflow-hidden" aria-hidden="true">
                <div className="h-full w-full rounded-full bg-gradient-to-r from-[#2563EB] to-emerald-400" />
              </div>
            </div>
          </div>

          <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="omega-sculpted rounded-full px-4 py-2 inline-flex items-center gap-2 text-xs font-medium text-[#E2E8F0] transition-transform duration-300 hover:-translate-y-0.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" strokeWidth={1.75} />
              {preview.footerLeft}
            </span>
            <span className="omega-sculpted rounded-full px-4 py-2 inline-flex items-center gap-2 text-xs font-medium text-[#93C5FD] transition-transform duration-300 hover:-translate-y-0.5">
              <FileText className="w-4 h-4" strokeWidth={1.75} />
              {preview.footerRight}
            </span>
          </div>
        </>
      )}

      {id === 'LEGAL' && (
        <>
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.10] pb-4">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-[#E2E8F0]">
              <FileCheck2 className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
              <span>{preview.caseLabel}</span>
            </div>
            <span className="omega-debossed rounded-full inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-[#94A3B8]">
              <Lock className="w-3.5 h-3.5 text-[#60A5FA]" strokeWidth={1.75} />
              {preview.accessBadge}
            </span>
          </div>

          <div className="relative z-10 space-y-4">
            <div className="omega-debossed rounded-2xl px-5 py-3.5">
              <p className="text-sm text-[#CBD5E1]">{preview.question}</p>
            </div>

            <div className="omega-sculpted rounded-2xl p-5 space-y-4 transition-transform duration-300 hover:-translate-y-0.5">
              <p className="text-sm md:text-base text-[#F8FAFC] leading-relaxed">
                {preview.answer}
              </p>

              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-[#2F6FED]/15 border border-[#60A5FA]/40 shadow-[0_0_18px_rgba(47,111,237,0.22)] px-3.5 py-1.5 text-xs font-medium text-[#93C5FD]">
                  <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                  <span>{preview.citation}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="relative z-10 flex items-center justify-between gap-3 border-t border-white/[0.10] pt-4 text-xs text-[#94A3B8]">
            <span className="inline-flex items-center gap-2 font-medium text-[#CBD5E1]">
              <ShieldCheck className="w-4 h-4 text-[#2F6FED]" strokeWidth={1.75} />
              {preview.verifiedNote}
            </span>
          </div>
        </>
      )}
    </SpecularCard>
  );
}
