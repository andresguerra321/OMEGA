import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import {
  EDITORIAL_SPACES,
  LANDING_FAQ,
  PROFILE_ACCESS_NOTES,
  getPlansForProfile,
} from '../../data/catalog';
import { SpecularCard } from '../SpecularCard';

const PILL_SPRING = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 };

/**
 * Capítulo 5A: Planes transparentes en COP con toggles de espacio y ciclo.
 */
export function PricingSection({
  pricingProfile,
  onChangeProfile,
  onStartApp,
  onRequestPilot,
}) {
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [openFaq, setOpenFaq] = useState(0);

  const plans = getPlansForProfile(pricingProfile, billingCycle);

  return (
    <section id="planes" className="relative py-32 md:py-44 px-6 bg-[#05070B] overflow-hidden">
      <div className="relative z-10 max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-4xl md:text-5xl font-medium tracking-[-0.03em] text-[#F8FAFC] text-balance">
            Planes simples.
          </h2>
          <p className="text-base text-[#94A3B8] mt-3">
            Empieza gratis y escala cuando tu equipo lo necesite. Precios en COP.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <div
              role="group"
              aria-label="Filtrar planes por espacio"
              className="omega-debossed inline-flex rounded-full p-1"
            >
              {EDITORIAL_SPACES.map((space) => {
                const active = pricingProfile === space.id;
                return (
                  <button
                    key={space.id}
                    type="button"
                    onClick={() => onChangeProfile(space.id)}
                    className={`relative rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                      active ? 'text-white' : 'text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    {active && (
                      <motion.div
                        layoutId="pricing-space-pill"
                        transition={PILL_SPRING}
                        className="omega-sculpted absolute inset-0 rounded-full"
                      />
                    )}
                    <span className="relative z-10">{space.label}</span>
                  </button>
                );
              })}
            </div>

            <div
              role="group"
              aria-label="Frecuencia de facturación"
              className="omega-debossed inline-flex rounded-full p-1"
            >
              <button
                type="button"
                onClick={() => setBillingCycle('monthly')}
                className={`relative rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                  billingCycle === 'monthly'
                    ? 'text-white'
                    : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                {billingCycle === 'monthly' && (
                  <motion.div
                    layoutId="pricing-cycle-pill"
                    transition={PILL_SPRING}
                    className="omega-sculpted absolute inset-0 rounded-full"
                  />
                )}
                <span className="relative z-10">Mensual</span>
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle('annual')}
                className={`relative rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] inline-flex items-center gap-1.5 ${
                  billingCycle === 'annual'
                    ? 'text-white'
                    : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                {billingCycle === 'annual' && (
                  <motion.div
                    layoutId="pricing-cycle-pill"
                    transition={PILL_SPRING}
                    className="omega-sculpted absolute inset-0 rounded-full"
                  />
                )}
                <span className="relative z-10">Anual</span>
                <span className="relative z-10 text-[#60A5FA] bg-[#2F6FED]/15 px-2 py-0.5 rounded-full text-[11px] tabular-nums">
                  -17%
                </span>
              </button>
            </div>
          </div>

          <p className="mt-3 text-xs text-[#64748B]">
            {PROFILE_ACCESS_NOTES[pricingProfile]}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          {plans.map((plan) => {
            const isFeatured = plan.featured;
            const ctaClass =
              plan.ctaVariant === 'primary'
                ? 'bg-[#2F6FED] hover:bg-[#3B7BF2] text-white shadow-[0_0_24px_rgba(47,111,237,0.35)]'
                : plan.ctaVariant === 'light'
                  ? 'bg-[#F8FAFC] text-[#05070B] hover:bg-white'
                  : 'bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.12] text-white';

            const CardWrapper = isFeatured ? SpecularCard : 'article';
            const cardProps = isFeatured
              ? {
                  as: 'article',
                  className:
                    'rounded-2xl p-7 flex flex-col !bg-[#0B1222]/85 !border-[#2F6FED]/45',
                }
              : {
                  className: 'relative rounded-2xl p-7 flex flex-col omega-glass',
                };

            return (
              <CardWrapper key={plan.id} {...cardProps}>
                {isFeatured && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-[0.18]"
                    style={{
                      background:
                        'radial-gradient(ellipse 75% 85% at 50% 0%, #2F6FED 0%, rgba(47, 111, 237, 0) 75%)',
                    }}
                  />
                )}

                <div className="relative z-10 flex items-center justify-between gap-2">
                  <h3 className="text-lg font-medium text-white text-balance">{plan.name}</h3>
                  {plan.badge && (
                    <span className="bg-[#2F6FED]/15 text-[#60A5FA] border border-[#2F6FED]/30 text-[11px] font-medium px-2.5 py-0.5 rounded-full">
                      {plan.badge}
                    </span>
                  )}
                </div>

                <p className="relative z-10 mt-2 text-sm text-[#94A3B8]">{plan.tagline}</p>

                <div className="relative z-10 mt-6 flex items-baseline gap-1.5">
                  <span className="text-4xl md:text-[42px] font-semibold tracking-[-0.03em] tabular-nums text-white">
                    {plan.displayPrice}
                  </span>
                  <span className="text-sm text-[#94A3B8]">{plan.unitLabel}</span>
                </div>
                <p className="relative z-10 mt-1.5 text-xs text-[#64748B] tabular-nums">
                  {plan.subtext}
                </p>

                <button
                  type="button"
                  onClick={() => {
                    if (plan.ctaAction === 'pilot') {
                      onRequestPilot();
                    } else {
                      onStartApp('register');
                    }
                  }}
                  className={`relative z-10 mt-6 w-full h-11 rounded-xl font-medium text-sm inline-flex items-center justify-center transition-transform active:scale-[0.97] ${ctaClass}`}
                >
                  {plan.ctaLabel}
                </button>

                <div className="relative z-10 my-6 border-t border-white/[0.08]" />

                <ul className="relative z-10 space-y-3 text-sm text-[#CBD5E1]">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <Check
                        className="mt-0.5 w-4 h-4 text-[#2F6FED] shrink-0"
                        strokeWidth={1.75}
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardWrapper>
            );
          })}
        </div>

        <p className="mt-8 text-center text-xs text-[#64748B]">
          Pagos seguros con Mercado Pago · Cancela cuando quieras · Sin cobros sorpresa
        </p>

        <div className="mt-14 max-w-3xl mx-auto">
          <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
            {LANDING_FAQ.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={item.q}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaq(isOpen ? -1 : idx)}
                    className="w-full py-4 flex items-center justify-between gap-4 text-left text-sm font-medium text-[#F8FAFC] hover:text-white transition-colors"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#64748B] shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-[#F8FAFC]' : ''
                      }`}
                      strokeWidth={1.75}
                    />
                  </button>
                  {isOpen && (
                    <p className="pb-4 text-sm text-[#94A3B8] leading-relaxed">{item.a}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
